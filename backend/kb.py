"""RAG over the Saudi AI/governance knowledge base (SDAIA, PDPL, generative-AI, health/cloud regs).

Port of the sibling LifeCall kb.py pattern, trimmed for this CP backend.
Index is built lazily at first use so the API stays up even if index deps fail.
"""
import hashlib
import os
import re
from pathlib import Path

KB_DIR = Path(__file__).resolve().parent / "kb"
CHUNK_CHARS = 800
OVERLAP = 120
TOP_K = 3
SCOPE_FLOOR = 0.12      # fallback (non-routed) path — strict
ROUTED_FLOOR = 0.05     # curated topic route — the correct doc is authoritative but must not be pure noise

# Friendly display name for unreadable/mangled filenames (incl. Arabic named PDFs)
GUID_PDF = "86e09090-44e4-481f-bc28-355673607654_ECC--2024-EN.pdf"
FRIENDLY = {
    GUID_PDF: "ECC-2024 Ethics Charter for AI",
    "ai-principles.pdf": "SDAIA AI Principles",
    "AIAdoptionFramework.pdf": "SDAIA AI Adoption Framework",
    "Cloud Computing Services Provisioning Regulations.pdf": "Cloud Computing Provisioning Regulations",
    "CPD Code of Ethics FV.pdf": "CPD Code of Ethics",
    "Executive-Regulations-Health-Profession.pdf": "Executive Regulations - Health Professions",
    "GenerativeAIPublicEN.pdf": "SDAIA Generative AI Guidelines",
    "PDPL.pdf": "Saudi PDPL",
    "SDAIA _ Privacy Policy _ Saudi Data & AI Authority.pdf": "SDAIA Privacy Policy",
}

# Curated topic router for a regulatory KB: explicit query topics -> the correct, READABLE docs.
# Deterministic precision beats hoping TF-IDF names the right document. Docs with no extractable
# text (image-scans like PDPL.pdf) are intentionally absent -- we never cite unreadable sources.
TOPIC_ROUTES = [
    (r"privacy|pdpl|data\s*protection|personal\s*data|de-?identif|قانون\s*حمايه|حمايه\s*(البيانات|المعلومات)|خصوصيه|الخصوصيه", ["SDAIA _ Privacy Policy _ Saudi Data & AI Authority.pdf", "AIAdoptionFramework.pdf", "GenerativeAIPublicEN.pdf"]),
    (r"ai\s*(ethics|principles|responsib)|responsible\s*ai|ethics|اخلاقيات|مبادئ", ["ai-principles.pdf", "AIAdoptionFramework.pdf"]),
    (r"generative\s*ai|genai", ["GenerativeAIPublicEN.pdf"]),
    (r"cloud\s*comput|cloud\s*services", ["Cloud Computing Services Provisioning Regulations.pdf"]),
    (r"health\s*profession|medical|practitioner|healthcare", ["Executive-Regulations-Health-Profession.pdf"]),
    (r"cyber|security", ["86e09090-44e4-481f-bc28-355673607654_ECC--2024-EN.pdf"]),
    # Generic governance questions ("what policies apply") -> the readable policy docs.
    (r"polic(y|ies)|regulation(s)?|compliance|governance|قوانين|قانون|لوائح|لائحه|انظمه|سياسات|سياسه",
     ["SDAIA _ Privacy Policy _ Saudi Data & AI Authority.pdf",
      "Executive-Regulations-Health-Profession.pdf", "ai-principles.pdf"]),
]
_UNREADABLE = {  # image-only PDFs: extracted text is OCR junk, never cite them
    "PDPL.pdf",
}

AR_STOP = {
    "في", "من", "على", "إلى", "عن", "أن", "إن", "التي", "الذي", "الذين", "هذا", "هذه",
    "ذلك", "كان", "كانت", "مع", "ما", "لا", "لم", "لمن", "بين", "كل", "أو", "و", "ثم",
    "هو", "هي", "لقد", "قد", "حيث", "عند", "غير", "كما", "لأن", "بسبب", "ضمن", "أي",
    "يمكن", "يجب", "أنه", "أنها", "وذلك", "التي", "وهي", "وهو", "إذ", "إذا",
}

# Arabic letters we unify so معاملة/التعامالت/hamza variants match
_AR_TRANS = str.maketrans(
    "أإآاٱىؤئءة",
    "ااااايييءه",
)
_AR_DIACRITICS = re.compile(r"[\u064B-\u0652\u0670\u0640]")
_BIDI = re.compile(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069]")


def _norm(text):
    """Normalize Arabic (diacritics/hamza/alef/taa-marbuta), drop bidi/control chars, lowercase."""
    if not text:
        return ""
    text = _BIDI.sub("", text)
    text = _AR_DIACRITICS.sub("", text)
    text = text.translate(_AR_TRANS)
    return text.lower()


