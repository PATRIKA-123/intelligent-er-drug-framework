import { useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import Button from "../components/Button";
import Icon from "../components/Icon";
import Mascot from "../components/Mascot";
import SafetyCard from "../components/SafetyCard";
import StatusChip from "../components/StatusChip";

const EMPTY = { medication_name: "", dosage: "", route: "", frequency: "", duration: "", instructions: "" };

export default function Prescription() {
  const { stayId } = useParams();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null); // { prescription, screening }
  const [acked, setAcked] = useState(false);
  const [decision, setDecision] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const screening = saved?.screening;
  const interactions = screening?.interactions_found || [];
  const complete = screening?.screening_status === "SCREENED";
  const needsAck = interactions.length > 0;
  const canAuthorize = saved && !decision && complete && (!needsAck || acked);

  async function save(e) {
    e.preventDefault();
    setError("");
    if (!form.medication_name.trim()) {
      setError("Enter the drug name.");
      return;
    }
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ""));
      setSaved(await api.createPrescription(stayId, body));
      setAcked(false);
      setDecision(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function review(status) {
    setError("");
    setBusy(true);
    try {
      await api.reviewPrescription(stayId, saved.prescription.prescription_id, { status });
      setDecision(status);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <Link to={`/stays/${stayId}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold">
          <Icon name="back" size={16} strokeWidth={2.4} /> Back to stay
        </Link>
        <h1 className="m-0 text-[40px] font-semibold leading-none tracking-tight md:text-5xl">New prescription</h1>
        <p className="m-0 text-sm text-muted">
          Visit {stayId}. Only the assigned doctor can prescribe; the server checks this.
        </p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <form onSubmit={save} noValidate className="panel flex flex-col gap-4 p-7!">
          <h2 className="m-0 text-[22px] font-semibold tracking-tight">Prescription</h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="drug" className="text-[13px] font-semibold">Drug</label>
            <input id="drug" className="field" value={form.medication_name} onChange={set("medication_name")} disabled={!!saved} />
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dose" className="text-[13px] font-semibold">Dose</label>
              <input id="dose" className="field" value={form.dosage} onChange={set("dosage")} disabled={!!saved} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="route" className="text-[13px] font-semibold">Route</label>
              <input id="route" className="field" value={form.route} onChange={set("route")} disabled={!!saved} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="freq" className="text-[13px] font-semibold">Frequency</label>
              <input id="freq" className="field" value={form.frequency} onChange={set("frequency")} disabled={!!saved} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dur" className="text-[13px] font-semibold">Duration</label>
              <input id="dur" className="field" value={form.duration} onChange={set("duration")} disabled={!!saved} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="notes" className="text-[13px] font-semibold">Instructions</label>
            <input id="notes" className="field" value={form.instructions} onChange={set("instructions")} disabled={!!saved} />
          </div>
          {error && <p role="alert" className="m-0 text-sm font-medium text-risk-high-bg">{error}</p>}
          {!saved ? (
            <Button type="submit" disabled={busy} className="h-14 text-base">
              {busy ? "Screening..." : "Screen and save"}
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="rounded-full bg-lavender px-3.5 py-1.5 text-[13px] font-bold">Saved, screened</span>
              <Button variant="outline" className="h-11!" onClick={() => { setSaved(null); setDecision(null); setForm(EMPTY); }}>
                Start over
              </Button>
            </div>
          )}
        </form>

        <div className="flex flex-col gap-4">
          {!saved && (
            <div className="flex flex-col gap-2.5 rounded-panel border-2 border-dashed border-[#B9A6F5] bg-surface p-7">
              <Mascot size={64} label="" />
              <h2 className="m-0 text-[22px] font-semibold tracking-tight">Not screened yet</h2>
              <p className="m-0 text-sm leading-relaxed">
                Drug-interaction screening runs when you save. The result appears here.
              </p>
            </div>
          )}

          {saved && (
            <>
              <SafetyCard
                title="Screening result"
                status={screening.screening_status}
                interactions={interactions}
                empty={complete ? "No interactions found" : "Screening is incomplete"}
                notes={
                  complete
                    ? undefined
                    : screening.mapping_reason || "Some medications could not be matched, so authorization is blocked."
                }
              />
              <div className="flex items-center gap-2.5 text-sm">
                Prescription status <StatusChip status={decision || saved.prescription.status} />
              </div>
            </>
          )}

          <section className="panel flex flex-col gap-4 p-7!">
            <h2 className="m-0 text-[22px] font-semibold tracking-tight">Review</h2>
            {!saved && (
              <>
                <Button disabled>Authorize</Button>
                <p className="m-0 text-[13px] leading-relaxed">
                  Authorize is disabled: the backend blocks authorization until the prescription is screened.
                </p>
              </>
            )}
            {saved && !decision && (
              <>
                {needsAck && (
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-risk-lowmed-bg px-4 py-3.5 text-sm leading-snug text-[#3F2700]">
                    <input
                      type="checkbox"
                      checked={acked}
                      onChange={() => setAcked((a) => !a)}
                      className="mt-0.5 h-6 w-6 flex-none accent-ink"
                    />
                    <span>
                      I have reviewed the interaction{interactions.length > 1 ? "s" : ""} shown above.{" "}
                      <span className="text-[#5A3A00]">Proposed safeguard; the backend does not ask for this today.</span>
                    </span>
                  </label>
                )}
                <Button disabled={!canAuthorize || busy} onClick={() => review("AUTHORIZED")} className="h-14 text-base">
                  {complete ? (needsAck && !acked ? "Authorize (confirm the review first)" : "Authorize") : "Authorize (screening incomplete)"}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => review("REJECTED")} className="h-14 text-base">
                  Reject
                </Button>
              </>
            )}
            {decision && (
              <div className={`flex items-center gap-3 rounded-card px-[18px] py-4 text-[15px] font-semibold ${decision === "AUTHORIZED" ? "bg-risk-low-bg text-[#0F3F22]" : "bg-page"}`}>
                <Icon name={decision === "AUTHORIZED" ? "checkCircle" : "x"} size={22} color={decision === "AUTHORIZED" ? "#187A41" : "#1B1F27"} strokeWidth={2.6} />
                Status is now {decision}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
