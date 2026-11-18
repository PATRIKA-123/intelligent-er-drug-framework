import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import RiskBadge from "../components/RiskBadge";
import StatusChip from "../components/StatusChip";
import Button from "../components/Button";
import { EmptyState, ErrorState, Loading } from "../components/States";

export default function ParamedicHome() {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: null, cases: [] });
  const [openId, setOpenId] = useState("");
  const [tab, setTab] = useState("active");
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    api.listCases()
      .then((d) => setState({ loading: false, error: null, cases: d.cases || [] }))
      .catch((error) => setState({ loading: false, error, cases: [] }));
  }, []);
  useEffect(load, [load]);

  const done = (c) => c.steps?.handover || c.transport?.transport_status === "CANCELLED";
  const shownCases = state.cases.filter((c) => (tab === "done" ? done(c) : !done(c)));
  const nActive = state.cases.filter((c) => !done(c)).length;

  function open(e) {
    e.preventDefault();
    if (/^\d+$/.test(openId.trim())) navigate(`/paramedic/cases/${openId.trim()}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">My cases</h1>
          <p className="mt-2.5 text-[15px] text-muted">Cases you started or opened on this device.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={open} className="flex items-center gap-2">
            <label htmlFor="open-id" className="sr-only">Open a case by ID</label>
            <input id="open-id" inputMode="numeric" value={openId} onChange={(e) => setOpenId(e.target.value)}
              placeholder="Case ID" className="h-12 w-32 rounded-full border border-[#C9CED8] bg-surface px-4 text-sm" />
            <Button variant="outline" type="submit" className="h-12!">Open</Button>
          </form>
          <Button to="/paramedic/new" className="hidden md:inline-flex">New case</Button>
        </div>
      </div>
      <div role="tablist" aria-label="Case list" className="flex gap-2">
        {[["active", `Active (${nActive})`], ["done", `Completed (${state.cases.length - nActive})`]].map(([k, l]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-11 rounded-full px-5 text-sm font-semibold ${tab === k ? "bg-ink text-white" : "bg-surface"}`}>{l}</button>
        ))}
      </div>
      {state.loading && <Loading label="Loading cases" />}
      {state.error && <ErrorState error={state.error} onRetry={load} />}
      {!state.loading && !state.error && (
        shownCases.length === 0 ? (
          <EmptyState title={tab === "done" ? "No completed cases yet" : "No active cases"} hint={tab === "done" ? "Cases appear here after handover." : "Start a new case when you pick up a patient."} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {shownCases.map((c) => (
              <Link key={c.case_id} to={`/paramedic/cases/${c.case_id}`} className="panel flex flex-col gap-3 hover:bg-[#F6F7F9]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-2xl font-semibold tracking-tight">{c.temporary_case_code}</span>
                  <StatusChip status={c.status} />
                </div>
                <p className="m-0 text-sm text-muted">
                  {c.latest_assessment?.chief_complaint || "No complaint recorded yet"}
                </p>
                {c.news2?.complete
                  ? <RiskBadge riskText={c.news2.risk_level} score={c.news2.total_news2_score} />
                  : <span className="text-xs font-semibold text-muted">Score not available yet</span>}
              </Link>
            ))}
          </div>
        )
      )}
    </div>
  );
}
