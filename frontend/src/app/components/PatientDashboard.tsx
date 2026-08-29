import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Play, Timer, TrendingUp, AlertTriangle, ArrowRight, FileText } from "lucide-react";
import { motion } from "motion/react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useLanguage } from "../context/LanguageContext";
import { BottomNav } from "./BottomNav";

const API = "http://localhost:8001";

interface SessionStats {
  id: string;
  started: string;
  duration_sec: number;
  avg_angle: number | null;
  min_angle: number | null;
  max_angle: number | null;
  red_alerts: number;
  events?: { ts?: number; angle: number | null }[];
}

const stateColor = (a: number | null) =>
  a == null ? "#A0A0A8" : a < 140 ? "#E5484D" : a < 155 ? "#E8853A" : "#4CAF50";

export function PatientDashboard() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [hasSessions, setHasSessions] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API}/api/sessions`)
      .then((r) => r.json())
      .then((ids: string[]) => {
        if (!ids.length) return setHasSessions(false);
        setHasSessions(true);
        fetch(`${API}/api/session?session_id=${ids[0]}`)
          .then((r) => r.json())
          .then(setStats)
          .catch(() => {});
      })
      .catch(() => setHasSessions(null));
  }, []);

  const events = (stats?.events ?? [])
    .filter((e) => e.angle != null)
    .map((e, i) => ({ n: i + 1, angle: e.angle as number }));
  const avg = stats?.avg_angle;
  const last = events.length ? events[events.length - 1].angle : null;

  return (
    <div className="min-h-screen bg-[#0A0A0C] pb-24">
      <BottomNav />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl">{t("welcomeBack")} {language === "ar" ? "أحمد" : "Ahmed"}</h1>
          {stats ? (
            <p className="mt-1 text-sm text-[#A0A0A8]">{t("latestSession")}: {stats.id}</p>
          ) : (
            <p className="mt-1 text-sm text-[#A0A0A8]">{t("yourJourney")}</p>
          )}
        </motion.header>

        <motion.button
          onClick={() => navigate("/therapy")}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className="mt-10 mb-10 flex w-full items-center justify-between gap-6 rounded-3xl border border-white/10 bg-gradient-to-br from-[#D4A574]/12 to-transparent p-7 text-left transition-colors hover:border-[#D4A574]/50"
        >
          <div>
            <h2 className="text-2xl text-[#F5F5F7]">{t("gaitGame")}</h2>
            <p className="mt-1 text-sm text-[#A0A0A8]">{t("gameSubtitle")}</p>
          </div>
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#D4A574] shadow-[0_0_20px_rgba(212,165,116,0.4)]">
            <Play className={`h-7 w-7 text-[#0A0A0C] ${language === "ar" ? "mr-0.5" : "ml-0.5"}`} fill="currentColor" />
          </div>
        </motion.button>

        {hasSessions === false && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-[#A0A0A8]"
          >
            {t("noSessions")}
          </motion.section>
        )}

        {hasSessions === null && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-[#A0A0A8]"
          >
            {t("backendOffline")}
          </motion.section>
        )}

        {hasSessions && stats && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <div className="grid grid-cols-3 gap-4">
              <StatCell
                icon={Timer}
                label={t("sessionDuration")}
                value={stats ? `${stats.duration_sec}s` : "—"}
              />
              <StatCell
                icon={TrendingUp}
                label={t("avgPostureAngle")}
                value={avg != null ? `${avg}°` : "—"}
                accent={stateColor(avg)}
              />
              <StatCell
                icon={AlertTriangle}
                label={t("redAlerts")}
                value={stats ? `${stats.red_alerts}` : "—"}
                accent={stats?.red_alerts ? "#E5484D" : undefined}
              />
            </div>

            {events.length > 1 && (
              <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg text-[#F5F5F7]">{t("gaitTrend")}</h3>
                  <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#A0A0A8]">
                    <span className="h-2 w-2 rounded-full" style={{ background: stateColor(last) }} />
                    {last != null ? `${last}°` : "—"}
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={events}>
                    <XAxis dataKey="n" hide />
                    <YAxis hide domain={[90, 180]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(10,10,12,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "12px",
                        color: "#F5F5F7",
                        fontSize: "12px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="angle"
                      stroke="#D4A574"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </motion.section>
        )}

        <motion.button
          onClick={() => navigate("/report")}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-10 flex items-center gap-2 text-sm text-[#A0A0A8] transition-colors hover:text-[#D4A574]"
        >
          <FileText className="h-4 w-4" />
          {t("recoveryAnalytics")}
          <ArrowRight className={`h-4 w-4 ${language === "ar" ? "rotate-180" : ""}`} />
        </motion.button>
      </main>
    </div>
  );
}

function StatCell({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Timer;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <Icon className="h-5 w-5 text-[#A0A0A8]" />
      <p className="mt-4 text-3xl" style={{ color: accent ?? "#F5F5F7" }}>{value}</p>
      <p className="mt-1 text-xs text-[#A0A0A8]">{label}</p>
    </div>
  );
}
