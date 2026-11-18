import { useEffect, useState } from "react";
import { api } from "../api";
import SelfList from "../components/SelfList";
import { Loading, ErrorState } from "../components/States";

export default function PatientHealth() {
  const [st, setSt] = useState({ loading: true, error: null });
  const [allergies, setAllergies] = useState([]);
  const [conditions, setConditions] = useState([]);
  const load = () => {
    setSt({ loading: true, error: null });
    api.listMyHealth()
      .then((d) => { setAllergies(d.allergies); setConditions(d.conditions || []); setSt({ loading: false, error: null }); })
      .catch((error) => setSt({ loading: false, error }));
  };
  useEffect(load, []);
  if (st.loading) return <Loading label="Loading your health details" />;
  if (st.error) return <ErrorState error={st.error} onRetry={load} />;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div>
        <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight">Health</h1>
        <p className="mt-2.5 text-[15px] text-muted">Your own notes. Doctors see them marked as reported by you, if you share your history.</p>
      </div>
      <section className="panel p-7!">
        <h2 className="m-0 mb-4 text-xl font-semibold tracking-tight">Allergies</h2>
        <SelfList kind="allergies" items={allergies} setItems={setAllergies} nameLabel="Allergic to" extraLabel="Reaction" extraKey="reaction" empty="No allergies added." />
      </section>
      <section className="panel p-7!">
        <h2 className="m-0 mb-4 text-xl font-semibold tracking-tight">Conditions and history</h2>
        <SelfList kind="conditions" items={conditions} setItems={setConditions} nameLabel="Condition or past event" extraLabel="Note, for example since when" extraKey="note" empty="Nothing added." />
      </section>
    </div>
  );
}
