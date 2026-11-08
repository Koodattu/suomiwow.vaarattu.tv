import { ForeverGuild } from "./forever.models";

// Confirmed individuals remain visible and polled regardless of guild moderation.
// Guild-only imports, including unfetched members, follow the guild's visibility.
export async function visibleForeverCharacters(): Promise<Record<string, unknown>> {
  const hidden = await ForeverGuild.find({ hidden: true }).select("region slug roster.slug").lean();
  const imported = { source: { $nin: ["admin", "seed"] }, independentlyTracked: { $ne: true } };
  return hidden.length ? { $nor: hidden.flatMap((guild) => [
    { ...imported, region: guild.region, "guild.slug": guild.slug },
    { ...imported, region: guild.region, guild: null, slug: { $in: guild.roster.map((member) => member.slug) } },
  ]) } : {};
}
