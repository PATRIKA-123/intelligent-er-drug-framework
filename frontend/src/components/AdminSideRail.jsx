import { Link, NavLink } from "react-router";
import { useAuth } from '../auth/useAuth';
import Logo from "./Logo";
import Icon from "./Icon";

const sections = [
  { to: "/admin", label: "Invite", icon: "user" },
  { to: "/admin/invitations", label: "Invitations", icon: "calendar" },
  { to: "/admin/users", label: "Users", icon: "list" },
  { to: "/admin/operations", label: "Operations", icon: "home" },
  { to: "/admin/history", label: "Archive / History", icon: "calendar" },
];

// Match the rest of Parvah: separate floating pill clusters, not one tall rectangular rail.
export default function AdminSideRail() {
  const { user, logout } = useAuth();
  return (
    <aside aria-label="Admin quick navigation" className="fixed bottom-6 left-4 top-6 z-30 hidden w-16 flex-col items-center gap-3 lg:flex">
      <Link to="/admin" aria-label="Admin home" title="Admin home" className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-surface transition hover:bg-mint">
        <Logo size={30} />
      </Link>
      <nav aria-label="Administration sections" className="flex flex-none flex-col items-center gap-1 rounded-full bg-surface p-2 shadow-sm">
        {sections.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} end aria-label={label} title={label}
            className={({ isActive }) => `group relative flex h-11 w-11 items-center justify-center rounded-full transition ${isActive ? "bg-ink shadow-sm" : "text-text hover:bg-soft"}`}>
            {({ isActive }) => (
              <>
                <Icon name={icon} size={20} color={isActive ? "#FFFFFF" : undefined} />
                <span className="pointer-events-none absolute left-[60px] z-40 hidden whitespace-nowrap rounded-xl bg-ink px-3 py-2 text-xs font-semibold text-white shadow-lg group-hover:block">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto flex flex-none flex-col items-center gap-2 rounded-full bg-surface p-2 shadow-sm" role="group" aria-label="Account">
        <button type="button" title="Sign out" aria-label="Sign out" onClick={logout} className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-soft">
          <Icon name="logout" size={20} />
        </button>
        <span role="img" aria-label={`Signed in as ${user.username}`} title={user.username} className="flex h-11 w-11 items-center justify-center rounded-full bg-lavender text-xs font-semibold">
          {(user.username || "AD").slice(0, 2).toUpperCase()}
        </span>
      </div>
    </aside>
  );
}
