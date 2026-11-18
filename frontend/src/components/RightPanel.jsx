import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { ROLE_CONFIG } from "../auth/roles";
import { useStays } from "../lib/useStays";
import Mascot from "./Mascot";
import { useCaseNav, useVisitNav } from "./CaseNav";
import { fmtNum, formatDateTime } from "../lib/format";
import RiskBadge from "./RiskBadge";
import StatusChip from "./StatusChip";

function initials(name = "") {
  return name.slice(0, 2).toUpperCase() || "ME";
}

function Card({ title, children, className = "" }) {
  return (
    <section className={`rounded-panel bg-surface p-5 ${className}`}>
      {title && <h2 className="m-0 mb-3 text-base font-semibold tracking-tight">{title}</h2>}
      {children}
    </section>
  );
}

function StaffPanel() {
  const { rows, counts, loading, error, reload } = useStays();
  const attention = rows.filter((r) => r.level && (r.level.key === "high" || r.level.key === "medium")).slice(0, 6);
  return (
    <>
      <Card title="Risk now">
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ["high", "High", "bg-risk-high-bg text-white"],
            ["medium", "Med", "bg-risk-medium-bg text-risk-medium-fg"],
            ["lowmed", "Low-med", "bg-risk-lowmed-bg text-risk-lowmed-fg"],
            ["low", "Low", "bg-risk-low-bg text-risk-low-fg"],
          ].map(([k, label, cls]) => (
            <div key={k} className={`rounded-2xl px-1 py-2 ${cls}`}>
              <div className="text-xl font-semibold leading-none">{loading ? "–" : counts[k]}</div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-wide">{label}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Needs attention">
        {loading && <p role="status" className="m-0 text-sm text-muted">Loading...</p>}
        {error && (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-muted">
            <span>Could not load patients{error.message ? `: ${error.message}` : "."}</span>
            <button type="button" onClick={reload} className="h-11 rounded-full border border-ink px-4 font-semibold text-ink">
              Try again
            </button>
          </div>
        )}
        {!loading && !error && attention.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <Mascot size={48} label="" />
            <p className="m-0 text-sm text-muted">Nobody above low-medium risk right now.</p>
          </div>
        )}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {attention.map((r) => (
            <li key={r.stay_id}>
              <Link to={`/stays/${r.stay_id}`} className="flex flex-col gap-1.5 rounded-2xl bg-soft px-3.5 py-3 hover:bg-page">
                <span className="flex items-center justify-between gap-2">
                  <RiskBadge riskText={r.latest_news2?.risk_level} score={r.latest_news2?.total_news2_score} />
                  <span className="text-xs text-muted">Visit {r.stay_id}</span>
                </span>
                {r.chiefcomplaint && <span className="truncate text-[13px]">{r.chiefcomplaint}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}


// Small loader shared by the cards that call an endpoint which may not exist on the real server.
function useLoad(fn, deps) {
  const [st, setSt] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    let live = true;
    setSt({ loading: true, error: null, data: null });
    fn().then((data) => live && setSt({ loading: false, error: null, data }))
      .catch((error) => live && setSt({ loading: false, error, data: null }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return st;
}

function Note({ children }) {
  return <p className="m-0 text-sm text-muted">{children}</p>;
}

function Row({ k, v }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold text-muted">{k}</dt>
      <dd className="m-0 text-sm font-medium">{v || <span className="text-muted">None yet</span>}</dd>
    </div>
  );
}

function VisitCard({ visit }) {
  const { stayId, summary: s } = visit;
  const post = useLoad(() => api.getPostEr(stayId), [stayId]);
  const d = post.data;
  const alerts = s.clinical_alerts?.alerts?.length || 0;
  const pending = d?.prescriptions?.filter((p) => p.status === "PENDING_REVIEW").length || 0;
  return (
    <Card title="This visit">
      <dl className="m-0 flex flex-col gap-2.5">
        <Row k="Visit ID" v={s.stay?.stay_id} />
        <Row k="Arrived" v={s.stay?.intime ? formatDateTime(s.stay.intime) : null} />
        <Row k="Doctor" v={post.loading ? "Loading..." : d?.assigned_doctor?.full_name || null} />
        <Row k="Open alerts" v={String(alerts)} />
        <Row k="Medicines waiting for review" v={post.loading ? "Loading..." : String(pending)} />
        <Row k="Follow-ups planned" v={post.loading ? "Loading..." : String(d?.follow_ups?.length || 0)} />
        <Row k="Discharge" v={post.loading ? "Loading..." : d?.discharge ? (d.discharge.departed_at ? "Patient has left" : `${d.discharge.discharge_status}, waiting to leave`) : "Not discharged"} />
      </dl>
      {post.error && <p role="alert" className="mb-0 mt-3 text-xs text-muted">Some details could not be loaded.</p>}
    </Card>
  );
}

function HistoryCard({ stayId }) {
  const st = useLoad(() => api.getPatientHistory(stayId), [stayId]);
  const h = st.data;
  if (st.loading || st.error || !h) return null;
  if (!h.linked) return <Card title="Patient history"><Note>No patient profile is linked to this visit.</Note></Card>;
  if (!h.shared) return <Card title="Patient history"><Note>{h.name} chose not to share earlier visits.</Note></Card>;
  const chips = (list) => list.length ? <div className="flex flex-wrap gap-1.5">{list.map((x) => <span key={x} className="rounded-full bg-soft px-3 py-1 text-xs font-medium">{x}</span>)}</div> : <span className="text-sm text-muted">None recorded</span>;
  return (
    <Card title="Patient history">
      <dl className="m-0 flex flex-col gap-3">
        <div className="flex flex-col gap-1"><dt className="text-xs font-semibold text-muted">Allergies (earlier visits)</dt><dd className="m-0">{chips(h.allergies)}</dd></div>
        {h.reported_allergies?.length > 0 && <div className="flex flex-col gap-1"><dt className="text-xs font-semibold text-muted">Allergies reported by the patient</dt><dd className="m-0">{chips(h.reported_allergies)}</dd></div>}
        {h.reported_conditions?.length > 0 && <div className="flex flex-col gap-1"><dt className="text-xs font-semibold text-muted">Conditions reported by the patient</dt><dd className="m-0">{chips(h.reported_conditions)}</dd></div>}
        {h.reported_medications?.length > 0 && <div className="flex flex-col gap-1"><dt className="text-xs font-semibold text-muted">Medicines reported by the patient</dt><dd className="m-0">{chips(h.reported_medications)}</dd></div>}
        {h.emergency_contact && <div className="flex flex-col gap-1"><dt className="text-xs font-semibold text-muted">Emergency contact</dt><dd className="m-0 text-sm font-medium">{h.emergency_contact.name}, {h.emergency_contact.phone}</dd></div>}
        <div className="flex flex-col gap-1"><dt className="text-xs font-semibold text-muted">Medicines (earlier visits)</dt><dd className="m-0">{chips(h.medications)}</dd></div>
        <div className="flex flex-col gap-1"><dt className="text-xs font-semibold text-muted">Earlier prescriptions</dt><dd className="m-0">{chips(h.prescriptions.map((p) => `${p.medication_name}${p.dosage ? ` ${p.dosage}` : ""}`))}</dd></div>
        <div className="flex flex-col gap-1.5">
          <dt className="text-xs font-semibold text-muted">Earlier visits</dt>
          <dd className="m-0">
            {h.visits.length === 0 ? <span className="text-sm text-muted">None</span> : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {h.visits.map((v) => (
                  <li key={v.stay_id}>
                    <Link to={`/stays/${v.stay_id}`} className="flex flex-col gap-0.5 rounded-2xl bg-soft px-3.5 py-3 hover:bg-page">
                      <span className="text-sm font-semibold">{v.diagnosis || v.chiefcomplaint}</span>
                      <span className="text-xs text-muted">{formatDateTime(v.arrived)} · Visit {v.stay_id}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function FollowUpsCard() {
  const st = useLoad(() => api.listFollowUps(), []);
  const rows = (st.data || []).filter((f) => !f.status || !/DONE|COMPLETE|CANCEL/i.test(f.status)).slice(0, 6);
  return (
    <Card title="Coming up">
      {st.loading && <Note>Loading...</Note>}
      {st.error && <Note>{st.error.status === 501 ? "The server cannot list follow-ups across visits yet. Open a visit to see its own." : "Could not load follow-ups."}</Note>}
      {!st.loading && !st.error && rows.length === 0 && <Note>No follow-ups planned yet.</Note>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((f, i) => (
          <li key={i}>
            <Link to={`/stays/${f.stay_id}`} className="flex flex-col gap-1 rounded-2xl bg-soft px-3.5 py-3 hover:bg-page">
              <span className="text-sm font-semibold">{f.follow_up_type}</span>
              <span className="text-xs text-muted">{formatDateTime(f.follow_up_date)} · Visit {f.stay_id}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReviewCard() {
  const st = useLoad(() => api.listPendingReviews(), []);
  const rows = st.data || [];
  return (
    <Card title="Medicines waiting for review">
      {st.loading && <Note>Loading...</Note>}
      {st.error && <Note>{st.error.status === 501 ? "The server cannot list these across visits yet. Open a visit to see its medicines." : "Could not load medicines."}</Note>}
      {!st.loading && !st.error && rows.length === 0 && <Note>Nothing waiting for review.</Note>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.slice(0, 6).map((p) => (
          <li key={p.prescription_id}>
            <Link to={`/stays/${p.stay_id}`} className="flex flex-col gap-1 rounded-2xl bg-soft px-3.5 py-3 hover:bg-page">
              <span className="text-sm font-semibold">{p.medication_name}</span>
              <span className="text-xs text-muted">Visit {p.stay_id}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StaffCard() {
  const st = useLoad(() => api.listDoctors(), []);
  const docs = Array.isArray(st.data) ? st.data : null;
  return (
    <Card title="Doctors on the system">
      {st.loading && <Note>Loading...</Note>}
      {!st.loading && !docs && <Note>The server cannot list doctors yet.</Note>}
      {docs && docs.length === 0 && <Note>No doctors yet.</Note>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {(docs || []).map((d) => (
          <li key={d.user_id} className="rounded-2xl bg-soft px-3.5 py-3">
            <div className="text-sm font-semibold">{d.full_name}</div>
            {d.specialization && <div className="text-xs text-muted">{d.specialization}</div>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PatientPanel() {
  const st = useLoad(() => api.listMyVisits(), []);
  const d = st.data;
  const meds = d ? d.visits.reduce((n, v) => n + v.prescriptions.length, 0) : 0;
  return (
    <>
      {d && (
        <Card title="My profile">
          <dl className="m-0 flex flex-col gap-2.5">
            <Row k="Date of birth" v={d.profile.dob} />
            <Row k="Phone" v={d.profile.phone} />
            <Row k="Email" v={d.profile.email} />
          </dl>
          <p className="mb-0 mt-3 text-sm text-muted">{d.visits.length} visit{d.visits.length === 1 ? "" : "s"} · {meds} active medicine{meds === 1 ? "" : "s"}</p>
        </Card>
      )}
      <Card title="Adding a visit">
        <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm">
          <li>Take the slip from the ER desk</li>
          <li>Enter the visit ID and access code</li>
          <li>Enter the last 4 digits of your phone</li>
        </ol>
      </Card>
    </>
  );
}

function ParamedicPanel() {
  const [state, setState] = useState({ loading: true, error: null, cases: [] });
  useEffect(() => {
    let live = true;
    api.listCases()
      .then((d) => live && setState({ loading: false, error: null, cases: d.cases || [] }))
      .catch((error) => live && setState({ loading: false, error, cases: [] }));
    return () => { live = false; };
  }, []);
  return (
    <Card title="Active ambulance cases">
      {state.loading && <p role="status" className="m-0 text-sm text-muted">Loading...</p>}
      {state.error && <p role="alert" className="m-0 text-sm text-muted">Could not load cases.</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {state.cases.map((c) => (
          <li key={c.case_id}>
            <Link to={`/paramedic/cases/${c.case_id}`} className="flex items-center justify-between gap-2 rounded-2xl bg-soft px-3.5 py-3 hover:bg-page">
              <span className="text-sm font-semibold">{c.temporary_case_code}</span>
              <StatusChip status={c.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CaseSnapshot({ c }) {
  const t = c.transport;
  const v = c.latest_vital;
  const rows = [
    ["Complaint", c.latest_assessment?.chief_complaint],
    ["Ambulance", t ? `${t.ambulance_id}${t.destination_hospital ? ` to ${t.destination_hospital}` : ""}` : null],
    ["Transport", t?.transport_status],
    ["Vitals", v ? `HR ${fmtNum(v.heart_rate)} · RR ${fmtNum(v.respiratory_rate)} · SBP ${fmtNum(v.systolic_bp)} · SpO2 ${fmtNum(v.spo2)}% · ${fmtNum(v.temperature)} °C` : null],
    ["ER stay", c.stay_id],
  ];
  return (
    <Card title="This ambulance case">
      <dl className="m-0 flex flex-col gap-2.5">
        {rows.map(([k, val]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-xs font-semibold text-muted">{k}</dt>
            <dd className="m-0 text-sm font-medium">{val || <span className="text-muted">Not recorded yet</span>}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// Right column on wide screens: who needs attention, plus who is signed in.
export default function RightPanel() {
  const { user } = useAuth();
  const cfg = ROLE_CONFIG[user.role];
  const nav = useCaseNav();
  const visit = useVisitNav();
  const { pathname } = useLocation();
  let body;
  if (user.role === "PATIENT") body = <PatientPanel />;
  else if (nav?.c || user.role === "PARAMEDIC") body = <ParamedicPanel />;
  else if (visit) body = <><VisitCard visit={visit} /><HistoryCard stayId={visit.stayId} /><StaffPanel /></>;
  else if (pathname === "/follow-ups") body = <><FollowUpsCard /><StaffPanel /></>;
  else if (pathname === "/admin") body = <><StaffCard /><StaffPanel /></>;
  else if (user.role === "DOCTOR") body = <><ReviewCard /><StaffPanel /></>;
  else body = <StaffPanel />;
  return (
    <aside aria-label="Overview" className="sticky top-6 hidden w-[320px] flex-none flex-col gap-4 self-start xl:flex">
      <section className="flex items-center gap-3 rounded-panel bg-mint p-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lavender text-sm font-semibold">
          {initials(user.username)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{user.username}</div>
          <div className="text-xs">{cfg.label}</div>
        </div>
      </section>
      {nav?.c && <CaseSnapshot c={nav.c} />}
      {body}
    </aside>
  );
}
