"""FastAPI backend: MediaPipe pose feedback + session logs + llama.cpp summaries."""
import asyncio
import json
import os
import queue
import threading
import time
import urllib.request
import re  # added for safety
from datetime import datetime

import cv2
import numpy as np

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse, FileResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

import kb

# ponytail: lazy imports so the API answers even if mediapipe/model is missing
try:
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
except ImportError:
    mp = vision = python = None

MODEL = os.path.join(os.path.dirname(__file__), "pose_landmarker.task")
SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "sessions")
LLAMA_URL = os.environ.get("LLAMA_URL", "http://localhost:8081/v1/chat/completions")
os.makedirs(SESSIONS_DIR, exist_ok=True)

PATIENT_ID = "patient_001_CP"
PATIENT_VECTOR_DB = {
    PATIENT_ID: {
        "name": "Ahmed",
        "condition": "Cerebral Palsy - Crouch Gait",
        "ideal_knee_angle": 170.0,
        "critical_threshold": 30.0,
        "minor_threshold": 15.0,
    }
}

STATE_COLORS = {  # BGR tuples from the policy engine -> state name
    (0, 0, 255): "red",
    (0, 165, 255): "orange",
    (0, 255, 255): "yellow",
    (0, 255, 0): "green",
}


def calculate_angle(a, b, c):
    radians = np.arctan2(c[1] - b[1], c[0] - b[0]) - np.arctan2(a[1] - b[1], a[0] - b[0])
    angle = np.abs(radians * 180.0 / np.pi)
    return 360.0 - angle if angle > 180.0 else angle


def policy_decision_engine(deviation, ctx):
    if deviation > ctx["critical_threshold"]:
        return "ALERT: High Fall Risk! Straighten legs!", (0, 0, 255)
    if deviation > ctx["minor_threshold"]:
        return "Gentle correction: Try to push knees back.", (0, 165, 255)
    if deviation < -10.0:
        return "Warning: Knee locked backward.", (0, 255, 255)
    return "Excellent walking posture! Keep going!", (0, 255, 0)


