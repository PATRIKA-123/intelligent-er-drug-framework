import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import Button from "./Button";
import Icon from "./Icon";
import StatusChip from "./StatusChip";
import { Loading, ErrorState } from "./States";

const TYPES = ["Clinic review", "Lab test", "Imaging", "Wound check", "Phone call", "Other"];
const EMPTY = { follow_up_date: "", follow_up_type: "", department: "", provider_name: "", notes: "" };

const when = (iso) =>
  new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Assigned doctor and follow-ups for one ER stay. ER staff (and admin) can add follow-ups.
function AssignDoctor({ stayId, onDone }) {
  const [docs, setDocs] = useState(undefined); // undefined = loading, null = server cannot list
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    api.listDoctors().then((d) => live && setDocs(Array.isArray(d) ? d : null)).catch(() => live && setDocs(null));
    return () => { live = false; };
  }, []);
  async function go(e) {
    e.preventDefault();
    setErr("");
    if (!/^\d+$/.test(String(pick).trim())) return setErr(docs ? "Choose a doctor." : "Enter the doctor's user ID.");
    setBusy(true);
    try { await api.assignDoctor(stayId, String(pick).trim()); onDone(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  }
  if (docs === undefined) return <p className="m-0 text-sm text-muted">Loading doctors...</p>;
  return (
    <form onSubmit={go} noValidate className="flex flex-col gap-3">
      {docs ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="as-doc" className="text-[13px] font-semibold">Choose a doctor</label>
          <select id="as-doc" className="field" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Select...</option>
            {docs.map((d) => <option key={d.user_id} value={d.user_id}>{d.full_name}{d.specialization ? ` · ${d.specialization}` : ""}</option>)}
          </select>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="as-id" className="text-[13px] font-semibold">Doctor user ID</label>
          <input id="as-id" inputMode="numeric" className="field w-48" value={pick} onChange={(e) => setPick(e.target.value)} />
          <span className="text-xs text-muted">The server cannot list doctors yet, so type the doctor's user ID.</span>
        </div>
      )}
      {err && <p role="alert" className="m-0 text-sm font-medium text-risk-high-bg">{err}</p>}
      <Button type="submit" disabled={busy} className="h-12!">{busy ? "Assigning..." : "Assign doctor"}</Button>
    </form>
  );
}

