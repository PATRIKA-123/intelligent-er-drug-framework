import Mascot from "../components/Mascot";
import Button from "../components/Button";
import { useAuth } from "../auth/AuthContext";
import { homeFor } from "../auth/roles";

// Honest placeholder for screens that are designed but not built yet.
export default function ComingSoon({ title, note }) {
  const { user } = useAuth();
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <Mascot size={96} label="" />
      <h1 className="m-0 text-[32px] font-semibold tracking-tight">{title}</h1>
      <p className="m-0 max-w-md text-[15px] text-muted">{note || "This screen is designed but not built yet."}</p>
      <Button to={homeFor(user.role)}>Back to home</Button>
    </div>
  );
}
