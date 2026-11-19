import { ForeverGuild } from "./forever.models";

// Confirmed individuals remain visible and polled regardless of guild moderation.
// Guild-only imports, including unfetched members, follow the guild's visibility.
type Candidate = { region?: string; slug?: string; source?: string; independentlyTracked?: boolean | null;
  guild?: { slug?: string } | null };

export async function foreverVisibility() {
  const hidden = await ForeverGuild.find({ hidden: true }).select("region slug roster.slug").lean();
  const imported = { source: { $nin: ["admin", "seed"] }, independentlyTracked: { $ne: true } };
  // Each region needs only two exclusions regardless of how many guilds are hidden.
  const regions = new Map<string, { guilds: Set<string>; members: Set<string> }>();
  for (const guild of hidden) {
    const group = regions.get(guild.region) ?? { guilds: new Set<string>(), members: new Set<string>() };
    group.guilds.add(guild.slug);
    for (const member of guild.roster) group.members.add(member.slug);
    regions.set(guild.region, group);
  }
  const filter: Record<string, unknown> = regions.size ? { $nor: [...regions].flatMap(([region, group]) => [
    { ...imported, region, "guild.slug": { $in: [...group.guilds] } },
    { ...imported, region, guild: null, slug: { $in: [...group.members] } },
  ]) } : {};
  // Full-population snapshot reads already need every candidate. Set membership
  // avoids evaluating large lists of hidden roster names inside the ranked scan.
  function includes(row: Candidate) {
    if (row.independentlyTracked || row.source === "admin" || row.source === "seed") return true;
    const group = regions.get(row.region ?? "");
    if (!group) return true;
    return row.guild == null ? !group.members.has(row.slug ?? "") : !group.guilds.has(row.guild.slug ?? "");
  }
  return { filter, includes };
}

export async function visibleForeverCharacters(): Promise<Record<string, unknown>> {
  return (await foreverVisibility()).filter;
}
