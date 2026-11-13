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
      { label: "Follow-ups", to: "/follow-ups", icon: "calendar" },
    ],
  },
  DOCTOR: {
    label: "Doctor",
    home: "/stays",
    items: [
      { label: "Stays", to: "/stays", icon: "home" },
      { label: "Prescriptions", to: "/prescriptions", icon: "pill" },
    ],
  },
  ADMIN: {
    label: "Admin",
    home: "/admin",
    items: [
      { label: "Doctors", to: "/admin", icon: "home" },
      { label: "Board", to: "/board", icon: "list" },
    ],
  },
  PATIENT: {
    label: "Patient",
    home: "/patient",
    items: [{ label: "Home", to: "/patient", icon: "home" }],
  },
};

export function homeFor(role) {
  return ROLE_CONFIG[role]?.home || "/login";
}
