import Guild, { IGuildCrest } from "../models/Guild";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import { CURRENT_RAID_IDS } from "../config/guilds";
import characterService from "./character.service";

export type SearchResultType = "guild" | "character";

export type SearchResult = {
  name: string;
  realm: string;
  type: SearchResultType;
  href: string;
  iconUrl?: string;
  crest?: IGuildCrest;
  faction?: string;
  classID?: number;
  guild?: {
    name: string;
    realm: string;
  } | null;
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type BotSearchCandidate = SearchResult & {
  searchText: string[];
  lastSeenAt?: Date;
};

type ScoredSearchResult = SearchResult & {
  score: number;
  lastSeenAt?: Date;
};

const normalizeSearchText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();

const boundedEditDistance = (a: string, b: string, maxDistance: number): number => {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMinimum = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) {
      return maxDistance + 1;
    }

    previous = current;
  }

  return previous[b.length];
};

const scoreSearchCandidate = (query: string, candidate: string): number => {
  if (!query || !candidate) return 0;
  if (candidate === query) return 100;
  if (candidate.startsWith(query)) return 92;
  if (candidate.split(" ").some((part) => part.startsWith(query))) return 84;
  if (candidate.includes(query)) return 74;

  const maxDistance = query.length <= 4 ? 1 : query.length <= 10 ? 2 : 3;
  const bestWordDistance = Math.min(...candidate.split(" ").map((part) => boundedEditDistance(query, part, maxDistance)));
  if (bestWordDistance <= maxDistance) {
    return 70 - bestWordDistance * 6;
  }

  const distance = boundedEditDistance(query, candidate, maxDistance);
  if (distance <= maxDistance) {
    return 68 - distance * 6;
  }

  return 0;
};

class SearchService {
  private botCharacterCandidateCache: { expiresAt: number; candidates: BotSearchCandidate[] } | null = null;

