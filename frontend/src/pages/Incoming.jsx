import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { getStays } from "../lib/staysCache";
import { invalidateStays } from "../lib/staysCache";
import Button from "../components/Button";
import RiskBadge from "../components/RiskBadge";
import StatusChip from "../components/StatusChip";
import { fmtNum } from "../lib/format";

export default function Incoming() {
  const [caseId, setCaseId] = useState("");
  const [c, setC] = useState(null);
  const [stays, setStays] = useState([]);
  const [stayId, setStayId] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function find(e) {
    e.preventDefault();
    setMsg(null); setC(null); setConfirm(false);
    const id = caseId.trim();
    if (!/^\d+$/.test(id)) return setMsg({ error: "Enter the ambulance case ID the paramedic gave you." });
    setBusy(true);
    try {
      setC(await api.getCase(id));
      getStays().then((d) => setStays(d.rows || d.stays || d || [])).catch(() => {});
    } catch (err) {
      setMsg({ error: err.status === 404 ? "No ambulance case with that ID." : err.message });
    } finally { setBusy(false); }
  }

  async function link(e) {
    e.preventDefault();
    setMsg(null);
    if (!/^\d+$/.test(stayId.trim())) return setMsg({ error: "Enter the ER visit ID." });
    if (!confirm) return setMsg({ error: "Please confirm this is the same patient." });
    setBusy(true);
    try {
      await api.markArrived(c.case_id, stayId.trim());
      invalidateStays();
      setC(await api.getCase(c.case_id));
      setMsg({ ok: `Ambulance case linked to ER visit ${stayId.trim()}.` });
    } catch (err) {
      setMsg({ error: err.message });
    } finally { setBusy(false); }
  }

  const v = c?.latest_vital;
  const recent = Array.isArray(stays) ? stays.slice(0, 20) : [];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">Incoming</h1>
        <p className="mt-2.5 text-[15px] text-muted">Match the ambulance case to the patient's ER visit.</p>
      </div>

      <form onSubmit={find} className="panel flex flex-wrap items-end gap-3 p-7!">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="inc-case" className="text-[13px] font-semibold">Ambulance case ID from the paramedic</label>
          <input id="inc-case" inputMode="numeric" className="field w-48" value={caseId} onChange={(e) => setCaseId(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy} className="h-12!">Find ambulance case</Button>
        {!c && msg?.error && <p role="alert" className="m-0 w-full text-sm font-medium text-risk-high-bg">{msg.error}</p>}
      </form>

      {c && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <section className="panel flex flex-col gap-3 p-7!">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="m-0 text-[28px] font-semibold tracking-tight">{c.temporary_case_code}</h2>
              <StatusChip status={c.status} />
            </div>
            <p className="m-0 text-sm text-muted">Case ID {c.case_id}{c.latest_assessment?.chief_complaint ? ` · ${c.latest_assessment.chief_complaint}` : ""}</p>
            {c.news2?.complete && <RiskBadge size="lg" riskText={c.news2.risk_level} score={c.news2.total_news2_score} />}
            {v && (
              <p className="m-0 text-sm">
                HR {fmtNum(v.heart_rate)} · BP {fmtNum(v.systolic_bp)}/{fmtNum(v.diastolic_bp)} · SpO2 {fmtNum(v.spo2)} · RR {fmtNum(v.respiratory_rate)} · Temp {fmtNum(v.temperature_celsius)}
              </p>
            )}
            <p className="m-0 text-sm text-muted">Transport: {c.transport?.transport_status?.replaceAll("_", " ").toLowerCase() || "not saved"}</p>
          </section>

          <section className="panel flex flex-col gap-4 p-7!">
            <h2 className="m-0 text-[22px] font-semibold tracking-tight">Link to ER visit</h2>
            {c.stay_id ? (
              <p className="m-0 text-sm">Already linked to <Link to={`/stays/${c.stay_id}`} className="font-semibold underline">ER visit {c.stay_id}</Link>. This can't be changed here.</p>
            ) : (
              <form onSubmit={link} className="flex flex-col gap-4" noValidate>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="inc-stay" className="text-[13px] font-semibold">ER visit ID</label>
                  <input id="inc-stay" list="inc-stays" inputMode="numeric" className="field" value={stayId} onChange={(e) => setStayId(e.target.value)} />
                  <datalist id="inc-stays">
                    {recent.map((s) => <option key={s.stay_id} value={s.stay_id}>{s.chiefcomplaint || ""}</option>)}
                  </datalist>
                </div>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-risk-lowmed-bg px-4 py-3.5 text-sm leading-snug text-[#3F2700]">
                  <input type="checkbox" checked={confirm} onChange={() => setConfirm((x) => !x)} className="mt-0.5 h-6 w-6 flex-none accent-ink" />
                  <span>I confirmed this is the same patient. Linking can't be undone here.</span>
                </label>
                <Button type="submit" disabled={busy} className="h-14 text-base">{busy ? "Linking..." : "Link to this ER visit"}</Button>
              </form>
            )}
            {msg?.error && <p role="alert" className="m-0 text-sm font-medium text-risk-high-bg">{msg.error}</p>}
            {msg?.ok && <p role="status" className="m-0 text-sm font-semibold text-risk-low-fg">{msg.ok}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
