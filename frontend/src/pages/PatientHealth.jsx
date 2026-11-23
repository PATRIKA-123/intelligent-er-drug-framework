import { useEffect, useState } from "react";
import { api } from "../api";
import SelfList from "../components/SelfList";
import { Loading, ErrorState } from "../components/States";
import { formatDateTime } from "../lib/format";

// Patient-reported notes are kept distinct from clinician-authored visit information.
export default function PatientHealth() {
  const [st, setSt] = useState({ loading: true, error: null, visits: [] });
  const [allergies, setAllergies] = useState([]);
  const [conditions, setConditions] = useState([]);
  // The initial load starts with loading=true. State updates happen only when
  // the asynchronous request resolves, avoiding a synchronous effect update.
  const fetchHealth = () => Promise.all([api.listMyHealth(), api.listMyVisits()])
    .then(([health, visits]) => {
      setAllergies(health.allergies || []);
      setConditions(health.conditions || []);
      setSt({ loading: false, error: null, visits: visits.visits || [] });
    })
    .catch(error => setSt(s => ({ ...s, loading: false, error })));
  const load = () => {
    setSt(s => ({ ...s, loading: true, error: null }));
    void fetchHealth();
  };
  useEffect(() => {
    let live = true;
    Promise.all([api.listMyHealth(), api.listMyVisits()])
      .then(([health, visits]) => {
        if (!live) return;
        setAllergies(health.allergies || []);
        setConditions(health.conditions || []);
        setSt({ loading: false, error: null, visits: visits.visits || [] });
      })
      .catch(error => { if (live) setSt(s => ({ ...s, loading: false, error })); });
    return () => { live = false; };
  }, []);
  if (st.loading) return <Loading label="Loading your health details" />;
  if (st.error) return <ErrorState error={st.error} onRetry={load} />;
  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight">Health & history</h1><p className="mt-2.5 text-[15px] text-muted">Your reported health notes and confirmed ER visit history, shown separately.</p></div>
      <button type="button" onClick={load} className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold hover:bg-mint">Refresh</button>
    </div>
    <section className="panel p-7!">
      <h2 className="m-0 mb-4 text-xl font-semibold tracking-tight">Visit history from ER</h2>
      {st.visits.length === 0 ? <p className="m-0 text-sm text-muted">No visits linked yet. Add a visit using the ER desk code to see it here.</p> :
        <ol className="m-0 flex list-none flex-col gap-3 p-0">{st.visits.map(v => <li key={v.stay_id} className="rounded-2xl bg-soft px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">Visit #{v.stay_id}</strong><span className="text-xs text-muted">{formatDateTime(v.arrived)}</span></div>
          <p className="my-2 text-sm">{v.chiefcomplaint || "ER visit"} · {v.status || "Recorded"}</p>
          {v.diagnosis && <p className="my-1 text-xs"><b>Clinician diagnosis:</b> {v.diagnosis}</p>}
          {v.instructions && <p className="my-1 text-xs"><b>Discharge instructions:</b> {v.instructions}</p>}
          {!!v.prescriptions?.length && <p className="my-1 text-xs"><b>Authorized medicines:</b> {v.prescriptions.map(p => p.medication_name).join(", ")}</p>}
          {!!v.follow_ups?.length && <p className="my-1 text-xs"><b>Follow-ups:</b> {v.follow_ups.map(f => f.follow_up_type).join(", ")}</p>}
          {!v.diagnosis && <p className="mt-2 text-xs text-muted">A visit complaint is not a confirmed diagnosis.</p>}
        </li>)}</ol>}
    </section>
    <section className="panel p-7!"><h2 className="m-0 mb-4 text-xl font-semibold tracking-tight">Allergies I reported</h2>
      <SelfList kind="allergies" items={allergies} setItems={setAllergies} nameLabel="Allergic to" extraLabel="Reaction" extraKey="reaction" empty="No allergies added." />
    </section>
    <section className="panel p-7!"><h2 className="m-0 mb-4 text-xl font-semibold tracking-tight">Conditions I reported</h2>
      <SelfList kind="conditions" items={conditions} setItems={setConditions} nameLabel="Condition or past event" extraLabel="Note, for example since when" extraKey="note" empty="Nothing added." />
    </section>
  </div>;
}
