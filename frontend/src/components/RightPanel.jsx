import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ROLE_CONFIG } from "../auth/roles";
import { useStays } from "../lib/useStays";
import Mascot from "./Mascot";
import RiskBadge from "./RiskBadge";
import StatusChip from "./StatusChip";

function initials(name = "") {
  return name.slice(0, 2).toUpperCase() || "ME";
}

function Card({ title, children, className = "" }) {
  return (
    <section className={`rounded-panel bg-surface p-5 ${className}`}>
      {title && <h2 className="m-0 mb-3 text-base font-semibold tracking-tight">{title}</h2>}
      {children}
    </section>
  );
}

function StaffPanel() {
  const { rows, counts, loading, error, reload } = useStays();
  const attention = rows.filter((r) => r.level && (r.level.key === "high" || r.level.key === "medium")).slice(0, 6);
  return (
    <>
      <Card title="Risk now">
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ["high", "High", "bg-risk-high-bg text-white"],
            ["medium", "Med", "bg-risk-medium-bg text-risk-medium-fg"],
            ["lowmed", "Low-med", "bg-risk-lowmed-bg text-risk-lowmed-fg"],
            ["low", "Low", "bg-risk-low-bg text-risk-low-fg"],
          ].map(([k, label, cls]) => (
            <div key={k} className={`rounded-2xl px-1 py-2 ${cls}`}>
              <div className="text-xl font-semibold leading-none">{loading ? "–" : counts[k]}</div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-wide">{label}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Needs attention">
        {loading && <p role="status" className="m-0 text-sm text-muted">Loading...</p>}
        {error && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-muted">
            <span>Could not load stays{error.message ? `: ${error.message}` : "."}</span>
            <button type="button" onClick={reload} className="h-11 rounded-full border border-ink px-4 font-semibold text-ink">
              Try again
            </button>
          </div>
        )}
        {!loading && !error && attention.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <Mascot size={48} label="" />
            <p className="m-0 text-sm text-muted">Nobody above low-medium risk right now.</p>
          </div>
        )}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {attention.map((r) => (
            <li key={r.stay_id}>
              <Link to={`/stays/${r.stay_id}`} className="flex flex-col gap-1.5 rounded-2xl bg-soft px-3.5 py-3 hover:bg-page">
                <span className="flex items-center justify-between gap-2">
                  <RiskBadge riskText={r.latest_news2?.risk_level} score={r.latest_news2?.total_news2_score} />
                  <span className="text-xs text-muted">Stay {r.stay_id}</span>
                </span>
                {r.chiefcomplaint && <span className="truncate text-[13px]">{r.chiefcomplaint}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function ParamedicPanel() {
  const [state, setState] = useState({ loading: true, error: null, cases: [] });
  useEffect(() => {
    let live = true;
    api.listCases()
      .then((d) => live && setState({ loading: false, error: null, cases: d.cases || [] }))
      .catch((error) => live && setState({ loading: false, error, cases: [] }));
    return () => { live = false; };
  }, []);
  return (
    <Card title="Active cases">
      {state.loading && <p role="status" className="m-0 text-sm text-muted">Loading...</p>}
      {state.error && <p role="alert" className="m-0 text-sm text-muted">Could not load cases.</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {state.cases.map((c) => (
          <li key={c.case_id}>
            <Link to={`/paramedic/cases/${c.case_id}`} className="flex items-center justify-between gap-2 rounded-2xl bg-soft px-3.5 py-3 hover:bg-page">
              <span className="text-sm font-semibold">{c.temporary_case_code}</span>
              <StatusChip status={c.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Right column on wide screens: who needs attention, plus who is signed in.
export default function RightPanel() {
  const { user } = useAuth();
  const cfg = ROLE_CONFIG[user.role];
  if (user.role === "PATIENT") return null;
  return (
    <aside aria-label="Overview" className="sticky top-6 hidden w-[320px] flex-none flex-col gap-4 self-start xl:flex">
      <section className="flex items-center gap-3 rounded-panel bg-mint p-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lavender text-sm font-semibold">
          {initials(user.username)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{user.username}</div>
          <div className="text-xs">{cfg.label}</div>
        </div>
      </section>
      {user.role === "PARAMEDIC" ? <ParamedicPanel /> : <StaffPanel />}
    </aside>
  );
}