# Characters that are PDF-OCR/extraction garbage and should never surface to the user:
# - CJK ideographs / Hangul / fullwidth that pypdf mis-decodes (e.g. 䈡)
# - Arabic presentation-forms-B (ligature junk like ﻣﻘﻴﺪ) and unshaped marks
# - Latin-1 private use / control separators
_GARBAGE = re.compile(
    r"["
    r"\u2E80-\u9FFF"    # CJK radicals..ideographs
    r"\uAC00-\uD7AF"    # Hangul syllables
    r"\uFF00-\uFFEF"    # fullwidth forms
    r"\uFB50-\uFDFF"    # Arabic presentation forms A
    r"\uFE70-\uFEFF"    # Arabic presentation forms B
    r"\u2000-\u200F"    # range dashes..bidi controls
    r"\u2060-\u206F"    # invisible/word-joiner & punctuation
    r"\uFFFD"           # replacement char
    r"\u0000-\u001F"    # ASCII control
    r"\u007F-\u009F"    # C1 controls
    r"]"
)
_MULTISPACE = re.compile(r" {2,}")
_LEADJUNK = re.compile(r"^[^A-Za-z\u0600-\u06FF0-9]+")


def _clean_text(text):
    """Remove PDF-extraction garbage and collapse stray spaces so excerpts read cleanly."""
    if not text:
        return ""
    text = _GARBAGE.sub(" ", text)
    text = _MULTISPACE.sub(" ", text)
    text = _LEADJUNK.sub("", text)
    return text.strip()

INJECTION_PATTERNS = [
    r"ignore (all|any|your|the) (previous|prior|above|earlier|old)? ?(instructions|rules|prompts?|context)",
    r"disregard .{0,30}(instructions|rules|prompt|guard)",
    r"forget (everything|all|your instructions|the rules)",
    r"you are now (a|an|no longer)",
    r"act as (if you are )?(a|an|my)",
    r"pretend (you are|to be)",
    r"reveal (your )?(system )?(prompt|instructions)",
    r"(developer|god|dan) mode",
    r"override (your |the )?(safety|guard|rules|policies)",
    r"bypass (your |the )?(safety|guard|rules|filters?)",
    r"<\|.*(tool|eot|eos).*\|>",
    r"system\s*:\s*new instructions",
    r"you must (obey|comply|follow) (my|these|the) (new |instructions|commands)",
]
PII_PATTERNS = [
    r"\b\d{10,15}\b",
    r"[\w.+-]+@[\w-]+\.[\w.]+",
]


def input_guard(message):
    low = message.lower()
    for pat in INJECTION_PATTERNS:
        if re.search(pat, low):
            return False, "prompt-injection pattern detected"
    for pat in PII_PATTERNS:
        if re.search(pat, message):
            return False, "possible PII in query — redacted from processing"
    if len(message) > 2000:
        return False, "query too long"
    return True, "ok"


def _clean_name(name):
    return _norm(Path(name).stem).strip()

def _friendly(name):
    if name in FRIENDLY:
        return FRIENDLY[name]
    # match by the control-char-stripped normalized stem, so mangled Arabic names resolve
    clean = _clean_name(name)
    for key in FRIENDLY:
        if clean and key.strip().lower() == clean:
            return FRIENDLY[key]
    return Path(name).stem


