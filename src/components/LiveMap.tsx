import { memo, useEffect, useMemo, useState } from "react";
import type { LiveUser, LocationUpdate } from "@/types";
import { socket } from "@/lib/socket";

import {
  Map,
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerLabel,
  MarkerTooltip,
} from "@/components/ui/map";

function shortId(id: string) {
  return `${id.slice(0, 6)}…`;
}

function LiveMap({
  me,
  users,
  focusTarget,
  focusedUserId,
  onUserSelect,
}: {
  me: LocationUpdate | null;
  users: LiveUser[];
  focusTarget?: { lat: number; lng: number; key: number } | null;
  focusedUserId?: string | null;
  onUserSelect?: (user: LiveUser) => void;
}) {
  const otherUsers = useMemo(
    () => users.filter((u) => u.id !== socket.id),
    [users]
  );

  // MapLibre usa [lng, lat]
  const defaultCenter: [number, number] = [32.5892, -25.9653]; // Maputo
  const initialCenter: [number, number] = defaultCenter;

  const [viewport, setViewport] = useState({
    center: initialCenter,
    zoom: 13,
    bearing: 0,
    pitch: 0,
  });

  // Quando um utilizador é selecionado, centra o mapa nele.
  useEffect(() => {
    if (!focusTarget) return;

    setViewport((v) => ({
      ...v,
      center: [focusTarget.lng, focusTarget.lat],
      zoom: Math.max(v.zoom, 15),
    }));
  }, [focusTarget?.key]);

  return (
    <div className="h-full w-full">
      <Map
        className="h-full w-full"
        viewport={viewport}
        onViewportChange={setViewport}
      >
        <MapControls
          position="bottom-right"
          showZoom
          showLocate
          showFullscreen
        />

        {/* ===== EU (verde) ===== */}
        {me && (
          <MapMarker longitude={me.lng} latitude={me.lat}>
            <MarkerContent>
              <div className="h-4 w-4 rounded-full border-2 border-emerald-100 bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.22)] transition-[transform,background-color,border-color,box-shadow] duration-200 ease-out dark:border-white dark:shadow-lg" />
              <MarkerLabel
                position="bottom"
                className="mt-1 rounded-md border border-emerald-700/25 bg-emerald-100/90 px-1.5 py-0.5 font-mono text-[10px] text-emerald-900 shadow-sm transition-[transform,background-color,color,border-color,opacity] duration-200 ease-out dark:border-emerald-200/35 dark:bg-emerald-500/25 dark:text-emerald-100"
              >
                eu
              </MarkerLabel>
            </MarkerContent>
            <MarkerTooltip>
              <span className="font-mono text-xs">eu</span>
            </MarkerTooltip>
          </MapMarker>
        )}

        {/* ===== OUTROS USERS (azul) ===== */}
        {otherUsers.map((u) => (
          <MapMarker
            key={u.id}
            longitude={u.lng}
            latitude={u.lat}
            onClick={() => onUserSelect?.(u)}
          >
            <MarkerContent>
              <div
                className={`h-4 w-4 rounded-full border-2 shadow-lg transition-[transform,background-color,border-color,box-shadow,ring-color] duration-200 ease-out ${
                  focusedUserId === u.id
                    ? "scale-110 border-cyan-700 bg-cyan-500 ring-4 ring-cyan-400/40 dark:border-cyan-200 dark:bg-cyan-400 dark:ring-cyan-500/35"
                    : "border-sky-700/60 bg-blue-500 ring-2 ring-blue-400/25 dark:border-white dark:ring-0"
                }`}
              />
              <MarkerLabel
                position="bottom"
                className={`mt-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-[transform,background-color,color,border-color,opacity] duration-200 ease-out ${
                  focusedUserId === u.id
                    ? "translate-y-0 border-cyan-700/25 bg-cyan-100/88 text-cyan-900 shadow-sm dark:border-cyan-200/50 dark:bg-cyan-500/20 dark:text-cyan-100"
                    : "border-slate-400/70 bg-slate-200/90 text-slate-800 shadow-sm dark:border-white/20 dark:bg-black/55 dark:text-zinc-100"
                }`}
              >
                {shortId(u.id)}
              </MarkerLabel>
            </MarkerContent>
            <MarkerTooltip>
              <span className="font-mono text-xs">{shortId(u.id)}</span>
            </MarkerTooltip>
          </MapMarker>
        ))}
      </Map>
    </div>
  );
}

export default memo(LiveMap);
