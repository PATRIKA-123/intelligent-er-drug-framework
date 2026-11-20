# B26 durable clinical audit — quick implementation

- The existing middleware emits redacted sensitive-API access events; the patch also persists the same allowlisted fields to `public.clinical_audit_events`.
- No raw request/response bodies, paths, user secrets, clinical text or record IDs are stored.
- The table rejects UPDATE/DELETE using a trigger. This is an application-user guard, **not** tamper-proof against a database owner/superuser.
- Persistence from the Express response `finish` event is **asynchronous/best effort**. DB outage/process crash can drop an event. The failure is logged to stderr using only a safe code. Full mandatory audit capture for high-risk clinical mutations, request correlation, retention/export policy and durable retry/outbox remain open B26 acceptance items.
- Migration is allowed only on local `intelligent_er_drug_test`; never on production.
- For test verification, restart the server after migration/patch; test a protected endpoint and verify `SELECT COUNT(*) FROM public.clinical_audit_events;` in the local DB.
