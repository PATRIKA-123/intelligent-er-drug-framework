const STYLES = {
  PRE_ER: "bg-lavender text-ink",
  ARRIVED_ER: "bg-lavender text-ink",
  ACTIVE_ER: "bg-mint text-ink",
  CLOSED: "bg-soft text-muted",
  PENDING_REVIEW: "bg-lavender text-ink",
  AUTHORIZED: "bg-risk-low-bg text-risk-low-fg",
  REJECTED: "bg-soft text-text",
  SCREENED: "bg-mint text-ink",
};

export default function StatusChip({ status, className = "" }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${STYLES[status] || "bg-soft text-text"} ${className}`}
    >
      {status}
    </span>
  );
}
