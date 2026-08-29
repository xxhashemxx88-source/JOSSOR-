import { useLanguage } from "../context/LanguageContext";

const NODE_COLORS: Record<string, string> = {
  src: "#0f9b7a",
  c: "#2e93c4",
  pp: "#e08a2e",
  m: "#5B9BD5",
  p: "#e5484d",
  d: "#7c6be0",
  sink: "#D4A574",
};

interface LogEntry {
  node?: string;
  log?: string;
}

export function PipelineLog({ entries }: { entries: LogEntry[] }) {
  const { t } = useLanguage();
  return (
    <div className="p-7 rounded-3xl bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl border border-white/10 shadow-2xl mb-12">
      <div className="flex items-center justify-between px-1 mb-5">
        <span className="text-[13px] font-semibold text-[#F5F5F7]">{t("pipelineTrace")}</span>
        <span className="text-[11px] font-semibold text-[#6b6b72]">{entries.length} events</span>
      </div>
      <div className="space-y-2">
        {entries.length === 0 && (
          <p className="px-1 py-8 text-center text-[13px] text-[#8b8b93]">
            {t("runPipeline")} — {t("y3172Pipeline")} hop by hop.
          </p>
        )}
        {entries.map((e, i) => (
          <div key={i} className="flex items-start gap-3 rounded-xl border border-white/5 bg-[#15151a] px-3 py-2.5">
            <span
              className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: NODE_COLORS[e.node ?? ""] ?? "#69727e" }}
            />
            <div>
              <span
                className="mr-2 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: NODE_COLORS[e.node ?? ""] ?? "#69727e" }}
              >
                {e.node}
              </span>
              <span className="text-[13px] leading-snug text-[#A0A0A8]">{e.log}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