class KB:
    def __init__(self):
        self.docs = self._extract_pages(self._build_registry())
        self.doc_text = {d["name"]: _clean_text(" ".join(d["pages"])) for d in self.docs}
        self.sha_map = {d["name"]: d["sha256"] for d in self.docs}
        self.chunks, self.store = self._chunk_and_store(self.docs)
        self.vectorizer, self.matrix = self._build_index(self.store)
        self.total_pages = sum(d["n_pages"] for d in self.docs)

    def _build_registry(self):
        docs = []
        for p in sorted(KB_DIR.glob("*.pdf")):
            docs.append({"name": p.name, "path": p,
                         "sha256": hashlib.sha256(p.read_bytes()).hexdigest()[:16]})
        return docs

    def _extract_pages(self, docs):
        from pypdf import PdfReader

        for d in docs:
            try:
                reader = PdfReader(str(d["path"]))
                pages = [(pg.extract_text() or "") for pg in reader.pages]
            except Exception:
                pages = [""]
            d["pages"] = pages
            d["n_pages"] = len(pages)
        return docs

    def _chunk_and_store(self, docs):
        chunks, store = [], []
        for d in docs:
            # ponytail: clean once at ingestion so garbage never reaches the index or the user
            text = _clean_text(" ".join(d["pages"]))
            text = re.sub(r"\s+", " ", text).strip()
            for i in range(0, len(text), CHUNK_CHARS - OVERLAP):
                piece = text[i : i + CHUNK_CHARS]
                if len(piece) < 80:
                    break
                chunks.append({"doc": d["name"], "text": piece})
                store.append(_norm(piece))
        return chunks, store

    def _build_index(self, store):
        from sklearn.feature_extraction.text import TfidfVectorizer

        stop = sorted(AR_STOP | set(TfidfVectorizer(stop_words="english").get_stop_words()))
        vec = TfidfVectorizer(stop_words=stop, token_pattern=r"(?u)\b\w+\b", sublinear_tf=True)
        mat = vec.fit_transform(store)
        return vec, mat

    def retrieve(self, query, k=TOP_K):
        from sklearn.metrics.pairwise import cosine_similarity

        nq = _norm(query)
        qv = self.vectorizer.transform([nq])
        scores = cosine_similarity(qv, self.matrix).ravel()

        def best_chunk_per_doc(self):
            best = {}
            for i, c in enumerate(self.chunks):
                if c["doc"] in best or c["doc"] in _UNREADABLE:
                    continue
                best[c["doc"]] = (scores[i], i)
            return best

        best = best_chunk_per_doc(self)
        # Route to the curated, correct doc(s) for a clearly-governance query.
        for pat, docs in TOPIC_ROUTES:
            if re.search(pat, nq):
                ordered = [d for d in docs if d in best]
                if ordered:
                    out = [{"doc": d, "score": round(best[d][0], 4), "routed": True,
                            "text": self.chunks[best[d][1]]["text"][:600]} for d in ordered]
                    rest = sorted((d for d in best if d not in ordered),
                                  key=lambda d: best[d][0], reverse=True)[: max(0, k - len(out))]
                    out += [{"doc": d, "score": round(best[d][0], 4), "routed": False,
                             "text": self.chunks[best[d][1]]["text"][:600]} for d in rest]
                    return out[:k]
        # Fallback: rank best chunk per doc by doc-level term overlap, then cosine.
        q_terms = set(re.findall(r"(?u)\b[a-zA-Z]{4,}\b", nq))
        overlap = {doc: len(q_terms & self._terms_of(doc)) for doc in best}
        ranked = sorted(best.items(), key=lambda kv: (overlap[kv[0]], kv[1][0]), reverse=True)
        return [{"doc": doc, "score": round(best[doc][0], 4), "routed": False,
                 "text": self.chunks[best[doc][1]]["text"][:600]}
                for doc, _ in ranked[:k]]

    def _terms_of(self, doc):
        ts = getattr(self, "_doc_terms", None)
        if ts is None:
            ts = self._doc_terms = {}
        if doc not in ts:
            ts[doc] = set(re.findall(r"(?u)\b[a-zA-Z]{4,}\b", _norm(self.doc_text.get(doc, ""))))
        return ts[doc]

    def kb_context(self, retrieved):
        return "\n\n".join(
            f"[{_friendly(r['doc'])} | relevance {r['score']:.2f}]\n{r['text']}"
            for r in retrieved
        )

    def kb_compact(self, retrieved):
        """Top excerpt only, trimmed — for chat so the reasoning model stays short and fast."""
        if not retrieved:
            return ""
        r = retrieved[0]
        return f"From \"{_friendly(r['doc'])}\": {_clean_text(r['text'][:420])}"

    def fallback_answer(self, retrieved, lang="en"):
        """Deterministic cited answer from the top excerpt — used for grounded chat queries."""
        if not retrieved:
            return None
        top = retrieved[0]
        title = _friendly(top["doc"])
        snippet = " ".join(_clean_text(top["text"]).split()).rstrip(".")[:220]
        if lang == "ar":
            return f"استناداً إلى {title}: {snippet}."
        return f"Based on {title}: {snippet}."

    def citations(self, retrieved):
        seen, out = set(), []
        for r in retrieved:
            if r["doc"] in seen:
                continue
            seen.add(r["doc"])
            out.append({"doc": r["doc"], "title": _friendly(r["doc"]),
                        "sha256": self.sha_map.get(r["doc"], ""), "score": round(r["score"], 3)})
        return out

    def best_quote(self, doc, min_len=140):
        """First body chunk of `doc` that is mostly readable after cleaning (skip covers/headers)."""
        for c in self.chunks:
            if c["doc"] != doc:
                continue
            t = _clean_text(c["text"]).strip()
            low = t.lower()
            if any(x in low for x in ("www.", "saudimoh", "moh.gov", "about portal", "log in")):
                continue
            letters = sum(1 for ch in t if ch.isalpha())
            if len(t) >= min_len and letters / max(len(t), 1) >= 0.5:
                return t[:420]
        return None

    def evidence(self, retrieved):
        """Real supporting quotes for the UI: title + snippet + score per retrieved doc."""
        seen, out = set(), []
        for r in retrieved:
            if r["doc"] in seen:
                continue
            seen.add(r["doc"])
            out.append({"type": "kb", "title": _friendly(r["doc"]), "doc": r["doc"],
                        "score": round(r["score"], 3), "quote": _clean_text(r["text"][:400])})
        return out


_K = None


def init():
    global _K
    if _K is None:
        _K = KB()
    return _K


def kb_stats():
    """Lightweight index report without forcing a full build (for /api/pipeline src-node)."""
    try:
        k = init()
        return {"docs": len(k.docs), "pages": k.total_pages, "chunks": len(k.chunks)}
    except Exception:
        return None
