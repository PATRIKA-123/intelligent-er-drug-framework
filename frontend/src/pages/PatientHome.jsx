import { useEffect, useState } from "react";
import { api } from "../api";
import Button from "../components/Button";
import Mascot from "../components/Mascot";
import StatusChip from "../components/StatusChip";
import { Loading, ErrorState } from "../components/States";
import { formatDateTime } from "../lib/format";

function Visit({ v }) {
  return (
    <article className="panel flex flex-col gap-3 p-6!">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-xl font-semibold tracking-tight">{v.chiefcomplaint || "ER visit"}</h3>
        <StatusChip status={v.status} />
      </div>
      <p className="m-0 text-sm text-muted">Visit {v.stay_id} · {formatDateTime(v.arrived)}</p>
      <dl className="m-0 flex flex-col gap-2.5 text-sm">
        <div><dt className="text-xs font-semibold text-muted">Doctor</dt><dd className="m-0 font-medium">{v.doctor ? `${v.doctor.full_name}${v.doctor.specialization ? `, ${v.doctor.specialization}` : ""}` : <span className="text-muted">Not assigned yet</span>}</dd></div>
        {v.diagnosis && <div><dt className="text-xs font-semibold text-muted">Diagnosis</dt><dd className="m-0 font-medium">{v.diagnosis}</dd></div>}
        {v.instructions && <div><dt className="text-xs font-semibold text-muted">Instructions</dt><dd className="m-0">{v.instructions}</dd></div>}
        {v.prescriptions.length > 0 && (
          <div>
            <dt className="text-xs font-semibold text-muted">Medicines</dt>
            <dd className="m-0">{v.prescriptions.map((p) => `${p.medication_name}${p.dosage ? ` ${p.dosage}` : ""}`).join(", ")}</dd>
          </div>
        )}
        {v.follow_ups.length > 0 && (
          <div>
            <dt className="text-xs font-semibold text-muted">Follow-ups</dt>
            <dd className="m-0">{v.follow_ups.map((f) => `${f.follow_up_type}, ${formatDateTime(f.follow_up_date)}`).join(" · ")}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

export default function PatientHome() {
  const [st, setSt] = useState({ loading: true, error: null, data: null });
  const load = () => {
    setSt({ loading: true, error: null, data: null });
    api.listMyVisits().then((data) => setSt({ loading: false, error: null, data })).catch((error) => setSt({ loading: false, error, data: null }));
  };
  useEffect(load, []);

  if (st.loading) return <Loading label="Loading your visits" />;
  if (st.error) return <ErrorState error={st.error} onRetry={load} />;
  const { profile, visits } = st.data;
  const active = visits.flatMap((v) => v.prescriptions.filter((p) => p.active !== false).map((p) => ({ ...p, visit: v })));
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight">My visits</h1>
          <p className="mt-2.5 text-[15px] text-muted">{profile.full_name}</p>
        </div>
        <Button to="/patient/add">Add a visit</Button>
      </div>

      {active.length > 0 && (
        <section className="rounded-panel bg-mint p-6">
          <h2 className="m-0 mb-3 text-xl font-semibold tracking-tight">Active medicines</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {active.map((p) => (
              <li key={p.prescription_id} className="rounded-2xl bg-white/70 px-4 py-3 text-sm">
                <b>{p.medication_name}</b>{p.dosage ? ` ${p.dosage}` : ""}{p.frequency ? `, ${p.frequency}` : ""}{p.duration ? ` for ${p.duration}` : ""}
                <div className="text-xs text-muted">From visit {p.visit.stay_id}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {visits.length === 0 ? (
        <div className="panel flex flex-col items-center gap-3 py-10 text-center">
          <Mascot size={72} label="" />
          <p className="m-0 max-w-sm text-sm text-muted">No visits yet. After an ER visit, add it here with the slip you were given.</p>
          <Button to="/patient/add">Add a visit</Button>
        </div>
      ) : visits.map((v) => <Visit key={v.stay_id} v={v} />)}
    </div>
  );
}
