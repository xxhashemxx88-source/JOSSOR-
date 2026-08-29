import { useState } from "react";
import { Gamepad2, Play } from "lucide-react";
import { motion } from "motion/react";
import { useLanguage } from "../context/LanguageContext";
import { BottomNav } from "./BottomNav";
import { GameSessionModal } from "./GameSessionModal";

export function TherapySession() {
  const { t, language } = useLanguage();
  const [gameOpen, setGameOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0A0A0C] pb-24">
      <BottomNav />

      <div className="max-w-4xl mx-auto px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-5xl mb-2">{t("todaysSession")}</h1>
          <p className="text-[#A0A0A8] mb-12">{t("gameSubtitle")}</p>
        </motion.div>

        <motion.button
          onClick={() => setGameOpen(true)}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className="w-full text-left p-8 rounded-3xl bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl border border-white/10 shadow-2xl relative overflow-hidden hover:border-[#D4A574]/50 transition-colors"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[#D4A574]/10 to-[#5B9BD5]/10 pointer-events-none" />

          <div className="relative flex items-center justify-between mb-6">
            <div>
              <h2 className="text-3xl mb-2">{t("gaitGame")}</h2>
              <p className="text-[#A0A0A8] text-sm">{t("gameDescription")}</p>
            </div>
            <div className="w-20 h-20 bg-[#D4A574] rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(212,165,116,0.5)] flex-shrink-0">
              <Play className={`w-10 h-10 text-[#0A0A0C] ${language === "ar" ? "mr-1" : "ml-1"}`} fill="currentColor" />
            </div>
          </div>

          <div className="relative aspect-video rounded-2xl bg-gradient-to-br from-[#D4A574] to-[#5B9BD5] flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 bg-black/20" />
            <div className="relative text-center">
              <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                <Gamepad2 className="w-12 h-12 text-white" />
              </div>
              <p className="text-white text-lg">{t("clickToStart")}</p>
            </div>
          </div>
        </motion.button>
      </div>

      {gameOpen && <GameSessionModal onClose={() => setGameOpen(false)} />}
    </div>
  );
}
