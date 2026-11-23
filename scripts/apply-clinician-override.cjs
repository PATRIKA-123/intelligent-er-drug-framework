'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const changes=[];
function load(file){const full=path.join(root,file);if(!fs.existsSync(full))throw Error('Missing '+file);const original=fs.readFileSync(full,'utf8');return {file,full,text:original.replace(/\r\n/g,'\n'),crlf:original.includes('\r\n')};}
function replace(o,oldText,newText,label){const count=o.text.split(oldText).length-1;if(count!==1)throw Error(o.file+' '+label+' expected once; found '+count+'; no files modified. Inspect current file before retrying.');o.text=o.text.replace(oldText,newText);}
function replacePattern(o,pattern,newText,label){const matches=[...o.text.matchAll(pattern)];if(matches.length!==1)throw Error(o.file+' '+label+' expected once; found '+matches.length+'; no files modified. Inspect current route fields.');o.text=o.text.replace(pattern,()=>newText);}
const route=load('backend/routes/postEr.js');
replacePattern(route,/const\s*\{\s*status\s*,\s*review_notes\s*\}\s*=\s*req\.body\s*\|\|\s*\{\s*\}\s*;/g,'const { status, review_notes, clinical_override, acknowledged_incomplete, acknowledged_interactions } = req.body || {};','route fields');
replace(route,'      const prescription = await reviewPrescription(\n        req.stayId,\n        prescriptionId,',`      if ([clinical_override, acknowledged_incomplete, acknowledged_interactions].some(\n        value => value !== undefined && typeof value !== 'boolean')) {\n        return res.status(400).json({ error: 'Override and acknowledgments must be booleans' });\n      }\n      const prescription = await reviewPrescription(\n        req.stayId,\n        prescriptionId,`,'validate fields');
replace(route,'          review_notes: review_notes?.trim(),\n        },\n        req.user.user_id','          review_notes: review_notes?.trim(),\n          clinical_override: clinical_override === true,\n          acknowledged_incomplete: acknowledged_incomplete === true,\n          acknowledged_interactions: acknowledged_interactions === true,\n        },\n        req.user.user_id','pass review fields');
changes.push(route);
const service=load('backend/services/prescriptionService.js');
const oldGate=`    if (data.status === "AUTHORIZED") {\n      const screening = prescriptionResult.rows[0].screening_result;\n\n      if (!screening || screening.screening_status !== "SCREENED") {\n        const error = new Error(\n          "Cannot authorize prescription because interaction screening is incomplete. Review the medication mapping and screening result first."\n        );\n        error.statusCode = 409;\n        throw error;\n      }\n    }`;
const newGate=`    let persistedReviewNotes = data.review_notes || null;
    if (data.status === "AUTHORIZED") {
      const screening = prescriptionResult.rows[0].screening_result;
      const screenStatus = screening?.screening_status;
      if (!screening || !["SCREENED", "UNMAPPED", "INCOMPLETE_SCREENING"].includes(screenStatus)) {
        const error = new Error("Missing or invalid drug screening result.");
        error.statusCode = 409; throw error;
      }
      const findings = Array.isArray(screening.interactions_found) ? screening.interactions_found : [];
      if (findings.length && data.acknowledged_interactions !== true) {
        const error = new Error("The assigned doctor must acknowledge detected interaction findings.");
        error.statusCode = 409; throw error;
      }
      if (screenStatus !== "SCREENED") {
        const justification = typeof data.review_notes === "string" ? data.review_notes.trim() : "";
        if (data.clinical_override !== true || data.acknowledged_incomplete !== true || justification.length < 30 || justification.length > 1600) {
          const error = new Error("Documented clinical override, explicit acknowledgment, and a 30–1600 character justification are required for incomplete screening.");
          error.statusCode = 409; throw error;
        }
        const unknownCount = Array.isArray(screening.existing_unmapped_medications) ? screening.existing_unmapped_medications.length : 0;
        persistedReviewNotes = '[CLINICIAN_OVERRIDE; screening_status=' + screenStatus + '; interaction_findings=' + findings.length + '; unmapped_existing=' + unknownCount + ']\\nClinical justification: ' + justification;
      }
    }`;
