import { io, type Socket } from "socket.io-client";
import type { LiveUser, LocationUpdate } from "@/types";

type ServerToClientEvents = {
  "users:update": (users: LiveUser[]) => void;
};

type ClientToServerEvents = {
  "location:update": (payload: LocationUpdate) => void;
};

function resolveSocketUrl(): string {
  const envUrl = import.meta.env.VITE_SOCKET_URL?.trim();
  const fallbackUrl =
    typeof window === "undefined" ? "http://localhost:3001" : window.location.origin;

  if (!envUrl) return fallbackUrl;

  try {
    const parsed = new URL(envUrl);
    const isLocalhost =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";

    // In LAN access, a localhost backend URL does not work from other devices.
    // Route through Vite same-origin proxy instead.
    if (
      typeof window !== "undefined" &&
      isLocalhost &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      return window.location.origin;
    }

    return parsed.toString();
  } catch {
    return envUrl;
  }
}

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  resolveSocketUrl(),
  {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 10000,
  }
);
