import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { getStays } from "../lib/staysCache";
import RiskBadge from "../components/RiskBadge";
import StatusChip from "../components/StatusChip";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { riskLevel } from "../lib/risk";
import { fmtNum, formatTime, minutesAgo } from "../lib/format";

const FILTERS = [
  { id: "all", label: "All stays" },
  { id: "high", label: "HIGH only" },
  { id: "medium", label: "MEDIUM only" },
  { id: "active", label: "Active only" },
];
const ORDER = { high: 0, medium: 1, lowmed: 2, low: 3 };

function vitalsLine(o) {
  if (!o) return "No observation yet";
  return `RR ${fmtNum(o.respiratory_rate)} · SpO2 ${fmtNum(o.spo2)}% · SBP ${fmtNum(o.systolic_bp)} · HR ${fmtNum(o.heart_rate)} · ${fmtNum(o.temperature_celsius)} °C`;
}

export default function Board() {
  const { pathname } = useLocation();
  const title = pathname === "/stays" ? "Stays" : "Live board";
  const [state, setState] = useState({ loading: true, error: null, stays: [] });
  const [filter, setFilter] = useState("all");

  const load = useCallback((force) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    getStays(force === true)
      .then((d) => setState({ loading: false, error: null, stays: d.stays || [] }))
      .catch((error) => setState({ loading: false, error, stays: [] }));
  }, []);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    const withLevel = state.stays.map((s) => ({ ...s, level: riskLevel(s.latest_news2?.risk_level) }));
    return withLevel.sort((a, b) => {
      const oa = a.level ? ORDER[a.level.key] : 9;
      const ob = b.level ? ORDER[b.level.key] : 9;
      return oa - ob || (b.latest_news2?.total_news2_score ?? -1) - (a.latest_news2?.total_news2_score ?? -1);
    });
  }, [state.stays]);

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, lowmed: 0, low: 0 };
    rows.forEach((r) => r.level && (c[r.level.key] += 1));
    return c;
  }, [rows]);

  const shown = rows.filter((r) => {
    if (filter === "high") return r.level?.key === "high";
    if (filter === "medium") return r.level?.key === "medium";
    if (filter === "active") return r.case_status === "ACTIVE_ER";
    return true;
  });

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">{title}</h1>
          <p className="mt-2.5 text-[15px] text-muted">
            Highest risk first. Scores are decision support and need clinician review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5" role="group" aria-label="Filter stays">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`h-11 rounded-full border px-5 text-sm ${
                filter === f.id ? "border-ink bg-ink font-semibold text-white" : "border-[#C9CED8] bg-surface font-medium"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["high", "HIGH", "bg-risk-high-bg text-white"],
          ["medium", "MEDIUM", "bg-risk-medium-bg text-risk-medium-fg"],
          ["lowmed", "LOW-MEDIUM", "bg-risk-lowmed-bg text-risk-lowmed-fg"],
          ["low", "LOW", "bg-risk-low-bg text-risk-low-fg"],
        ].map(([key, label, cls]) => (
          <div key={key} className="flex flex-col gap-3 rounded-panel bg-surface px-5 py-5">
            <span className={`self-start rounded-full px-3 py-1 text-xs font-bold tracking-wide ${cls}`}>{label}</span>
            <span className="text-[44px] font-semibold leading-none tracking-tight">{counts[key]}</span>
          </div>
        ))}
      </div>

      {state.loading && <Loading label="Loading stays" />}
      {state.error && <ErrorState error={state.error} onRetry={() => load(true)} />}

      {!state.loading && !state.error && (
        <div className="rounded-panel bg-surface p-3">
          <div className="hidden grid-cols-[150px_1.2fr_1.4fr_130px_2fr_90px] gap-3 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
            <span>NEWS2 risk</span><span>Case and stay</span><span>Patient</span><span>Status</span><span>Latest vitals</span><span>Last obs</span>
          </div>
          {shown.length === 0 && (
            <EmptyState title="No stays match this filter" hint="Try another filter, or wait for new arrivals." />
          )}
          {shown.map((r) => (
            <Link
              key={r.stay_id}
              to={`/stays/${r.stay_id}`}
              className="flex flex-col gap-2 rounded-card border-t border-page px-5 py-4 hover:bg-[#F6F7F9] md:grid md:grid-cols-[150px_1.2fr_1.4fr_130px_2fr_90px] md:items-center md:gap-3"
            >
              <span><RiskBadge riskText={r.latest_news2?.risk_level} score={r.latest_news2?.total_news2_score} /></span>
              <span className="flex flex-col">
                <span className="text-[15px] font-semibold">{r.case_code || `Stay ${r.stay_id}`}</span>
                {r.case_code && <span className="text-xs text-muted">Stay {r.stay_id}</span>}
              </span>
              <span className="flex flex-col text-sm">
                <span>Subject {r.subject_id}{r.gender ? ` · ${r.gender}` : ""}</span>
                {r.chiefcomplaint && <span className="text-xs text-muted">{r.chiefcomplaint}</span>}
              </span>
              <span>{r.case_status && <StatusChip status={r.case_status} />}</span>
              <span className="text-[13px] leading-relaxed">{vitalsLine(r.latest_observation)}</span>
              <span className="text-[13px] text-muted">{r.latest_news2?.minutes_ago != null ? minutesAgo(r.latest_news2.minutes_ago) : formatTime(r.latest_observation?.observation_time)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
