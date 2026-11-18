# Parvah frontend

Parvah (परवाह, "care") is the frontend for the intelligent ER drug-safety backend. It has screens for five roles: paramedic, ER staff, doctor, admin and patient.

Stack: Vite 8, React 19, Tailwind 4, react-router 8. Pages are plain `.jsx`; the project also allows TypeScript.

## Run it

```
npm install
npm run dev      # http://localhost:5173
```

Other scripts: `npm run build` (type check and production build), `npm run lint`, `npm run preview`.

## Sample data or the real backend

Copy `.env.example` to `.env` (never commit `.env`) and restart the dev server after changing it. Vite reads `.env` only at startup.

| Setting | Meaning |
| --- | --- |
| `VITE_USE_MOCK=true` | Built-in sample data. No backend needed. |
| `VITE_USE_MOCK=false` | Calls the real backend. |
| `VITE_API_URL` | Backend address for the dev proxy (default `http://localhost:5000`). `/api` is proxied. |
| `VITE_API_BASE` | Backend address for a deployed frontend, with no trailing slash. |

In sample mode the login page shows one button per role. The sample usernames are `paramedic1`, `nurse1`, `doctor1`, `admin1` and `patient1`; any password works. Sample data lives in memory, so a full page reload resets it. Move between pages with the menu links when you test a flow.

## Screens by role

- **Paramedic:** case list, new case, assessment, vitals (with history and repeat reminder), transport, arrival and handover summary.
- **ER staff:** live board, incoming (find the ambulance case and register the ER visit, with a printable slip), visit page, follow-ups, assign doctor, patient details, "Patient has left".
- **Doctor:** patient list, visit page, prescribe, discharge.
- **Admin:** staff invitations (doctor, ER staff, paramedic). Admin can also open the ER and paramedic pages. Remove that once real paramedic and ER logins exist: the route role list in `src/App.jsx` and the "Cases" item in `src/auth/roles.js`.
- **Patient:** create a profile, add a visit (visit ID, access code and last 4 phone digits), my visits, medicines, health notes (allergies, conditions), profile.
- **Public:** `/login`, `/signup`, `/accept-invitation?token=...`.

## What the backend does not have yet

Several screens call endpoints that do not exist on the server. In real mode these show a plain message such as "The server cannot register new ER visits yet" instead of failing silently. They are listed in the backend work order (`Parvah-Backend-Work-Order-Round-2`). The calls are all in `src/api/real.js`.

## Project layout

```
src/
  api/          index.js picks mock or real; real.js, mock.js, mockData.js, client.js
  auth/         login session (JWT in sessionStorage), role routes, ROLE_CONFIG
  components/   shared UI: shell, rail, right panel, forms, badges
  lib/          risk levels, formatting, wording (terms.js)
  pages/        one file per screen
```

`mock.js` and `real.js` export the same function names, so a page never needs to know which one it is using.

## Rules worth keeping

- The early warning score (NEWS2) is calculated by the server. The frontend only shows it, and always as decision support that needs clinician review. Only sample mode has a rough calculator.
- Risk is shown with colour, a word and an icon, never colour alone.
- An unknown drug-interaction severity is never treated as "none".
- Never commit `.env`, passwords or database connection strings.
