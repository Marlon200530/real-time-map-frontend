import "./App.css";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import type { LiveUser, LocationUpdate } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

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

type MapFocusTarget = {
  lat: number;
  lng: number;
  key: number;
};

export default function App() {
  const [me, setMe] = useState<LocationUpdate | null>(null);
  const [users, setUsers] = useState<LiveUser[]>([]);
  const [userOrder, setUserOrder] = useState<string[]>([]);
  const [geoError, setGeoError] = useState<string | null>(getInitialGeoError);
  const [geoRetryNonce, setGeoRetryNonce] = useState(0);
  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isLocationOpen, setIsLocationOpen] = useState(true);
  const [isUsersOpen, setIsUsersOpen] = useState(true);
  const [mapFocusTarget, setMapFocusTarget] = useState<MapFocusTarget | null>(null);
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);

  const lastSentAt = useRef(0);

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
    setGeoError(getInitialGeoError());
    setGeoRetryNonce((v) => v + 1);
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

  return (
    <div
      className={`min-h-dvh bg-[radial-gradient(1200px_700px_at_75%_-10%,rgba(61,116,255,0.18),transparent_60%),radial-gradient(900px_420px_at_10%_115%,rgba(5,209,195,0.16),transparent_60%),linear-gradient(140deg,#06080f_0%,#0a1220_55%,#0f1b2d_100%)] md:h-dvh md:grid md:overflow-hidden ${
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
          className="fixed left-3 top-[max(env(safe-area-inset-top),0.75rem)] z-40 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black/55 px-3 py-2 text-xs font-medium text-zinc-100 shadow-lg backdrop-blur-md hover:bg-black/70"
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
            <div className="h-full w-full animate-pulse bg-[linear-gradient(135deg,#111826,#0a1220)]" />
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
      <aside className="border-t border-white/10 bg-[#090f19]/85 p-4 space-y-4 pb-[max(env(safe-area-inset-bottom),1rem)] backdrop-blur-xl md:border-t-0 md:border-l md:overflow-hidden">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            Live Map
          </h1>
          <Badge variant="secondary" className="bg-zinc-900/70 text-zinc-200">
            {users.length} conectados
          </Badge>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-300">
          <span
            className={`mr-2 inline-block h-2 w-2 rounded-full ${
              isSocketConnected ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          {isSocketConnected ? "Canal realtime online" : "A reconectar..."}
        </div>

        <Card className="border-white/10 bg-zinc-950/50 shadow-[0_12px_35px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base text-zinc-100">
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
                className="inline-flex size-8 items-center justify-center rounded-md border border-white/15 bg-zinc-900/70 text-zinc-200 hover:bg-zinc-800"
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
                  <p className="text-sm text-red-300">{geoError}</p>
                  {canRetryGeo && (
                    <button
                      type="button"
                      onClick={retryGeolocation}
                      className="inline-flex items-center rounded-lg border border-white/15 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800"
                    >
                      Tentar novamente
                    </button>
                  )}
                </div>
              ) : (
                <p className="font-mono text-sm text-zinc-100">
                  {me
                    ? `${formatCoord(me.lat)}, ${formatCoord(me.lng)}`
                    : "Aguardando permissão..."}
                </p>
              )}
            </CardContent>
          )}
        </Card>

        <Card
          className={`flex overflow-hidden border-white/10 bg-zinc-950/50 shadow-[0_12px_35px_rgba(0,0,0,0.35)] backdrop-blur-xl ${
            isUsersOpen
              ? "h-[40dvh] min-h-[220px] max-h-[420px] flex-col md:h-[calc(100dvh-252px)] md:max-h-none md:min-h-0"
              : ""
          }`}
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base text-zinc-100">
                Utilizadores
              </CardTitle>
              <button
                type="button"
                onClick={() => setIsUsersOpen((v) => !v)}
                aria-label={isUsersOpen ? "Fechar utilizadores" : "Abrir utilizadores"}
                className="inline-flex size-8 items-center justify-center rounded-md border border-white/15 bg-zinc-900/70 text-zinc-200 hover:bg-zinc-800"
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
                          ? "border-cyan-400/70 bg-cyan-500/10"
                          : "border-white/10 bg-black/25"
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
                        <div className="flex justify-between text-xs text-zinc-400">
                          <span className="font-mono">
                            {u.id.slice(0, 6)}… {u.id === socket.id ? "(eu)" : ""}
                          </span>
                          <span>{new Date(u.updatedAt).toLocaleTimeString()}</span>
                        </div>
                        <div className="mt-1 font-mono text-sm text-zinc-100">
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
