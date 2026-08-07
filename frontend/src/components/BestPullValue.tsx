import { formatPercent, formatPhaseDisplay } from "@/lib/utils";
import type { PullProgressDisplay } from "@/lib/raid-progress-display";

export default function BestPullValue({ display, className, compactPhase = false }: { display: PullProgressDisplay; className?: string; compactPhase?: boolean }) {
  if (display.isKilledBoss) {
    return <span className={className ? `text-white ${className}` : "text-white"}>✓</span>;
  }

  if (!display.bestPullDisplay) {
    return <>{display.bestPull > 0 ? formatPercent(display.bestPull) : "-"}</>;
  }

  const formattedDisplay = formatPhaseDisplay(display.bestPullDisplay);

  if (!compactPhase) {
    return <>{formattedDisplay}</>;
  }

  const percent = display.bestPull > 0 ? formatPercent(display.bestPull) : formattedDisplay.match(/\d+(?:\.\d+)?%/)?.[0] || "-";
  const phase = formattedDisplay.match(/\b(?:P|I)\d+\b/i)?.[0].toUpperCase();

  return <>{phase ? `${percent} ${phase}` : percent}</>;
}
