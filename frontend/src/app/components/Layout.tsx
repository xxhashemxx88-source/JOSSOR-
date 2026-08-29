import { Outlet } from "react-router";
import { LanguageProvider } from "../context/LanguageContext";
import { LanguageToggle } from "./LanguageToggle";

export function Layout() {
  return (
    <LanguageProvider>
      <div className="min-h-screen w-full bg-[#0A0A0C]">
        <LanguageToggle />
        <Outlet />
      </div>
    </LanguageProvider>
  );
}
