# Round 2 Batch C — core ER board, vitals and Post-ER workflow

From repository root:

```powershell
node --test backend/test-round2-c.js
node scripts/round2-c-patch.js --check
node scripts/round2-c-patch.js --apply
node --check backend/server.js
node --check backend/services/postErService.js
node --check backend/routes/round2Board.js
node --check backend/routes/round2Vitals.js
node --check backend/routes/round2PostEr.js
node --check backend/routes/round2Departure.js
node --check backend/routes/round2Alerts.js
node --test backend/test-round2-c.js
```

## Staging migration

`migrations/20261120_011_round2_er_post_er.sql` depends on B1 (009) and B2 (010). Check current Neon staging schema and test migrations in order on disposable staging. Do not apply schema changes or test data to production unreviewed.

## Implementation boundaries / unresolved work

- T9: bounded board filter, role-scoped count, latest NEWS2/observation and assigned doctor included. The result is not claimed clinically current without source freshness evidence. Existing list response fields retained.
- T10: complete input entries are scored with the existing NEWS2 calculator; partial input remains `PENDING_INPUTS`. New clinical vital entries are in a separate table; the enriched board includes them. Full clinical provenance linkage, observation normalization and clinician-approved Scale-2 cases still need staging verification.
- T11/T17/T24: SQL-scoped followups, active alerts and review queues; authorization needs two-user fixture checks. Medication authorization rules remain unchanged.
- T16: discharge authorization updates visit status in the discharge transaction; departure requires ER staff and an existing discharge. Non-home dispositions require clinical policy review.
- T25/T26: existing screening ledger and prescription guards retained, but full clinical lifecycle/acknowledgment policy and E2E testing are outstanding.
- This package does NOT claim complete T9–T11/T16/T17/T24–T26 acceptance, nor production-readiness. Track those in the final staging release gate.
