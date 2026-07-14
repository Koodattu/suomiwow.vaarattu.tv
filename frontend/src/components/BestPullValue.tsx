import { formatPercent, formatPhaseDisplay } from "@/lib/utils";
import type { PullProgressDisplay } from "@/lib/raid-progress-display";

export default function BestPullValue({ display, className }: { display: PullProgressDisplay; className?: string }) {
  if (display.isKilledBoss) {
    return <span className={className ? `text-white ${className}` : "text-white"}>✓</span>;
  }

  return <>{display.bestPullDisplay ? formatPhaseDisplay(display.bestPullDisplay) : display.bestPull > 0 ? formatPercent(display.bestPull) : "-"}</>;
}
