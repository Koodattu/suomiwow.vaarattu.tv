import type { ForeverMember } from "./forever-armory";

interface Evidence {
  slug: string;
  guild?: { region: string; slug: string } | null;
  faction?: string | null;
  ruleset?: string | null;
  rulesetInferredFromGuild?: string | null;
  sourceUpdatedAt?: Date | null;
}

/** Only direct Armory profiles of current, non-outdated members can confirm a guild. */
export function confirmedGuildRuleset(guild: { region: string; slug: string }, roster: ForeverMember[], characters: Evidence[]) {
  const members = new Map(roster.filter(member => !member.isOutdated).map(member => [member.slug, member]));
  const evidence = characters.filter(character => members.has(character.slug) && character.sourceUpdatedAt &&
    character.guild?.region === guild.region && character.guild.slug === guild.slug && !character.rulesetInferredFromGuild &&
    ["Horde", "Alliance"].includes(character.faction || "") && character.ruleset && character.ruleset !== "Unknown");
  if (evidence.length < 3) return null;
  const { faction, ruleset } = evidence[0];
  if (evidence.some(character => character.faction !== faction || character.ruleset !== ruleset) ||
    [...members.values()].some(member => member.faction && member.faction !== faction)) return null;
  return { faction: faction!, ruleset: ruleset! };
}
