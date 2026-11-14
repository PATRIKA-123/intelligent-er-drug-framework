import { useState } from "react";
import { Link } from "react-router";
import { useStays } from "../lib/useStays";
import FollowUps from "../components/FollowUps";
import RiskBadge from "../components/RiskBadge";
import Button from "../components/Button";

// The backend has no list of all follow-ups, so ER staff pick a stay first.
export default function FollowUpsPage() {
  const { rows: stays = [] } = useStays(true);
  const [input, setInput] = useState("");
  const [stayId, setStayId] = useState("");
  const [err, setErr] = useState("");

  function open(e) {
    e.preventDefault();
    const v = input.trim();
    if (!/^\d+$/.test(v)) return setErr("Enter the numeric visit ID.");
    setErr(""); setStayId(v);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">Follow-ups</h1>
        <p className="mt-2.5 text-[15px] text-muted">Pick an ER visit to see and plan its follow-ups.</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <form onSubmit={open} className="panel flex flex-wrap items-end gap-3 p-7!" noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fu-stay" className="text-[13px] font-semibold">Visit ID</label>
              <input id="fu-stay" inputMode="numeric" className="field w-48" value={input} onChange={(e) => setInput(e.target.value)} />
            </div>
            <Button type="submit" className="h-12!">Open</Button>
            {err && <p role="alert" className="m-0 w-full text-sm font-medium text-risk-high-bg">{err}</p>}
          </form>

          <section className="panel flex flex-col gap-3 p-7!">
            <h2 className="m-0 text-[22px] font-semibold tracking-tight">Recent visits</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {stays.slice(0, 8).map((s) => (
                <li key={s.stay_id}>
                  <button
                    type="button"
                    onClick={() => { setStayId(String(s.stay_id)); setInput(String(s.stay_id)); setErr(""); }}
                    aria-pressed={String(s.stay_id) === stayId}
                    className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-left ${String(s.stay_id) === stayId ? "bg-lavender" : "bg-soft"}`}
                  >
                    <span className="text-sm"><b>Visit {s.stay_id}</b>{s.chiefcomplaint ? ` · ${s.chiefcomplaint}` : ""}</span>
                    <RiskBadge riskText={s.latest_news2?.risk_level} score={s.latest_news2?.total_news2_score} />
                  </button>
                </li>
              ))}
              {stays.length === 0 && <li className="text-sm text-muted">No visits loaded yet.</li>}
            </ul>
          </section>
        </div>

        <div>
          {stayId ? (
            <div className="flex flex-col gap-3">
              <Link to={`/stays/${stayId}`} className="inline-flex min-h-11 items-center self-start text-sm font-semibold underline">Open visit {stayId}</Link>
              <FollowUps stayId={stayId} canAdd />
            </div>
          ) : (
            <div className="rounded-panel border-2 border-dashed border-[#B9A6F5] bg-surface p-7 text-sm">Choose a visit to see its follow-ups.</div>
          )}
        </div>
      </div>
    </div>
  );
}
