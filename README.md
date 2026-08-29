# Gait-Training Patient Monitoring & KB-Anchored Chat

**Hackathon**: AI Readiness Hackathon – Kingdom of Saudi Arabia  
**Event**: https://aiforgood.itu.int/event/ai-readiness-hackathon-kingdom-of-saudi-arabia/

A production-ready full-stack web app for gait‑training sessions of cerebral‑palsy patients, demonstrating **honest, grounded AI** in a regulatory setting. The chat cites only KB evidence that actually supports the answer; PDF‑extraction garbage is stripped from excerpts; only relevant documents are cited; AI summaries are factual (no praise, no invented compliance claims) and contain no fake mandatory PDPL/SaMD footer; the chat reports when it has no KB evidence. All of this is achieved without relying on the LLM for summaries — deterministic templates guarantee consistency.

## Core Features (fixing the complaints that mattered most)

| Feature | Problem it fixes |
|---|---|
| **Honest grounding** | KB evidence only when actually supported; session‑stat answers cite the session; never fabricate KB evidence |
| **PDF‑extraction garbage cleanup** | `_clean_text()` strips CJK/Hangul/fullwidth/replacement/control chars; Arabic normalization (`_norm()`) unifies alef/hamza/taa‑marbuta |
| **Retrieval precision** | Topic‑router maps governance queries (`PDPL`, `AI ethics`, `generative AI`, `cybersecurity`, `health‑profession`) to the correct readable doc; image‑only PDFs excluded; two‑tier SCOPE_FLOOR (0.12 fallback, 0.05 routed) |
| **No fake mandatory footer** | Removed `FOOTER_AR`/`FOOTER_EN`, `SYSTEM_PROMPT`, `output_guard` |
| **Factual summaries** | Deterministic template in Arabic & English: duration, knee‑target progress, red‑alert count. No praise, no invented compliance claims |
| **Ungrounded chat citations always `[]`** | No irrelevant KB citations leak through on session/general answers |
| **Chat opinion + walking‑stage suggestion** | System prompt asks the model for a brief clinical read and ONE small practical suggestion (cadence, repetition, rest, cueing) tied to real numbers |

## Hackathon Alignment

| Theme | How this project serves it |
|---|---|
| **AI Readiness** – policies, governance, compliance | KB holds Saudi PDPL, SDAIA Privacy Policy, SDAIA AI Principles, ECC cybersecurity, Executive Regulations‑Health‑Professions. Grounded answers cite the exact doc & clause. |
| **Groundedness & attribution** | Every KB‑grounded answer starts with `"Based on <title>: …"` and lists deterministic citations. Ungrounded answers return empty citations. |
| **Factuality & hallucination reduction** | Summaries are deterministic templates; the model never emits `reasoning_content` as user‑facing reply; `llama()` retries once and never returns `reasoning_content`. |
| **Arabic language support** | Normalization, stopwords, friendly names for Arabic PDFs, Arabic topic‑route keywords. |
| **Production‑ready code** | No speculative abstractions; deletions over additions; minimal dependencies; deterministic fallback when LLM is unreliable. |

## Project Structure

```
full_app/
├── backend/              # FastAPI on port 8001
│   ├── kb.py             # KB init + retrieve with topic routing, garbage‑clean text, two‑tier floor
│   ├── main.py           # Deterministic compose_summary, chat handler, no fake footer
│   └── kb/               # 11 PDFs (one image‑only → excluded from citations)
├── frontend/             # Vite/React dev server on port 5173
│   ├── src/app/components/CaregiverReport.tsx  # Report page: short summary card, expandable sources, embedded chat
│   └── ... (source files, NOT node_modules)
├── .gitignore            # Excludes node_modules/, dist/, __pycache__/, *.pyc
├── README.md             # This file – hackathon project description
└── sessions/             # Session JSONs + videos
```

## How to Run

```bash
# 1. Backend (port 8001)
pushd backend
  powershell -ExecutionPolicy Bypass -File ..\..\AppData\Local\Temp\opencode\launch_backend.ps1
# 2. Frontend (port 5173)
pushd frontend
  powershell -ExecutionPolicy Bypass -File ..\..\AppData\Local\Temp\opencode\launch_frontend.ps1
# 3. Open http://localhost:5173/  (report page) or http://localhost:8001/docs
```

## Known Limitations

- **LLM flakiness** – ungrounded chat sometimes returns `"Could not reach the local LLM server."` (port 8081 timeout). The shared llama.cpp server is unstable under load.
- **Arabic PDPL doc is image‑only** – zero extractable text, so it never surfaces in retrieval. Honest: we never cite an unreadable source.
- **No user authentication** – any user can start a new gait‑training session; existing session JSONs are left as‑is.
- **Rich clinical view chart** – a target 170° line with risk zones still pending (visual communication pending).

## License

Internal hackathon project – all code is open‑source under the repo license.