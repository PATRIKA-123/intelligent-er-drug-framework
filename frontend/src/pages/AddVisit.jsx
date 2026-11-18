import { useState } from "react";
import { useNavigate } from "react-router";
import { api, USE_MOCK } from "../api";
import Button from "../components/Button";
import Icon from "../components/Icon";

export default function AddVisit() {
  const navigate = useNavigate();
  const [f, setF] = useState({ stay_id: "", access_code: "", phone_last4: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!/^\d+$/.test(f.stay_id.trim())) return setErr("Enter the visit ID from your slip.");
    if (f.access_code.trim().length < 6) return setErr("Enter the access code from your slip.");
    if (!/^\d{4}$/.test(f.phone_last4.trim())) return setErr("Enter the last 4 digits of your phone number.");
    setBusy(true);
    try {
      await api.claimVisit({ stay_id: f.stay_id.trim(), access_code: f.access_code.trim(), phone_last4: f.phone_last4.trim() });
      navigate("/patient", { replace: true });
    } catch (x) {
      setErr(x.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5">
      <div>
        <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight">Add a visit</h1>
        <p className="mt-2.5 text-[15px] text-muted">Use the slip the ER desk gave you.</p>
      </div>
      <form onSubmit={submit} noValidate className="panel flex flex-col gap-4 p-7!">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="av-id" className="text-[13px] font-semibold">Visit ID</label>
          <input id="av-id" inputMode="numeric" className="field" value={f.stay_id} onChange={set("stay_id")} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="av-code" className="text-[13px] font-semibold">Access code</label>
          <input id="av-code" className="field uppercase tracking-widest" value={f.access_code} onChange={set("access_code")} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="av-phone" className="text-[13px] font-semibold">Last 4 digits of your phone</label>
          <input id="av-phone" inputMode="numeric" maxLength={4} className="field w-40" value={f.phone_last4} onChange={set("phone_last4")} autoComplete="off" />
          <span className="text-xs text-muted">The phone number you gave at the ER desk</span>
        </div>
        {err && <p role="alert" className="m-0 flex items-center gap-2 text-sm font-medium text-risk-high-bg"><Icon name="alert" size={16} color="#C62828" /> {err}</p>}
        <Button type="submit" disabled={busy} className="h-14 text-base">{busy ? "Checking..." : "Add this visit"}</Button>
      </form>
      {USE_MOCK && (
        <p className="m-0 rounded-2xl bg-lavender px-5 py-4 text-sm">
          Sample mode: try visit 30094124, code HX4P-7QMD, phone ending 4821.
        </p>
      )}
    </div>
  );
}
