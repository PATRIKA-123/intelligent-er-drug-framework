import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthContext";
import { homeFor } from "./roles";

// Wraps routes. Not signed in -> login. Wrong role -> that role's home page.
// This only hides screens; the backend still enforces who may do what.
export default function RequireRole({ roles }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}
