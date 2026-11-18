// Says where a value came from: RECORDED, or NO DATA (never a blank).
export default function ProvenanceTag({ status }) {
  const recorded = status === "RECORDED";
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
        recorded ? "bg-risk-low-bg text-risk-low-fg" : "bg-page text-text"
      }`}
    >
      {recorded ? "RECORDED" : "NO DATA"}
    </span>
  );
}
