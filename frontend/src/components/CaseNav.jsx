import { useMemo, useState } from "react";

// The case page tells the shell about the case it shows, so the left rail can
// show the step navigator and the right column can show the case snapshot.
import { Ctx } from './CaseNavContext';

export function CaseNavProvider({ children }) {
  const [nav, setNav] = useState(null);
  const [visit, setVisit] = useState(null);
  const value = useMemo(() => ({ nav, setNav, visit, setVisit }), [nav, visit]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

