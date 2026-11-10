"use client";

import { useState } from "react";
import { CommandCenter } from "@/components/command-center";
import type { NavKey } from "@/types/clinical";

export default function Home() {
  const [activePage, setActivePage] = useState<NavKey>("Dashboard");
  return <CommandCenter activePage={activePage} onNavigate={setActivePage} />;
}
