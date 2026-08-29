import { Camera, Database, ScanLine, Sparkles, ShieldCheck, Radio, LayoutDashboard } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";

const NODES = [
  { tag: "SRC", icon: Camera },
  { tag: "C", icon: Database },
  { tag: "PP", icon: ScanLine },
  { tag: "M", icon: Sparkles },
  { tag: "P", icon: ShieldCheck },
  { tag: "D", icon: Radio },
  { tag: "SINK", icon: LayoutDashboard },
];

const COLORS = ["#0f9b7a", "#2e93c4", "#e08a2e", "#5B9BD5", "#e5484d", "#7c6be0", "#D4A574"];

const W = 150, H = 96, STEP = 176, X0 = 20, Y = 56, MID = Y + H / 2;

interface PipelineEvent {
  node?: string;
  packet_from?: string;
  note?: string;
  log?: string;
  report?: string;
  done?: boolean;
}

const IDX: Record<string, number> = { src: 0, c: 1, pp: 2, m: 3, p: 4, d: 5, sink: 6 };

function Node({ i, active, note, dimmed }: { i: number; active: number | null; note?: string; dimmed: boolean }) {
  const tag = NODES[i].tag;
  const Icon = NODES[i].icon;
  const color = COLORS[i];
  const x = X0 + i * STEP;
  const isActive = active === i;
  return (
    <g style={{ color }}>
      <rect
        x={x} y={Y} width={W} height={H} rx={14}
        fill={isActive ? `${color}14` : "#15151a"}
        stroke={isActive ? color : "#2a2a30"}
        strokeWidth={isActive ? 2 : 1}
      />
      {isActive && (
        <rect x={x} y={Y} width={W} height={H} rx={14} fill="none" stroke={color} strokeWidth={1} opacity={0.5}>
          <animate attributeName="stroke-width" values="1;5;1" dur="1s" repeatCount="indefinite" />
        </rect>
      )}
      <Icon x={x + W / 2 - 12} y={Y + 12} width={24} height={24} color={color} strokeWidth={1.8} />
      <text x={x + W / 2} y={Y + 58} textAnchor="middle" fill={isActive ? color : "#8b8b93"} fontSize={16} fontWeight={700}>
        {tag}
      </text>
      {note && (
        <g>
          <rect x={x + W / 2 - 62} y={Y + H + 12} width={124} height={26} rx={13}
            fill={isActive ? `${color}18` : "#15151a"} stroke={isActive ? `${color}66` : "#2a2a30"} strokeWidth={1} />
          <text x={x + W / 2} y={Y + H + 30} textAnchor="middle" fill={isActive ? color : "#6b6b72"}
            fontSize={11} fontWeight={600}>{note}</text>
        </g>
      )}
    </g>
  );
}

function Edge({ i, live }: { i: number; live: boolean }) {
  const x1 = X0 + i * STEP + W + 2;
  const x2 = X0 + (i + 1) * STEP - 6;
  return (
    <g>
      <line x1={x1} y1={MID} x2={x2} y2={MID} stroke="#2a2a30" strokeWidth={2} />
      {live && (
        <>
          <line x1={x1} y1={MID} x2={x2} y2={MID} stroke="#D4A574" strokeWidth={2} />
          <circle r={5} fill="#D4A574" opacity={0.9}>
            <animateMotion dur="0.8s" repeatCount="indefinite" path={`M${x1},${MID} L${x2},${MID}`} />
          </circle>
          <circle r={9} fill="none" stroke="#D4A574" strokeWidth={1} opacity={0.6}>
            <animateMotion dur="0.8s" repeatCount="indefinite" path={`M${x1},${MID} L${x2},${MID}`} />
          </circle>
        </>
      )}
      <path d={`M${x2},${MID - 4} L${x2 + 5},${MID} L${x2},${MID + 4}`} fill="none" stroke="#8b8b93" strokeWidth={1.5} />
    </g>
  );
}

export function PipelineFlow({ event, running }: { event: PipelineEvent | null; running: boolean }) {
  const { t } = useLanguage();
  const active = event?.node ? IDX[event.node] ?? null : null;
  const packetFrom = event?.packet_from ? IDX[event.packet_from] : null;
  const notes: Record<number, string> = {};
  if (event?.note && active !== null) notes[active] = event.note;

  return (
    <div className="p-7 rounded-3xl bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl border border-white/10 shadow-2xl mb-12">
      <div className="flex items-center justify-between px-1 mb-5">
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-[#5B9BD5]/25 bg-[#5B9BD5]/10 px-3 py-1 text-[11px] font-semibold text-[#5B9BD5]">
            ITU-T Y.3172
          </span>
          <span className="text-[11px] font-semibold tracking-wide text-[#8b8b93]">{t("y3172Pipeline")}</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-semibold text-[#6b6b72]">
          {running ? (
            <span className="flex items-center gap-1.5 text-[#D4A574]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#D4A574] animate-pulse" />
              {t("inTransit")}
            </span>
          ) : (
            <span>{t("idleRun")}</span>
          )}
        </div>
      </div>
      <svg viewBox="0 0 1260 200" className="w-full">
        {NODES.map((_, i) => i < NODES.length - 1 && (
          <Edge key={i} i={i} live={packetFrom === i && active === i + 1} />
        ))}
        {NODES.map((_, i) => (
          <Node key={i} i={i} active={active} note={notes[i]} dimmed={running && active !== null} />
        ))}
      </svg>
    </div>
  );
}
