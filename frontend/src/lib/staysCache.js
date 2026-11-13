// One shared stays request for the board, the bell count and the right column.
// In real mode listStays also loads each stay's summary, so asking once matters.
import { api } from "../api";

let cache = null;

export function getStays(force = false) {
  const now = Date.now();
  if (!force && cache && now - cache.t < 30000) return cache.promise;
  const promise = api.listStays();
  cache = { t: now, promise };
  promise.catch(() => {
    if (cache && cache.promise === promise) cache = null;
  });
  return promise;
}

export function invalidateStays() {
  cache = null;
}
