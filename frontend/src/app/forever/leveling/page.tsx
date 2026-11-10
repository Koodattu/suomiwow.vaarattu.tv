import ForeverLeveling from "@/components/forever/ForeverLeveling";
import type { ForeverBoard } from "@/lib/forever-api";

export default async function ForeverLevelingPage() {
  let initialData: ForeverBoard | undefined;
  try {
    const response = await fetch(`${process.env.API_URL || "http://localhost:3001"}/api/forever/leveling`, {
      cache: "no-store", signal: AbortSignal.timeout(3000),
    });
    if (response.ok) initialData = await response.json();
  } catch {
    // The client query can recover if the API is restarting or the initial fetch times out.
  }
  return <ForeverLeveling initialData={initialData} now={new Date().toISOString()} />;
}
