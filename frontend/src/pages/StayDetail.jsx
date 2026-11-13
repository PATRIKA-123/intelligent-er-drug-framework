import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import Icon from "../components/Icon";
import RiskBadge from "../components/RiskBadge";
import StatusChip from "../components/StatusChip";
import VitalTile from "../components/VitalTile";
import VitalsChart, { ChartLegend } from "../components/VitalsChart";
import AlertBanner from "../components/AlertBanner";
import SafetyCard from "../components/SafetyCard";
import ProvenanceTag from "../components/ProvenanceTag";
import Button from "../components/Button";
import { ErrorState, Loading } from "../components/States";
import { formatTime } from "../lib/format";
import { invalidateStays } from "../lib/staysCache";
import { SCORE_NAME, SCORE_REF } from "../lib/terms";

const label = (r, keys, fallback) => {
  for (const k of keys) if (r?.[k]) return r[k];
  return fallback;
};

function MedList({ meds }) {
  const [all, setAll] = useState(false);
  const seen = new Set();
  const unique = meds.filter((m) => {
    const k = String(m.medication_name || "").trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const shown = all ? unique : unique.slice(0, 8);
  return (
    <>
      {shown.map((m, i) => (
        <span key={i} className="rounded-full bg-soft px-3 py-1 text-sm font-semibold">
          {m.medication_name}{m.dosage ? ` ${m.dosage}` : ""}
        </span>
      ))}
      {unique.length > 8 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="min-h-11 rounded-full px-3 text-sm font-semibold underline">
          {all ? "Show fewer" : `Show all ${unique.length}`}
        </button>
      )}
    </>
  );
}

function SummaryRow({ title, status, children }) {
  return (
    <div className={`flex flex-col gap-1 ${status !== "RECORDED" ? "rounded-2xl border-[1.5px] border-dashed border-[#AEB4C0] px-3.5 py-3" : ""}`}>
      <div className="text-xs font-semibold text-muted">{title}</div>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        <ProvenanceTag status={status} />
      </div>
    </div>
  );
}

export default function StayDetail() {
  const { stayId } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, summary: null, obs: [] });
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState("");

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([api.getStaySummary(stayId), api.getObservations(stayId)])
      .then(([summary, o]) => setState({ loading: false, error: null, summary, obs: o.observations || [] }))
      .catch((error) => setState({ loading: false, error, summary: null, obs: [] }));
  }, [stayId]);
  useEffect(load, [load]);

  async function runDecisionSupport() {
    setRunning(true);
    setRunMsg("");
    try {
      await api.runDecisionSupport(stayId);
      invalidateStays();
      setRunMsg("Decision support finished.");
      load();
    } catch (e) {
      setRunMsg(e.message);
    } finally {
      setRunning(false);
    }
  }

  if (state.loading && !state.summary) return <Loading label="Loading stay" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const s = state.summary;
  const o = s.latest_observation;
  const n = s.latest_news2;
  const alerts = s.clinical_alerts?.alerts || [];
  const findings = s.drug_safety?.findings || [];
  const staleSafety = s.drug_safety && s.drug_safety.computed_by_current_engine === false;
  const assumed = o?.assumed_fields || [];
  const isDoctor = user.role === "DOCTOR";
  const isStaff = user.role === "ER_STAFF" || user.role === "ADMIN";
  const back = isDoctor ? "/stays" : "/board";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <Link to={back} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold">
          <Icon name="back" size={16} strokeWidth={2.4} /> Back
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">
            {s.stay?.case_code || `Stay ${s.stay?.stay_id}`}
          </h1>
          <RiskBadge size="lg" riskText={n?.risk_level} score={n?.total_news2_score} />
          {s.stay?.case_status && <StatusChip status={s.stay.case_status} />}
        </div>
        <p className="m-0 text-sm text-muted">
          Stay {s.stay?.stay_id} · Subject {s.patient?.subject_id ?? s.stay?.subject_id}
          {s.stay?.chiefcomplaint ? ` · ${s.stay.chiefcomplaint}` : ""}
        </p>
      </div>

      {(alerts.length > 0 || findings.length > 0 || staleSafety) && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            {alerts.map((a) => <AlertBanner key={a.alert_id} alert={a} />)}
            {alerts.length === 0 && (
              <div className="rounded-panel bg-surface px-6 py-5 text-sm text-muted">No open alerts for this stay.</div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <SafetyCard
              title="Drug safety"
              interactions={findings}
              empty="No interactions found"
              status={s.drug_safety?.provenance_status === "VERIFIED_CURRENT_RUN" ? "CURRENT RUN" : undefined}
              notes={findings.length ? "Clinician review required before prescribing." : undefined}
            />
            {staleSafety && (
              <p role="status" className="m-0 rounded-2xl bg-risk-lowmed-bg px-4 py-3 text-sm text-risk-lowmed-fg">
                This result is from an older run. Run decision support to refresh it.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <section className="panel">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="m-0 text-[22px] font-semibold tracking-tight">Latest observation</h2>
              <span className="text-[13px] text-muted">{formatTime(o?.observation_time)}</span>
            </div>
            {o ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <VitalTile label="Resp. rate" value={o.respiratory_rate} unit="/min" points={n?.respiratory_score} />
                  <VitalTile label="SpO2" value={o.spo2} unit="%" points={n?.spo2_score} />
                  <VitalTile label="Systolic BP" value={o.systolic_bp} unit="mmHg" points={n?.systolic_bp_score} />
                  <VitalTile label="Heart rate" value={o.heart_rate} unit="bpm" points={n?.heart_rate_score} />
                  <VitalTile label="Temperature" value={o.temperature_celsius} unit="°C" points={n?.temperature_score} />
                  <VitalTile
                    label="Consciousness"
                    value={o.consciousness ? o.consciousness[0] + o.consciousness.slice(1).toLowerCase() : null}
                    assumed={assumed.includes("consciousness")}
                    points={n?.consciousness_score}
                  />
                </div>
                <p className="mb-0 mt-3.5 text-xs leading-relaxed text-muted">
                  Chips show each reading's points toward the score. A dashed tile was assumed, not recorded.
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">No observation recorded for this stay yet.</p>
            )}
          </section>

          <section className="panel">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="m-0 text-[22px] font-semibold tracking-tight">Vitals over the stay</h2>
              <ChartLegend />
            </div>
            <VitalsChart observations={state.obs} />
            <p className="m-0 mt-1.5 text-xs text-muted">Left scale is heart rate in bpm; SpO2 is drawn on its own 88 to 100 scale.</p>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {n && (
            <section
              className="flex flex-wrap items-center gap-5 rounded-panel p-6"
              style={{ background: "linear-gradient(135deg, #D3EAE3 0%, #E7DEF6 100%)" }}
            >
              <svg viewBox="0 0 140 140" width="132" height="132" role="img" aria-label={`${SCORE_NAME} ${n.total_news2_score} of a possible 20`}>
                <circle cx="70" cy="70" r="56" fill="none" stroke="#FFFFFF" strokeWidth="14" />
                <circle
                  cx="70" cy="70" r="56" fill="none" stroke="#15171C" strokeWidth="14" strokeLinecap="round"
                  strokeDasharray={`${(Math.min(n.total_news2_score, 20) / 20) * 351.9} 351.9`}
                  transform="rotate(-90 70 70)"
                />
                <text x="70" y="82" textAnchor="middle" fontSize="40" fontWeight="600" fill="#15171C">{n.total_news2_score}</text>
              </svg>
              <div className="min-w-[160px] flex-1">
                <div className="text-[13px] font-bold uppercase tracking-wide">{SCORE_NAME} <span className="font-medium normal-case">({SCORE_REF})</span></div>
                <div className="mt-1"><RiskBadge size="lg" riskText={n.risk_level} /></div>
                <div className="mt-2 text-[13px] leading-snug">Decision support. Clinician review required. Not a clinical decision.</div>
              </div>
            </section>
          )}

          <section className="panel flex flex-col gap-3.5">
            <h2 className="m-0 text-[22px] font-semibold tracking-tight">Clinical summary</h2>
            <SummaryRow title="Allergies" status={s.allergies?.status}>
              {s.allergies?.status === "RECORDED"
                ? s.allergies.records.map((r, i) => (
                    <span key={i} className="text-[15px] font-semibold">{label(r, ["allergen", "allergy", "substance", "name"], "Recorded")}</span>
                  ))
                : <span className="text-sm">No data recorded</span>}
            </SummaryRow>
            <SummaryRow title="History" status={s.history?.status}>
              {s.history?.status === "RECORDED"
                ? s.history.records.map((r, i) => (
                    <span key={i} className="text-[15px] font-semibold">{label(r, ["condition", "history", "description", "name"], "Recorded")}</span>
                  ))
                : <span className="text-sm">No data recorded</span>}
            </SummaryRow>
            <SummaryRow title="Current medication" status={s.medications?.length ? "RECORDED" : "NO_DATA_RECORDED"}>
              {s.medications?.length
                ? <MedList meds={s.medications} />
                : <span className="text-sm">No data recorded</span>}
            </SummaryRow>
            <SummaryRow title="Diagnoses" status={s.diagnoses?.length ? "RECORDED" : "NO_DATA_RECORDED"}>
              {s.diagnoses?.length
                ? s.diagnoses.map((d, i) => (
                    <span key={i} className="text-[15px] font-semibold">{label(d, ["icd_title", "diagnosis", "icd_code"], "Recorded")}</span>
                  ))
                : <span className="text-sm">No data recorded</span>}
            </SummaryRow>
          </section>

          <section className="panel flex flex-col gap-3">
            <h2 className="m-0 text-[22px] font-semibold tracking-tight">Actions</h2>
            {isDoctor && (
              <>
                <Button to={`/stays/${stayId}/prescribe`}>Prescribe</Button>
                <Button variant="disabled" disabled>Discharge (next build)</Button>
              </>
            )}
            {isStaff && (
              <>
                <Button onClick={runDecisionSupport} disabled={running}>
                  {running ? "Running..." : "Run decision support"}
                </Button>
                <Button variant="disabled" disabled>Add follow-up (next build)</Button>
              </>
            )}
            {runMsg && <p role="status" className="m-0 text-sm text-muted">{runMsg}</p>}
            <p className="m-0 text-xs text-muted">Only the actions your role may use are shown.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
