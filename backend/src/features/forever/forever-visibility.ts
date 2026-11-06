import { ForeverGuild } from "./forever.models";

// Hiding a guild preserves each member's tracking status and collected history.
// Unfetched roster members have no profile guild yet, but must also stay hidden.
export async function visibleForeverCharacters(): Promise<Record<string, unknown>> {
  const hidden = await ForeverGuild.find({ hidden: true }).select("region slug roster.slug").lean();
  return hidden.length ? { $nor: hidden.flatMap((guild) => [
    { region: guild.region, "guild.slug": guild.slug },
    { region: guild.region, guild: null, slug: { $in: guild.roster.map((member) => member.slug) } },
  ]) } : {};
}
