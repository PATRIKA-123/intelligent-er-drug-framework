import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { ROLE_CONFIG } from "../auth/roles";
import Icon from "./Icon";
import Mascot from "./Mascot";
import RightPanel from "./RightPanel";
import { CaseNavProvider } from "./CaseNav";
import UtilityRail from "./UtilityRail";

function initials(name = "") {
  return name.slice(0, 2).toUpperCase() || "ME";
}

// Desktop: floating pill nav on top, a slim tools rail on the left (lg), an overview column on the right (xl). Phone: bottom bar with a round action button.
export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const cfg = ROLE_CONFIG[user.role];
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState("");

  function jump(e) {
    e.preventDefault();
    const q = query.trim();
    if (/^\d+$/.test(q)) navigate(`/stays/${q}`);
    setQuery("");
  }

  const pillLink = ({ isActive }) =>
    `flex h-11 items-center rounded-full px-5 text-sm transition ${
      isActive ? "bg-ink font-semibold text-white" : "font-medium text-text hover:bg-soft"
    }`;

  return (
    <CaseNavProvider>
    <div className="min-h-screen px-4 pb-28 pt-4 md:px-8 md:pb-14 md:pt-6 lg:pl-28">
      <UtilityRail />
      {/* Desktop header */}
      <header className="mb-8 hidden flex-wrap items-center justify-center gap-3 md:flex">
        <Link to={cfg.home} aria-label="Home" className="flex h-12 w-12 items-center justify-center rounded-full bg-surface">
          <Mascot size={28} outline label="" />
        </Link>
        <nav aria-label="Main" className="flex gap-1 rounded-full bg-surface p-1.5">
          {cfg.items.map((it) => (
            <NavLink key={it.to} to={it.to} end className={pillLink}>{it.label}</NavLink>
          ))}
        </nav>
        <form onSubmit={jump} className="flex h-12 min-w-[260px] flex-[0_1_340px] items-center gap-2.5 rounded-full bg-surface px-[18px]">
          <Icon name="search" size={18} color="#5B6472" strokeWidth={2} />
          <input
            id="stay-jump"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a stay ID"
            aria-label="Jump to a stay by ID"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <span className="rounded-lg border border-line px-1.5 py-0.5 text-xs text-muted">Enter</span>
        </form>
        <div className="relative lg:hidden">
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-label={`Account menu for ${user.username}`}
            aria-expanded={menu}
            className="h-12 w-12 rounded-full bg-lavender text-sm font-semibold text-ink"
          >
            {initials(user.username)}
          </button>
          {menu && (
            <div className="absolute right-0 top-14 z-20 w-56 rounded-3xl bg-surface p-4 shadow-lg">
              <div className="text-sm font-semibold">{user.username}</div>
              <div className="mb-3 text-xs text-muted">{cfg.label}</div>
              <button
                type="button"
                onClick={logout}
                className="flex h-11 w-full items-center gap-2 rounded-full border border-ink px-4 text-sm font-semibold"
              >
                <Icon name="logout" size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Phone top row */}
      <div className="mb-4 flex items-center justify-between md:hidden">
        <Link to={cfg.home} aria-label="Home" className="flex h-11 w-11 items-center justify-center rounded-full bg-surface">
          <Mascot size={24} outline label="" />
        </Link>
        <span className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold">{cfg.label}</span>
      </div>

      <div className="mx-auto flex max-w-[1680px] items-start gap-6">
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
        <RightPanel />
      </div>

      {/* Phone bottom bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-4 bottom-4 z-30 flex h-16 items-center justify-around rounded-full bg-surface px-3 shadow-lg md:hidden"
      >
        {cfg.items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end
            className={({ isActive }) =>
              `flex min-h-11 min-w-[72px] flex-col items-center justify-center gap-0.5 text-[11px] ${
                isActive ? "font-semibold text-ink" : "font-medium text-muted"
              }`
            }
          >
            <Icon name={it.icon} size={22} />
            {it.label}
          </NavLink>
        ))}
        {cfg.action && (
          <Link
            to={cfg.action.to}
            aria-label={cfg.action.label}
            className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full border-4 border-page bg-ink"
          >
            <Icon name={cfg.action.icon} size={26} color="#FFFFFF" strokeWidth={2.6} />
          </Link>
        )}
        <button
          type="button"
          onClick={logout}
          className="flex min-h-11 min-w-[72px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted"
        >
          <Icon name="logout" size={22} />
          Sign out
        </button>
      </nav>
    </div>
    </CaseNavProvider>
  );
}
