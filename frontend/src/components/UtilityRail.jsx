import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { ROLE_CONFIG } from "../auth/roles";
import { useStays } from "../lib/useStays";
import Icon from "./Icon";
import Mascot from "./Mascot";

const BTN = "relative flex h-11 w-11 items-center justify-center rounded-full text-text hover:bg-soft";

function Attention({ home }) {
  const { counts, loading } = useStays();
  const n = counts.high + counts.medium;
  return (
    <Link to={home} aria-label={`Stays needing attention: ${loading ? "loading" : n}`} title="Stays needing attention" className={BTN}>
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

  useEffect(() => {
    if (!help) return undefined;
    const onKey = (e) => e.key === "Escape" && setHelp(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [help]);

  const showAttention = user.role === "ER_STAFF" || user.role === "DOCTOR" || user.role === "ADMIN";

  return (
    <>
      <aside aria-label="Tools" className="fixed bottom-6 left-4 top-6 z-30 hidden w-16 flex-col items-center justify-between rounded-full bg-surface py-5 lg:flex">
        <div className="flex flex-col items-center gap-2">
          <Link to={cfg.home} aria-label="Home" title="Home" className="mb-2 flex h-11 w-11 items-center justify-center">
            <Mascot size={30} outline label="" />
          </Link>
          <button type="button" className={BTN} aria-label="Search by stay ID" title="Search by stay ID"
            onClick={() => document.getElementById("stay-jump")?.focus()}>
            <Icon name="search" size={21} />
          </button>
          {showAttention && <Attention home={cfg.home} />}
          <button type="button" className={BTN} aria-label="How NEWS2 risk works" title="How NEWS2 risk works"
            aria-expanded={help} onClick={() => setHelp((h) => !h)}>
            <Icon name="help" size={21} />
          </button>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button type="button" onClick={logout} className={BTN} aria-label="Sign out" title="Sign out">
            <Icon name="logout" size={21} />
          </button>
        </div>
      </aside>

      {help && (
        <div role="dialog" aria-label="How NEWS2 risk works" className="fixed bottom-24 left-24 z-40 hidden w-80 rounded-3xl bg-surface p-5 shadow-lg lg:block">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="m-0 text-base font-semibold">How risk is shown</h2>
            <button type="button" onClick={() => setHelp(false)} className="h-11 rounded-full px-3 text-sm font-semibold underline">Close</button>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] leading-snug">
            <li><b>High</b>: NEWS2 total 7 or more</li>
            <li><b>Medium</b>: total 5 or 6</li>
            <li><b>Low-medium</b>: total 0 to 4, but one reading scores 3</li>
            <li><b>Low</b>: everything else</li>
          </ul>
          <p className="mb-0 mt-3 text-xs text-muted">
            NEWS2 is decision support. A clinician must review every score.
          </p>
        </div>
      )}
    </>
  );
}
