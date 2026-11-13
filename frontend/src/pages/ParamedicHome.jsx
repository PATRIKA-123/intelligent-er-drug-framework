import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import RiskBadge from "../components/RiskBadge";
import StatusChip from "../components/StatusChip";
import Button from "../components/Button";
import { EmptyState, ErrorState, Loading } from "../components/States";

export default function ParamedicHome() {
  const [state, setState] = useState({ loading: true, error: null, cases: [] });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    api.listCases()
      .then((d) => setState({ loading: false, error: null, cases: d.cases || [] }))
      .catch((error) => setState({ loading: false, error, cases: [] }));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">My cases</h1>
          <p className="mt-2.5 text-[15px] text-muted">Patients you are bringing in or have handed over.</p>
        </div>
        <Button to="/paramedic/new" className="hidden md:inline-flex">New case</Button>
      </div>
      {state.loading && <Loading label="Loading cases" />}
      {state.error && <ErrorState error={state.error} onRetry={load} />}
      {!state.loading && !state.error && (
        state.cases.length === 0 ? (
          <EmptyState title="No cases yet" hint="Start a new case when you pick up a patient." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {state.cases.map((c) => (
              <Link key={c.case_id} to={`/paramedic/cases/${c.case_id}`} className="panel flex flex-col gap-3 hover:bg-[#F6F7F9]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-2xl font-semibold tracking-tight">{c.temporary_case_code}</span>
                  <StatusChip status={c.status} />
                </div>
                <p className="m-0 text-sm text-muted">{c.chief_note}</p>
                <RiskBadge riskText={c.news2?.risk_level} score={c.news2?.total} />
              </Link>
            ))}
          </div>
        )
      )}
    </div>
  );
}
