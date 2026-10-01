import type { Metadata } from "next";
import { MapEditorLoader } from "@/components/map/MapEditorLoader";
import { getAdmin } from "@/lib/auth";

export const metadata: Metadata = { title: "Map editor · Project 1221 Admin" };

export default async function MapPage() {
  const { user } = await getAdmin();
  return <MapEditorLoader email={user.email ?? ""} />;
}
