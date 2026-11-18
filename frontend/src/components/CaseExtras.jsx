import { fmtNum, localTime, agoText, minsSince } from "../lib/format";
import { SCORE_NAME } from "../lib/terms";


const arrow = (cur, prev) => (cur == null || prev == null || Number(cur) === Number(prev) ? "" : Number(cur) > Number(prev) ? "↑" : "↓");
const word = (a) => (a === "↑" ? "up" : a === "↓" ? "down" : "");

export function repeatDue(c) {
  if (!c?.latest_vital?.recorded_at || c.steps?.handover) return null;
  const m = minsSince(c.latest_vital.recorded_at);
  return m != null && m >= 15 ? m : null;
}

export function VitalsHistory({ c }) {
  const list = [...(c.vitals_history || [])].sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at)).slice(0, 4);
  if (!list.length) return null;
  const due = repeatDue(c);
  const cols = [["heart_rate", "HR"], ["respiratory_rate", "RR"], ["systolic_bp", "SBP"], ["spo2", "SpO2"], ["temperature", "Temp"]];
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-sm">
        Last recorded <b>{agoText(list[0].recorded_at) || "earlier"}</b>
        {due != null && <span className="ml-2 rounded-full bg-risk-lowmed-bg px-2.5 py-1 text-xs font-bold text-risk-lowmed-fg">Repeat due</span>}
      </p>
      <div className="overflow-x-auto rounded-2xl bg-soft">
        <table className="w-full min-w-[420px] border-collapse text-left text-sm">
          <caption className="sr-only">Recent vitals, newest first. Arrows compare with the reading before.</caption>
          <thead><tr className="text-xs text-muted">
            <th scope="col" className="px-3 py-2 font-semibold">Time</th>
            {cols.map(([, l]) => <th key={l} scope="col" className="px-2 py-2 font-semibold">{l}</th>)}
          </tr></thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={r.vital_id ?? r.recorded_at} className="border-t border-page">
                <th scope="row" className="px-3 py-2 font-semibold">{localTime(r.recorded_at)}</th>
                {cols.map(([k]) => {
                  const a = list[i + 1] ? arrow(r[k], list[i + 1][k]) : "";
                  return <td key={k} className="px-2 py-2">{fmtNum(r[k])}{a && <span aria-hidden className="ml-0.5 font-bold">{a}</span>}{a && <span className="sr-only"> {word(a)}</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function allergyText(a) {
  if (!a) return "Not recorded";
  const named = /Allergies:\s*([^\n]+)/i.exec(a.notes || "")?.[1];
  if (a.allergy_status === "ALLERGIES_REPORTED") return named ? `Allergic to ${named}` : "Allergies reported";
  if (a.allergy_status === "NONE_REPORTED") return "No allergies reported";
  if (a.allergy_status === "UNKNOWN") return "Not known";
  return a.allergy_status || "Not recorded";
}
export function medsText(a) {
  const m = Array.isArray(a?.current_medications) ? a.current_medications : [];
  if (!m.length) return "None reported";
  return m.map((x) => [x.medication_name, x.dose].filter(Boolean).join(" ")).join(", ");
}

export function HandoverSummary({ c }) {
  const v = c.latest_vital, a = c.latest_assessment, t = c.transport, n = c.news2;
  const vit = v ? `HR ${fmtNum(v.heart_rate)}, BP ${fmtNum(v.systolic_bp)}${v.diastolic_bp ? "/" + fmtNum(v.diastolic_bp) : ""}, SpO2 ${fmtNum(v.spo2)}%, RR ${fmtNum(v.respiratory_rate)}, Temp ${fmtNum(v.temperature)} °C${v.oxygen_support ? ", on oxygen" : ""}` : "Not recorded";
  const rows = [
    ["Case", `${c.temporary_case_code}${a?.chief_complaint ? " · " + a.chief_complaint : ""}`],
    ["Consciousness", a?.consciousness_status || v?.consciousness_level || "Not recorded"],
    ["Vitals", vit],
    [SCORE_NAME, n?.complete ? `${n.total_news2_score}, ${String(n.risk_level).toLowerCase()}` : "Not available"],
    ["Allergies", allergyText(a)],
    ["Medicines", medsText(a)],
    ["Ambulance", t ? `${t.ambulance_id}${t.destination_hospital ? " to " + t.destination_hospital : ""}` : "Not recorded"],
  ];
  return (
    <section className="panel flex flex-col gap-3">
      <h2 className="m-0 text-[22px] font-semibold tracking-tight">Handover summary</h2>
      <p className="m-0 text-xs text-muted">Read this out at the desk. It is made from what you recorded.</p>
      <dl className="m-0 flex flex-col gap-2.5">
        {rows.map(([k, val]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-xs font-semibold text-muted">{k}</dt>
            <dd className="m-0 text-[17px] font-semibold leading-snug">{val}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Timeline({ c }) {
  const ev = [];
  const a = c.latest_assessment;
  if (a?.assessment_time || a?.created_at) ev.push([a.assessment_time || a.created_at, "Assessment recorded"]);
  (c.vitals_history || []).forEach((v, i) => v.recorded_at && ev.push([v.recorded_at, i === 0 ? "Vitals recorded" : "Vitals repeated"]));
  if (c.transport?.created_at) ev.push([c.transport.created_at, `Ambulance ${c.transport.ambulance_id || ""} assigned`.replace("  ", " ")]);
  if (c.transport?.updated_at && c.transport.transport_status !== "DISPATCHED")
    ev.push([c.transport.updated_at, `Transport ${c.transport.transport_status.replaceAll("_", " ").toLowerCase()}`]);
  ev.sort((x, y) => new Date(x[0]) - new Date(y[0]));
  if (!ev.length) return null;
  return (
    <section className="panel flex flex-col gap-3">
      <h2 className="m-0 text-[22px] font-semibold tracking-tight">Timeline</h2>
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        {ev.map(([t, label], i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className="mt-1 h-2.5 w-2.5 flex-none rounded-full bg-ink" aria-hidden />
            <span><b>{localTime(t)}</b> · {label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
