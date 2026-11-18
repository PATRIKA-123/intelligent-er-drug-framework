import Mascot from "./Mascot";
import Button from "./Button";

export function Loading({ label = "Loading" }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-16 text-muted">
      <div className="animate-pulse"><Mascot size={72} label="" /></div>
      <span className="text-sm font-medium">{label}...</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div role="alert" className="panel flex flex-col items-start gap-3">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted">{error?.message || "Please try again."}</p>
      {onRetry && <Button variant="outline" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Mascot size={64} label="" />
      <p className="text-base font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
    </div>
  );
}
