import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { homeFor } from "../auth/roles";
import { USE_MOCK } from "../api";
import Mascot from "../components/Mascot";
import Icon from "../components/Icon";

const SHORTCUTS = [
  { label: "Paramedic", username: "paramedic1" },
  { label: "ER staff", username: "nurse1" },
  { label: "Doctor", username: "doctor1" },
  { label: "Admin", username: "admin1" },
];

export default function Login() {
  const { user, login, expired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function submit(u, p) {
    setError("");
    setBusy(true);
    try {
      const who = await login(u, p);
      const back = location.state?.from;
      navigate(back && back !== "/login" ? back : homeFor(who.role), { replace: true });
    } catch (err) {
      setError(err.status === 401 || err.status === 403 || err.status === 400 ? err.message : err.message || "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    submit(username, password);
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12 text-white"
      style={{
        background:
          "radial-gradient(60% 55% at 18% 20%, rgba(211,234,227,0.55) 0%, rgba(211,234,227,0) 70%), radial-gradient(55% 60% at 85% 80%, rgba(231,222,246,0.55) 0%, rgba(231,222,246,0) 70%), radial-gradient(40% 45% at 80% 15%, rgba(120,160,255,0.35) 0%, rgba(120,160,255,0) 70%), #0E1016",
      }}
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex w-full max-w-[420px] flex-col gap-5 rounded-[32px] border border-white/20 bg-[rgba(18,20,28,0.78)] px-9 pb-8 pt-10 shadow-2xl"
      >
        <div className="flex flex-col items-center gap-3">
          <Mascot size={96} />
          <div className="text-center">
            <h1 className="m-0 text-[32px] font-semibold leading-tight tracking-tight">Welcome back</h1>
            <p className="mt-2 text-sm text-[#D5D9E2]">Sign in to the emergency care workspace</p>
          </div>
        </div>

        {expired && (
          <p role="status" className="m-0 rounded-2xl bg-white/10 px-4 py-3 text-center text-sm">
            Your session expired. Please sign in again.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="username" className="text-[13px] font-medium text-[#E6E9F0]">Username</label>
          <input
            id="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="h-12 rounded-2xl border border-white/30 bg-white/10 px-4 text-[15px] font-medium text-white placeholder:text-white/40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[13px] font-medium text-[#E6E9F0]">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-2xl border border-white/30 bg-white/10 px-4 text-[15px] font-medium text-white"
          />
        </div>

        {error && (
          <p role="alert" className="m-0 flex items-center gap-2 text-[13px] text-[#FFB4B4]">
            <Icon name="alert" size={16} color="#FFB4B4" />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="h-[52px] rounded-full bg-mint text-base font-semibold text-ink disabled:opacity-60"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>

        {USE_MOCK && (
          <div className="flex flex-col items-center gap-2.5">
            <span className="text-xs text-[#C9CED8]">Sample data mode. Sign in as</span>
            <div className="flex flex-wrap justify-center gap-2">
              {SHORTCUTS.map((s) => (
                <button
                  key={s.username}
                  type="button"
                  onClick={() => submit(s.username, "sample")}
                  className="min-h-11 rounded-full border border-white/35 px-4 text-[13px] font-medium"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
      <p className="m-0 text-center text-xs text-[#B8BECB]">
        {USE_MOCK ? "Sample data only. Nothing here is a real patient." : "Authorized staff only."}
      </p>
    </div>
  );
}