  async searchSite(query: string, requestedLimit = 5): Promise<SearchResult[]> {
    const trimmedQuery = query.trim();
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 5, 1), 5);

    if (trimmedQuery.length < 2) {
      return [];
    }

    const selectedValueResult = await this.findSelectedValueResult(trimmedQuery);
    if (selectedValueResult) {
      return [selectedValueResult];
    }

    const namePrefix = new RegExp(`^${escapeRegex(trimmedQuery)}`, "i");
    const perTypeLimit = limit;

    const [guilds, characters] = await Promise.all([
      Guild.find({ name: namePrefix }).sort({ name: 1, realm: 1 }).limit(perTypeLimit).select("name realm iconUrl crest faction -_id").lean(),
      characterService.searchCharacters(trimmedQuery, perTypeLimit),
    ]);

    return [
      ...guilds.map((guild) => ({
        name: guild.name,
        realm: guild.realm,
        type: "guild" as const,
        href: `/guilds/${encodeURIComponent(guild.realm)}/${encodeURIComponent(guild.name)}`,
        iconUrl: guild.iconUrl,
        crest: guild.crest,
        faction: guild.faction,
      })),
      ...characters.map((character) => ({
        name: character.matchedName ?? character.name,
        realm: character.matchedRealm ?? character.realm,
        type: "character" as const,
        href: `/characters/${encodeURIComponent(character.realm)}/${encodeURIComponent(character.name)}`,
        classID: character.classID,
        guild: character.guild ?? null,
      })),
    ]
      .sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm) || a.type.localeCompare(b.type))
      .slice(0, limit);
  }

  async searchForBotCommand(query: string, requestedLimit = 5): Promise<SearchResult[]> {
    const trimmedQuery = query.trim();
    const normalizedQuery = normalizeSearchText(trimmedQuery);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 5, 1), 5);

    if (normalizedQuery.length < 2) {
      return [];
    }

    const [guildCandidates, characterCandidates] = await Promise.all([this.loadBotGuildCandidates(), this.loadBotCharacterCandidates()]);
    const scored = [...guildCandidates, ...characterCandidates]
      .map((candidate): ScoredSearchResult | null => {
        const score = Math.max(...candidate.searchText.map((text) => scoreSearchCandidate(normalizedQuery, text)));
        if (score <= 0) {
          return null;
        }

        const { searchText, ...result } = candidate;
        return { ...result, score };
      })
      .filter((result): result is ScoredSearchResult => result !== null)
      .sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (scoreDiff !== 0) return scoreDiff;

        if (a.type !== b.type) {
          return a.type === "guild" ? -1 : 1;
        }

        const seenDiff = (b.lastSeenAt?.getTime() || 0) - (a.lastSeenAt?.getTime() || 0);
        if (seenDiff !== 0) return seenDiff;

        return a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm);
      })
      .slice(0, limit);

    return scored.map(({ score, lastSeenAt, ...result }) => result);
  }

  private async loadBotGuildCandidates(): Promise<BotSearchCandidate[]> {
    const guilds = await Guild.find({})
      .sort({ name: 1, realm: 1 })
      .select("name realm iconUrl crest faction -_id")
      .lean();

    return guilds.map((guild) => ({
      name: guild.name,
      realm: guild.realm,
      type: "guild" as const,
      href: `/guilds/${encodeURIComponent(guild.realm)}/${encodeURIComponent(guild.name)}`,
      iconUrl: guild.iconUrl,
      crest: guild.crest,
      faction: guild.faction,
      searchText: [guild.name, `${guild.name} ${guild.realm}`, `${guild.name}-${guild.realm}`].map(normalizeSearchText),
    }));
  }

  private async loadBotCharacterCandidates(): Promise<BotSearchCandidate[]> {
    if (this.botCharacterCandidateCache && this.botCharacterCandidateCache.expiresAt > Date.now()) {
      return this.botCharacterCandidateCache.candidates;
    }

    const rows = await CharacterRaidParticipation.find({ zoneId: { $in: CURRENT_RAID_IDS } })
      .sort({ lastSeenAt: -1 })
      .limit(3000)
      .select("wclCanonicalCharacterId characterName characterRealm classID reportGuildName reportGuildRealm lastSeenAt -_id")
      .lean();

    const byCharacter = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key =
        typeof row.wclCanonicalCharacterId === "number"
          ? `wcl:${row.wclCanonicalCharacterId}:${row.classID}`
          : `name:${normalizeSearchText(row.characterName)}:${normalizeSearchText(row.characterRealm)}:${row.classID}`;
      if (!byCharacter.has(key)) {
        byCharacter.set(key, row);
      }
    }

    const candidates = Array.from(byCharacter.values()).map((character) => ({
      name: character.characterName,
      realm: character.characterRealm,
      type: "character" as const,
      href: `/characters/${encodeURIComponent(character.characterRealm)}/${encodeURIComponent(character.characterName)}`,
      classID: character.classID,
      guild: character.reportGuildName
        ? {
            name: character.reportGuildName,
            realm: character.reportGuildRealm,
          }
        : null,
      lastSeenAt: character.lastSeenAt,
      searchText: [character.characterName, `${character.characterName} ${character.characterRealm}`, `${character.characterName}-${character.characterRealm}`].map(normalizeSearchText),
    }));

    this.botCharacterCandidateCache = {
      expiresAt: Date.now() + 5 * 60 * 1000,
      candidates,
    };

    return candidates;
  }

  private async findSelectedValueResult(query: string): Promise<SearchResult | null> {
    const separatorIndex = query.indexOf("-");
    if (separatorIndex <= 0 || separatorIndex === query.length - 1) {
      return null;
    }

    const name = query.slice(0, separatorIndex).trim();
    const realm = query.slice(separatorIndex + 1).trim();
    if (name.length < 2 || realm.length < 2) {
      return null;
    }

    const [guild, characterProfile] = await Promise.all([
      Guild.findOne({
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
        realm: new RegExp(`^${escapeRegex(realm)}$`, "i"),
      })
        .select("name realm iconUrl crest faction -_id")
        .lean(),
      characterService.getCharacterProfileByRealmName(realm, name),
    ]);

    if (guild) {
      return {
        name: guild.name,
        realm: guild.realm,
        type: "guild",
        href: `/guilds/${encodeURIComponent(guild.realm)}/${encodeURIComponent(guild.name)}`,
        iconUrl: guild.iconUrl,
        crest: guild.crest,
        faction: guild.faction,
      };
    }

    if (characterProfile?.type === "profile") {
      const latestGuild = [...characterProfile.character.guildHistory].sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())[0];
      return {
        name: characterProfile.character.name,
        realm: characterProfile.character.realm,
        type: "character",
        href: `/characters/${encodeURIComponent(characterProfile.character.realm)}/${encodeURIComponent(characterProfile.character.name)}`,
        classID: characterProfile.character.classID,
        guild: latestGuild ? { name: latestGuild.guildName, realm: latestGuild.guildRealm } : null,
      };
    }

    if (characterProfile?.type === "choices" && characterProfile.choices.length > 0) {
      const choice = characterProfile.choices[0];
      return {
        name: choice.name,
        realm: choice.realm,
        type: "character",
        href: `/characters/${encodeURIComponent(choice.realm)}/${encodeURIComponent(choice.name)}`,
        classID: choice.classID,
        guild: choice.latestGuild ?? null,
      };
    }

    return null;
  }
}

export default new SearchService();
