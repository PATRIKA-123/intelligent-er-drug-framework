import { useEffect, useState } from "react";
import { api } from "../api";
import Button from "./Button";
import PatientFields from "./PatientFields";

// Visit page, ER staff: fill in the patient's details later. A match with a profile links the visit to it.
export default function PatientDetails({ stayId }) {
  const [st, setSt] = useState({ loading: true, error: null, d: null });
  const [form, setForm] = useState({ patient_name: "", dob: "", phone: "", email: "" });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(null);

  useEffect(() => {
    let live = true;
    api.getPatientDetails(stayId)
      .then((d) => { if (!live) return; setSt({ loading: false, error: null, d }); setForm({ patient_name: d.patient_name || "", dob: d.dob || "", phone: d.phone || "", email: d.email || "" }); })
      .catch((error) => live && setSt({ loading: false, error, d: null }));
    return () => { live = false; };
  }, [stayId]);

  if (st.loading) return null;
  if (st.error) {
    return (
      <section className="panel flex flex-col gap-2">
        <h2 className="m-0 text-[22px] font-semibold tracking-tight">Patient details</h2>
        <p className="m-0 text-sm text-muted">{st.error.status === 501 ? st.error.message : "Could not load patient details."}</p>
      </section>
    );
  }

  async function save(e) {
    e.preventDefault();
    setMsg(null); setBusy(true);
    try {
      const r = await api.updatePatientDetails(stayId, form);
      setSt((s) => ({ ...s, d: { ...s.d, linked_profile: r.linked_profile } }));
      setMsg({ ok: r.linked_profile ? `Saved. This visit is in the profile of ${r.linked_profile}.` : "Saved." });
    } catch (x) { setMsg({ error: x.message }); } finally { setBusy(false); }
  }

  async function newCode() {
    setMsg(null);
    try { setCode((await api.newAccessCode(stayId)).access_code); } catch (x) { setMsg({ error: x.message }); }
  }

  const d = st.d;
  return (
    <form onSubmit={save} noValidate className="panel flex flex-col gap-4">
      <h2 className="m-0 text-[22px] font-semibold tracking-tight">Patient details</h2>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {code ? <span>New access code: <b className="tracking-widest">{code}</b>. Give it to the patient now; it is not shown again.</span> : <span className="text-muted">The access code is shown only once, when the visit is registered.</span>}
        <button type="button" onClick={newCode} className="h-11 rounded-full border border-ink px-4 text-sm font-semibold">New access code</button>
      </div>
      <p className="m-0 text-sm text-muted">{d.linked_profile ? `Linked to the profile of ${d.linked_profile}.` : "Not linked to a patient profile yet."}</p>
      <PatientFields value={form} onChange={setForm} idPrefix="pd" />
      {msg?.error && <p role="alert" className="m-0 text-sm font-medium text-risk-high-bg">{msg.error}</p>}
      {msg?.ok && <p role="status" className="m-0 text-sm font-semibold text-risk-low-fg">{msg.ok}</p>}
      <Button type="submit" variant="outline" disabled={busy}>{busy ? "Saving..." : "Save details"}</Button>
    </form>
  );
}
