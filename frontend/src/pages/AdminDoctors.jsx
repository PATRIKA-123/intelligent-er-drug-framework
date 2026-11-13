import { useState } from "react";
import { api } from "../api";
import Button from "../components/Button";
import Icon from "../components/Icon";
import Mascot from "../components/Mascot";

const EMPTY = {
  full_name: "", username: "", password: "", email: "",
  qualification: "", specialization: "", registration_number: "",
};

function Field({ id, label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">{label}</label>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

// Admin only. The backend has no endpoint that lists doctors, so this page
// shows the doctors created in this visit, not everyone in the system.
export default function AdminDoctors() {
  const [form, setForm] = useState(EMPTY);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState([]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function check() {
    const u = form.username.trim();
    if (!form.full_name.trim()) return "Enter the doctor's full name.";
    if (u.length < 3 || u.length > 100) return "Username must be 3 to 100 characters.";
    if (form.password.length < 12 || form.password.length > 128) return "Password must be 12 to 128 characters.";
    return "";
  }

  async function submit(e) {
    e.preventDefault();
    const problem = check();
    if (problem) { setError(problem); return; }
    setError("");
    setBusy(true);
    try {
      const body = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, k === "password" ? v : v.trim()]).filter(([, v]) => v !== "")
      );
      const res = await api.createDoctor(body);
      setCreated((c) => [{ username: res.doctor?.username || form.username.trim(), name: form.full_name.trim(), at: new Date() }, ...c]);
      setForm(EMPTY);
      setShow(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">Doctors</h1>
        <p className="mt-2.5 text-[15px] text-muted">Create a doctor account. Share the password with them privately.</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <form onSubmit={submit} noValidate className="panel flex flex-col gap-4 p-7!">
          <h2 className="m-0 text-[22px] font-semibold tracking-tight">New doctor</h2>
          <Field id="full_name" label="Full name">
            <input id="full_name" className="field" value={form.full_name} onChange={set("full_name")} autoComplete="off" />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field id="username" label="Username" hint="3 to 100 characters">
              <input id="username" className="field" value={form.username} onChange={set("username")} autoComplete="off" />
            </Field>
            <Field id="password" label="Password" hint="12 to 128 characters">
              <div className="relative">
                <input
                  id="password"
                  type={show ? "text" : "password"}
                  className="field pr-20"
                  value={form.password}
                  onChange={set("password")}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-pressed={show}
                  className="absolute right-2 top-1/2 h-11 -translate-y-1/2 rounded-full px-3 text-sm font-semibold underline"
                >
                  {show ? "Hide" : "Show"}
                </button>
              </div>
            </Field>
          </div>
          <Field id="email" label="Email (optional)">
            <input id="email" type="email" className="field" value={form.email} onChange={set("email")} autoComplete="off" />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field id="qualification" label="Qualification (optional)">
              <input id="qualification" className="field" value={form.qualification} onChange={set("qualification")} />
            </Field>
            <Field id="specialization" label="Specialization (optional)">
              <input id="specialization" className="field" value={form.specialization} onChange={set("specialization")} />
            </Field>
          </div>
          <Field id="registration_number" label="Registration number (optional)" hint="Must be unique">
            <input id="registration_number" className="field" value={form.registration_number} onChange={set("registration_number")} />
          </Field>
          {error && (
            <p role="alert" className="m-0 flex items-center gap-2 text-sm font-medium text-risk-high-bg">
              <Icon name="alert" size={16} color="#C62828" /> {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="h-14 text-base">
            {busy ? "Creating..." : "Create doctor"}
          </Button>
        </form>

        <section className="panel flex flex-col gap-3 p-7!">
          <h2 className="m-0 text-[22px] font-semibold tracking-tight">Created this visit</h2>
          {created.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-6 text-center">
              <Mascot size={64} label="" />
              <p className="m-0 text-sm text-muted">
                No doctors created yet. The backend cannot list existing doctors, so only new ones show here.
              </p>
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {created.map((d, i) => (
                <li key={i} className="flex items-center gap-3 rounded-2xl bg-risk-low-bg px-4 py-3 text-risk-low-fg">
                  <Icon name="checkCircle" size={20} color="#187A41" strokeWidth={2.6} />
                  <span className="text-sm">
                    <b>{d.name}</b> · {d.username}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
