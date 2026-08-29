import { useEffect, useState } from "react";
import { TrendingUp, Calendar, Award, Sparkles, ChevronDown, ChevronUp, Send, MessageCircle } from "lucide-react";
import { motion } from "motion/react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useLanguage } from "../context/LanguageContext";
import { BottomNav } from "./BottomNav";
import { PipelineFlow } from "./PipelineFlow";
import { PipelineLog } from "./PipelineLog";

interface Evidence {
  type?: "kb" | "session";
  title?: string;
  doc?: string;
  score?: number;
  quote?: string;
  id?: string;
  note?: string;
}

interface PipelineEvent {
  node?: string;
  packet_from?: string;
  note?: string;
  log?: string;
  report?: string;
  citations?: Evidence[];
  done?: boolean;
}

const API = "http://localhost:8001";

interface SessionEvent { angle: number | null; state: string | null; text: string | null }
interface SessionStats {
  id: string;
  duration_sec: number;
  pose_frames: number;
  avg_angle: number | null;
  min_angle: number | null;
  max_angle: number | null;
  red_alerts: number;
  video?: string;
  events: SessionEvent[];
}

export function CaregiverReport() {
  const { t, language } = useLanguage();
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [backendUp, setBackendUp] = useState(true);
  const [pipelineEvent, setPipelineEvent] = useState<PipelineEvent | null>(null);
  const [logs, setLogs] = useState<PipelineEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [citations, setCitations] = useState<Evidence[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<
    { role: "user" | "bot"; text: string; evidence?: Evidence[]; grounded?: boolean }[]
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/sessions`)
      .then((r) => r.json())
      .then((ids: string[]) => {
        setBackendUp(true);
        if (!ids.length) return;
        fetch(`${API}/api/session?session_id=${ids[0]}`)
          .then((r) => r.json())
          .then((s) => setStats(s))
          .catch(() => {});
      })
      .catch(() => setBackendUp(false));
  }, []);

  useEffect(() => {
    if (summary && !running) generateSummary(); // keep summary language in sync
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const generateSummary = () => {
    if (running) return;
    setLoadingSummary(true);
    setRunning(true);
    setLogs([]);
    setSummary(null);
    setCitations([]);
    const es = new EventSource(`${API}/api/pipeline?lang=${language === "ar" ? "ar" : "en"}`);
    es.onmessage = (e) => {
      const ev: PipelineEvent = JSON.parse(e.data);
      setPipelineEvent(ev);
      if (ev.log) setLogs((prev) => [...prev, ev]);
      if (ev.report) setSummary(ev.report);
      if (ev.citations) setCitations(ev.citations);
      if (ev.done) {
        es.close();
        setRunning(false);
        setLoadingSummary(false);
      }
    };
    es.onerror = () => {
      es.close();
      setRunning(false);
      setLoadingSummary(false);
      setSummary(t("backendOffline"));
    };
  };

  const sendChat = (text: string) => {
    const q = text.trim();
    if (!q || chatBusy) return;
    setChatMsgs((prev) => [...prev, { role: "user", text: q }]);
    setChatInput("");
    setChatBusy(true);
    fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: q, lang: language }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: { reply?: string; evidence?: Evidence[]; grounded?: boolean }) =>
        setChatMsgs((prev) => [
          ...prev,
          { role: "bot", text: d.reply || "", evidence: d.evidence, grounded: d.grounded },
        ])
      )
      .catch(() =>
        setChatMsgs((prev) => [
          ...prev,
          { role: "bot", text: language === "ar" ? "تعذر الاتصال بالخادم." : "Could not reach the server." },
        ])
      )
      .finally(() => setChatBusy(false));
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] pb-24">
      <BottomNav />

      <div className="max-w-7xl mx-auto px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="flex items-center justify-between mb-12">
            <div>
              <h1 className="text-5xl mb-2">{t("recoveryAnalytics")}</h1>
              <p className="text-[#A0A0A8]">
                {t("patient")}: {language === "ar" ? "أحمد" : "Ahmed"}
                {stats && ` · ${t("latestSession")}: ${stats.id}`}
              </p>
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={generateSummary}
              className="px-6 py-3 bg-gradient-to-r from-[#D4A574] to-[#5B9BD5] rounded-full text-white shadow-[0_0_20px_rgba(212,165,116,0.4)] text-sm flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              {loadingSummary ? t("generating") : t("aiSummary")}
            </motion.button>
          </div>
        </motion.div>

        <PipelineFlow event={pipelineEvent} running={running} />

        {summary && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12 p-6 rounded-3xl bg-gradient-to-br from-[#5B9BD5]/10 to-transparent backdrop-blur-xl border border-[#5B9BD5]/30 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
              <h2 className="text-xl flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#D4A574]" /> {t("aiSummary")}
              </h2>
              <button
                onClick={() => setChatOpen((o) => !o)}
                className="px-4 py-2 rounded-full border border-[#D4A574]/40 text-[#D4A574] text-xs flex items-center gap-2 hover:bg-[#D4A574]/10 transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                {chatOpen
                  ? language === "ar"
                    ? "إغلاق"
                    : "Close"
                  : language === "ar"
                    ? "اسأل عن الملخص"
                    : "Ask about summary"}
              </button>
            </div>
            <p className="text-sm text-[#F5F5F7] leading-relaxed">{summary}</p>

            {citations.length > 0 && (
              <button
                onClick={() => setExpanded(expanded === 0 ? null : 0)}
                className="mt-4 flex items-center gap-2 text-xs text-[#5B9BD5] hover:text-[#7FB8E5] transition-colors"
              >
                {expanded === 0 ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                {language === "ar" ? `المصادر (${citations.length})` : `Sources (${citations.length})`}
              </button>
            )}
            {expanded === 0 && citations.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {citations.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[#5B9BD5]/25 bg-[#5B9BD5]/10 px-3 py-2"
                  >
                    <p className="text-[11px] font-semibold text-[#5B9BD5]">
                      {c.type === "session"
                        ? `${language === "ar" ? "الجلسة" : "Session"} ${c.id ?? ""}`
                        : c.title || c.doc}
                    </p>
                    <p className="text-[11px] text-[#A0A0A8] mt-0.5 leading-relaxed line-clamp-2">
                      {c.type === "session" ? c.note : c.quote}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {chatOpen && (
              <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {chatMsgs.map((m, i) => (
                    <div
                      key={i}
                      className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${
                        m.role === "user"
                          ? "bg-[#D4A574]/15 border border-[#D4A574]/30 text-right"
                          : "bg-white/8 border border-white/10 text-[#F5F5F7]"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      {m.role === "bot" && m.evidence && m.evidence.length === 0 && (
                        <p className="mt-1 text-[10px] italic text-[#D4A574]/70">
                          {language === "ar"
                            ? "لا يوجد دليل من قاعدة المعرفة."
                            : "No knowledge-base evidence."}
                        </p>
                      )}
                      {m.role === "bot" && m.evidence && m.evidence.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          {m.evidence.map((e, j) => (
                            <p key={j} className="text-[10px] text-[#5B9BD5] leading-snug">
                              {e.type === "session"
                                ? `${language === "ar" ? "الجلسة" : "Session"} ${e.id ?? ""} — ${e.note}`
                                : `${e.title || e.doc} — ${e.quote}`}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {chatBusy && (
                    <p className="text-xs text-[#A0A0A8]">
                      {language === "ar" ? "جارٍ التفكير…" : "Thinking…"}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendChat(chatInput)}
                    placeholder={
                      language === "ar" ? "اكتب سؤالاً…" : "Type a question…"
                    }
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-[#F5F5F7] placeholder-[#A0A0A8] outline-none focus:border-[#D4A574]/50 min-w-0"
                  />
                  <button
                    onClick={() => sendChat(chatInput)}
                    disabled={chatBusy || !chatInput.trim()}
                    className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#D4A574] to-[#5B9BD5] flex items-center justify-center disabled:opacity-40 flex-shrink-0"
                  >
                    <Send className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {(running || logs.length > 0) && <PipelineLog entries={logs} />}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {[
            { label: t("sessionDuration"), value: stats ? `${stats.duration_sec}s` : "—", icon: Calendar, color: "#D4A574" },
            { label: t("avgPostureAngle"), value: stats?.avg_angle != null ? `${stats.avg_angle}°` : "—", icon: TrendingUp, color: "#8FBC8F" },
            { label: t("redAlerts"), value: stats ? `${stats.red_alerts}` : "—", icon: Award, color: "#E5484D" },
          ].map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.1, duration: 0.6 }}
              className="p-6 rounded-3xl bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl border border-white/10 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[#A0A0A8] mb-2">{stat.label}</p>
                  <p className="text-4xl" style={{ color: stat.color }}>{stat.value}</p>
                </div>
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: `${stat.color}20` }}
                >
                  <stat.icon className="w-8 h-8" style={{ color: stat.color }} />
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {stats?.events?.length ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="p-8 rounded-3xl bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl border border-white/10 shadow-2xl"
          >
            <h2 className="text-3xl mb-6">{t("gaitTrend")}</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={stats.events
                  .filter((e) => e.angle != null)
                  .map((e, i) => ({ n: i + 1, angle: e.angle }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="n" stroke="#A0A0A8" style={{ fontSize: "12px" }} />
                <YAxis stroke="#A0A0A8" style={{ fontSize: "12px" }} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(10, 10, 12, 0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "12px",
                    color: "#F5F5F7",
                  }}
                />
                <Legend wrapperStyle={{ color: "#A0A0A8" }} />
                <Line
                  type="monotone"
                  dataKey="angle"
                  stroke="#D4A574"
                  strokeWidth={2}
                  dot={false}
                  name={t("postureAngle")}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-[#A0A0A8] mt-4">
              {t("targetAngle")}: 170° · {t("min")}: {stats.min_angle}° · {t("max")}: {stats.max_angle}°
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-8 rounded-3xl bg-gradient-to-br from-white/5 to-transparent border border-white/10 text-center text-[#A0A0A8]"
          >
            {backendUp ? t("noSessions") : t("backendOffline")}
          </motion.div>
)}

      </div>
    </div>
  );
}