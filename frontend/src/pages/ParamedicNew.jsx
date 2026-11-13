import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import Button from "../components/Button";
import Field from "../components/Field";
import Icon from "../components/Icon";

// Suggest a code like ER-1109-1432 (month, day, hour, minute). It must be unique.
function suggest() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `ER-${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export default function ParamedicNew() {
  const navigate = useNavigate();
  const [code, setCode] = useState(suggest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    const clean = code.trim();
    if (!clean) { setError("Enter a case code."); return; }
    setError("");
    setBusy(true);
    try {
      const res = await api.createCase({ temporary_case_code: clean });
      navigate(`/paramedic/cases/${res.case.case_id}`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <Link to="/paramedic" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold">
          <Icon name="back" size={16} strokeWidth={2.4} /> My cases
        </Link>
        <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">New case</h1>
        <p className="m-0 text-sm text-muted">Start a case when you pick up a patient. You can add the rest on the next screen.</p>
      </div>
      <form onSubmit={submit} noValidate className="panel flex flex-col gap-4 p-7!">
        <Field id="code" label="Case code" hint="Temporary code for this patient. It must be unique.">
          <input id="code" className="field" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        </Field>
        {error && (
          <p role="alert" className="m-0 flex items-center gap-2 text-sm font-medium text-risk-high-bg">
            <Icon name="alert" size={16} color="#C62828" /> {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="h-14 text-base">{busy ? "Creating..." : "Start case"}</Button>
      </form>
    </div>
  );
}
