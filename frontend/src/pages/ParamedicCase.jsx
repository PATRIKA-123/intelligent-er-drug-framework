import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import Button from "../components/Button";
import Field from "../components/Field";
import Icon from "../components/Icon";
import RiskBadge from "../components/RiskBadge";
import StatusChip from "../components/StatusChip";
import { ErrorState, Loading } from "../components/States";
import { fmtNum } from "../lib/format";
import { useRegisterCaseNav, STEP_DEFS, stepDone } from "../components/CaseNav";
import { SCORE_NAME, SCORE_REF } from "../lib/terms";
import { lastTransport, rememberTransport } from "../lib/lastTransport";
import { useMemo } from "react";
import { VitalsHistory, HandoverSummary, Timeline, repeatDue } from "../components/CaseExtras";
import { agoText } from "../lib/format";

const CONSCIOUSNESS = [
  ["ALERT", "Alert"],
  ["NEW_CONFUSION", "New confusion"],
  ["V", "Responds to voice"],
  ["P", "Responds to pain"],
  ["U", "Unresponsive"],
];
const NEXT = {
  DISPATCHED: ["EN_ROUTE", "En route"],
  EN_ROUTE: ["IN_TRANSIT", "In transit"],
  IN_TRANSIT: ["ARRIVED_AT_DESTINATION", "Arrived at destination"],
  ARRIVED_AT_DESTINATION: ["HANDOVER_COMPLETE", "Handover complete"],
};
const num = (v) => (v === "" || v == null ? undefined : Number(v));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));

function Section({ id, title, done, open, onToggle, children }) {
  return (
    <section id={`step-${id}`} className="panel scroll-mt-6 p-0!">
      <button type="button" id={`step-btn-${id}`} onClick={onToggle} aria-expanded={open}
        className="flex min-h-16 w-full items-center justify-between gap-3 rounded-panel px-6 py-4 text-left">
        <span className="text-[20px] font-semibold tracking-tight">{title}</span>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon name={done ? "checkCircle" : "clock"} size={18} color={done ? "#187A41" : "#5B6270"} strokeWidth={2.4} />
          {done ? "Done" : "To do"}
        </span>
      </button>
      {open && <div className="flex flex-col gap-4 px-6 pb-6">{children}</div>}
    </section>
  );
}

function Msg({ error, ok }) {
  if (error) return <p role="alert" className="m-0 flex items-center gap-2 text-sm font-medium text-risk-high-bg"><Icon name="alert" size={16} color="#C62828" /> {error}</p>;
  if (ok) return <p role="status" className="m-0 text-sm font-medium text-risk-low-fg">{ok}</p>;
  return null;
}

const FIELD_LABELS = {
  respiratoryRate: "Respiratory rate", spo2: "SpO2", systolicBP: "Systolic BP", heartRate: "Heart rate",
  temperatureCelsius: "Temperature", consciousness: "Consciousness", oxygenSupport: "On oxygen (yes/no)",
};

function News2Card({ n }) {
  if (!n) return null;
  if (!n.complete) {
    return (
      <section className="panel">
        <h2 className="m-0 text-[22px] font-semibold tracking-tight">{SCORE_NAME} <span className="text-sm font-medium text-muted">({SCORE_REF})</span></h2>
        <p className="mb-0 mt-3 text-sm">Not available yet. Save these in Vitals first:</p>
        <ul className="mb-0 mt-2 flex list-none flex-wrap gap-2 p-0">
          {(n.missing || []).map((m) => (
            <li key={m} className="rounded-full bg-soft px-3 py-1 text-xs font-semibold">{FIELD_LABELS[m] || m}</li>
          ))}
        </ul>
      </section>
    );
  }
  const rows = [
    ["Resp. rate", n.respiratory_score], ["SpO2", n.spo2_score], ["Oxygen", n.oxygen_score],
    ["Systolic BP", n.systolic_bp_score], ["Heart rate", n.heart_rate_score],
    ["Temperature", n.temperature_score], ["Consciousness", n.consciousness_score],
  ];
  return (
    <section className="rounded-panel p-6" style={{ background: "linear-gradient(135deg, #D3EAE3 0%, #E7DEF6 100%)" }}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-[56px] font-semibold leading-none tracking-tight">{n.total_news2_score}</div>
        <div>
          <div className="text-[13px] font-bold uppercase tracking-wide">{SCORE_NAME} <span className="font-medium normal-case">({SCORE_REF})</span></div>
          <div className="mt-1"><RiskBadge size="lg" riskText={n.risk_level} /></div>
        </div>
      </div>
      <ul className="m-0 mt-4 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
        {rows.map(([label, pts]) => (
          <li key={label} className="flex items-center justify-between gap-2 rounded-2xl bg-white/70 px-3 py-2 text-sm">
            <span>{label}</span><b>+{pts}</b>
          </li>
        ))}
      </ul>
      <p className="mb-0 mt-3 text-[13px]">Calculated by the server from your latest vitals. Decision support. Clinician review required. Not a clinical decision.</p>
    </section>
  );
}

