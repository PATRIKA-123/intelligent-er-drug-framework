import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import Icon from "../components/Icon";
import RiskBadge from "../components/RiskBadge";
import StatusChip from "../components/StatusChip";
import VitalTile from "../components/VitalTile";
import Button from "../components/Button";
import { ErrorState, Loading } from "../components/States";

const STEPS = [
  ["assessment", "Assessment"],
  ["vitals", "Vitals"],
  ["transport", "Transport"],
  ["handover", "Handover"],
];

export default function ParamedicCase() {
  const { caseId } = useParams();
  const [state, setState] = useState({ loading: true, error: null, c: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    api.getCase(caseId)
      .then((c) => setState({ loading: false, error: null, c }))
      .catch((error) => setState({ loading: false, error, c: null }));
  }, [caseId]);
  useEffect(load, [load]);

  async function arrived() {
    setBusy(true);
    setMsg("");
    try {
      await api.markArrived(caseId, {});
      load();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (state.loading && !state.c) return <Loading label="Loading case" />;
  if (state.error) return <ErrorState error={state.error} onRetry={load} />;
  const c = state.c;
  const n = c.news2;
  const ready = c.steps && Object.values(c.steps).every(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <Link to="/paramedic" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold">
          <Icon name="back" size={16} strokeWidth={2.4} /> My cases
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">{c.temporary_case_code}</h1>
          <RiskBadge size="lg" riskText={n?.risk_level} score={n?.total} />
          <StatusChip status={c.status} />
        </div>
        <p className="m-0 text-sm text-muted">{c.chief_note}</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="panel">
          <h2 className="m-0 text-[22px] font-semibold tracking-tight">Steps</h2>
          <ol className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0">
            {STEPS.map(([key, label]) => {
              const done = c.steps?.[key];
              return (
                <li key={key} className="flex items-center justify-between rounded-2xl bg-page px-4 py-3.5">
                  <span className="text-[15px] font-semibold">{label}</span>
                  <span className="flex items-center gap-1.5 text-sm">
                    <Icon name={done ? "checkCircle" : "alert"} size={18} color={done ? "#187A41" : "#5B6270"} strokeWidth={2.4} />
                    {done ? "Done" : "To do"}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mb-0 mt-3 text-xs text-muted">Entry forms for each step come in the next build.</p>
        </section>

        <div className="flex flex-col gap-4">
          {n && (
            <section className="panel">
              <h2 className="m-0 text-[22px] font-semibold tracking-tight">Latest vitals</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <VitalTile label="Resp. rate" value={n.rr} unit="/min" />
                <VitalTile label="SpO2" value={n.spo2} unit="%" />
                <VitalTile label="Systolic BP" value={n.sbp} unit="mmHg" />
                <VitalTile label="Heart rate" value={n.hr} unit="bpm" />
                <VitalTile label="Temperature" value={n.temp} unit="°C" />
              </div>
              <p className="mb-0 mt-3 text-xs text-muted">NEWS2 is decision support. Clinician review required.</p>
            </section>
          )}
          <section className="panel flex flex-col gap-3">
            <h2 className="m-0 text-[22px] font-semibold tracking-tight">Hand over</h2>
            {c.status === "PRE_ER" ? (
              <>
                <Button onClick={arrived} disabled={busy || !ready}>{busy ? "Updating..." : "Arrived at ER"}</Button>
                {!ready && <p className="m-0 text-xs text-muted">Finish all four steps first.</p>}
              </>
            ) : (
              <p className="m-0 text-sm">This case is already with the ER ({c.status}).</p>
            )}
            {msg && <p role="alert" className="m-0 text-sm font-medium text-risk-high-bg">{msg}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