replace(service,oldGate,newGate,'authorization gate');
replace(service,'        data.review_notes || null,\n        prescriptionId,','        persistedReviewNotes,\n        prescriptionId,','persist review notes');
changes.push(service);
const ui=load('frontend/src/pages/Prescription.jsx');
replace(ui,'  const [acked, setAcked] = useState(false);','  const [acked, setAcked] = useState(false);\n  const [incompleteAck, setIncompleteAck] = useState(false);\n  const [clinicalReason, setClinicalReason] = useState("");','override state');
replace(ui,'  const canAuthorize = saved && !decision && complete && (!needsAck || acked);',`  const needsOverride = !!saved && !complete;
  const reasonValid = clinicalReason.trim().length >= 30 && clinicalReason.trim().length <= 1600;
  const canAuthorize = !!saved && !decision && (!needsAck || acked) && (!needsOverride || (incompleteAck && reasonValid));`,'eligibility');
replace(ui,'      setAcked(false);\n      setDecision(null);','      setAcked(false);\n      setIncompleteAck(false);\n      setClinicalReason("");\n      setDecision(null);','clear on save');
replace(ui,'      await api.reviewPrescription(stayId, saved.prescription.prescription_id, { status });',`      await api.reviewPrescription(stayId, saved.prescription.prescription_id, {
        status,
        clinical_override: status === "AUTHORIZED" && needsOverride,
        acknowledged_incomplete: status === "AUTHORIZED" && incompleteAck,
        acknowledged_interactions: status === "AUTHORIZED" && acked,
        review_notes: status === "AUTHORIZED" && needsOverride ? clinicalReason.trim() : undefined,
      });`,'send review');
replace(ui,'>Saved, screened</span>','>{complete ? "Saved — screening complete" : "Saved — screening incomplete"}</span>','saved label');
replace(ui,'onClick={() => { setSaved(null); setDecision(null); setForm(EMPTY); }}','onClick={() => { setSaved(null); setDecision(null); setForm(EMPTY); setAcked(false); setIncompleteAck(false); setClinicalReason(""); }}','reset');
replace(ui,'"Some medications could not be matched, so authorization is blocked."','"Some medications could not be matched. This does not establish drug safety."','screening note');
const button=`                <Button disabled={!canAuthorize || busy} onClick={() => review("AUTHORIZED")} className="h-14 text-base">
                  {complete ? (needsAck && !acked ? "Authorize (confirm the review first)" : "Authorize") : "Authorize (screening incomplete)"}
                </Button>`;
const newButton=`                {needsOverride && (
                  <div className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                    <strong>Incomplete drug safety screening — clinician judgment required</strong>
                    <p className="m-0">When the proposed drug is UNMAPPED, its interactions have NOT been checked. When screening is incomplete, some interactions may remain unidentified. Review all shown findings and independently assess the medication, formulation, dose, and patient context. This is not a clean safety result.</p>
                    {!!screening?.existing_unmapped_medications?.length && (
                      <ul className="m-0 list-disc pl-5">
                        {screening.existing_unmapped_medications.map((m, i) => <li key={m.medication_id ?? i}>{m.medication_name}: {m.reason}</li>)}
                      </ul>
                    )}
                    <label htmlFor="clinical-review-reason" className="font-semibold">Clinical justification for this exception</label>
                    <textarea id="clinical-review-reason" className="field min-h-28 resize-y bg-white" value={clinicalReason} maxLength={1600} onChange={e => setClinicalReason(e.target.value)} placeholder="Document review of interactions, unresolved mapping, dose, patient context and medical rationale (minimum 30 characters)." />
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1 h-5 w-5 accent-ink" checked={incompleteAck} onChange={e => setIncompleteAck(e.target.checked)} />
                      <span>I acknowledge incomplete drug safety screening, have independently reviewed this prescription, and accept responsibility for this documented clinical decision.</span>
                    </label>
                  </div>
                )}
                <Button disabled={!canAuthorize || busy} onClick={() => review("AUTHORIZED")} className="h-14 text-base">
                  {needsOverride ? "Authorize with documented clinical override" : "Authorize"}
                </Button>`;
replace(ui,button,newButton,'override UI');
changes.push(ui);
// Preflight above completes before writing any modified files.
for (const item of changes) fs.writeFileSync(item.full,item.crlf ? item.text.replace(/\n/g,'\r\n') : item.text);
console.log('Updated '+changes.length+' source files. No Neon migration required.');
for(const item of changes) console.log('PATCHED '+item.file);
