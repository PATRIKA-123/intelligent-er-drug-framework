import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import Button from "../components/Button";
import Icon from "../components/Icon";
import RiskBadge from "../components/RiskBadge";
import StatusChip from "../components/StatusChip";
import { ErrorState, Loading } from "../components/States";
import { invalidateStays } from "../lib/staysCache";

// What the doctor is deciding. The two backend fields are filled from one choice.
const OUTCOMES = [
  { key: "home", label: "Go home", status: "DISCHARGED", disposition: "HOME" },
  { key: "admit", label: "Admit to the hospital", status: "ADMITTED", disposition: "ADMITTED" },
  { key: "transfer", label: "Transfer to another hospital", status: "TRANSFERRED", disposition: "TRANSFER" },
  { key: "left", label: "Left before treatment finished", status: "LEFT_WITHOUT_BEING_SEEN", disposition: "LEFT WITHOUT BEING SEEN" },
];

export default function Discharge() {
  const { stayId } = useParams();
  const [state, setState] = useState({ loading: true, error: null, summary: null, post: null });
  const [outcome, setOutcome] = useState("");
  const [dx, setDx] = useState("");
  const [instr, setInstr] = useState("");
  const [follow, setFollow] = useState(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  function load() {
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([api.getStaySummary(stayId), api.getPostEr(stayId)])
      .then(([summary, post]) => setState({ loading: false, error: null, summary, post }))
      .catch((error) => setState({ loading: false, error, summary: null, post: null }));
  }
  useEffect(load, [stayId]);

  if (state.loading && !state.post) return <Loading label="Loading visit" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;

  const { summary: s, post } = state;
  const n = s.latest_news2;
  const alerts = s.clinical_alerts?.alerts || [];
  const rx = post.prescriptions || [];
  const pending = rx.filter((p) => p.status === "PENDING_REVIEW");
  const fus = post.follow_ups || [];
  const existing = done || post.discharge;
  const wantsFollow = follow ?? fus.length > 0;

  async function submit(e) {
    e.preventDefault();
    setErr("");
    const o = OUTCOMES.find((x) => x.key === outcome);
    if (!o) return setErr("Choose what happens to the patient.");
    if (!sure) return setErr("Please confirm you reviewed the patient's risk and medicines.");
    const body = { discharge_status: o.status, disposition: o.disposition, prescribed_followup: wantsFollow };
    if (dx.trim()) body.discharge_diagnosis = dx.trim();
    if (instr.trim()) body.discharge_instructions = instr.trim();
    setBusy(true);
    try {
      const r = await api.createDischarge(stayId, body);
      invalidateStays();
      setDone(r.discharge);
    } catch (x) {
      setErr(x.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <Link to={`/stays/${stayId}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold">
          <Icon name="back" size={16} strokeWidth={2.4} /> Back to visit
        </Link>
        <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">Discharge</h1>
        <p className="m-0 text-sm text-muted">Visit {stayId}. Only the doctor assigned to this visit can discharge; the server checks this.</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="panel flex flex-col gap-4 p-7!">
          <h2 className="m-0 text-[22px] font-semibold tracking-tight">Check before you discharge</h2>
          <div className="flex flex-wrap items-center gap-3">
            <RiskBadge size="lg" riskText={n?.risk_level} score={n?.total_news2_score} />
            <span className="text-sm text-muted">{n ? "Latest early warning score" : "No score yet"}</span>
          </div>
          {alerts.length > 0 && (
            <p className="m-0 flex items-start gap-2 rounded-2xl bg-risk-high-bg/10 px-4 py-3 text-sm font-medium">
              <Icon name="alert" size={18} color="#C62828" /> {alerts.length} open alert{alerts.length > 1 ? "s" : ""} on this visit.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-[13px] font-semibold text-muted">Medicines</h3>
            {rx.length === 0 && <p className="m-0 text-sm text-muted">No medicines prescribed.</p>}
            {rx.map((p) => (
              <p key={p.prescription_id} className="m-0 flex flex-wrap items-center gap-2 text-sm">
                <b>{p.medication_name}</b> <StatusChip status={p.status} />
              </p>
            ))}
            {pending.length > 0 && (
              <p role="status" className="m-0 rounded-2xl bg-risk-lowmed-bg px-4 py-3 text-sm text-risk-lowmed-fg">
                {pending.length} prescription{pending.length > 1 ? "s are" : " is"} still waiting for your review.
              </p>
            )}
          </div>
          <p className="m-0 text-sm"><b>{fus.length}</b> follow-up{fus.length === 1 ? "" : "s"} planned.</p>
          <p className="m-0 text-sm text-muted">Assigned doctor: {post.assigned_doctor ? post.assigned_doctor.full_name : "none yet"}</p>
        </section>

        {existing ? (
          <section className="panel flex flex-col gap-3 p-7!">
            <h2 className="m-0 text-[22px] font-semibold tracking-tight">Discharge recorded</h2>
            <p className="m-0 flex items-center gap-2 text-[15px] font-semibold text-risk-low-fg">
              <Icon name="checkCircle" size={20} color="#187A41" strokeWidth={2.6} />
              {String(existing.discharge_status).replaceAll("_", " ")}
            </p>
            {existing.discharge_diagnosis && <p className="m-0 text-sm"><b>Diagnosis:</b> {existing.discharge_diagnosis}</p>}
            {existing.discharge_instructions && <p className="m-0 text-sm"><b>Instructions:</b> {existing.discharge_instructions}</p>}
            <p className="m-0 text-sm text-muted">A discharge can be recorded only once for a visit.</p>
            <Button to={`/stays/${stayId}`} variant="outline">Back to visit</Button>
          </section>
        ) : (
          <form onSubmit={submit} noValidate className="panel flex flex-col gap-4 p-7!">
            <h2 className="m-0 text-[22px] font-semibold tracking-tight">Discharge details</h2>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1.5 text-[13px] font-semibold">What happens to the patient?</legend>
              {OUTCOMES.map((o) => (
                <label key={o.key} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl px-4 py-2.5 text-[15px] ${outcome === o.key ? "bg-lavender font-semibold" : "bg-soft"}`}>
                  <input type="radio" name="outcome" value={o.key} checked={outcome === o.key} onChange={() => setOutcome(o.key)} className="h-5 w-5 accent-ink" />
                  {o.label}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dx" className="text-[13px] font-semibold">Final diagnosis (optional)</label>
              <input id="dx" className="field" value={dx} onChange={(e) => setDx(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="instr" className="text-[13px] font-semibold">Instructions for the patient (optional)</label>
              <textarea id="instr" rows={4} className="field h-auto py-3" value={instr} onChange={(e) => setInstr(e.target.value)} />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={wantsFollow} onChange={(e) => setFollow(e.target.checked)} className="h-5 w-5 accent-ink" />
              A follow-up visit is recommended
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-risk-lowmed-bg px-4 py-3.5 text-sm leading-snug text-[#3F2700]">
              <input type="checkbox" checked={sure} onChange={() => setSure((x) => !x)} className="mt-0.5 h-6 w-6 flex-none accent-ink" />
              <span>I reviewed this patient's risk, open alerts and medicines. This discharge cannot be changed afterwards.</span>
            </label>
            {err && <p role="alert" className="m-0 text-sm font-medium text-risk-high-bg">{err}</p>}
            <Button type="submit" disabled={busy} className="h-14 text-base">{busy ? "Saving..." : "Record discharge"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
