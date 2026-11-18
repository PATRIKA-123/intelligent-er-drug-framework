import { createContext, useContext, useEffect, useMemo, useState } from "react";

// The case page tells the shell about the case it shows, so the left rail can
// show the step navigator and the right column can show the case snapshot.
const Ctx = createContext({ nav: null, setNav: () => {}, visit: null, setVisit: () => {} });

export function CaseNavProvider({ children }) {
  const [nav, setNav] = useState(null);
  const [visit, setVisit] = useState(null);
  const value = useMemo(() => ({ nav, setNav, visit, setVisit }), [nav, visit]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCaseNav() {
  return useContext(Ctx).nav;
}

export function useRegisterCaseNav(nav) {
  const { setNav } = useContext(Ctx);
  useEffect(() => {
    setNav(nav);
  }, [nav, setNav]);
  useEffect(() => () => setNav(null), [setNav]);
}

export const STEP_DEFS = [
  { key: "assessment", label: "Assessment", icon: "clipboard" },
  { key: "vitals", label: "Vitals", icon: "activity" },
  { key: "transport", label: "Transport", icon: "truck" },
  { key: "arrive", label: "Arrival and handover", icon: "flag" },
];

export function stepDone(c, key) {
  if (key === "arrive") return !!c.steps?.handover;
  return !!c.steps?.[key];
}

// The visit page registers itself the same way, for the jump pills and the visit card.
export function useVisitNav() {
  return useContext(Ctx).visit;
}

export function useRegisterVisitNav(visit) {
  const { setVisit } = useContext(Ctx);
  useEffect(() => {
    setVisit(visit);
  }, [visit, setVisit]);
  useEffect(() => () => setVisit(null), [setVisit]);
}

export const VISIT_SECTIONS = [
  { id: "visit-safety", label: "Alerts and drug safety", icon: "flask" },
  { id: "visit-vitals", label: "Vitals", icon: "activity" },
  { id: "visit-score", label: "Early warning score", icon: "flag" },
  { id: "visit-summary", label: "Clinical summary", icon: "clipboard" },
  { id: "follow-ups", label: "Assigned doctor and follow-ups", icon: "calendar" },
];