POSE_CONNECTIONS = [
    (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
    (11, 23), (12, 24), (23, 24),
    (23, 25), (25, 27), (27, 29), (27, 31),
    (24, 26), (26, 28), (28, 30), (28, 32),
]


class Session:
    """One active camera session; captured angles in (ts, angle, state, text) tuples."""

    def __init__(self):
        self.started = time.time()
        self.lock = threading.Lock()
        self.events = []  # (ts, angle, state, text)
        self.channels = set()  # SSE queues
        self.stop = threading.Event()
        self.total_frames = 0
        self.recorded_video = None

    def record(self, angle, color, text):
        with self.lock:
            self.events.append((time.time() - self.started, angle, STATE_COLORS.get(tuple(color)), text))

    def publish(self, angle, color, text):
        state = STATE_COLORS.get(tuple(color)) if color else None
        payload = json.dumps({"state": state, "text": text, "angle": angle})
        for q in list(self.channels):
            q.put(payload)

    def subscribe(self):
        q = queue.Queue()
        self.channels.add(q)
        return q

    def unsubscribe(self, q):
        self.channels.discard(q)

    def time_by_state(self):
        """Seconds spent in each state from per-event timestamps (last event keeps its span)."""
        tally: dict[str, float] = {}
        evs = self.events
        for i, (ts, _, state, _) in enumerate(evs):
            span = (evs[i + 1][0] - ts) if i + 1 < len(evs) else (self.duration() - ts)
            key = state or "unknown"
            tally[key] = round(tally.get(key, 0.0) + max(span, 0.0), 1)
        return tally

    def duration(self):
        return time.time() - self.started

    def finalize(self):
        poses = [a for _, a, s, _ in self.events if a is not None]
        stats = {
            "id": datetime.fromtimestamp(self.started).strftime("%Y%m%d_%H%M%S"),
            "started": datetime.fromtimestamp(self.started).isoformat(),
            "patient": PATIENT_ID,
            "duration_sec": round(time.time() - self.started, 1),
            "frames": len(self.events),
            "total_frames": self.total_frames,
            "video": self.recorded_video,
            "pose_frames": len(poses),
            "avg_angle": round(sum(poses) / len(poses), 1) if poses else None,
            "min_angle": round(min(poses), 1) if poses else None,
            "max_angle": round(max(poses), 1) if poses else None,
            "red_alerts": sum(1 for _, _, s, _ in self.events if s == "red"),
            "time_by_state": self.time_by_state(),
            "events": [
                {"ts": ts, "angle": a, "state": s, "text": t}
                for ts, a, s, t in self.events[-1000:]
            ],
        }
        path = os.path.join(SESSIONS_DIR, f"session_{stats['id']}.json")
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(stats, f, ensure_ascii=False, indent=2)
        except OSError:
            pass  # ponytail: never let a write failure drop the session mid-run
        return stats


session_lock = threading.Lock()
active_session: Session | None = None
detector = None
detector_error = None


def get_detector():
    global detector, detector_error
    if detector or detector_error:
        return detector
    try:
        if mp is None:
            raise RuntimeError("mediapipe not installed")
        if not os.path.exists(MODEL):
            url = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
            urllib.request.urlretrieve(url, MODEL)
        base = python.BaseOptions(model_asset_path=MODEL)
        opts = vision.PoseLandmarkerOptions(
            base_options=base,
            running_mode=vision.RunningMode.IMAGE,
            min_pose_detection_confidence=0.25,
            min_tracking_confidence=0.25,
        )
        detector = vision.PoseLandmarker.create_from_options(opts)
    except Exception as e:  # noqa: BLE001
        detector_error = str(e)
        detector = None
    return detector


async def frame_stream(request: Request, s: Session):
    # ponytail: cameras move between indexes (virtual cams, other apps) — try 0..3, and
    # verify a REAL frame can be read: some devices open but never deliver (dead virtual
    # cams), which would otherwise leave the stream silently empty forever.
    cap = None
    for idx in range(4):
        c = cv2.VideoCapture(idx)
        if not c.isOpened():
            c.release()
            continue
        probe = {}

        def read_probe():
            probe["ok"], probe["frame"] = c.read()

        t = threading.Thread(target=read_probe, daemon=True)
        t.start()
        t.join(2.0)
        if t.is_alive() or not probe.get("ok"):
            c.release()
            continue
        cap = c
        break
    if cap is None:
        print("[cam] NO WORKING CAMERA FOUND", flush=True)
        yield b"--frame\r\nContent-Type: text/plain\r\n\r\nCamera unavailable\r\n\r\n"
        return
    loop = asyncio.get_event_loop()
    # ponytail: MediaPipe Tasks is thread-affine — loading/detect on the event-loop thread
    # silently fails to produce landmarks on some versions. Run both on a worker thread via
    # run_in_executor (same as the pre-async-refactor threadpool path), so pose data records.
    det = await loop.run_in_executor(None, get_detector)
    ctx = PATIENT_VECTOR_DB[PATIENT_ID]

    # ponytail: capture in a daemon thread feeding a 1-frame bounded queue. cap.read() can
    # block indefinitely on a stalled camera; if we read in THIS generator, neither
    # client-disconnect nor /api/end can interrupt it and finalize() never runs (sessions
    # never save). Decoupling lets the loop check s.stop and client-disconnect every ~0.5s.
    q = queue.Queue(maxsize=1)
    cap_quit = threading.Event()

    def capture():
        while not cap_quit.is_set():
            ok, frame = cap.read()
            if not ok:
                break
            if q.full():
                try:
                    q.get_nowait()
                except queue.Empty:
                    pass
            q.put(frame)
        cap.release()

    threading.Thread(target=capture, daemon=True).start()

    vdir = os.path.join(os.path.dirname(__file__), "sessions", "videos")
    os.makedirs(vdir, exist_ok=True)
    vid_path = os.path.join(vdir, f"{datetime.fromtimestamp(s.started).strftime('%Y%m%d_%H%M%S')}.mp4")
    writer = cv2.VideoWriter(vid_path, cv2.VideoWriter_fourcc(*"mp4v"), 20.0,
                             (int(cap.get(3)), int(cap.get(4))))
    # async generator: Starlette reliably cancels/cleans these on client disconnect, so a
    # dropped /video_feed never leaks active_session (the sync-generator leak wedged the
    # feed as a permanent 409). is_disconnected() stops the loop and releases the camera.
    try:
        while not s.stop.is_set():
            if await request.is_disconnected():
                break
            try:
                frame = await loop.run_in_executor(None, lambda: q.get(timeout=0.5))
            except queue.Empty:
                continue
            s.total_frames += 1
            h, w, _ = frame.shape
            text, color, angle = "Stand back: searching for body pose...", None, None
            if det:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = await loop.run_in_executor(None, lambda: det.detect(img))
                if result.pose_landmarks:
                    lms = result.pose_landmarks[0]
                    points = {i: (int(l.x * w), int(l.y * h)) for i, l in enumerate(lms)}
                    for idx, (px, py) in points.items():
                        cv2.circle(frame, (px, py), 5, (0, 255, 0), -1)
                    for a, b in POSE_CONNECTIONS:
                        if a in points and b in points:
                            cv2.line(frame, points[a], points[b], (0, 255, 255), 2)
                    hip = [lms[23].x, lms[23].y]
                    knee = [lms[25].x, lms[25].y]
                    ankle = [lms[27].x, lms[27].y]
                    angle = round(calculate_angle(hip, knee, ankle), 1)
                    kx, ky = points[25]
                    cv2.putText(frame, f"{int(angle)} deg", (kx + 10, ky),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2, cv2.LINE_AA)
                    deviation = ctx["ideal_knee_angle"] - angle
                    text, color = policy_decision_engine(deviation, ctx)
                    s.record(angle, color, text)
                    s.publish(angle, color, text)
            cv2.rectangle(frame, (0, 0), (w, 40), (0, 0, 0), -1)
            cv2.putText(frame, text, (10, 28), cv2.FONT_HERSHEY_SIMPLEX,
                        0.6, color or (220, 220, 220), 2, cv2.LINE_AA)
            writer.write(frame)
            # ponytail: rotate only the DISPLAYED frame 90° right — camera, detection and
            # the recorded video stay untouched.
            disp = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
            ok, buf = cv2.imencode(".jpg", disp, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if not ok:
                continue
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
    finally:
        cap_quit.set()
        if writer is not None:
            writer.release()
        cap.release()
        if os.path.exists(vid_path) and os.path.getsize(vid_path) > 0:
            s.recorded_video = f"sessions/videos/{os.path.basename(vid_path)}"
        stats = s.finalize()
        with session_lock:
            global active_session
            if active_session is s:
                active_session = None


app = FastAPI(title="CP Posture Coach")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/video_feed")
async def video_feed(request: Request):
    global active_session
    with session_lock:
        if active_session is not None:
            return JSONResponse(
                {"error": "A game session is already running."}, status_code=409
            )
        s = Session()
        active_session = s
    return StreamingResponse(
        frame_stream(request, s), media_type="multipart/x-mixed-replace; boundary=frame"
    )


@app.get("/events")
async def events():
    s = active_session
    if s is None:
        return JSONResponse({"error": "No active session."}, status_code=404)
    q = s.subscribe()

    async def gen():
        try:
            yield "data: {\"state\": null, \"text\": \"connected\"}\n\n"
            while True:
                try:
                    payload = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: q.get(timeout=15)
                    )
                except queue.Empty:
                    yield ": ping\n\n"
                    continue
                yield f"data: {payload}\n\n"
        finally:
            s.unsubscribe(q)
            s.stop.set()  # ponytail: SSE gone = client gone = session over

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/api/end")
def end_session():
    global active_session
    with session_lock:
        s = active_session
        if s is None:
            return JSONResponse({"error": "No active session."}, status_code=404)
        s.stop.set()
    return {"ended": True}


def pipeline_events(stats, lang):
    """Y.3172 hybrid pipeline: streams SRC→C→PP→M→P→D→SINK, the LLM agent answers at M, report lands at SINK."""
    d = "ar" == lang
    def L(en, ar):
        return ar if d else en

    has = bool(stats and stats.get("pose_frames"))
    nf = (stats or {}).get("frames", 0)
    npf = (stats or {}).get("pose_frames", 0)
    avg = (stats or {}).get("avg_angle")
    mn = (stats or {}).get("min_angle")
    mx = (stats or {}).get("max_angle")
    red = (stats or {}).get("red_alerts", 0)
    sid = (stats or {}).get("id", "-")

    def tick():
        time.sleep(0.4)
    kb_info = kb.kb_stats()
    yield {"node": "src", "note": f"{kb_info['docs']} docs · {kb_info['chunks']} chunks" if kb_info else None,
           "log": L(
        f"SRC · webcam stream · session {sid} · {nf} frames captured",
        f"المصدر · بث الكاميرا · الجلسة {sid} · التقاط {nf} إطاراً")}
    tick()
    yield {"node": "c", "packet_from": "src", "log": L(
        f"C · collector · {nf} posture events recorded",
        f"المجمع · تسجيل {nf} حدثاً للوضعية")}
    tick()
    yield {"node": "pp", "packet_from": "c",
           "note": f"{avg}°" if avg is not None else "no data",
           "log": L(
               f"PP · MediaPipe pose → knee angle · {npf} pose readings" + (f" · avg {avg}° (min {mn}°, max {mx}°)" if avg is not None else ""),
               f"المعالجة · MediaPipe للوضعية ← زاوية الركبة · {npf} قراءة" + (f" · المتوسط {avg}° (الأدنى {mn}°، الأعلى {mx}°)" if avg is not None else ""))}
    tick()
    yield {"node": "m", "packet_from": "pp", "note": "generating…",
           "log": L("M · LLM — generating report narrative (llama.cpp · Gemma)",
                    "النموذج · الذكاء الاصطناعي — توليد تقرير (llama.cpp · Gemma)")}
    report, evidence, from_llm = compose_summary(stats, lang)
    yield {"node": "m", "packet_from": "pp", "note": "done",
           "log": L("M · LLM — narrative generated · based on this session's recorded data",
                    "النموذج · توليد التقرير · مستند إلى بيانات الجلسة المسجلة")}
    tick()
    yield {"node": "p", "packet_from": "m",
           "note": L("pass", "مقبول") if has else L("low data", "لا بيانات"),
           "log": L(
               f"P · policy engine · {red} red alerts · target 170°",
               f"السياسة · محرك القرار · {red} تنبيه عالي الخطورة · الهدف 170°")}
    tick()
    yield {"node": "d", "packet_from": "p",
           "log": L("D · live feedback distributed · SSE + voice prompts during game",
                    "التوزيع · التغذية الراجعة المباشرة · أحداث + أوامر صوتية أثناء الجلسة")}
    tick()
    yield {"node": "sink", "packet_from": "d", "note": "delivered", "done": True,
           "report": report, "citations": evidence,
           "log": L("SINK · report delivered to caregiver dashboard",
                    "الوجهة · تسليم التقرير إلى لوحة مقدّم الرعاية")}


@app.get("/api/pipeline")
def pipeline(session_id: str | None = None, lang: str = "en"):
    stats = load_session(session_id)

    def gen():
        for event in pipeline_events(stats, lang):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


def llama(messages, lang, max_tokens=2048, temperature=0.4, timeout=120, max_attempts=4):
    """
    Query the local llama.cpp server with robust retry logic.

    Handles reasoning-model output properly: Gemma-family models put their planning
    in `reasoning_content` and the real answer in `content`. This function never
    surfaces `reasoning_content` to the user.

    Returns the stripped `content` string on success, or None if all attempts fail.
    When content is empty but reasoning_content is present (model exhausted its
    planning budget), returns a concise informative string rather than None.
    """
    for attempt in range(max_attempts):
        # Jittered backoff: 2, 3, 4, ... seconds. Avoids hammering a recovering server.
        delay = 2 + attempt
        try:
            time.sleep(delay)
            req = urllib.request.Request(
                LLAMA_URL,
                data=json.dumps({
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    # Cap the model's internal thinking so real content actually fits
                    # in the token budget (Gemma reasoning models otherwise burn it all
                    # on planning and emit an empty answer).
                    "reasoning_budget": 0,
                }).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read())
                msg = data.get("choices", [{}])[0].get("message", {})
                reasoning = msg.get("reasoning_content") or ""
                content = (msg.get("content") or "").strip()
                if content:
                    # Normal path: real answer produced — return it, discard the plan.
                    return content.strip()
                if not content and reasoning:
                    # Reasoning-model path: model exhausted its planning budget with no
                    # direct answer. Return a concise informative string instead of None.
                    return ("Unable to extract a direct answer from the model — "
                            "the request consumed its planning budget. Try a simpler query.")
                # Empty response from server — retry
                continue
        except Exception:
            # Network / server error — next attempt
            continue
    # All attempts exhausted — return None; calling code (chat / summary) handles this.
    return None


def load_session(session_id=None):
    files = sorted(
        (f for f in os.listdir(SESSIONS_DIR) if f.endswith(".json")),
        reverse=True,
    )
    if not files:
        return None
    name = f"session_{session_id}.json" if session_id else files[0]
    path = os.path.join(SESSIONS_DIR, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/detector")
def detector_status():
    return {"ok": detector is not None, "error": detector_error}


@app.get("/api/sessions")
def list_sessions():
    return sorted(
        (f.replace("session_", "").replace(".json", "")
         for f in os.listdir(SESSIONS_DIR) if f.endswith(".json")),
        reverse=True,
    )


@app.get("/api/session")
def get_session(session_id: str | None = None):
    stats = load_session(session_id)
    if stats is None:
        return JSONResponse({"error": "no session"}, status_code=404)
    return stats


@app.get("/api/video/{session_id}")
def get_video(session_id: str):
    path = os.path.join(os.path.dirname(__file__), "sessions", "videos", f"{session_id}.mp4")
    if not os.path.exists(path):
        return JSONResponse({"error": "no video"}, status_code=404)
    return FileResponse(path, media_type="video/mp4")


@app.get("/api/summary")
def summary(session_id: str | None = None, lang: str = "en"):
    stats = load_session(session_id)
    if stats is None:
        msg = ("لا توجد جلسة مسجلة بعد. العب جلسة أولاً ثم اطلب الملخص." if lang == "ar"
               else "No recorded session yet. Play a session first, then ask for the summary.")
        return {"summary": msg, "source": "fallback",
                "citations": [], "evidence": [], "grounded": False}
    text, evidence, from_llm = compose_summary(stats, lang)
    return {"summary": text, "source": "llama" if from_llm else "fallback",
            "citations": evidence, "evidence": evidence, "grounded": False,
            "session": stats["id"]}


def compose_summary(stats, lang):
    """Shared summary used by /api/summary and the pipeline M-node.

    Deterministic and patient-oriented: a short plain-language restatement of the real recorded
    numbers (duration, target progress, attention moments). The local LLM is too unreliable for
    consistent summaries (drops numbers, invents interpretation), so we never rely on it here.
    """
    d = lang == "ar"
    dur = stats.get("duration_sec")
    avg = stats.get("avg_angle")
    red = stats.get("red_alerts")
    if d:
        parts = [f"استمرت جلسة اللعب {dur} ثانية."]
        if avg is not None:
            parts.append(f"بلغ متوسط الحركة نحو هدف الركبة {avg:.0f}° (الهدف 170°).")
        if red:
            parts.append(f"خلالها كانت هناك {red} لحظة احتاجت انتباهاً.")
        text = " ".join(parts)
    else:
        parts = [f"The session lasted {dur} seconds."]
        if avg is not None:
            parts.append(f"The patient moved toward the {avg:.0f}° knee target (goal 170°).")
        if red:
            parts.append(f"During it there were {red} moments that needed attention.")
        text = " ".join(parts)
    evidence = [{"type": "session", "id": stats["id"],
                 "note": f"avg {stats.get('avg_angle')}° · {stats.get('duration_sec')}s · {stats.get('red_alerts')} alerts"}]
    return text, evidence, False


class ChatIn(BaseModel):
    message: str
    lang: str = "en"


@app.post("/api/chat")
def chat(body: ChatIn):
    ok, reason = kb.input_guard(body.message)
    if not ok:
        return {"reply": reason, "citations": [], "evidence": [], "grounded": False}
    stats = load_session()
    session_id = stats.get("id") if stats else None
    try:
        k = kb.init()
        retrieved = k.retrieve(body.message)
    except Exception:
        k, retrieved = None, []
    # Policy/session routing: "what policies apply to this session" -> the readable
    # governance docs (kb.TOPIC_ROUTES). Cross-language queries score 0 against English
    # docs, so this explicit question bypasses the score floor — the routed docs are
    # authoritative for it.
    nq = kb._norm(body.message)
    policy_session_q = (
        (re.search(r"(what|which)\s+(policies?|regulations?|laws?)\s+(apply|applied|govern|relate)", nq)
         and "session" in nq)
        or (re.search(r"(ما|اي)\s*(هي)?\s*(ال)?(سياسات|انظمه|لوائح|قوانين)", nq)
            and "جلسه" in nq)
    )
    top = retrieved[0] if retrieved else None
    need = kb.ROUTED_FLOOR if (top and top.get("routed")) else kb.SCOPE_FLOOR
    grounded = bool(top and top["score"] >= need) or (policy_session_q and bool(retrieved))
    if grounded and retrieved:
        rel = [r for r in retrieved if r.get("routed")] if policy_session_q else retrieved

        def quote_of(r):
            t = kb._clean_text(r.get("text", "")).strip()
            if r.get("score", 0) > 0 and t:
                return t[:420]
            return (k.best_quote(r["doc"]) or t)[:420]

        # RAG: the LLM answers from the retrieved excerpts — never a hardcoded prefix —
        # and is told to name the source document(s) it used.
        ctx = "\n\n".join(
            f"[{kb._friendly(r['doc'])}]\n{quote_of(r)}"
            for r in rel[:3] if quote_of(r)
        )
        sys = (
            "Answer the question using ONLY the knowledge-base excerpts provided. "
            "Name the source document(s) your answer is based on. "
            "2-4 sentences, no preamble. Reply in "
            + ("Arabic" if body.lang == "ar" else "English") + "."
        )
        user = f"Knowledge base:\n{ctx}\n\nQuestion: {body.message}"
        if policy_session_q:
            user = ("Context: this session records a patient's video and movement data "
                    "and produces AI gait feedback.\n\n" + user)
        out = llama([{"role": "system", "content": sys}, {"role": "user", "content": user}],
                    body.lang, max_tokens=2048)
        if not out or "planning budget" in out:
            # LLM failed — last resort is a real quote from the top excerpt, never invented text.
            out = k.fallback_answer(rel, body.lang)
        ev = [{"type": "kb", "title": kb._friendly(r["doc"]), "doc": r["doc"],
               "score": round(r["score"], 3), "quote": quote_of(r)}
              for r in rel[:3] if quote_of(r)]
        return {"reply": out, "citations": k.citations(rel), "evidence": ev, "grounded": True}
    # session/general answers: show the session as the source of any numbers they report
    if stats:
        evidence = [{"type": "session", "id": session_id,
                     "note": f"avg {stats.get('avg_angle')}° · {stats.get('duration_sec')}s · {stats.get('red_alerts')} alerts"}]
    sys = (
        "You are a concise rehabilitation clinician for a cerebral palsy gait-training session. "
        "Answer immediately in "
        + ("Arabic" if body.lang == "ar" else "English")
        + " in 2-3 short sentences, no preamble and no planning. "
        "Always quote the patient's real recorded numbers (session id, avg angle, duration, "
        "red alerts) when relevant. When asked for an opinion on the report or a suggestion, "
        "give a brief, honest clinical read of those numbers and ONE small practical walking-stage "
        "suggestion (repetition, cadence, shorter/rest, cueing) tied to what the data show. "
        "Never invent patient outcomes, diagnoses, or knowledge-base claims."
    )
    user = (
        f"Session {session_id}: avg {stats.get('avg_angle')} deg, "
        f"{stats.get('duration_sec')}s, {stats.get('red_alerts')} alerts, "
        f"time by state {stats.get('time_by_state')}." if stats
        else "No session logged yet."
    )
    user += f"\n\nQuestion: {body.message}"
    out = llama([{"role": "system", "content": sys}, {"role": "user", "content": user}], body.lang, max_tokens=2048)
    if not out or "planning budget" in out:
        return {"reply": ("تعذر الوصول إلى الخادم المحلي." if body.lang == "ar"
                          else "Could not reach the local LLM server."),
                "citations": [], "evidence": evidence, "grounded": grounded}
    # ungrounded answer: never attach KB citations it wasn't grounded on (only session evidence)
    return {"reply": out, "citations": [], "evidence": evidence, "grounded": grounded}
