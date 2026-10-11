import type { PullProgressDisplay } from "@/lib/raid-progress-display";

export default function BestPullValue({ display, className }: { display: PullProgressDisplay; className?: string }) {
  if (display.isKilledBoss) {
    return <span className={className ? `text-white ${className}` : "text-white"}>✓</span>;
  }

  return <>{display.bestPullDisplay || "-"}</>;
}
