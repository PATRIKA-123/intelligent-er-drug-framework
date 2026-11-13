import { riskLevel } from "../lib/risk";

const ICONS = {
  octagon: (c) => (
    <>
      <path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" fill={c} />
      <path d="M12 7v6M12 16v1" stroke="#C62828" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </>
  ),
  triangle: (c) => <path d="M12 3l10 18H2z" fill={c} />,
  alert: (c) => (
    <g fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </g>
  ),
  check: (c) => (
    <g fill="none" stroke={c} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-6" />
    </g>
  ),
};

// Risk is always color + word + icon, never color alone.
export default function RiskBadge({ riskText, score, size = "md" }) {
  const level = riskLevel(riskText);
  const pad = size === "lg" ? "px-3.5 py-1.5 text-sm" : "px-3 py-1 text-[13px]";
  if (!level) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-soft font-bold text-text ${pad}`}>
        Not scored
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold ${level.badge} ${pad}`}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        {ICONS[level.icon](level.iconColor)}
      </svg>
      {level.label}
      {score != null ? ` ${score}` : ""}
    </span>
  );
}
