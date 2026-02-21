import "./App.css";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import type { LiveUser, LocationUpdate } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  Moon,
  Sun,
} from "lucide-react";

import { socket } from "@/lib/socket";
const LiveMap = lazy(() => import("@/components/LiveMap"));

function formatCoord(n?: number) {
  return typeof n === "number" ? n.toFixed(6) : "-";
}

function geolocationErrorMessage(err: GeolocationPositionError) {
  switch (err.code) {
    case 1:
      return "Permissão de geolocalização negada.";
    case 2:
      return "Sinal de geolocalização indisponível.";
    case 3:
      return "Timeout expired. A tentar novamente...";
    default:
      return err.message || "Erro ao obter localização.";
  }
}

function getInitialGeoError() {
  if (typeof window === "undefined") return null;
  if (!navigator.geolocation) return "Geolocalização não suportada.";
  if (!window.isSecureContext) {
    return "Geolocalização requer HTTPS (ou localhost no mesmo dispositivo).";
  }
  return null;
}

function getInitialThemeMode(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";

  const saved = window.localStorage.getItem("theme-mode");
  if (saved === "light" || saved === "dark") return saved;

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

async function isGeolocationBlockedByBrowser() {
  if (typeof navigator === "undefined" || !("permissions" in navigator)) return false;
  try {
    const status = await navigator.permissions.query({
      name: "geolocation" as PermissionName,
    });
    return status.state === "denied";
  } catch {
    return false;
  }
}

type MapFocusTarget = {
  lat: number;
  lng: number;
  key: number;
};

export default function App() {
  const [themeMode, setThemeMode] = useState<"light" | "dark">(getInitialThemeMode);
  const [me, setMe] = useState<LocationUpdate | null>(null);
  const [users, setUsers] = useState<LiveUser[]>([]);
  const [userOrder, setUserOrder] = useState<string[]>([]);
  const [geoError, setGeoError] = useState<string | null>(getInitialGeoError);
  const [geoRetryNonce, setGeoRetryNonce] = useState(0);
  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isLocationOpen, setIsLocationOpen] = useState(true);
  const [isUsersOpen, setIsUsersOpen] = useState(true);
  const [isGeoRetrying, setIsGeoRetrying] = useState(false);
  const [mapFocusTarget, setMapFocusTarget] = useState<MapFocusTarget | null>(null);
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);

  const lastSentAt = useRef(0);
  const geoRetryTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    document.documentElement.classList.toggle("light", themeMode === "light");
    document.documentElement.style.colorScheme = themeMode;
    window.localStorage.setItem("theme-mode", themeMode);
  }, [themeMode]);

  // Receber users em tempo real
  useEffect(() => {
    const handler = (payload: LiveUser[]) => {
      // (opcional) validação mínima
      if (!Array.isArray(payload)) return;
      setUsers(payload);
    };
    const handleConnect = () => setIsSocketConnected(true);
    const handleDisconnect = () => setIsSocketConnected(false);

    socket.on("users:update", handler);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off("users:update", handler);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  // Geolocalização
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!navigator.geolocation || !window.isSecureContext) return;

    let watchId = -1;
    let fallbackMode = false;

    const startWatch = (
      enableHighAccuracy: boolean,
      timeout: number,
      maximumAge: number
    ) => {
      watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        setMe({ lat, lng });
        setGeoError((current) => (current ? null : current));
        setIsGeoRetrying(false);
        if (geoRetryTimeoutRef.current !== null) {
          window.clearTimeout(geoRetryTimeoutRef.current);
          geoRetryTimeoutRef.current = null;
        }

        const now = Date.now();
        if (now - lastSentAt.current < 2000) return;
        lastSentAt.current = now;

        socket.emit("location:update", { lat, lng });
      },
      (err) => {
        // Fallback after first timeout: lower accuracy is faster and more stable on mobile.
        if (err.code === 3 && !fallbackMode) {
          fallbackMode = true;
          setGeoError("Timeout expired. A tentar modo de localização padrão...");
          navigator.geolocation.clearWatch(watchId);
          startWatch(false, 30000, 15000);
          return;
        }

        setGeoError(geolocationErrorMessage(err));
        setIsGeoRetrying(false);
        if (geoRetryTimeoutRef.current !== null) {
          window.clearTimeout(geoRetryTimeoutRef.current);
          geoRetryTimeoutRef.current = null;
        }
      },
      {
        enableHighAccuracy,
        maximumAge,
        timeout,
      }
    );
    };

    startWatch(true, 20000, 3000);

    return () => {
      if (watchId !== -1) navigator.geolocation.clearWatch(watchId);
    };
  }, [geoRetryNonce]);

  useEffect(() => {
    return () => {
      if (geoRetryTimeoutRef.current !== null) {
        window.clearTimeout(geoRetryTimeoutRef.current);
      }
    };
  }, []);

  // Mantem a ordem visual estável: cada user fica na posição em que entrou.
  useEffect(() => {
    setUserOrder((prev) => {
      const activeIds = new Set(users.map((u) => u.id));
      const kept = prev.filter((id) => activeIds.has(id));

      const known = new Set(kept);
      const additions: string[] = [];
      for (const user of users) {
        if (known.has(user.id)) continue;
        additions.push(user.id);
        known.add(user.id);
      }

      return [...kept, ...additions];
    });
  }, [users]);

  const orderedUsers = useMemo(() => {
    const byId = new Map(users.map((u) => [u.id, u] as const));
    const ordered = userOrder
      .map((id) => byId.get(id))
      .filter((u): u is LiveUser => Boolean(u));

    if (ordered.length === users.length) return ordered;

    const existing = new Set(ordered.map((u) => u.id));
    for (const user of users) {
      if (!existing.has(user.id)) ordered.push(user);
    }
    return ordered;
  }, [users, userOrder]);

  const canRetryGeo =
    typeof window !== "undefined" &&
    Boolean(navigator.geolocation) &&
    window.isSecureContext;

  const retryGeolocation = () => {
    if (isGeoRetrying) return;
    setIsGeoRetrying(true);

    const initialError = getInitialGeoError();
    if (initialError) {
      setGeoError(initialError);
      setIsGeoRetrying(false);
      return;
    }

    // Restart watch immediately (helps when permission was changed in browser settings).
    setGeoRetryNonce((v) => v + 1);

    // Ask location again from this click gesture. Some browsers only show the prompt reliably here.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        setMe({ lat, lng });
        setGeoError(null);

        const now = Date.now();
        if (now - lastSentAt.current >= 2000) {
          lastSentAt.current = now;
          socket.emit("location:update", { lat, lng });
        }
        setIsGeoRetrying(false);
        if (geoRetryTimeoutRef.current !== null) {
          window.clearTimeout(geoRetryTimeoutRef.current);
          geoRetryTimeoutRef.current = null;
        }
      },
      async (err) => {
        const blocked = await isGeolocationBlockedByBrowser();
        if (blocked) {
          setGeoError(
            "Permissão de geolocalização bloqueada. Ative nas definições do site e tente novamente."
          );
          setIsGeoRetrying(false);
          return;
        }

        setGeoError(geolocationErrorMessage(err));
        setIsGeoRetrying(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    geoRetryTimeoutRef.current = window.setTimeout(() => {
      setIsGeoRetrying(false);
      geoRetryTimeoutRef.current = null;
    }, 12000);
  };

  const focusOnUser = (user: LiveUser) => {
    if (user.id === socket.id) return;
    setFocusedUserId(user.id);
    setMapFocusTarget({
      lat: user.lat,
      lng: user.lng,
      key: Date.now(),
    });
  };

  const shellBackground =
    themeMode === "dark"
      ? "bg-[radial-gradient(1200px_700px_at_75%_-10%,rgba(61,116,255,0.18),transparent_60%),radial-gradient(900px_420px_at_10%_115%,rgba(5,209,195,0.16),transparent_60%),linear-gradient(140deg,#06080f_0%,#0a1220_55%,#0f1b2d_100%)]"
      : "bg-[radial-gradient(1200px_700px_at_75%_-10%,rgba(71,85,105,0.14),transparent_60%),radial-gradient(900px_420px_at_10%_115%,rgba(56,189,248,0.10),transparent_60%),linear-gradient(140deg,#e2e8f0_0%,#e8edf5_55%,#f1f5f9_100%)]";
  const mapFallbackBackground =
    themeMode === "dark"
      ? "bg-[linear-gradient(135deg,#111826,#0a1220)]"
      : "bg-[linear-gradient(135deg,#dbe4ef,#edf2f7)]";

  return (
    <div
      className={`min-h-dvh ${shellBackground} md:h-dvh md:grid md:overflow-hidden ${
        isPanelOpen ? "md:grid-cols-[minmax(0,1fr)_380px]" : "md:grid-cols-1"
      }`}
    >
      {/* MAPA */}
      <section
        className={`relative min-h-[320px] md:h-full md:min-h-0 ${
          isPanelOpen ? "h-[62dvh]" : "h-dvh"
        }`}
      >
        <button
          type="button"
          onClick={() => setIsPanelOpen((v) => !v)}
          aria-label={isPanelOpen ? "Fechar painel" : "Abrir painel"}
          className="fixed left-3 top-[max(env(safe-area-inset-top),0.75rem)] z-40 inline-flex items-center gap-2 rounded-lg border border-border bg-background/75 px-3 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur-md hover:bg-accent"
        >
          {isPanelOpen ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronLeft className="size-4" />
          )}
          {isPanelOpen ? "Ocultar painel" : "Mostrar painel"}
        </button>
        <Suspense
          fallback={
            <div
              className={`h-full w-full animate-pulse ${mapFallbackBackground}`}
            />
          }
        >
          <LiveMap
            me={me}
            users={users}
            focusTarget={mapFocusTarget}
            focusedUserId={focusedUserId}
            onUserSelect={focusOnUser}
          />
        </Suspense>
      </section>

      {/* SIDEBAR */}
      {isPanelOpen && (
      <aside className="border-t border-slate-300/70 bg-slate-100/80 p-4 space-y-4 pb-[max(env(safe-area-inset-bottom),1rem)] backdrop-blur-xl dark:border-border dark:bg-background/80 md:border-t-0 md:border-l md:overflow-hidden">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Live Map
          </h1>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-slate-200/80 text-slate-700 dark:bg-secondary dark:text-secondary-foreground">
              {users.length} conectados
            </Badge>
            <button
              type="button"
              onClick={() =>
                setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))
              }
              aria-label={
                themeMode === "dark" ? "Ativar modo claro" : "Ativar modo escuro"
              }
              className="inline-flex size-8 items-center justify-center rounded-md border border-slate-300 bg-slate-100/70 text-foreground hover:bg-slate-200/80 dark:border-border dark:bg-background/70 dark:hover:bg-accent"
            >
              {themeMode === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-300/80 bg-slate-200/55 px-3 py-2 text-xs text-slate-600 dark:border-border dark:bg-muted/40 dark:text-muted-foreground">
          <span
            className={`mr-2 inline-block h-2 w-2 rounded-full ${
              isSocketConnected ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          {isSocketConnected ? "Canal realtime online" : "A reconectar..."}
        </div>

        <Card className="border-slate-300/80 bg-slate-100/75 shadow-[0_10px_26px_rgba(51,65,85,0.12)] backdrop-blur-xl dark:border-border dark:bg-card/80 dark:shadow-[0_12px_35px_rgba(0,0,0,0.18)]">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base text-foreground">
                Minhas coordenadas
              </CardTitle>
              <button
                type="button"
                onClick={() => setIsLocationOpen((v) => !v)}
                aria-label={
                  isLocationOpen
                    ? "Fechar minhas coordenadas"
                    : "Abrir minhas coordenadas"
                }
                className="inline-flex size-8 items-center justify-center rounded-md border border-slate-300 bg-slate-100/70 text-foreground hover:bg-slate-200/80 dark:border-border dark:bg-background/70 dark:hover:bg-accent"
              >
                {isLocationOpen ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </button>
            </div>
          </CardHeader>
          {isLocationOpen && (
            <CardContent>
              {geoError ? (
                <div className="space-y-3">
                  <p className="text-sm text-destructive">{geoError}</p>
                  {canRetryGeo && (
                    <button
                      type="button"
                      onClick={retryGeolocation}
                      disabled={isGeoRetrying}
                      className="inline-flex items-center rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-foreground hover:bg-slate-200/80 disabled:opacity-60 dark:border-border dark:bg-background dark:hover:bg-accent"
                    >
                      {isGeoRetrying ? (
                        <>
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          A verificar localização...
                        </>
                      ) : (
                        "Tentar novamente"
                      )}
                    </button>
                  )}
                </div>
              ) : (
                <p className="font-mono text-sm text-foreground">
                  {me
                    ? `${formatCoord(me.lat)}, ${formatCoord(me.lng)}`
                    : "Aguardando permissão..."}
                </p>
              )}
            </CardContent>
          )}
        </Card>

        <Card
          className={`flex overflow-hidden border-slate-300/80 bg-slate-100/75 shadow-[0_10px_26px_rgba(51,65,85,0.12)] backdrop-blur-xl dark:border-border dark:bg-card/80 dark:shadow-[0_12px_35px_rgba(0,0,0,0.18)] ${
            isUsersOpen
              ? "h-[40dvh] min-h-[220px] max-h-[420px] flex-col md:h-[calc(100dvh-252px)] md:max-h-none md:min-h-0"
              : ""
          }`}
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base text-foreground">
                Utilizadores
              </CardTitle>
              <button
                type="button"
                onClick={() => setIsUsersOpen((v) => !v)}
                aria-label={isUsersOpen ? "Fechar utilizadores" : "Abrir utilizadores"}
                className="inline-flex size-8 items-center justify-center rounded-md border border-slate-300 bg-slate-100/70 text-foreground hover:bg-slate-200/80 dark:border-border dark:bg-background/70 dark:hover:bg-accent"
              >
                {isUsersOpen ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
              </button>
            </div>
          </CardHeader>
          {isUsersOpen && (
            <CardContent className="min-h-0 flex-1 p-0">
              <div className="h-full overflow-y-auto overscroll-contain px-4 pb-4 [scrollbar-color:#3f4a5a_transparent]">
                <ul className="space-y-3 pt-2">
                  {orderedUsers.map((u) => (
                    <li
                      key={u.id}
                      className={`rounded-xl border p-3 transition ${
                        focusedUserId === u.id
                          ? "border-primary/70 bg-primary/10"
                          : "border-slate-300/80 bg-slate-100/60 dark:border-border dark:bg-background/45"
                      } ${u.id === socket.id ? "opacity-70" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => focusOnUser(u)}
                        disabled={u.id === socket.id}
                        className={`w-full text-left ${
                          u.id === socket.id ? "cursor-not-allowed" : "cursor-pointer"
                        }`}
                      >
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span className="font-mono">
                            {u.id.slice(0, 6)}… {u.id === socket.id ? "(eu)" : ""}
                          </span>
                          <span>{new Date(u.updatedAt).toLocaleTimeString()}</span>
                        </div>
                        <div className="mt-1 font-mono text-sm text-foreground">
                          {formatCoord(u.lat)}, {formatCoord(u.lng)}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          )}
        </Card>
      </aside>
      )}
    </div>
  );
}
