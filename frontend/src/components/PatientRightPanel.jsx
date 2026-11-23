import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { api } from "../api";

function Metric({ label, value, to }) {
  return <Link to={to} className="flex flex-col gap-1 rounded-2xl bg-soft p-3 transition hover:bg-mint focus-visible:outline-2 focus-visible:outline-ink">
    <span className="text-2xl font-semibold tabular-nums">{value}</span><span className="text-xs text-muted">{label}</span>
  </Link>;
}
function Empty({ children }) { return <p className="m-0 text-xs leading-5 text-muted">{children}</p>; }
function Card({ title, children, action }) {
  return <section className="rounded-panel bg-surface p-5 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="m-0 text-base font-semibold tracking-tight">{title}</h2>{action}</div>
    {children}
  </section>;
}

// Pulls from the patient's own protected endpoints only; no clinical stay lookup or other-patient data.
export default function PatientRightPanel() {
  const { pathname } = useLocation();
  const [state, setState] = useState({ loading: true, visits: [], health: null, error: "", updated: null });
  const [section, setSection] = useState("recent");
  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: "" }));
    try {
      const [visits, health] = await Promise.all([api.listMyVisits(), api.listMyHealth()]);
      setState({ loading: false, visits: visits.visits || [], health, error: "", updated: new Date() });
    } catch (error) { setState(s => ({ ...s, loading: false, error: error.message || "Unable to load patient summary" })); }
  }, []);
  // Load on page navigation without changing state synchronously inside the effect.
  useEffect(() => {
    let live = true;
    Promise.all([api.listMyVisits(), api.listMyHealth()])
      .then(([visits, health]) => {
        if (!live) return;
        setState({ loading: false, visits: visits.visits || [], health, error: "", updated: new Date() });
      })
      .catch(error => {
        if (live) setState(s => ({ ...s, loading: false, error: error.message || "Unable to load patient summary" }));
      });
    return () => { live = false; };
  }, [pathname]);
  useEffect(() => {
    const onUpdated = () => refresh();
    window.addEventListener("parvah:patient-visit-linked", onUpdated);
    window.addEventListener("focus", onUpdated);
    return () => { window.removeEventListener("parvah:patient-visit-linked", onUpdated); window.removeEventListener("focus", onUpdated); };
  }, [refresh]);
  const stats = useMemo(() => {
    const visits = state.visits;
    const prescriptions = visits.flatMap(v => v.prescriptions || []);
    return { count: visits.length, rx: prescriptions.length, unverified: prescriptions.filter(p => p.active == null).length,
      followups: visits.flatMap(v => v.follow_ups || []).length };
  }, [state.visits]);
  return <aside aria-label="My health overview" className="sticky top-6 hidden w-[320px] flex-none flex-col gap-4 self-start xl:flex">
    <div className="rounded-panel bg-mint p-5">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted">Patient overview</div>
      <div className="mt-2 text-lg font-semibold">Your care at a glance</div>
      <p className="mt-1 text-xs text-muted">Updates from linked visits, not a substitute for medical advice.</p>
      <button type="button" onClick={refresh} disabled={state.loading} className="mt-3 rounded-full bg-surface px-4 py-2 text-xs font-semibold disabled:opacity-50">{state.loading ? "Refreshing…" : "Refresh summary"}</button>
    </div>
    {state.error && <Card title="Unable to load"><p role="alert" className="text-sm text-risk-high-bg">{state.error}</p><button type="button" onClick={refresh} className="text-sm font-semibold underline">Retry</button></Card>}
    <Card title="My records">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Linked visits" value={stats.count} to="/patient" />
        <Metric label="Prescriptions" value={stats.rx} to="/patient/medicines" />
        <Metric label="Follow-ups" value={stats.followups} to="/patient" />
        <Metric label="Health notes" value={(state.health?.allergies?.length || 0) + (state.health?.conditions?.length || 0)} to="/patient/health" />
      </div>
    </Card>
    <Card title="Visit activity" action={<div className="flex gap-1 rounded-full bg-soft p-1">{[["recent", "Recent"], ["meds", "Medicines"]].map(([value, label]) => <button key={value} type="button" aria-pressed={section === value} onClick={() => setSection(value)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${section === value ? "bg-ink text-white" : "text-muted"}`}>{label}</button>)}</div>}>
      {section === "recent" ? (
        state.visits.length ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{state.visits.slice(0, 4).map(v => <li key={v.stay_id} className="rounded-2xl bg-soft p-3"><div className="text-sm font-semibold">Visit #{v.stay_id}</div><div className="mt-1 truncate text-xs text-muted">{v.chiefcomplaint || "ER visit"} · {v.status || "Recorded"}</div></li>)}</ul>
          : <Empty>No visits linked yet. Add a visit using the code given by ER staff.</Empty>
      ) : (
        <><Empty>Only clinician-authorized prescriptions are displayed. Their current activity may not be verified.</Empty>
          <ul className="mt-3 flex list-none flex-col gap-2 p-0">{state.visits.flatMap(v => (v.prescriptions || []).map(p => ({ ...p, stayId: v.stay_id }))).slice(0, 4).map((p,i) => <li key={`${p.prescription_id}-${i}`} className="rounded-2xl bg-soft p-3 text-sm"><div className="font-semibold">{p.medication_name}</div><div className="text-xs text-muted">Visit #{p.stayId} · {p.active == null ? "Activity unverified" : p.active ? "Marked active" : "Earlier"}</div></li>)}</ul>
          {!stats.rx && <Empty>No authorized prescriptions found on linked visits.</Empty>}
        </>
      )}
      {stats.unverified > 0 && <p className="mt-3 rounded-xl bg-lavender p-3 text-xs">{stats.unverified} prescription(s) have unverified activity. Check with your clinician before taking them.</p>}
    </Card>
    <Card title="Quick links">
      <div className="grid grid-cols-2 gap-2 text-center text-xs font-semibold">
        {[["Add visit", "/patient/add"], ["Medicines", "/patient/medicines"], ["Health history", "/patient/health"], ["My profile", "/patient/profile"]].map(([label,to]) => <Link key={to} to={to} className="rounded-2xl border border-line px-2 py-3 transition hover:bg-mint">{label}</Link>)}
      </div>
    </Card>
  </aside>;
}
