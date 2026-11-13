import { formatTime } from "../lib/format";

// Heart rate (solid, round markers) and SpO2 (dashed, square markers) over a stay.
// Two different line styles so the lines are told apart without color.
const W = 560, H = 220, X0 = 40, X1 = 520, Y0 = 30, Y1 = 170;

function scale(v, min, max) {
  const t = (v - min) / (max - min);
  return Y1 - Math.max(0, Math.min(1, t)) * (Y1 - Y0);
}

export default function VitalsChart({ observations }) {
  const obs = (observations || []).filter((o) => o.heart_rate != null || o.spo2 != null);
  if (obs.length < 2) {
    return <p className="mt-3 text-sm text-muted">Not enough readings yet to draw a chart.</p>;
  }
  const step = obs.length > 1 ? (X1 - X0) / (obs.length - 1) : 0;
  const x = (i) => X0 + i * step;
  const hr = obs.map((o, i) => (o.heart_rate != null ? [x(i), scale(o.heart_rate, 80, 140)] : null));
  const sp = obs.map((o, i) => (o.spo2 != null ? [x(i), scale(o.spo2, 88, 100)] : null));
  const pts = (arr) => arr.filter(Boolean).map((p) => p.join(",")).join(" ");
  const first = obs[0], last = obs[obs.length - 1];
  const summary = `Line chart: heart rate went from ${first.heart_rate} to ${last.heart_rate} beats per minute and SpO2 from ${first.spo2} to ${last.spo2} percent over ${obs.length} readings.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={summary} className="mt-3 block">
      <g stroke="#E0E3E8">
        <path d={`M${X0} ${Y0}H530M${X0} 100H530M${X0} ${Y1}H530`} />
      </g>
      <g fontSize="11" fill="#5B6472">
        <text x="0" y="34">140</text><text x="0" y="104">110</text><text x="0" y="174">80</text>
        {obs.map((o, i) => (
          <text key={i} x={x(i)} y="200" textAnchor="middle">{formatTime(o.observation_time)}</text>
        ))}
      </g>
      <polyline points={pts(sp)} fill="none" stroke="#6C4DD6" strokeWidth="3" strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round" />
      {sp.map((p, i) => p && <rect key={i} x={p[0] - 5} y={p[1] - 5} width="10" height="10" fill="#6C4DD6" />)}
      <polyline points={pts(hr)} fill="none" stroke="#15171C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {hr.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="5" fill="#15171C" />)}
      <g fontSize="12" fontWeight="700">
        {hr[hr.length - 1] && <text x={x(obs.length - 1)} y={hr[hr.length - 1][1] - 12} textAnchor="middle" fill="#15171C">{last.heart_rate}</text>}
        {sp[sp.length - 1] && <text x={x(obs.length - 1)} y={sp[sp.length - 1][1] + 24} textAnchor="middle" fill="#4B33A8">{last.spo2}%</text>}
      </g>
    </svg>
  );
}

export function ChartLegend() {
  return (
    <div className="flex gap-4 text-xs font-semibold">
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="10" aria-hidden="true"><path d="M1 5H21" stroke="#15171C" strokeWidth="2.6" strokeLinecap="round" /><circle cx="11" cy="5" r="3.4" fill="#15171C" /></svg>
        Heart rate
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="10" aria-hidden="true"><path d="M1 5H21" stroke="#6C4DD6" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="4 3" /><rect x="8" y="2" width="6" height="6" fill="#6C4DD6" /></svg>
        SpO2
      </span>
    </div>
  );
}
