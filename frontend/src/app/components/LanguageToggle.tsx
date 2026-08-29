import { Languages } from "lucide-react";
import { motion } from "motion/react";
import { useLanguage } from "../context/LanguageContext";

export function LanguageToggle() {
  const { language, toggleLanguage } = useLanguage();

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={toggleLanguage}
      className={`fixed top-6 ${language === 'ar' ? 'left-6' : 'right-6'} z-50 flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-white/10 to-transparent backdrop-blur-xl border border-white/20 rounded-full text-[#F5F5F7] shadow-[0_0_20px_rgba(212,165,116,0.3)] hover:border-[#D4A574] transition-all duration-300`}
    >
      <Languages className="w-4 h-4" />
      <span className="text-sm font-medium">{language === 'ar' ? 'English' : 'العربية'}</span>
    </motion.button>
  );
}
