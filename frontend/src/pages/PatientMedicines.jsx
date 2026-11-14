import { useEffect, useState } from "react";
import { api } from "../api";
import SelfList from "../components/SelfList";
import { Loading, ErrorState } from "../components/States";

function Rx({ p }) {
  return (
    <li className="rounded-2xl bg-soft px-4 py-3 text-sm">
      <b>{p.medication_name}</b>{p.dosage ? ` ${p.dosage}` : ""}{p.frequency ? `, ${p.frequency}` : ""}{p.duration ? ` for ${p.duration}` : ""}
      <div className="text-xs text-muted">Visit {p.stay_id}</div>
    </li>
  );
}

export default function PatientMedicines() {
  const [st, setSt] = useState({ loading: true, error: null, visits: [] });
  const [mine, setMine] = useState([]);
  const load = () => {
    setSt({ loading: true, error: null, visits: [] });
    Promise.all([api.listMyVisits(), api.listMyHealth()])
      .then(([v, h]) => { setMine(h.medications); setSt({ loading: false, error: null, visits: v.visits }); })
      .catch((error) => setSt({ loading: false, error, visits: [] }));
  };
  useEffect(load, []);
  if (st.loading) return <Loading label="Loading your medicines" />;
  if (st.error) return <ErrorState error={st.error} onRetry={load} />;
  const all = st.visits.flatMap((v) => v.prescriptions);
  const active = all.filter((p) => p.active !== false);
  const earlier = all.filter((p) => p.active === false);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div>
        <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight">Medicines</h1>
        <p className="mt-2.5 text-[15px] text-muted">Prescribed at your ER visits, and medicines you add yourself.</p>
      </div>
      <section className="rounded-panel bg-mint p-6">
        <h2 className="m-0 mb-3 text-xl font-semibold tracking-tight">Active from visits</h2>
        {active.length === 0 ? <p className="m-0 text-sm">Nothing active right now.</p> : <ul className="m-0 flex list-none flex-col gap-2 p-0">{active.map((p) => <Rx key={p.prescription_id} p={p} />)}</ul>}
      </section>
      {earlier.length > 0 && (
        <section className="panel p-6!">
          <h2 className="m-0 mb-3 text-xl font-semibold tracking-tight">Earlier</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">{earlier.map((p) => <Rx key={p.prescription_id} p={p} />)}</ul>
        </section>
      )}
      <section className="panel p-7!">
        <h2 className="m-0 mb-1 text-xl font-semibold tracking-tight">Medicines I take</h2>
        <p className="mb-4 mt-0 text-sm text-muted">Added by you. Doctors see these marked as reported by you.</p>
        <SelfList kind="medications" items={mine} setItems={setMine} nameLabel="Medicine" extraLabel="Dose" extraKey="dose" empty="No medicines added." />
      </section>
    </div>
  );
}
