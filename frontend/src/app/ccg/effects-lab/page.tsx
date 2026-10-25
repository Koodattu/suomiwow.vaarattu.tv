import { notFound } from "next/navigation";
import EffectsLab from "./EffectsLab";

// Local-only performance lab for card finishes and affixes. Never served by production builds.
export default function CcgEffectsLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <EffectsLab />;
}
