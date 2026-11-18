# Parvah Master Backend Audit — Batch 02 (B18)

**Source:** Master Backend Audit B18, "Missing startup secret validation and environment manifest".
**Base:** PATRIKA-123/intelligent-er-drug-framework `main` inspected 2026-11-18, commit `695fe751080e...`.
**Scope:** B18 only; do not mark B16 or other findings fixed.

## Install

1. Stay on `fix/audit1`. Confirm a clean or intentionally staged workspace first (`git status`).
2. ZIP paths begin with `backend/`: extract into the **repository root** `C:\Dev\intelligent-er-drug-framework` and allow only the named files to be replaced. Alternatively, open `backend/` and move the contents of the ZIP's `backend/` folder into it. **Do not put backend/backend inside backend.**
3. Review `git diff` and ensure no changes to frontend, Neon, and migrations.
4. Run `node --test backend/test-startup-environment.js` from the repository root.
5. Run `node --check backend/server.js` and `node --check backend/db.js`.
6. With a deliberately isolated local environment, start backend and verify missing JWT_SECRET causes a controlled startup error *without revealing any secrets*; then supply all valid settings and verify startup/health. Do not test against production Neon.

## Configuration

The runtime already reads the **repository-root** `.env` (`../.env` from `backend/`), not `backend/.env`. `backend/.env.example` is a safe manifest, not a working secret file. Copy values into root `.env` locally, or into Render's service environment securely. `process.env` now wins over `.env` (`override:false`). A required `JWT_SECRET` must be non-placeholder and >=32 characters. Credentials exposed in past screenshots must be rotated.

`DB_SSL` handling in `db.js` deliberately remains unchanged to avoid mixing B18 with B16/TLS hardening; certificate verification must be separately reviewed. `cors()` similarly remains unchanged (B16). Avoid exposing real patient data.

## Limitations and merge gate

These tests are **offline configuration tests**; a functioning Render+Neon deployment is not proven. Verify all deployed variables before production release. If Patrika's `main` changes `server.js` or `db.js` after the base SHA, don't overwrite newer work: rebase/reconcile. B18 is only code-complete when a full startup smoke test succeeds in a nonproduction environment.
