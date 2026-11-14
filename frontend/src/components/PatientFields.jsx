const TODAY = new Date().toISOString().slice(0, 10);

// Patient name, date of birth, phone and email, as the ER desk records them. All but the name are optional.
export default function PatientFields({ value, onChange, idPrefix = "pf" }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  // Called as a function, not rendered as a component, so the inputs keep focus while typing.
  const field = (k, label, hint, props) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${idPrefix}-${k}`} className="text-[13px] font-semibold">{label}</label>
      <input id={`${idPrefix}-${k}`} className="field" value={value[k] || ""} onChange={set(k)} {...props} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
  return (
    <>
      {field("patient_name", "Patient name", null, { autoComplete: "off" })}
      <div className="grid gap-3.5 sm:grid-cols-2">
        {field("dob", "Date of birth (optional)", null, { type: "date", max: TODAY })}
        {field("phone", "Phone (optional)", "The patient needs the last 4 digits to add this visit to their profile", { type: "tel", inputMode: "tel", autoComplete: "off" })}
      </div>
      {field("email", "Email (optional)", "With the date of birth, this links the visit to an existing patient profile", { type: "email", autoComplete: "off" })}
    </>
  );
}
