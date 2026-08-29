import { Link, useLocation } from "react-router";
import { Home, Activity, FileText } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";

export function BottomNav() {
  const { t } = useLanguage();
  const { pathname } = useLocation();

  const items = [
    { to: "/dashboard", icon: Home, label: t("home") },
    { to: "/therapy", icon: Activity, label: t("therapy") },
    { to: "/report", icon: FileText, label: t("reports") },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#0A0A0C]/95 backdrop-blur-lg border-t border-white/10 z-50">
      <div className="max-w-md mx-auto px-6 py-4 flex justify-around">
        {items.map(({ to, icon: Icon, label }) => {
          const active = pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center gap-1 ${
                active
                  ? "text-[#D4A574]"
                  : "text-[#A0A0A8] hover:text-[#D4A574] transition-colors"
              }`}
            >
              <Icon className="w-6 h-6" />
              <span className="text-xs">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
