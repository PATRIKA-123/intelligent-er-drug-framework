import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import Button from "./Button";
import Icon from "./Icon";
import PatientFields from "./PatientFields";

// ER desk: create the visit for an ambulance case. The server makes the visit ID and the access code.
export function RegisterVisit({ c, onDone }) {
  const [form, setForm] = useState({ patient_name: "", dob: "", phone: "", email: "" });
  const [complaint, setComplaint] = useState(c.latest_assessment?.chief_complaint || "");
  const [docs, setDocs] = useState(null);
  const [doctor, setDoctor] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    api.listDoctors().then((d) => live && setDocs(Array.isArray(d) ? d : null)).catch(() => {});
    return () => { live = false; };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!form.patient_name.trim()) return setErr("Enter the patient's name.");
    if (!complaint.trim()) return setErr("Enter the reason for the visit.");
    setBusy(true);
    try {
      const body = { ...form, chief_complaint: complaint.trim() };
      if (doctor) body.doctor_user_id = doctor;
      onDone(await api.registerVisit(c.case_id, body));
    } catch (x) {
      setErr(x.message);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate className="panel flex flex-col gap-4 p-7!">
      <h2 className="m-0 text-[22px] font-semibold tracking-tight">Register the ER visit</h2>
      <PatientFields value={form} onChange={setForm} idPrefix="reg" />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reg-complaint" className="text-[13px] font-semibold">Reason for the visit</label>
        <input id="reg-complaint" className="field" value={complaint} onChange={(e) => setComplaint(e.target.value)} />
      </div>
      {docs && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reg-doctor" className="text-[13px] font-semibold">Doctor (optional, can be set later)</label>
          <select id="reg-doctor" className="field" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
            <option value="">Not assigned yet</option>
            {docs.map((d) => <option key={d.user_id} value={d.user_id}>{d.full_name}{d.specialization ? `, ${d.specialization}` : ""}</option>)}
          </select>
        </div>
      )}
      {err && <p role="alert" className="m-0 flex items-center gap-2 text-sm font-medium text-risk-high-bg"><Icon name="alert" size={16} color="#C62828" /> {err}</p>}
      <Button type="submit" disabled={busy} className="h-14 text-base">{busy ? "Registering..." : "Register visit"}</Button>
    </form>
  );
}

// The slip the ER prints for the patient.
export function Slip({ slip }) {
  return (
    <section className="panel flex flex-col gap-4 p-7!" aria-label="Patient slip">
      <h2 className="m-0 text-[22px] font-semibold tracking-tight">Visit registered</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-mint px-5 py-4">
          <div className="text-xs font-semibold">Visit ID</div>
          <div className="text-3xl font-semibold tracking-tight">{slip.stay_id}</div>
        </div>
        <div className="rounded-2xl bg-lavender px-5 py-4">
          <div className="text-xs font-semibold">Access code</div>
          <div className="whitespace-nowrap text-2xl font-semibold tracking-widest">{slip.access_code}</div>
        </div>
      </div>
      <p className="m-0 text-sm">Give this slip to the patient. They add the visit to their profile with the visit ID, the access code and the last 4 digits of their phone.</p>
      {slip.linked_profile && <p role="status" className="m-0 rounded-2xl bg-risk-low-bg px-4 py-3 text-sm font-medium text-risk-low-fg">Added to the profile of {slip.linked_profile}.</p>}
      {slip.phone_missing && <p role="status" className="m-0 rounded-2xl bg-risk-lowmed-bg px-4 py-3 text-sm text-[#3F2700]">No phone number was recorded, so the patient cannot add this visit yet. Add it on the visit page.</p>}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => window.print()}>Print slip</Button>
        <Button to={`/stays/${slip.stay_id}`}>Open visit</Button>
      </div>
    </section>
  );
}

export function SlipLink({ stayId }) {
  return <Link to={`/stays/${stayId}`} className="underline">visit {stayId}</Link>;
}
