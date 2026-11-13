# ER Decision Support Frontend

Vite 8 + React 19 + Tailwind 4 + react-router 8. Pages are JSX; the project allows JS alongside TS. Soft-bento design from the approved prototype.

## Run
    npm install
    npm run dev        # http://localhost:5173, sample data by default

## Connect to the real backend
Copy `.env.example` to `.env`, set `VITE_USE_MOCK=false` and `VITE_API_URL` to the backend (default http://localhost:5000). `/api` is proxied in dev.

## Built
Login, live board / stays list, stay detail (vitals, NEWS2, drug safety, summary, run decision support), prescription (screen, authorize, reject), paramedic case list and case page with "Arrived at ER".

## Not built yet (placeholder pages)
New case, assessment/vitals/transport/handover forms, follow-ups, prescriptions list, admin, patient.

## Sample data vs backend
Fields marked NEEDS-BACKEND in `src/api/mockData.js` do not exist in the backend yet: case list, case code and status and latest NEWS2 in the stays list, patient endpoint, doctor list. Allergy/history field names are unverified, so the stay page tries several names.
Sample logins: use the role buttons on the login page.

## Safety notes
NEWS2 is decision support only. "Unknown" interaction severity is shown, never treated as none. The review checkbox on the prescription page is a proposed safeguard the backend does not require.
