import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { ROLE_CONFIG } from "../auth/roles";
import { useStays } from "../lib/useStays";
import Icon from "./Icon";
import Logo from "./Logo";
import { STEP_DEFS, VISIT_SECTIONS, stepDone, useCaseNav, useVisitNav } from "./CaseNav";
import { riskLevel } from "../lib/risk";
import { SCORE_NAME, SCORE_REF } from "../lib/terms";

const BTN = "relative flex h-11 w-11 items-center justify-center rounded-full text-text hover:bg-soft";

function Attention({ home }) {
  const { counts, loading } = useStays();
  const n = counts.high + counts.medium;
  return (
    <Link to={home} aria-label={`Patients needing attention: ${loading ? "loading" : n}`} title="Patients needing attention" className={BTN}>
      <Icon name="bell" size={22} />
      {!loading && n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-risk-high-bg px-1 text-[11px] font-bold text-white">
          {n}
        </span>
      )}
    </Link>
  );
}

// Slim left rail (wide screens): small tools, not page navigation.
export default function UtilityRail() {
  const { user, logout } = useAuth();
  const cfg = ROLE_CONFIG[user.role];
  const [help, setHelp] = useState(false);
  const nav = useCaseNav();
  const visit = useVisitNav();
  const c = nav?.c;
  const firstTodo = c ? STEP_DEFS.find((s) => !stepDone(c, s.key))?.key : null;
  const risk = c?.news2?.complete ? riskLevel(c.news2.risk_level) : null;

  useEffect(() => {
    if (!help) return undefined;
    const onKey = (e) => e.key === "Escape" && setHelp(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [help]);

  const showAttention = user.role === "ER_STAFF" || user.role === "DOCTOR" || user.role === "ADMIN";

  return (
    <>
      <aside aria-label="Tools" className="fixed bottom-6 left-4 top-6 z-30 hidden w-16 flex-col items-center gap-3 overflow-y-auto lg:flex">
        <Link to={cfg.home} aria-label="Home" title="Home" className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-surface">
          <Logo size={30} />
        </Link>

        {c && (
          <div role="group" aria-label="Case steps" className="flex flex-none flex-col items-center gap-2 rounded-full bg-surface p-2">
            {STEP_DEFS.map((st) => {
              const done = stepDone(c, st.key);
              const current = st.key === firstTodo;
              return (
                <button
                  key={st.key}
                  type="button"
                  onClick={() => nav.onJump(st.key)}
                  aria-label={`${st.label}, ${done ? "done" : "to do"}`}
                  title={`${st.label} (${done ? "done" : "to do"})`}
                  className={`relative flex h-11 w-11 items-center justify-center rounded-full ${
                    done ? "bg-mint" : current ? "border-2 border-ink" : "bg-soft"
                  }`}
                >
                  <Icon name={st.icon} size={20} />
                  {done && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-risk-low-fg">
                      <Icon name="check" size={11} color="#FFFFFF" strokeWidth={3.5} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {visit && (
          <div role="group" aria-label="On this page" className="flex flex-none flex-col items-center gap-2 rounded-full bg-surface p-2">
            {VISIT_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => document.getElementById(sec.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                aria-label={`Jump to ${sec.label}`}
                title={sec.label}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-soft hover:bg-mint"
              >
                <Icon name={sec.icon} size={20} />
              </button>
            ))}
          </div>
        )}

        {!c && !visit && (user.role === "ER_STAFF" || user.role === "ADMIN") && (
          <div role="group" aria-label="Quick links" className="flex flex-none flex-col items-center gap-2 rounded-full bg-surface p-2">
            <Link to="/incoming" aria-label="Incoming ambulance cases" title="Incoming ambulance cases" className="flex h-11 w-11 items-center justify-center rounded-full bg-soft hover:bg-mint">
              <Icon name="truck" size={20} />
            </Link>
            <Link to="/follow-ups" aria-label="Follow-ups" title="Follow-ups" className="flex h-11 w-11 items-center justify-center rounded-full bg-soft hover:bg-mint">
              <Icon name="calendar" size={20} />
            </Link>
          </div>
        )}

        <div role="group" aria-label="Tools" className="flex flex-none flex-col items-center gap-1 rounded-full border border-[#C9CED8] p-2">
          <button type="button" className={BTN} aria-label="Search by visit ID" title="Search by visit ID"
            onClick={() => document.getElementById("stay-jump")?.focus()}>
            <Icon name="search" size={21} />
          </button>
          {showAttention && <Attention home={cfg.home} />}
          <button type="button" className={BTN} aria-label="How risk is shown" title="How risk is shown"
            aria-expanded={help} onClick={() => setHelp((h) => !h)}>
            <Icon name="help" size={21} />
          </button>
        </div>

        <div className="mt-auto flex flex-none flex-col items-center gap-3">
          {c && (
            <div
              role="img"
              aria-label={risk ? `${SCORE_NAME} (${SCORE_REF}) ${c.news2.total_news2_score}, ${risk.label}` : `${SCORE_NAME} not available yet`}
              title={risk ? `${SCORE_NAME}: ${c.news2.total_news2_score} (${risk.label})` : `${SCORE_NAME}: not available yet`}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-semibold ${risk ? risk.badge : "bg-surface text-muted"}`}
            >
              {risk ? c.news2.total_news2_score : "–"}
            </div>
          )}
          <div role="group" aria-label="Account" className="flex flex-col items-center gap-2 rounded-full bg-surface p-2">
            <button type="button" onClick={logout} className={BTN} aria-label="Sign out" title="Sign out">
              <Icon name="logout" size={21} />
            </button>
            <span
              role="img"
              aria-label={`Signed in as ${user.username}, ${cfg.label}`}
              title={`${user.username} (${cfg.label})`}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-lavender text-sm font-semibold"
            >
              {(user.username || "me").slice(0, 2).toUpperCase()}
            </span>
          </div>
        </div>
      </aside>

      {help && (
        <div role="dialog" aria-label="How risk is shown" className="fixed bottom-24 left-24 z-40 hidden w-80 rounded-3xl bg-surface p-5 shadow-lg lg:block">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="m-0 text-base font-semibold">How risk is shown</h2>
            <button type="button" onClick={() => setHelp(false)} className="h-11 rounded-full px-3 text-sm font-semibold underline">Close</button>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] leading-snug">
            <li><b>High</b>: total 7 or more</li>
            <li><b>Medium</b>: total 5 or 6</li>
            <li><b>Low-medium</b>: total 0 to 4, but one reading scores 3</li>
            <li><b>Low</b>: everything else</li>
          </ul>
          <p className="mb-0 mt-3 text-xs text-muted">
            Risk comes from the {SCORE_NAME} ({SCORE_REF}). It is decision support. A clinician must review every score.
          </p>
        </div>
      )}
    </>
  );
}
