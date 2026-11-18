// A clinical alert. HIGH is red, MEDIUM is orange. The message always says clinician review is needed.
export default function AlertBanner({ alert }) {
  const high = String(alert.severity).toUpperCase() === "HIGH";
  return (
    <div
      role="alert"
      className={`flex items-start gap-4 rounded-panel px-6 py-5 ${
        high ? "bg-risk-high-soft text-risk-high-softfg" : "bg-risk-medium-bg text-risk-medium-fg"
      }`}
    >
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" className="flex-none">
        {high ? (
          <>
            <path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" fill="#C62828" />
            <path d="M12 7v6M12 16v1" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          </>
        ) : (
          <path d="M12 3l10 18H2z" fill="#D9622B" />
        )}
      </svg>
      <div>
        <div className="text-[13px] font-bold uppercase tracking-wide">{alert.severity} alert</div>
        <div className="mt-1 text-[17px] font-semibold leading-snug">{alert.alert_message}</div>
      </div>
    </div>
  );
}
