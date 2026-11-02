# Intelligent ER Drug Framework

An Express and PostgreSQL backend for emergency-department (ED) clinical
context, pre-hospital case handover, medication safety, and decision-support
workflows.

> **Clinical use:** This project produces software-generated calculations and
> findings for review. It is not a substitute for clinical judgment, a
> diagnosis, or treatment advice. A qualified clinician must verify inputs and
> review results before acting on them.

## Contents

- [Project capabilities](#project-capabilities)
- [Technology](#technology)
- [Repository layout](#repository-layout)
- [Requirements](#requirements)
- [Setup](#setup)
- [Configuration](#configuration)
- [Start the API](#start-the-api)
- [Authentication and roles](#authentication-and-roles)
- [API reference](#api-reference)
- [Clinical workflow](#clinical-workflow)
- [Data and database notes](#data-and-database-notes)
- [Tests](#tests)
- [Operational and privacy notes](#operational-and-privacy-notes)

## Project capabilities

- User registration, login, signed bearer tokens, and role-protected routes.
- Authenticated access to ED stays, observations, NEWS2 results, trends, and
  diagnoses.
- Emergency-case lifecycle management, including pre-ER assessments, vital
  signs, ambulance transport, handover summaries, and linking a case to an
  existing ED stay.
- Clinical context and read-only clinical summaries assembled from existing
  ED data.
- Medication normalization and drug-interaction checks using the project's
  DDInter service integration.
- NEWS2 and vital-trend calculations, decision-support results, and generated
  clinical alerts.

## Technology

- Node.js (18 or newer recommended)
- Express 5
- PostgreSQL
- `pg` for database access
- JSON Web Tokens (`jsonwebtoken`) and `bcrypt` for authentication

## Repository layout

```text
.
|-- backend/
|   |-- middleware/   Authentication and authorization
|   |-- routes/       Express API routes
|   |-- scripts/      Backend data and analysis utilities
|   |-- services/     Clinical calculations and application services
|   |-- validators/   Input validation helpers
|   |-- server.js     HTTP server and route registration
|   `-- package.json  Backend dependencies and npm scripts
|-- data/
|   `-- cleaned_vitals.csv
|-- schema.sql        Foundational patient, stay, and observation schema
`-- scripts/
    `-- importData.js CSV-to-PostgreSQL import utility
```

## Requirements

- Node.js and npm.
- Access to a PostgreSQL database provisioned with the tables, views, and
  supporting schema used by the application.
- A `JWT_SECRET` value for signing and verifying login tokens.

## Setup

1. Install backend dependencies:

   ```sh
   cd backend
   npm install
   ```

2. Create a `.env` file in the repository root (one directory above `backend`)
   with the database connection details and token secret:

   ```dotenv
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=your_database
   DB_USER=your_user
   DB_PASSWORD=your_password
   JWT_SECRET=replace_with_a_long_random_secret
   PORT=5000
   ```

   Use values appropriate for your environment. Keep real credentials private
   and never commit `.env`.

3. Ensure the target database is initialized with the complete application
   schema and required data before starting the API. See
   [Data and database notes](#data-and-database-notes).

## Configuration

| Variable | Required | Description |
|---|---|---|
| `DB_HOST` | Yes | PostgreSQL server hostname. |
| `DB_PORT` | No | PostgreSQL port; the PostgreSQL default is used if omitted. |
| `DB_NAME` | Yes | Database name. |
| `DB_USER` | Yes | Database user. |
| `DB_PASSWORD` | Yes | Database password. |
| `JWT_SECRET` | Yes for authentication | Secret used to sign and verify JWTs. |
| `PORT` | No | HTTP port; defaults to `5000`. |

The application loads `.env` from the repository root. Do not put credentials
in source files, issue reports, screenshots, or commits.

## Start the API

From the `backend` directory:

```sh
npm start
```

For development with automatic restarts:

```sh
npm run dev
```

The server listens on `http://localhost:5000` by default.

### Health check

```http
GET /api/health
```

This endpoint checks database connectivity. It returns HTTP `200` with a
service status when the query succeeds, or HTTP `503` when the database is
unavailable. The database name is only included when the
`PRE_ER_TEST_DATABASE_NAME` environment variable is set.

## Authentication and roles

Protected endpoints expect a bearer token in the `Authorization` header:

```http
Authorization: Bearer <token>
```

Register and log in using JSON:

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "example-user",
  "email": "user@example.com",
  "password": "use-a-private-password"
}
```

Public registration assigns the `PATIENT` role. It does not allow a caller to
grant themselves `PARAMEDIC`, `ER_STAFF`, or `ADMIN`. After registration, log
in to receive a token:

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "example-user",
  "password": "use-a-private-password"
}
```

Tokens expire after two hours. Role checks are enforced on selected operations:

- `PATIENT`: patient role verification endpoint.
- `PARAMEDIC`: create emergency cases and record pre-ER assessments, vitals,
  and transport information; advance a case from `PRE_ER` to `ARRIVED_ER`.
- `ER_STAFF`: advance a case from `ARRIVED_ER` to `ACTIVE_ER`, and from
  `ACTIVE_ER` to `CLOSED`.
- `ADMIN`: permitted alongside the specified staff roles for those operations.

Most read endpoints require authentication but do not impose an additional role
check.

## API reference

All routes are prefixed with `/api`. Unless noted as public, endpoints require
authentication. Path identifiers are represented below as `{stay_id}` or
`{case_id}`.

### Authentication — `/api/auth`

| Method | Path | Description | Access |
|---|---|---|---|
| `POST` | `/register` | Register a user; public registration creates a `PATIENT`. | Public |
| `POST` | `/login` | Authenticate and return a JWT. | Public |
| `GET` | `/me` | Return the authenticated user's token identity. | Authenticated |
| `GET` | `/paramedic-only` | Verify paramedic/admin role access. | `PARAMEDIC`, `ADMIN` |
| `GET` | `/er-staff-only` | Verify ER staff/admin role access. | `ER_STAFF`, `ADMIN` |
| `GET` | `/patient-only` | Verify patient role access. | `PATIENT` |
| `GET` | `/admin-only` | Verify admin role access. | `ADMIN` |

### ED stays — `/api/stays`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Return the first 20 ED stays. |
| `GET` | `/{stay_id}` | Get one ED stay. |
| `GET` | `/{stay_id}/observations` | Get cleaned vital-sign observations. |
| `GET` | `/{stay_id}/news2` | Get stored NEWS2 results. |
| `GET` | `/{stay_id}/trends` | Get stored temporal vital-trend results. |
| `GET` | `/{stay_id}/diagnoses` | Get diagnoses for the stay. |

### Emergency cases — `/api/emergency-cases`

| Method | Path | Description | Access |
|---|---|---|---|
| `POST` | `/` | Create an emergency case. | `PARAMEDIC`, `ADMIN` |
| `GET` | `/{case_id}` | Get one emergency case. | Authenticated |
| `PATCH` | `/{case_id}/status` | Advance the case by one permitted lifecycle step. | Authenticated; role depends on transition |

The supported status sequence is `PRE_ER` → `ARRIVED_ER` → `ACTIVE_ER` →
`CLOSED`. Backward transitions and skipped steps are rejected.

### Pre-ER and handover — `/api/emergency-cases/{case_id}`

| Method | Path | Description | Access |
|---|---|---|---|
| `POST` | `/assessments` | Record a pre-ER assessment. | `PARAMEDIC`, `ADMIN` |
| `GET` | `/assessments` | List case assessments. | Authenticated |
| `POST` | `/transport` | Record ambulance transport details. | `PARAMEDIC`, `ADMIN` |
| `GET` | `/transport` | List transport records. | Authenticated |
| `PATCH` | `/transport` | Update the latest transport record/status. | `PARAMEDIC`, `ADMIN` |
| `POST` | `/vitals` | Add a timestamped pre-ER vital-sign observation. | `PARAMEDIC`, `ADMIN` |
| `GET` | `/vitals` | List pre-ER vital-sign observations. | Authenticated |
| `GET` | `/clinical-risk` | Preview NEWS2 using the latest available assessment/vitals. | Authenticated |
| `POST` | `/clinical-risk` | Calculate a NEWS2 preview, optionally selecting assessment/vital records. | `PARAMEDIC`, `ADMIN` |
| `GET` | `/news2` | Backwards-compatible alias for the NEWS2 preview. | Authenticated |
| `GET` | `/workflow` | Get the integrated pre-ER-to-ER workflow snapshot. | Authenticated |
| `GET` | `/integrated-summary` | Get a summarized view of handover and linked ER clinical data. | Authenticated |
| `GET` | `/handover-summary` | Get the handover-focused view for ER staff. | Authenticated |
| `POST` | `/er-arrival` | Link the case to an existing ED stay and perform applicable ER processing. | `PARAMEDIC`, `ADMIN`, `ER_STAFF` |

The ER-arrival operation requires a valid existing stay and checks that the
case and stay refer to the same patient when the case already has a patient
identifier.

### Clinical context and decision support

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/clinical-context/{stay_id}` | Read clinical context for an ED stay. |
| `GET` | `/api/clinical-summary/{stay_id}` | Read a combined summary of existing clinical and persisted decision-support data. |
| `POST` | `/api/decision-support/{stay_id}` | Run decision-support processing and persist results for one stay. |

The clinical summary endpoint is read-only. The decision-support `POST`
endpoint is not read-only: it runs the processing pipeline and writes
decision-support, drug-safety, and alert results. Use it only with an
appropriately configured database.

### Example request

After obtaining a token, retrieve a stay summary:

```sh
curl -H "Authorization: Bearer <token>" \
  http://localhost:5000/api/clinical-summary/12345
```

Replace `12345` with a stay identifier present in the database.

## Clinical workflow

1. A permitted paramedic or administrator creates an emergency case.
2. Pre-ER staff add assessments, timestamped vital signs, and transport records.
3. The clinical-risk endpoint can calculate a NEWS2 preview from the available
   pre-ER observations. Incomplete inputs are reported rather than silently
   treated as normal.
4. On arrival, the case can be linked to an existing ED stay. Linking validates
   the stay and patient relationship.
5. Once ER clinical inputs are available, decision-support processing can
   normalize medications, evaluate interactions, compute decision-support
   outputs, and persist alerts.
6. Authenticated clients can retrieve the handover, clinical-context, and
   clinical-summary views.

Pre-ER medications are reported as assessment data; they are not automatically
copied into ER medication-safety records or treated as reconciled.

## Data and database notes

- [`schema.sql`](./schema.sql) defines foundational `patients`, `ed_stays`, and
  `observations` tables. **It is not a complete database bootstrap for the
  current API.**
- The API also queries other application tables and views, including user and
  emergency-case data, cleaned observations, diagnoses, medications, NEWS2 and
  trend results, and persisted decision-support/alert data. Ensure these
  objects exist in the target database before running the API.
- [`data/cleaned_vitals.csv`](./data/cleaned_vitals.csv) is a sample data asset.
  [`scripts/importData.js`](./scripts/importData.js) contains a CSV import
  utility; verify its prerequisites and target database before running it.
- The application has PostgreSQL-backed test scripts. Do not point test or
  import utilities at a production database.

## Tests

The backend package does not currently define an `npm test` script. The NEWS2
and trend calculation tests are standalone Node.js scripts and can be run
without connecting to PostgreSQL:

```sh
cd backend
node test-news2Calculator.js
node test-trendCalculator.js
```

Other `test-*.js` scripts may require a running API, database fixtures, or a
specific test database; inspect each script's setup and safety checks before
running it.

## Operational and privacy notes

- Keep `.env`, database backups, and other credentials or sensitive records
  out of version control. The repository's `.gitignore` excludes `.env` files
  and SQL backup files.
- Use a dedicated test database for integration tests and exploratory scripts.
- Avoid placing patient data, tokens, or database credentials in logs, issue
  comments, screenshots, or public repositories.
- Treat all calculated scores, classifications, and alerts as decision support
  requiring qualified clinical review.
