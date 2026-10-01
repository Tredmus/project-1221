"use client";

import dynamic from "next/dynamic";

// MapLibre needs the browser (WebGL, window), so the editor never renders on the server.
const MapEditor = dynamic(() => import("./MapEditor").then((m) => m.MapEditor), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted">Loading the map editor…</p>,
});

export function MapEditorLoader({ email }: { email: string }) {
  return <MapEditor email={email} />;
}
