import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Play, Volume2, VolumeX, Loader2 } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";

const API = "http://localhost:8001";

const STATE_HEX: Record<string, string> = {
  red: "#E5484D",
  orange: "#E8853A",
  yellow: "#E3C341",
  green: "#4CAF50",
};

const SPEAK: Record<string, { en: string; ar: string }> = {
  red: { en: "Watch out, hero! Straighten your legs!", ar: "انتبه يا بطل! مدّ رجليك!" },
  green: { en: "Well done, hero! Keep going!", ar: "أحسنت يا بطل! واصل!" },
};

interface Props {
  onClose: () => void;
}

export function GameSessionModal({ onClose }: Props) {
  const { t, language } = useLanguage();
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  const [state, setState] = useState<{ state: string | null; text: string; angle: number | null } | null>(null);
  const eventsRef = useRef<EventSource | null>(null);
  const lastSpoken = useRef(0);
  const runningRef = useRef(false);

  const speak = (key: string) => {
    if (muted || !("speechSynthesis" in window)) return;
    const now = Date.now();
    if (now - lastSpoken.current < 8000) return; // ponytail: cooldown so TTS doesn't nag
    lastSpoken.current = now;
    const phrase = SPEAK[key];
    if (!phrase) return;
    const u = new SpeechSynthesisUtterance(phrase[language]);
    u.lang = language === "ar" ? "ar-SA" : "en-US";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  const start = () => {
    runningRef.current = true;
    setRunning(true); // mounts <img video_feed> which creates the session server-side
    // connect SSE after a short delay so the session exists (avoids /events 404 race)
    setTimeout(() => {
      if (!runningRef.current) return;
      const es = new EventSource(`${API}/events`);
      es.onmessage = (e) => {
        const data = JSON.parse(e.data);
        setState(data);
        if (data.state === "red" || data.state === "green") speak(data.state);
      };
      eventsRef.current = es;
    }, 400);
  };

  const stop = () => {
    eventsRef.current?.close();
    eventsRef.current = null;
    runningRef.current = false;
    // explicit end request guarantees the session is finalized + saved (video + stats)
    fetch(`${API}/api/end`, { method: "POST" }).catch(() => {});
    speechSynthesis.cancel();
    onClose();
  };

  useEffect(() => () => {
    eventsRef.current?.close();
    speechSynthesis.cancel();
  }, []);

  const color = state?.state ? STATE_HEX[state.state] : "#A0A0A8";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={stop}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="w-full max-w-3xl rounded-3xl bg-[#0A0A0C] border border-white/10 shadow-[0_0_60px_rgba(212,165,116,0.25)] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-gradient-to-r from-[#1A1410] to-[#0F1520]">
            <h2 className="text-xl text-[#D4A574]">{t("gaitGame")}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMuted((m) => !m)}
                className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#A0A0A8] hover:text-white transition-colors"
                title={t("toggleVoice")}
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <button
                onClick={stop}
                className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#A0A0A8] hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="p-6">
            <div className="aspect-[3/4] rounded-2xl overflow-hidden bg-black border border-white/10 relative mx-auto max-w-sm">
              {running ? (
                <img
                  src={`${API}/video_feed`}
                  alt="Posture camera"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#D4A574]/10 to-[#5B9BD5]/10">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={start}
                    className="w-20 h-20 bg-[#D4A574] rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(212,165,116,0.5)]"
                  >
                    <Play className={`w-10 h-10 text-[#0A0A0C] ${language === "ar" ? "mr-1" : "ml-1"}`} fill="currentColor" />
                  </motion.button>
                  <p className="text-[#A0A0A8] text-sm">{t("startGame")}</p>
                </div>
              )}
            </div>

            <div
              className="mt-4 px-4 py-3 rounded-xl border flex items-center gap-3 transition-colors"
              style={{ borderColor: color, backgroundColor: `${color}15` }}
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <p className="text-sm text-[#F5F5F7]">
                {running
                  ? state?.text ?? t("waitingPose")
                  : t("gameHint")}
              </p>
              {running && state?.angle != null && (
                <span className="ml-auto text-xs text-[#A0A0A8] flex-shrink-0">
                  {Math.round(state.angle)}°
                </span>
              )}
              {running && !state && <Loader2 className="ml-auto w-4 h-4 animate-spin text-[#D4A574]" />}
            </div>

            {running && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={stop}
                className="mt-4 w-full py-3 rounded-xl bg-white/5 border border-white/20 text-[#F5F5F7] hover:border-[#D4A574] transition-colors text-sm font-medium"
              >
                {t("endGame")}
              </motion.button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
