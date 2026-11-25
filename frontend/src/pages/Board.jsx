import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { api } from "../api";
import { getStays } from "../lib/staysCache";
import RiskBadge from "../components/RiskBadge";
import StatusChip from "../components/StatusChip";
import VitalsChart, { ChartLegend } from "../components/VitalsChart";
import Button from "../components/Button";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { riskLevel } from "../lib/risk";
import { fmtNum, formatTime, minutesAgo } from "../lib/format";

const FILTERS = [
  { id: "all", label: "All patients" },
  { id: "high", label: "HIGH only" },
  { id: "medium", label: "MEDIUM only" },
  { id: "active", label: "Active only" },
];
const ORDER = { high: 0, medium: 1, lowmed: 2, low: 3 };

function vitalsLine(o) {
  if (!o) return "No vitals yet";
  return `RR ${fmtNum(o.respiratory_rate)} · SpO2 ${fmtNum(o.spo2)}% · SBP ${fmtNum(o.systolic_bp)} · HR ${fmtNum(o.heart_rate)} · ${fmtNum(o.temperature_celsius)} °C`;
}

export default function Board() {
  const { pathname } = useLocation();
  const title = pathname === "/stays" ? "Patients" : "Live board";
  const [state, setState] = useState({ loading: true, error: null, stays: [] });
  const [filter, setFilter] = useState("all");
  const [selectedStay, setSelectedStay] = useState(null);
  const [telemetry, setTelemetry] = useState({ loading: false, obs: [] });

  const load = useCallback((force) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    getStays(force === true)
      .then((d) => setState({ loading: false, error: null, stays: d.stays || [] }))
      .catch((error) => setState({ loading: false, error, stays: [] }));
  }, []);

  useEffect(() => {
    let live = true;
    getStays(false)
      .then((d) => { if (live) setState({ loading: false, error: null, stays: d.stays || [] }); })
      .catch((error) => { if (live) setState({ loading: false, error, stays: [] }); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        getStays(true)
          .then((d) => setState((prev) => ({ ...prev, stays: d.stays || [] })))
          .catch(() => {});
        if (selectedStay?.stay_id) {
          api.getObservations(selectedStay.stay_id)
            .then((res) => setTelemetry({ loading: false, obs: res.observations || [] }))
            .catch(() => {});
        }
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [selectedStay?.stay_id]);

  async function inspectTelemetry(stay) {
    setSelectedStay(stay);
    setTelemetry({ loading: true, obs: [] });
    try {
      const res = await api.getObservations(stay.stay_id);
      setTelemetry({ loading: false, obs: res.observations || [] });
    } catch (_) {
      setTelemetry({ loading: false, obs: [] });
    }
  }

  const rows = useMemo(() => {
    const withLevel = state.stays.map((s) => ({ ...s, level: riskLevel(s.latest_news2?.risk_level) }));
    return withLevel.sort((a, b) => {
      const oa = a.level ? ORDER[a.level.key] : 9;
      const ob = b.level ? ORDER[b.level.key] : 9;
      return oa - ob || (b.latest_news2?.total_news2_score ?? -1) - (a.latest_news2?.total_news2_score ?? -1);
    });
  }, [state.stays]);

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
        <div className="flex flex-wrap gap-2.5" role="group" aria-label="Filter patients">
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

      {selectedStay && (
        <section aria-label="Vitals during the visit" className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="m-0 text-[22px] font-semibold tracking-tight">
                Vitals during the visit · {selectedStay.case_code || `Visit ${selectedStay.stay_id}`}
              </h2>
              <RiskBadge riskText={selectedStay.latest_news2?.risk_level} score={selectedStay.latest_news2?.total_news2_score} />
              <ChartLegend />
            </div>
            <div className="flex items-center gap-2.5">
              <Button to={`/stays/${selectedStay.stay_id}`} className="h-11! px-4! text-sm!">Open visit</Button>
              <Button variant="outline" onClick={() => setSelectedStay(null)} className="h-11! px-4! text-sm!">Close</Button>
            </div>
          </div>
          {telemetry.loading ? (
            <p className="mt-3 text-sm text-muted">Loading vitals...</p>
          ) : (
            <VitalsChart observations={telemetry.obs} />
          )}
        </section>
      )}

      {state.loading && <Loading label="Loading patients" />}
      {state.error && <ErrorState error={state.error} onRetry={() => load(true)} />}

      {!state.loading && !state.error && (
        <div className="rounded-panel bg-surface p-3">
          <div className="hidden grid-cols-[150px_1.1fr_1.3fr_120px_2fr_150px] gap-3 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
            <span>Risk</span><span>Visit</span><span>Patient</span><span>Status</span><span>Latest vitals</span><span>Last vitals</span>
          </div>
          {shown.length === 0 && (
            <EmptyState title="No patients match this filter" hint="Try another filter, or wait for new arrivals." />
          )}
          {shown.map((r) => (
            <div
              key={r.stay_id}
              className="flex flex-col gap-2 rounded-card border-t border-page px-5 py-4 hover:bg-[#F6F7F9] md:grid md:grid-cols-[150px_1.1fr_1.3fr_120px_2fr_150px] md:items-center md:gap-3"
            >
              <Link to={`/stays/${r.stay_id}`} className="contents">
                <span><RiskBadge riskText={r.latest_news2?.risk_level} score={r.latest_news2?.total_news2_score} /></span>
                <span className="flex flex-col">
                  <span className="text-[15px] font-semibold">{r.case_code || `Visit ${r.stay_id}`}</span>
                  {r.case_code && <span className="text-xs text-muted">Visit {r.stay_id}</span>}
                </span>
                <span className="flex flex-col text-sm">
                  <span>Patient {r.subject_id}{r.gender ? ` · ${r.gender}` : ""}</span>
                  {r.chiefcomplaint && <span className="text-xs text-muted">{r.chiefcomplaint}</span>}
                </span>
                <span>{r.case_status && <StatusChip status={r.case_status} />}</span>
                <span className="text-[13px] leading-relaxed">{vitalsLine(r.latest_observation)}</span>
              </Link>
              <span className="flex items-center justify-between gap-2 md:justify-end">
                <span className="text-[13px] text-muted">
                  {r.latest_news2?.minutes_ago != null ? minutesAgo(r.latest_news2.minutes_ago) : formatTime(r.latest_observation?.observation_time)}
                </span>
                <button
                  type="button"
                  onClick={() => inspectTelemetry(r)}
                  className="h-9 rounded-full border border-[#C9CED8] bg-surface px-3.5 text-xs font-semibold text-ink hover:bg-soft"
                >
                  Graph
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