export default function ParamedicCase() {
  const { caseId } = useParams();
  const [state, setState] = useState({ loading: true, error: null, c: null });
  const [open, setOpen] = useState({});
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState("");
  const [asm, setAsm] = useState({ chief_complaint: "", consciousness_status: "ALERT", breathing_status: "", circulation_status: "", pain_score: "", notes: "", allergy_status: "UNKNOWN", allergens: "", meds: "" });
  const [vit, setVit] = useState({ heart_rate: "", respiratory_rate: "", systolic_bp: "", diastolic_bp: "", spo2: "", temperature: "", oxygen_support: "no", consciousness_level: "ALERT" });
  const prev = useMemo(() => lastTransport(), []);
  const prefilled = !!(prev.ambulance_id || prev.destination_hospital);
  const [tr, setTr] = useState({
    ambulance_id: prev.ambulance_id || "", transport_type: prev.transport_type || "",
    pickup_location: "", destination_hospital: prev.destination_hospital || "",
  });

  const load = useCallback(() => {
    api.getCase(caseId)
      .then((c) => setState({ loading: false, error: null, c }))
      .catch((error) => setState({ loading: false, error, c: null }));
  }, [caseId]);
  useEffect(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    load();
  }, [load]);

  // Open the first unfinished step once the case loads.
  const firstTodo = state.c ? ["assessment", "vitals", "transport"].find((k) => !state.c.steps[k]) : null;
  useEffect(() => { if (firstTodo) setOpen((o) => (Object.keys(o).length ? o : { [firstTodo]: true })); }, [firstTodo]);

  // Left rail and right column read the case from here (see CaseNav).
  const jump = useCallback((key) => {
    setOpen((o) => ({ ...o, [key]: true }));
    requestAnimationFrame(() => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`step-${key}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      document.getElementById(`step-btn-${key}`)?.focus({ preventScroll: true });
    });
  }, []);
  const navValue = useMemo(() => (state.c ? { c: state.c, onJump: jump } : null), [state.c, jump]);
  useRegisterCaseNav(navValue);

  async function run(key, fn, okText) {
    setBusy(key);
    setMsg((m) => ({ ...m, [key]: {} }));
    try {
      await fn();
      setMsg((m) => ({ ...m, [key]: { ok: okText } }));
      load();
    } catch (e) {
      setMsg((m) => ({ ...m, [key]: { error: e.message } }));
    } finally {
      setBusy("");
    }
  }

  function saveAssessment(e) {
    e.preventDefault();
    if (!asm.chief_complaint.trim()) return setMsg((m) => ({ ...m, assessment: { error: "Enter the main complaint." } }));
    const pain = num(asm.pain_score);
    if (pain != null && (pain < 0 || pain > 10)) return setMsg((m) => ({ ...m, assessment: { error: "Pain score must be 0 to 10." } }));
    run("assessment", () => api.recordAssessment(caseId, clean({
      chief_complaint: asm.chief_complaint.trim(), consciousness_status: asm.consciousness_status,
      breathing_status: asm.breathing_status.trim(), circulation_status: asm.circulation_status.trim(),
      pain_score: pain,
      notes: [asm.notes.trim(), asm.allergy_status === "ALLERGIES_REPORTED" && asm.allergens.trim() ? `Allergies: ${asm.allergens.trim()}` : ""].filter(Boolean).join("\n"),
      allergy_status: asm.allergy_status,
      current_medications: asm.meds.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const [name, ...rest] = l.split(",");
        return clean({ medication_name: name.trim(), dose: rest.join(",").trim() });
      }),
    })), "Assessment saved.");
  }

  function saveVitals(e) {
    e.preventDefault();
    const r = { heart_rate: [20, 300, "Heart rate"], respiratory_rate: [3, 80, "Respiratory rate"], systolic_bp: [40, 300, "Systolic BP"],
      diastolic_bp: [20, 200, "Diastolic BP"], spo2: [50, 100, "SpO2"], temperature: [30, 45, "Temperature (°C)"] };
    const body = {};
    for (const [k, [lo, hi, name]] of Object.entries(r)) {
      const v = num(vit[k]);
      if (v == null) continue;
      if (Number.isNaN(v) || v < lo || v > hi) return setMsg((m) => ({ ...m, vitals: { error: `${name} should be between ${lo} and ${hi}.` } }));
      body[k] = v;
    }
    if (!Object.keys(body).length) return setMsg((m) => ({ ...m, vitals: { error: "Enter at least one measurement." } }));
    if (body.diastolic_bp != null && body.systolic_bp != null && body.diastolic_bp >= body.systolic_bp)
      return setMsg((m) => ({ ...m, vitals: { error: "Diastolic BP should be lower than systolic BP. Please check both." } }));
    body.oxygen_support = vit.oxygen_support === "yes";
    body.consciousness_level = vit.consciousness_level;
    run("vitals", async () => {
      await api.recordVitals(caseId, body);
      setVit((v) => ({ ...v, heart_rate: "", respiratory_rate: "", systolic_bp: "", diastolic_bp: "", spo2: "", temperature: "" }));
    }, "Vitals saved. Score updated.");
  }

  function saveTransport(e) {
    e.preventDefault();
    if (!tr.ambulance_id.trim()) return setMsg((m) => ({ ...m, transport: { error: "Enter the ambulance ID." } }));
    run("transport", async () => {
      const body = clean(Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, v.trim()])));
      await api.saveTransport(caseId, body);
      rememberTransport(body);
    }, "Transport saved.");
  }

  if (state.loading && !state.c) return <Loading label="Loading case" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;
  const c = state.c;
  const t = c.transport;
  const ts = t?.transport_status;
  const next = ts && ["DISPATCHED", "EN_ROUTE"].includes(ts) ? NEXT[ts] : null;
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const T = (k) => msg[k] || {};

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <Link to="/paramedic" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold">
          <Icon name="back" size={16} strokeWidth={2.4} /> My cases
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">{c.temporary_case_code}</h1>
          {c.news2?.complete && <RiskBadge size="lg" riskText={c.news2.risk_level} score={c.news2.total_news2_score} />}
          <StatusChip status={c.status} />
          {repeatDue(c) != null && (
            <button type="button" onClick={() => jump("vitals")} className="min-h-11 rounded-full bg-risk-lowmed-bg px-4 text-sm font-bold text-risk-lowmed-fg">
              Repeat vitals due · last {agoText(c.latest_vital.recorded_at)}
            </button>
          )}
        </div>
        <p className="m-0 text-sm text-muted">
          Case {c.case_id}{c.stay_id ? ` · ER stay ${c.stay_id}` : ""}{c.latest_assessment?.chief_complaint ? ` · ${c.latest_assessment.chief_complaint}` : ""}
        </p>
      </div>

      <nav aria-label="Case steps" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:hidden">
        {STEP_DEFS.map((st) => {
          const done = stepDone(c, st.key);
          return (
            <button key={st.key} type="button" onClick={() => jump(st.key)}
              className={`flex min-h-11 flex-none items-center gap-2 rounded-full px-4 text-sm font-semibold ${done ? "bg-mint" : "bg-surface"}`}>
              <Icon name={done ? "checkCircle" : st.icon} size={18} color={done ? "#187A41" : "currentColor"} strokeWidth={2.4} />
              {st.label.split(" ")[0]}
              <span className="sr-only">{done ? ", done" : ", to do"}</span>
            </button>
          );
        })}
      </nav>

      <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-4">
          <Section id="assessment" title="1. Assessment" done={c.steps.assessment} open={!!open.assessment} onToggle={() => toggle("assessment")}>
            <form onSubmit={saveAssessment} noValidate className="flex flex-col gap-4">
              <Field id="a-complaint" label="Main complaint">
                <input id="a-complaint" className="field" value={asm.chief_complaint} onChange={(e) => setAsm({ ...asm, chief_complaint: e.target.value })} />
              </Field>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field id="a-cons" label="Consciousness">
                  <select id="a-cons" className="field" value={asm.consciousness_status} onChange={(e) => setAsm({ ...asm, consciousness_status: e.target.value })}>
                    {CONSCIOUSNESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field id="a-pain" label="Pain score (0 to 10, optional)">
                  <input id="a-pain" inputMode="numeric" className="field" value={asm.pain_score} onChange={(e) => setAsm({ ...asm, pain_score: e.target.value })} />
                </Field>
                <Field id="a-breath" label="Breathing (optional)">
                  <input id="a-breath" className="field" value={asm.breathing_status} onChange={(e) => setAsm({ ...asm, breathing_status: e.target.value })} />
                </Field>
                <Field id="a-circ" label="Circulation (optional)">
                  <input id="a-circ" className="field" value={asm.circulation_status} onChange={(e) => setAsm({ ...asm, circulation_status: e.target.value })} />
                </Field>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field id="a-allergy" label="Allergies">
                  <select id="a-allergy" className="field" value={asm.allergy_status} onChange={(e) => setAsm({ ...asm, allergy_status: e.target.value })}>
                    <option value="UNKNOWN">Not known</option>
                    <option value="NONE_REPORTED">None reported</option>
                    <option value="ALLERGIES_REPORTED">Allergies reported</option>
                  </select>
                </Field>
                {asm.allergy_status === "ALLERGIES_REPORTED" && (
                  <Field id="a-allergens" label="Allergic to">
                    <input id="a-allergens" className="field" value={asm.allergens} onChange={(e) => setAsm({ ...asm, allergens: e.target.value })} />
                  </Field>
                )}
              </div>
              <Field id="a-meds" label="Current medicines (optional, one per line: name, dose)">
                <textarea id="a-meds" rows={3} className="field h-auto py-3" value={asm.meds} onChange={(e) => setAsm({ ...asm, meds: e.target.value })} />
              </Field>
              <Field id="a-notes" label="Notes (optional)">
                <input id="a-notes" className="field" value={asm.notes} onChange={(e) => setAsm({ ...asm, notes: e.target.value })} />
              </Field>
              <Msg {...T("assessment")} />
              <Button type="submit" disabled={busy === "assessment"} className="h-14 text-base">{busy === "assessment" ? "Saving..." : "Save assessment"}</Button>
            </form>
          </Section>

          <Section id="vitals" title="2. Vitals" done={c.steps.vitals} open={!!open.vitals} onToggle={() => toggle("vitals")}>
            <VitalsHistory c={c} />
            <form onSubmit={saveVitals} noValidate className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
                {[["heart_rate", "Heart rate (bpm)"], ["respiratory_rate", "Resp. rate (/min)"], ["systolic_bp", "Systolic BP"],
                  ["diastolic_bp", "Diastolic BP"], ["spo2", "SpO2 (%)"], ["temperature", "Temp (°C)"]].map(([k, label]) => (
                  <Field key={k} id={`v-${k}`} label={label}>
                    <input id={`v-${k}`} inputMode="decimal" className="field" value={vit[k]} onChange={(e) => setVit({ ...vit, [k]: e.target.value })} />
                  </Field>
                ))}
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field id="v-o2" label="On oxygen?">
                  <select id="v-o2" className="field" value={vit.oxygen_support} onChange={(e) => setVit({ ...vit, oxygen_support: e.target.value })}>
                    <option value="no">No, breathing air</option><option value="yes">Yes, on oxygen</option>
                  </select>
                </Field>
                <Field id="v-cons" label="Consciousness">
                  <select id="v-cons" className="field" value={vit.consciousness_level} onChange={(e) => setVit({ ...vit, consciousness_level: e.target.value })}>
                    {CONSCIOUSNESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              </div>
              <p className="m-0 text-xs text-muted">Temperature in degrees Celsius. Fill every box so the server can work out the score.</p>
              <Msg {...T("vitals")} />
              <Button type="submit" disabled={busy === "vitals"} className="h-14 text-base">{busy === "vitals" ? "Saving..." : c.steps.vitals ? "Save new reading" : "Save vitals and check score"}</Button>
            </form>
          </Section>

          <Section id="transport" title="3. Transport" done={c.steps.transport} open={!!open.transport} onToggle={() => toggle("transport")}>
            {t ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <b>{t.ambulance_id}</b>{t.destination_hospital ? <span>to {t.destination_hospital}</span> : null}
                  <span className="rounded-full bg-lavender px-3 py-1 text-xs font-bold">{t.transport_status}</span>
                </div>
                {next ? (
                  <Button onClick={() => run("transport", () => api.setTransportStatus(caseId, next[0]), `Status is now ${next[1]}.`)} disabled={busy === "transport"}>
                    Move to: {next[1]}
                  </Button>
                ) : (
                  <p className="m-0 text-sm text-muted">
                    {ts === "CANCELLED" ? "This transport was cancelled." : "Arrival and handover are in step 4."}
                  </p>
                )}
                <Msg {...T("transport")} />
              </div>
            ) : (
              <form onSubmit={saveTransport} noValidate className="flex flex-col gap-4">
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field id="t-amb" label="Ambulance ID"><input id="t-amb" className="field" value={tr.ambulance_id} onChange={(e) => setTr({ ...tr, ambulance_id: e.target.value })} /></Field>
                  <Field id="t-type" label="Type (optional)"><input id="t-type" className="field" value={tr.transport_type} onChange={(e) => setTr({ ...tr, transport_type: e.target.value })} /></Field>
                  <Field id="t-from" label="Pickup (optional)"><input id="t-from" className="field" value={tr.pickup_location} onChange={(e) => setTr({ ...tr, pickup_location: e.target.value })} /></Field>
                  <Field id="t-to" label="Destination (optional)"><input id="t-to" className="field" value={tr.destination_hospital} onChange={(e) => setTr({ ...tr, destination_hospital: e.target.value })} /></Field>
                </div>
                {prefilled && <p className="m-0 text-xs text-muted">Filled in from your last case. Change anything that is different.</p>}
                <Msg {...T("transport")} />
                <Button type="submit" disabled={busy === "transport"} className="h-14 text-base">{busy === "transport" ? "Saving..." : "Save transport"}</Button>
              </form>
            )}
          </Section>

          <Section id="arrive" title="4. Arrival and handover" done={c.steps.handover} open={!!open.arrive} onToggle={() => toggle("arrive")}>
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl bg-soft px-4 py-3.5">
                <div className="text-xs font-semibold text-muted">Give the ER desk this case code</div>
                <div className="mt-1 text-[28px] font-semibold leading-none tracking-tight">{c.temporary_case_code}</div>
                <div className="mt-1 text-sm">Case ID {c.case_id}</div>
              </div>
              <p className="m-0 text-sm">
                {c.stay_id
                  ? <>ER staff linked this case to ER stay <b>{c.stay_id}</b>.</>
                  : "ER staff will link this case to the patient's ER record. You do not need a stay ID."}
              </p>
              {ts === "IN_TRANSIT" && (
                <Button onClick={() => run("arrive", () => api.setTransportStatus(caseId, "ARRIVED_AT_DESTINATION"), "Marked as arrived at the hospital.")} disabled={busy === "arrive"} className="h-14 text-base">
                  Arrived at hospital
                </Button>
              )}
              {ts === "ARRIVED_AT_DESTINATION" && (
                <Button onClick={() => run("arrive", () => api.setTransportStatus(caseId, "HANDOVER_COMPLETE"), "Handover marked complete.")} disabled={busy === "arrive"} className="h-14 text-base">
                  Handover complete
                </Button>
              )}
              {ts === "HANDOVER_COMPLETE" && (
                <div className="flex flex-col gap-3">
                  <p className="m-0 flex items-center gap-2 text-sm font-semibold text-risk-low-fg">
                    <Icon name="checkCircle" size={18} color="#187A41" strokeWidth={2.6} /> Handover is complete.
                  </p>
                  <Button to="/paramedic/new" className="h-14 text-base">Start next case</Button>
                </div>
              )}
              {!ts && <p className="m-0 text-sm text-muted">Save the transport details first.</p>}
              {ts && !["IN_TRANSIT", "ARRIVED_AT_DESTINATION", "HANDOVER_COMPLETE"].includes(ts) && (
                <p className="m-0 text-sm text-muted">Available once the ambulance is in transit (step 3).</p>
              )}
              <Msg {...T("arrive")} />
            </div>
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          {ts === "HANDOVER_COMPLETE" && (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-mint p-6">
              <div>
                <div className="text-[20px] font-semibold">Handover complete</div>
                <div className="text-sm">Ready for the next call?</div>
              </div>
              <Button to="/paramedic/new" className="h-12!">Start next case</Button>
            </section>
          )}
          <News2Card n={c.news2} />
          {(c.steps.assessment && c.steps.vitals) && <HandoverSummary c={c} />}
          {c.latest_vital && (
            <section className="panel">
              <h2 className="m-0 text-[22px] font-semibold tracking-tight">Latest vitals</h2>
              <p className="mb-0 mt-2 text-sm leading-relaxed">
                HR {fmtNum(c.latest_vital.heart_rate)} · RR {fmtNum(c.latest_vital.respiratory_rate)} · SBP {fmtNum(c.latest_vital.systolic_bp)} · SpO2 {fmtNum(c.latest_vital.spo2)}% · {fmtNum(c.latest_vital.temperature)} °C
              </p>
              {c.latest_vital.recorded_at && <p className="mb-0 mt-1 text-xs text-muted">{agoText(c.latest_vital.recorded_at)}</p>}
            </section>
          )}
          <Timeline c={c} />
          {c.stay_id && (
            <section className="panel flex flex-col gap-3">
              <h2 className="m-0 text-[22px] font-semibold tracking-tight">At the ER</h2>
              <p className="m-0 text-sm">Your case is linked. ER staff and doctors see the patient on their board.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