function Departure({ stayId, dis, canMark, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (dis.departed_at) {
    return <p className="m-0 flex items-center gap-2 text-sm font-semibold text-risk-low-fg"><Icon name="checkCircle" size={18} color="#187A41" strokeWidth={2.6} /> Patient left at {new Date(dis.departed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>;
  }
  if (!canMark) return <p className="m-0 text-sm text-muted">Waiting for ER staff to confirm the patient has left.</p>;
  async function go() {
    setErr(""); setBusy(true);
    try { await api.recordDeparture(stayId); onDone(); }
    catch (e) { setErr(e.status === 404 ? "The server does not support this step yet." : e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-sm text-muted">Give the patient their instructions first, then confirm they have left.</p>
      {err && <p role="alert" className="m-0 text-sm font-medium text-risk-high-bg">{err}</p>}
      <Button onClick={go} disabled={busy} className="h-12!">{busy ? "Saving..." : "Patient has left"}</Button>
    </div>
  );
}

export default function FollowUps({ stayId, canAdd }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    api.getPostEr(stayId)
      .then((data) => setState({ loading: false, error: null, data }))
      .catch((error) => setState({ loading: false, error, data: null }));
  }, [stayId]);
  useEffect(() => { setForm(EMPTY); setMsg(null); load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    if (!form.follow_up_date) return setMsg({ error: "Choose the follow-up date and time." });
    if (!form.follow_up_type.trim()) return setMsg({ error: "Choose or type what kind of follow-up this is." });
    const body = { follow_up_date: new Date(form.follow_up_date).toISOString(), follow_up_type: form.follow_up_type.trim() };
    for (const k of ["department", "provider_name", "notes"]) if (form[k].trim()) body[k] = form[k].trim();
    setBusy(true);
    try {
      await api.createFollowUp(stayId, body);
      setForm(EMPTY);
      setMsg({ ok: "Follow-up added." });
      load();
    } catch (err) {
      setMsg({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (state.loading && !state.data) return <Loading label="Loading follow-ups" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;
  const { assigned_doctor: doc, follow_ups: list = [], prescriptions: rx = [], discharge: dis } = state.data;

  return (
    <div className="flex flex-col gap-4">
      <section className="panel flex flex-col gap-2">
        <h2 className="m-0 text-[22px] font-semibold tracking-tight">Assigned doctor</h2>
        {doc ? (
          <p className="m-0 text-[15px]">
            <b>{doc.full_name}</b>{doc.specialization ? ` · ${doc.specialization}` : ""}
          </p>
        ) : (
          <>
            <p className="m-0 text-sm text-muted">No doctor assigned yet.</p>
            {canAdd && <AssignDoctor stayId={stayId} onDone={load} />}
          </>
        )}
      </section>

      {rx.length > 0 && (
        <section className="panel flex flex-col gap-3">
          <h2 className="m-0 text-[22px] font-semibold tracking-tight">Medicines prescribed</h2>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {rx.map((p) => (
              <li key={p.prescription_id} className="flex flex-col gap-1 rounded-2xl bg-soft px-4 py-3">
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                  {p.medication_name}{p.dosage ? ` ${p.dosage}` : ""}
                  <StatusChip status={p.status} />
                </span>
                <span className="text-sm text-muted">{[p.route, p.frequency, p.duration].filter(Boolean).join(" · ") || "No schedule entered"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dis && (
        <section className="panel flex flex-col gap-2">
          <h2 className="m-0 text-[22px] font-semibold tracking-tight">Discharge</h2>
          <p className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            {String(dis.discharge_status).replaceAll("_", " ")}
            {dis.disposition && <span className="rounded-full bg-lavender px-2.5 py-0.5 text-xs font-bold">{dis.disposition}</span>}
          </p>
          <p className="m-0 text-sm text-muted">{when(dis.discharge_time)}</p>
          {dis.discharge_diagnosis && <p className="m-0 text-sm"><b>Diagnosis:</b> {dis.discharge_diagnosis}</p>}
          {dis.discharge_instructions && <p className="m-0 text-sm"><b>Instructions:</b> {dis.discharge_instructions}</p>}
          <Departure stayId={stayId} dis={dis} canMark={canAdd} onDone={load} />
        </section>
      )}

      <section className="panel flex flex-col gap-3">
        <h2 className="m-0 text-[22px] font-semibold tracking-tight">Follow-ups</h2>
        {list.length === 0 ? (
          <p className="m-0 text-sm text-muted">No follow-ups planned for this visit.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {list.map((f) => (
              <li key={f.follow_up_id} className="flex flex-col gap-0.5 rounded-2xl bg-soft px-4 py-3">
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                  <Icon name="calendar" size={16} /> {f.follow_up_type}
                  {f.status && <span className="rounded-full bg-lavender px-2.5 py-0.5 text-xs font-bold">{f.status}</span>}
                </span>
                <span className="text-sm">{when(f.follow_up_date)}</span>
                {(f.department || f.provider_name) && (
                  <span className="text-sm text-muted">{[f.department, f.provider_name].filter(Boolean).join(" · ")}</span>
                )}
                {f.notes && <span className="text-sm">{f.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canAdd && (
        <form onSubmit={submit} noValidate className="panel flex flex-col gap-4">
          <h2 className="m-0 text-[22px] font-semibold tracking-tight">Add a follow-up</h2>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fu-date" className="text-[13px] font-semibold">Date and time</label>
              <input id="fu-date" type="datetime-local" className="field" value={form.follow_up_date} onChange={set("follow_up_date")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fu-type" className="text-[13px] font-semibold">Type</label>
              <input id="fu-type" list="fu-types" className="field" value={form.follow_up_type} onChange={set("follow_up_type")} />
              <datalist id="fu-types">{TYPES.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fu-dept" className="text-[13px] font-semibold">Department (optional)</label>
              <input id="fu-dept" className="field" value={form.department} onChange={set("department")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fu-prov" className="text-[13px] font-semibold">Provider (optional)</label>
              <input id="fu-prov" className="field" value={form.provider_name} onChange={set("provider_name")} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fu-notes" className="text-[13px] font-semibold">Notes (optional)</label>
            <textarea id="fu-notes" rows={2} className="field h-auto py-3" value={form.notes} onChange={set("notes")} />
          </div>
          {msg?.error && <p role="alert" className="m-0 text-sm font-medium text-risk-high-bg">{msg.error}</p>}
          {msg?.ok && <p role="status" className="m-0 text-sm font-semibold text-risk-low-fg">{msg.ok}</p>}
          <Button type="submit" disabled={busy} className="h-14 text-base">{busy ? "Saving..." : "Add follow-up"}</Button>
        </form>
      )}
    </div>
  );
}
