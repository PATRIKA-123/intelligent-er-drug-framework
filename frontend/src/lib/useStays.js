import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router";
import { getStays, invalidateStays } from "./staysCache";
import { riskLevel } from "./risk";

const ORDER = { high: 0, medium: 1, lowmed: 2, low: 3 };

// Stays with their risk level, highest first, plus counts per level.
export function useStays(enabled = true) {
  const { pathname } = useLocation();
  const [state, setState] = useState({ loading: enabled, error: null, stays: [] });
  const [tick, setTick] = useState(0);

  // Refetch when the page changes, every minute, and on demand, so one failed
  // request (a sleeping backend) does not leave the panel stuck on an error.
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    getStays()
      .then((d) => live && setState({ loading: false, error: null, stays: d.stays || [] }))
      .catch((error) => live && setState((s) => ({ loading: false, error, stays: s.stays })));
    return () => { live = false; };
  }, [enabled, pathname, tick]);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, [enabled]);

  const reload = useCallback(() => {
    invalidateStays();
    setState((s) => ({ ...s, loading: true, error: null }));
    setTick((t) => t + 1);
  }, []);

  const rows = state.stays
    .map((s) => ({ ...s, level: riskLevel(s.latest_news2?.risk_level) }))
    .sort((a, b) => {
      const oa = a.level ? ORDER[a.level.key] : 9;
      const ob = b.level ? ORDER[b.level.key] : 9;
      return oa - ob || (b.latest_news2?.total_news2_score ?? -1) - (a.latest_news2?.total_news2_score ?? -1);
    });
  const counts = { high: 0, medium: 0, lowmed: 0, low: 0 };
  rows.forEach((r) => r.level && (counts[r.level.key] += 1));
  return { loading: state.loading, error: state.error, rows, counts, reload };
}
