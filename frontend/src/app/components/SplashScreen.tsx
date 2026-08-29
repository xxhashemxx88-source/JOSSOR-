import { useEffect } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { useLanguage } from "../context/LanguageContext";

export function SplashScreen() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate("/dashboard");
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-gradient-to-b from-[#0A0A0C] via-[#1A1410] to-[#0A0A0C]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(212,165,116,0.2)_0%,transparent_60%)]" />

      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#D4A574] to-transparent" />

      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className="relative"
        >
          <div className="absolute inset-0 blur-[100px] bg-[#D4A574] opacity-30 rounded-full" />

          <div className="relative z-10 text-center">
            <motion.div
              animate={{
                boxShadow: [
                  "0 0 30px rgba(212,165,116,0.6)",
                  "0 0 60px rgba(212,165,116,0.9)",
                  "0 0 30px rgba(212,165,116,0.6)"
                ]
              }}
              transition={{ duration: 2, repeat: Infinity }}
              className="inline-block p-10 rounded-full bg-gradient-to-br from-[#D4A574]/20 to-[#5B9BD5]/10 backdrop-blur-sm border-2 border-[#D4A574]/40"
            >
              <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="35" stroke="#D4A574" strokeWidth="2" opacity="0.3" />
                <circle cx="50" cy="50" r="25" stroke="#5B9BD5" strokeWidth="2" opacity="0.5" />
                <path d="M50 20 L50 80 M20 50 L80 50" stroke="#D4A574" strokeWidth="3" strokeLinecap="round" opacity="0.8"/>
                <circle cx="50" cy="50" r="8" fill="url(#grad)" />
                <defs>
                  <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style={{ stopColor: '#D4A574', stopOpacity: 1 }} />
                    <stop offset="100%" style={{ stopColor: '#5B9BD5', stopOpacity: 1 }} />
                  </linearGradient>
                </defs>
              </svg>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 1 }}
              className="mt-10 text-6xl tracking-wide text-[#D4A574]"
            >
              {t('appName')}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1, duration: 1 }}
              className="mt-4 text-xl text-[#A0A0A8] tracking-wide"
            >
              {t('tagline')}
            </motion.p>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.4, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 text-[#A0A0A8] text-sm"
      >
        {t('loadingJourney')}
      </motion.div>
    </div>
  );
}
