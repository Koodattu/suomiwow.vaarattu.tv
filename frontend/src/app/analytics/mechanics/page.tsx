import { Suspense } from "react";
import MechanicLeaderboardView from "@/components/analytics/MechanicLeaderboardView";

export default function MechanicsPage() {
  return <Suspense fallback={null}><MechanicLeaderboardView /></Suspense>;
}
