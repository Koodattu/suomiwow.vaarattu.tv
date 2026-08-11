import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CcgGameHub, { type CcgPlayableMode } from "@/components/ccg/games/CcgGameHub";

const MODES = new Set<CcgPlayableMode>(["expedition", "raid-night", "raid-race", "transmog-ring"]);

export const metadata: Metadata = {
  title: "Raid Director | SuomiWoW CCG",
  description: "Build a roster, assign raid mechanics, and lead your SuomiWoW collection through dungeon and raid challenges.",
};

export default async function CcgGameModePage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (!MODES.has(mode as CcgPlayableMode)) notFound();
  return <CcgGameHub mode={mode as CcgPlayableMode} />;
}
