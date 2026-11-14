import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api";
import BrandPill from "../components/BrandPill";
import Icon from "../components/Icon";

const inputCls = "h-13 w-full rounded-full border border-white/30 bg-white/10 px-5 text-[15px] font-medium text-white";

// Public page: the doctor lands here from the invitation email.
export default function AcceptInvitation() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState({ phase: "checking", name: "", error: "" });
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      setState({ phase: "bad", name: "", error: "This invitation link is incomplete. Open the link from your email again." });
      return;
    }
    api.validateInvitation(token)
      .then((r) => setState({ phase: "ready", name: r.doctor_name || "", error: "" }))
      .catch((e) => setState({ phase: "bad", name: "", error: e.message }));
  }, [token]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (pw.length < 12 || pw.length > 128) return setError("Password must be 12 to 128 characters.");
    if (pw !== pw2) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      await api.acceptInvitation(token, pw);
      setState((s) => ({ ...s, phase: "done" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12 text-white"
      style={{ background: "radial-gradient(60% 55% at 18% 20%, rgba(211,234,227,0.55) 0%, rgba(211,234,227,0) 70%), radial-gradient(55% 60% at 85% 80%, rgba(231,222,246,0.55) 0%, rgba(231,222,246,0) 70%), #0E1016" }}
    >
      <BrandPill />
      <div className="flex w-full max-w-[420px] flex-col gap-5 rounded-[32px] border border-white/20 bg-[rgba(18,20,28,0.78)] p-8 shadow-2xl">
        {state.phase === "checking" && <p role="status" className="m-0 text-center text-sm text-[#D5D9E2]">Checking your invitation...</p>}

        {state.phase === "bad" && (
          <>
            <h1 className="m-0 text-center text-2xl font-semibold tracking-tight">Invitation not available</h1>
            <p role="alert" className="m-0 text-center text-sm text-[#FFB4B4]">{state.error}</p>
            <p className="m-0 text-center text-sm text-[#D5D9E2]">Invitations work once and expire after 24 hours. Ask your administrator to send a new one.</p>
          </>
        )}

        {state.phase === "ready" && (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <div className="text-center">
              <h1 className="m-0 text-2xl font-semibold tracking-tight">Welcome{state.name ? `, Dr. ${state.name}` : ""}</h1>
              <p className="mt-2 text-sm text-[#D5D9E2]">Choose a password to activate your account.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pw" className="text-[13px] font-medium text-[#E6E9F0]">New password</label>
              <input id="pw" type={show ? "text" : "password"} autoComplete="new-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
              <span className="text-xs text-[#C9CED8]">12 to 128 characters. A few random words work well.</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pw2" className="text-[13px] font-medium text-[#E6E9F0]">Repeat password</label>
              <input id="pw2" type={show ? "text" : "password"} autoComplete="new-password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={show} onChange={() => setShow((x) => !x)} className="h-5 w-5 accent-[#D3EAE3]" /> Show passwords
            </label>
            {error && (
              <p role="alert" className="m-0 flex items-center gap-2 text-[13px] text-[#FFB4B4]">
                <Icon name="alert" size={16} color="#FFB4B4" /> {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="h-[52px] rounded-full bg-mint text-base font-semibold text-ink disabled:opacity-60">
              {busy ? "Activating..." : "Activate account"}
            </button>
          </form>
        )}

        {state.phase === "done" && (
          <>
            <h1 className="m-0 text-center text-2xl font-semibold tracking-tight">You are all set</h1>
            <p role="status" className="m-0 text-center text-sm text-[#D5D9E2]">Your account is active. Sign in with your username and the password you just chose.</p>
            <Link to="/login" className="flex h-[52px] items-center justify-center rounded-full bg-mint text-base font-semibold text-ink">Go to sign in</Link>
          </>
        )}
      </div>
    </div>
  );
}
