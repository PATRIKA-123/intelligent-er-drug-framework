import Icon from "./Icon";

// The one black card. Used only for drug-interaction results. "Unknown" severity is a real
// finding (an interaction exists but is not graded), so it is shown, never hidden as "none".
function LevelPill({ level }) {
  const l = String(level || "Unknown");
  const strong = /major/i.test(l);
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
        strong ? "bg-risk-high-bg text-white" : "bg-lavender text-ink"
      }`}
    >
      {l.toUpperCase()}
    </span>
  );
}

export default function SafetyCard({ title, interactions = [], status, notes, empty }) {
  const count = interactions.length;
  return (
    <section aria-label="Drug safety" className="flex flex-col gap-3 rounded-panel bg-ink p-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-[13px] font-bold uppercase tracking-wide text-mint">
          <Icon name="flask" size={18} color="#D3EAE3" />
          {title || "Drug safety"}
        </div>
        {status && <span className="rounded-full bg-mint px-3 py-1 text-xs font-bold text-ink">{status}</span>}
      </div>
      <div className="text-2xl font-semibold leading-tight tracking-tight">
        {count === 0 ? empty || "No interactions found" : `${count} interaction${count > 1 ? "s" : ""} found`}
      </div>
      {interactions.map((it, i) => (
        <div key={it.interaction_id ?? i} className="rounded-card bg-white/10 px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-lg font-semibold capitalize">{it.component_a ?? it.drug_a} + {it.component_b ?? it.drug_b}</span>
            <LevelPill level={it.interaction_level} />
          </div>
        </div>
      ))}
      {notes && <p className="m-0 text-sm text-[#D5D9E2]">{notes}</p>}
    </section>
  );
}
