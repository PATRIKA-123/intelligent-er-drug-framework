import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "./auth/AuthContext";
import { homeFor } from "./auth/roles";
import RequireRole from "./auth/RequireRole";
import AppShell from "./components/AppShell";
import Login from "./pages/Login";
import Board from "./pages/Board";
import Incoming from "./pages/Incoming";
import Discharge from "./pages/Discharge";
import FollowUpsPage from "./pages/FollowUps";
import StayDetail from "./pages/StayDetail";
import Prescription from "./pages/Prescription";
import ParamedicHome from "./pages/ParamedicHome";
import ParamedicCase from "./pages/ParamedicCase";
import ComingSoon from "./pages/ComingSoon";
import ParamedicNew from "./pages/ParamedicNew";
import AdminDoctors from "./pages/AdminDoctors";
import AcceptInvitation from "./pages/AcceptInvitation";

function Root() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/login" element={<Login />} />
      <Route path="/accept-invitation" element={<AcceptInvitation />} />
      <Route element={<RequireRole />}>
        <Route element={<AppShell />}>
          <Route element={<RequireRole roles={["PARAMEDIC", "ADMIN"]} />}>
            <Route path="/paramedic" element={<ParamedicHome />} />
            <Route path="/paramedic/new" element={<ParamedicNew />} />
            <Route path="/paramedic/cases/:caseId" element={<ParamedicCase />} />
          </Route>
          <Route element={<RequireRole roles={["ER_STAFF", "ADMIN"]} />}>
            <Route path="/board" element={<Board />} />
            <Route path="/incoming" element={<Incoming />} />
            <Route path="/follow-ups" element={<FollowUpsPage />} />
          </Route>
          <Route element={<RequireRole roles={["DOCTOR"]} />}>
            <Route path="/stays" element={<Board />} />
            <Route path="/stays/:stayId/prescribe" element={<Prescription />} />
            <Route path="/stays/:stayId/discharge" element={<Discharge />} />
          </Route>
          <Route element={<RequireRole roles={["DOCTOR", "ER_STAFF", "ADMIN"]} />}>
            <Route path="/stays/:stayId" element={<StayDetail />} />
          </Route>
          <Route element={<RequireRole roles={["ADMIN"]} />}>
            <Route path="/admin" element={<AdminDoctors />} />
          </Route>
          <Route element={<RequireRole roles={["PATIENT"]} />}>
            <Route path="/patient" element={<ComingSoon title="My visit" note="The backend has no patient endpoint yet." />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Root />} />
    </Routes>
  );
}
