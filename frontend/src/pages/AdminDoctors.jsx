import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import Button from "../components/Button";
import Icon from "../components/Icon";
import Mascot from "../components/Mascot";

const EMPTY = {
  full_name: "", username: "", email: "",
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

const ROLES = [
  { key: "DOCTOR", label: "Doctor" },
  { key: "ER_STAFF", label: "ER staff" },
  { key: "PARAMEDIC", label: "Paramedic" },
];

// Admin only. The backend has no endpoint that lists doctors, so this page
// shows the doctors created in this visit, not everyone in the system.
export default function AdminDoctors() {
  const [form, setForm] = useState(EMPTY);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState([]);
  const [role, setRole] = useState("DOCTOR");
  const roleLabel = ROLES.find((r) => r.key === role).label;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function check() {
    const u = form.username.trim();
    if (!form.full_name.trim()) return "Enter the full name.";
    if (u.length < 3 || u.length > 100) return "Username must be 3 to 100 characters.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Enter a valid email address. The invitation is sent there.";
    return "";
  }

  async function submit(e) {
    e.preventDefault();
    const problem = check();
    if (problem) { setError(problem); return; }
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const body = Object.fromEntries(
        Object.entries(form)
          .filter(([k]) => role === "DOCTOR" || !["qualification", "specialization", "registration_number"].includes(k))
          .map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== "")
      );
      const res = await api.createStaff(role, body);
      setCreated((c) => [{ role: roleLabel, username: res.doctor?.username || form.username.trim(), name: form.full_name.trim(), email: form.email.trim(), sample: res.sample_invite_path }, ...c]);
      setNotice(`Invitation sent to ${form.email.trim()}. It works once and expires in 24 hours.`);
      setForm(EMPTY);
    } catch (err) {
      setNotice("");
      setError(err.status === 501 ? `${err.message} Ask Patrika to add it, then try again.` : err.status === 502
        ? `${err.message} The account now exists but is not active, so using the same username again will be refused. Ask Patrika to check the email settings.`
        : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">Staff</h1>
        <p className="mt-2.5 text-[15px] text-muted">Invite a doctor, ER staff member or paramedic by email. They set their own password from the link.</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <form onSubmit={submit} noValidate className="panel flex flex-col gap-4 p-7!">
          <h2 className="m-0 text-[22px] font-semibold tracking-tight">Invite {roleLabel === "ER staff" ? "an ER staff member" : `a ${roleLabel.toLowerCase()}`}</h2>
          <div role="radiogroup" aria-label="Role" className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={role === r.key}
                onClick={() => { setRole(r.key); setError(""); setNotice(""); }}
                className={`h-11 rounded-full px-5 text-sm ${role === r.key ? "bg-ink font-semibold text-white" : "border border-line font-medium hover:bg-soft"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Field id="full_name" label="Full name">
            <input id="full_name" className="field" value={form.full_name} onChange={set("full_name")} autoComplete="off" />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field id="username" label="Username" hint="3 to 100 characters">
              <input id="username" className="field" value={form.username} onChange={set("username")} autoComplete="off" />
            </Field>
            <Field id="email" label="Email" hint="The invitation link is sent here">
              <input id="email" type="email" className="field" value={form.email} onChange={set("email")} autoComplete="off" />
            </Field>
          </div>
          {role === "DOCTOR" && (
            <>
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
            </>
          )}
          {error && (
            <p role="alert" className="m-0 flex items-center gap-2 text-sm font-medium text-risk-high-bg">
              <Icon name="alert" size={16} color="#C62828" /> {error}
            </p>
          )}
          {notice && <p role="status" className="m-0 rounded-2xl bg-risk-low-bg px-4 py-3 text-sm font-medium text-risk-low-fg">{notice}</p>}
          <Button type="submit" disabled={busy} className="h-14 text-base">
            {busy ? "Sending invitation..." : "Create and send invitation"}
          </Button>
        </form>

        <section className="panel flex flex-col gap-3 p-7!">
          <h2 className="m-0 text-[22px] font-semibold tracking-tight">Invited just now</h2>
          {created.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-6 text-center">
              <Mascot size={64} label="" />
              <p className="m-0 text-sm text-muted">
                No one invited yet. New invitations from this visit show here.
              </p>
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {created.map((d, i) => (
                <li key={i} className="flex items-center gap-3 rounded-2xl bg-risk-low-bg px-4 py-3 text-risk-low-fg">
                  <Icon name="checkCircle" size={20} color="#187A41" strokeWidth={2.6} />
                  <span className="text-sm">
                    <b>{d.name}</b> · {d.role} · {d.username}<br />
                    <span className="text-xs">Invited at {d.email}</span>
                    {d.sample && <><br /><Link to={d.sample} className="text-xs font-semibold underline">Sample mode: open the invitation link</Link></>}
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
