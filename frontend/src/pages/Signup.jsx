import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { homeFor } from "../auth/roles";
import BrandPill from "../components/BrandPill";
import Icon from "../components/Icon";

const TODAY = new Date().toISOString().slice(0, 10);
const IN = "h-13 rounded-full border border-white/30 bg-white/10 px-5 text-[15px] font-medium text-white scheme-dark";

export default function Signup() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ full_name: "", dob: "", phone: "", email: "", password: "", again: "", share: true });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!f.full_name.trim()) return setErr("Enter your full name.");
    if (!f.dob) return setErr("Enter your date of birth.");
    if (f.phone.replace(/\D/g, "").length < 7) return setErr("Enter your phone number.");
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErr("Enter a valid email address, or leave it empty.");
    if (f.password.length < 12) return setErr("Password must be at least 12 characters.");
    if (f.password !== f.again) return setErr("The two passwords do not match.");
    setBusy(true);
    try {
      const body = { full_name: f.full_name.trim(), dob: f.dob, phone: f.phone.trim(), email: f.email.trim(), password: f.password, share: f.share };
      const r = await api.registerPatient(body);
      await login(r.username || body.email || body.phone, f.password);
      navigate("/patient", { replace: true });
    } catch (x) {
      setErr(x.message);
    } finally { setBusy(false); }
  }

  const type = show ? "text" : "password";
  const L = (id, label, props) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="pl-4 text-[13px] font-medium text-[#E6E9F0]">{label}</label>
      <input id={id} className={IN} {...props} />
    </div>
  );
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12 text-white"
      style={{ background: "radial-gradient(60% 55% at 18% 20%, rgba(211,234,227,0.55) 0%, rgba(211,234,227,0) 70%), radial-gradient(55% 60% at 85% 80%, rgba(231,222,246,0.55) 0%, rgba(231,222,246,0) 70%), #0E1016" }}
    >
      <BrandPill />
      <h1 className="sr-only">Create your profile</h1>
      <form onSubmit={submit} noValidate className="flex w-full max-w-[420px] flex-col gap-4 rounded-[32px] border border-white/20 bg-[rgba(18,20,28,0.78)] p-7 shadow-2xl">
        {L("su-name", "Full name", { value: f.full_name, onChange: set("full_name"), autoComplete: "name" })}
        {L("su-dob", "Date of birth", { type: "date", value: f.dob, onChange: set("dob"), max: TODAY, autoComplete: "bday" })}
        {L("su-phone", "Phone", { type: "tel", inputMode: "tel", value: f.phone, onChange: set("phone"), autoComplete: "tel" })}
        {L("su-email", "Email (optional)", { type: "email", value: f.email, onChange: set("email"), autoComplete: "email" })}
        {L("su-pass", "Password (12 or more characters)", { type, value: f.password, onChange: set("password"), autoComplete: "new-password" })}
        {L("su-again", "Repeat password", { type, value: f.again, onChange: set("again"), autoComplete: "new-password" })}
        <label className="flex cursor-pointer items-center gap-3 pl-3 text-[13px] text-[#E6E9F0]">
          <input type="checkbox" checked={show} onChange={() => setShow((s) => !s)} className="h-5 w-5 accent-[#D3EAE3]" /> Show passwords
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-3xl bg-white/10 px-4 py-3 text-[13px] leading-snug text-[#E6E9F0]">
          <input type="checkbox" checked={f.share} onChange={() => setF((x) => ({ ...x, share: !x.share }))} className="mt-0.5 h-5 w-5 flex-none accent-[#D3EAE3]" />
          <span>Let ER doctors and staff see my earlier visits, allergies and medicines when I am treated.</span>
        </label>
        {err && (
          <p role="alert" className="m-0 flex items-center gap-2 rounded-full bg-[rgba(255,120,120,0.14)] px-5 py-3 text-[13px] text-[#FFB4B4]">
            <Icon name="alert" size={16} color="#FFB4B4" /> {err}
          </p>
        )}
        <button type="submit" disabled={busy} className="h-[52px] rounded-full bg-mint text-base font-semibold text-ink disabled:opacity-60">
          {busy ? "Creating..." : "Create profile"}
        </button>
      </form>
      <Link to="/login" className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm text-[#C9CED8]">Already have a profile? Sign in</Link>
    </div>
  );
}
