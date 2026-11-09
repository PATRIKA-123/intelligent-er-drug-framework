"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

export function useSocket() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/api\/?$/, "");
    if (!url) return;
    const socket: Socket = io(url, { autoConnect: false });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    return () => { socket.disconnect(); };
  }, []);
  return { connected };
}
