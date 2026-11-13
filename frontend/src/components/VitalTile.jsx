// One vital sign. `points` is the NEWS2 score for this parameter (0 = normal).
// `assumed` marks values the demo data did not record.
const CHIP = {
  0: "bg-risk-low-bg text-risk-low-fg",
  1: "bg-risk-lowmed-bg text-risk-lowmed-fg",
  2: "bg-risk-medium-bg text-risk-medium-fg",
  3: "bg-risk-high-bg text-white",
};

import { fmtNum } from "../lib/format";

export default function VitalTile({ label, value, unit, points, assumed }) {
  const missing = value == null || value === "";
  return (
    <div
      className={`rounded-card px-4 py-3.5 ${
        assumed ? "border-[1.5px] border-dashed border-[#B9A6F5] bg-surface" : "bg-soft"
      }`}
    >
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className="mt-1.5 text-[28px] font-semibold leading-none tracking-tight">
        {missing ? "–" : typeof value === "string" && Number.isNaN(Number(value)) ? value : fmtNum(value)}
        {!missing && unit && <span className="ml-1 text-[13px] font-medium text-muted">{unit}</span>}
      </div>
      {assumed ? (
        <span className="mt-2 inline-block rounded-full bg-lavender px-2.5 py-0.5 text-xs font-bold">Assumed</span>
      ) : (
        points != null && (
          <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${CHIP[Math.min(points, 3)]}`}>
            +{points}
          </span>
        )
      )}
    </div>
  );
}
