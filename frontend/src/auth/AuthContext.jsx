import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, configureClient } from "../api";

const AuthContext = createContext(null);
const KEY = "er-session";

function readSession() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeSession(s) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage can be blocked; the app still works until refresh */
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession);
  const [expired, setExpired] = useState(false);

  const logout = useCallback(() => {
    writeSession(null);
    setSession(null);
  }, []);

  // The token lasts 2 hours and there is no refresh: on 401, send the user to login.
  useEffect(() => {
    configureClient({
      tokenGetter: () => session?.token || null,
      unauthorizedHandler: () => {
        setExpired(true);
        logout();
      },
    });
  }, [session, logout]);

  const login = useCallback(async (username, password) => {
    const data = await api.login(username.trim(), password);
    const s = { token: data.token, user: data.user };
    writeSession(s);
    setSession(s);
    setExpired(false);
    return s.user;
  }, []);

  const value = useMemo(
    () => ({ user: session?.user || null, token: session?.token || null, expired, login, logout }),
    [session, expired, login, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
