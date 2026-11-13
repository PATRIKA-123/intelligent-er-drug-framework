import { createContext, useContext, useEffect, useMemo, useState } from "react";

// The case page tells the shell about the case it shows, so the left rail can
// show the step navigator and the right column can show the case snapshot.
const Ctx = createContext({ nav: null, setNav: () => {} });

export function CaseNavProvider({ children }) {
  const [nav, setNav] = useState(null);
  const value = useMemo(() => ({ nav, setNav }), [nav]);
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
