# T1 to T3: staff accounts, doctor list, re-invite and delete

## Deploy order (important)
1. Run `migrations/20261120_008_staff_profiles.sql` on Neon. It is safe to run twice.
   Do this BEFORE the new code goes live: the invitation check now reads `staff_profiles`.
   (If another migration already uses number 005, rename this file; the SQL does not depend on the number.)
2. Make sure `FRONTEND_URL`, `GMAIL_USER` and `GMAIL_APP_PASSWORD` are set on Render (T2).
3. Deploy the backend.
4. Optional, for testing: `TEST_STAFF_PASSWORD=<12+ characters> node create-test-staff.js --force`
   creates `test_paramedic`, `test_er_staff` and `test_doctor` (active). `--force` is needed on a
   database whose name does not contain "test", "dev" or "local".

## New and changed endpoints
| Endpoint | Who | What |
|---|---|---|
| `POST /api/staff` | ADMIN | Invite a PARAMEDIC or ER_STAFF `{ username, email, full_name, role }` |
| `GET /api/staff` | ADMIN | Staff list with ACTIVE / PENDING / EXPIRED |
| `POST /api/staff/:user_id/resend-invitation` | ADMIN | New invitation, optional `{ email }` to fix a typo |
| `DELETE /api/staff/:user_id` | ADMIN | Remove an account that never accepted |
| `GET /api/doctors` | ADMIN, ER_STAFF | Doctors `{ doctors: [...] }`; ER staff see active doctors only, without email |
| `POST /api/doctors/:user_id/resend-invitation` | ADMIN | Same for doctors |
| `DELETE /api/doctors/:user_id` | ADMIN | Same for doctors |
| `POST /api/doctors/validate-invitation` | public | Now works for all three roles; adds `role` and `full_name` (`doctor_name` kept) |
| `POST /api/doctors/accept-invitation` | public | Now works for all three roles; adds `user` (`doctor` kept) |

Invitations are single use, expire after 24 hours, and only the SHA-256 hash of the token is stored.
The invitation email and sender name now say Parvah.

## Tests
`node test-staff-invitations.js` (36 checks, no database or email needed). Add it to the `npm test` line.
A real-database check is still worth doing once: create, email, accept, log in, for each role.
