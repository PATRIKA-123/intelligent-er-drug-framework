import { useEffect, useState } from "react";
import { api } from "../api";
import Button from "../components/Button";
import { Loading, ErrorState } from "../components/States";

function Note({ m }) {
  if (!m) return null;
  return m.error
    ? <p role="alert" className="m-0 text-sm font-medium text-risk-high-bg">{m.error}</p>
    : <p role="status" className="m-0 text-sm font-semibold text-risk-low-fg">{m.ok}</p>;
}

function F({ id, label, hint, ...rest }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">{label}</label>
      <input id={id} className="field" {...rest} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

export default function PatientProfile() {
  const [st, setSt] = useState({ loading: true, error: null });
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current_password: "", new_password: "", again: "" });
  const [pwMsg, setPwMsg] = useState(null);

  const load = () => {
    setSt({ loading: true, error: null });
    api.listMyVisits().then((d) => {
      const p = d.profile;
      setF({ full_name: p.full_name, dob: p.dob, phone: p.phone, email: p.email || "", share: p.share !== false, ec_name: p.emergency_contact?.name || "", ec_phone: p.emergency_contact?.phone || "" });
      setSt({ loading: false, error: null });
    }).catch((error) => setSt({ loading: false, error }));
  };
  useEffect(load, []);
  if (st.loading) return <Loading label="Loading your profile" />;
  if (st.error) return <ErrorState error={st.error} onRetry={load} />;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setMsg(null); setBusy(true);
    try {
      await api.updateMyProfile({ full_name: f.full_name, phone: f.phone, email: f.email, share: f.share, emergency_contact: { name: f.ec_name, phone: f.ec_phone } });
      setMsg({ ok: "Saved." });
    } catch (x) { setMsg({ error: x.message }); } finally { setBusy(false); }
  }
  async function changePw(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.new_password !== pw.again) return setPwMsg({ error: "The two new passwords do not match." });
    try {
      await api.changeMyPassword({ current_password: pw.current_password, new_password: pw.new_password });
      setPw({ current_password: "", new_password: "", again: "" });
      setPwMsg({ ok: "Password changed." });
    } catch (x) { setPwMsg({ error: x.message }); }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight">Profile</h1>
      <form onSubmit={save} noValidate className="panel flex flex-col gap-4 p-7!">
        <h2 className="m-0 text-xl font-semibold tracking-tight">Your details</h2>
        <F id="pp-name" label="Full name" value={f.full_name} onChange={set("full_name")} />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <F id="pp-dob" label="Date of birth" value={f.dob} disabled hint="Ask the ER desk if this needs to change" />
          <F id="pp-phone" label="Phone" type="tel" value={f.phone} onChange={set("phone")} />
        </div>
        <F id="pp-email" label="Email (optional)" type="email" value={f.email} onChange={set("email")} />
        <h2 className="m-0 mt-2 text-xl font-semibold tracking-tight">Emergency contact</h2>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <F id="pp-ecn" label="Name (optional)" value={f.ec_name} onChange={set("ec_name")} />
          <F id="pp-ecp" label="Phone (optional)" type="tel" value={f.ec_phone} onChange={set("ec_phone")} />
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-soft px-4 py-3.5 text-sm leading-snug">
          <input type="checkbox" checked={f.share} onChange={() => setF((x) => ({ ...x, share: !x.share }))} className="mt-0.5 h-6 w-6 flex-none accent-ink" />
          <span>Let ER doctors and staff see my earlier visits, allergies and medicines when I am treated.</span>
        </label>
        <Note m={msg} />
        <Button type="submit" disabled={busy} className="h-14 text-base">{busy ? "Saving..." : "Save changes"}</Button>
      </form>

      <form onSubmit={changePw} noValidate className="panel flex flex-col gap-4 p-7!">
        <h2 className="m-0 text-xl font-semibold tracking-tight">Change password</h2>
        <F id="pw-cur" label="Current password" type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <F id="pw-new" label="New password" type="password" autoComplete="new-password" hint="12 or more characters" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          <F id="pw-again" label="Repeat new password" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
        </div>
        <Note m={pwMsg} />
        <Button type="submit" variant="outline">Change password</Button>
      </form>
    </div>
  );
}
