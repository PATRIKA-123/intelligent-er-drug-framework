// What each role sees. Navigation, home page and the main phone action live here.
export const ROLE_CONFIG = {
  PARAMEDIC: {
    label: "Paramedic",
    home: "/paramedic",
    items: [{ label: "Cases", to: "/paramedic", icon: "home" }],
    action: { label: "New case", to: "/paramedic/new", icon: "plus" },
  },
  ER_STAFF: {
    label: "ER staff",
    home: "/board",
    items: [
      { label: "Board", to: "/board", icon: "home" },
      { label: "Incoming", to: "/incoming", icon: "list" },
      { label: "Follow-ups", to: "/follow-ups", icon: "calendar" },
    ],
  },
  DOCTOR: {
    label: "Doctor",
    home: "/stays",
    items: [
      { label: "Patients", to: "/stays", icon: "home" },
    ],
  },
  ADMIN: {
    label: "Admin",
    home: "/admin",
    items: [
      { label: "Staff", to: "/admin", icon: "user" },
      { label: "Board", to: "/board", icon: "home" },
      { label: "Incoming", to: "/incoming", icon: "list" },
      { label: "Follow-ups", to: "/follow-ups", icon: "calendar" },
      { label: "Cases", to: "/paramedic", icon: "truck" },
    ],
  },
  PATIENT: {
    label: "Patient",
    home: "/patient",
    items: [
      { label: "Visits", to: "/patient", icon: "home" },
      { label: "Medicines", to: "/patient/medicines", icon: "pill" },
      { label: "Health", to: "/patient/health", icon: "alert" },
      { label: "Profile", to: "/patient/profile", icon: "user" },
    ],
    action: { label: "Add a visit", to: "/patient/add", icon: "plus" },
  },
};

export function homeFor(role) {
  return ROLE_CONFIG[role]?.home || "/login";
}
