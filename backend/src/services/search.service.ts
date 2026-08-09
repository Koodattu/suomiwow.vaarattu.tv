import Guild, { IGuildCrest } from "../models/Guild";
import CharacterRaidParticipation from "../models/CharacterRaidParticipation";
import { CURRENT_RAID_IDS } from "../config/guilds";
import { createAccentInsensitiveSearchRegex, normalizeSearchText, scoreSearchCandidate } from "../utils/search";
import characterService from "./character.service";

const ACCENT_INSENSITIVE_COLLATION = { locale: "en", strength: 1 } as const;

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
  lastSeenAt?: Date;
};

type BotSearchCandidate = SearchResult & {
  searchText: string[];
  lastSeenAt?: Date;
};

type ScoredSearchResult = SearchResult & {
  score: number;
};

type BotCharacterGuild = {
  name: string;
  realm: string;
  reportCount: number;
  lastSeenAt: Date;
};

class SearchService {
  private botCharacterCandidateCache: { expiresAt: number; candidates: BotSearchCandidate[] } | null = null;
  private siteSearchCache = new Map<string, { expiresAt: number; results: SearchResult[] }>();
  private siteSearchPromises = new Map<string, Promise<SearchResult[]>>();

  async searchSite(query: string, requestedLimit = 5, options: { includeHistorical?: boolean } = {}): Promise<SearchResult[]> {
    const trimmedQuery = query.trim().slice(0, 60);
    const normalizedQuery = normalizeSearchText(trimmedQuery);
    const includeHistorical = options.includeHistorical === true;
    const maximumLimit = includeHistorical ? 20 : 5;
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 5, 1), maximumLimit);

    if (normalizedQuery.length < 2) {
      return [];
    }

    const cacheKey = `${normalizedQuery}:${limit}:${includeHistorical ? "all" : "preview"}`;
    const cached = this.siteSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.results;
    const pending = this.siteSearchPromises.get(cacheKey);
    if (pending) return pending;

    const searchPromise = this.searchSiteUncached(trimmedQuery, normalizedQuery, limit, includeHistorical)
      .then((results) => {
        if (this.siteSearchCache.size >= 200) {
          const oldestKey = this.siteSearchCache.keys().next().value;
          if (oldestKey) this.siteSearchCache.delete(oldestKey);
        }
        this.siteSearchCache.set(cacheKey, { expiresAt: Date.now() + 2 * 60 * 1000, results });
        return results;
      })
      .finally(() => {
        this.siteSearchPromises.delete(cacheKey);
      });
    this.siteSearchPromises.set(cacheKey, searchPromise);
    return searchPromise;
  }

  private async searchSiteUncached(trimmedQuery: string, normalizedQuery: string, limit: number, includeHistorical: boolean): Promise<SearchResult[]> {
    const selectedValueResult = await this.findSelectedValueResult(trimmedQuery);
    if (selectedValueResult) {
      return [selectedValueResult];
    }

    const prefixOnly = includeHistorical && normalizedQuery.length === 2;
    const nameMatch = createAccentInsensitiveSearchRegex(trimmedQuery, { prefix: prefixOnly });
    const candidateLimit = Math.min(includeHistorical ? Math.max(limit, 10) : Math.max(limit * 2, 5), 20);

    const [exactGuilds, guilds, exactCharacters, currentCharacters] = await Promise.all([
      Guild.find({ name: trimmedQuery })
        .collation(ACCENT_INSENSITIVE_COLLATION)
        .sort({ name: 1, realm: 1 })
        .limit(candidateLimit)
        .select("name realm iconUrl crest faction -_id")
        .lean(),
      Guild.find({ name: nameMatch }).sort({ name: 1, realm: 1 }).limit(candidateLimit).select("name realm iconUrl crest faction -_id").lean(),
      characterService.searchExactHistoricalCharacters(trimmedQuery, candidateLimit),
      characterService.searchCurrentCharacters(trimmedQuery, candidateLimit, { prefix: prefixOnly }),
    ]);

    const guildResults = [...exactGuilds, ...guilds].map((guild) => ({
      name: guild.name,
      realm: guild.realm,
      type: "guild" as const,
      href: `/guilds/${encodeURIComponent(guild.realm)}/${encodeURIComponent(guild.name)}`,
      iconUrl: guild.iconUrl,
      crest: guild.crest,
      faction: guild.faction,
    }));
    const characterResults = [...exactCharacters, ...currentCharacters].map((character) => ({
      name: character.matchedName ?? character.name,
      realm: character.matchedRealm ?? character.realm,
      type: "character" as const,
      href: `/characters/${encodeURIComponent(character.realm)}/${encodeURIComponent(character.name)}`,
      classID: character.classID,
      guild: character.guild ?? null,
      lastSeenAt: character.lastReportSeenAt,
    }));

    return this.rankAndLimitResults([...guildResults, ...characterResults], normalizedQuery, limit);
  }

  private rankAndLimitResults(results: SearchResult[], normalizedQuery: string, limit: number): SearchResult[] {
    const uniqueResults = new Map<string, SearchResult>();
    for (const result of results) {
      const key = `${result.type}:${result.name.normalize("NFC").toLowerCase()}:${result.realm.normalize("NFC").toLowerCase()}`;
      if (!uniqueResults.has(key)) uniqueResults.set(key, result);
    }

    return Array.from(uniqueResults.values())
      .map((result): ScoredSearchResult => ({
        ...result,
        score: Math.max(
          scoreSearchCandidate(normalizedQuery, normalizeSearchText(result.name)),
          scoreSearchCandidate(normalizedQuery, normalizeSearchText(`${result.name} ${result.realm}`)),
          scoreSearchCandidate(normalizedQuery, normalizeSearchText(`${result.name}-${result.realm}`)),
        ),
      }))
      .filter((result) => result.score > 0)
      .sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (scoreDiff !== 0) return scoreDiff;

        const seenDiff = (b.lastSeenAt?.getTime() || 0) - (a.lastSeenAt?.getTime() || 0);
        if (seenDiff !== 0) return seenDiff;

        if (a.type !== b.type) return a.type === "guild" ? -1 : 1;
        return a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm);
      })
      .slice(0, limit)
      .map(({ score, ...result }) => result);
  }

  async searchForBotCommand(query: string, requestedLimit = 5): Promise<SearchResult[]> {
    const trimmedQuery = query.trim();
    const normalizedQuery = normalizeSearchText(trimmedQuery);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 5, 1), 5);

    if (normalizedQuery.length < 2) {
      return [];
    }

    const [guildCandidates, currentCharacterCandidates, directCharacters] = await Promise.all([
      this.loadBotGuildCandidates(),
      this.loadBotCharacterCandidates(),
      characterService.searchCharacters(trimmedQuery, limit),
    ]);
    const characterCandidates = currentCharacterCandidates.map((candidate) => ({ ...candidate, searchText: [...candidate.searchText] }));
    const currentCharacterByKey = new Map(characterCandidates.map((candidate) => [`${candidate.href}:${candidate.classID}`, candidate]));

    for (const character of directCharacters) {
      const href = `/characters/${encodeURIComponent(character.realm)}/${encodeURIComponent(character.name)}`;
      const key = `${href}:${character.classID}`;
      const currentCandidate = currentCharacterByKey.get(key);
      const matchedName = character.matchedName ?? character.name;
      const matchedRealm = character.matchedRealm ?? character.realm;
      const searchText = [
        character.name,
        `${character.name} ${character.realm}`,
        `${character.name}-${character.realm}`,
        matchedName,
        `${matchedName} ${matchedRealm}`,
        `${matchedName}-${matchedRealm}`,
      ].map(normalizeSearchText);

      if (currentCandidate) {
        currentCandidate.searchText = Array.from(new Set([...currentCandidate.searchText, ...searchText]));
        continue;
      }

      characterCandidates.push({
        name: character.name,
        realm: character.realm,
        type: "character",
        href,
        classID: character.classID,
        guild: null,
        lastSeenAt: character.lastReportSeenAt,
        searchText: Array.from(new Set(searchText)),
      });
    }

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
      });

    const selected = scored[0]?.score === 100 ? scored.slice(0, 1) : scored.slice(0, limit);

    return selected.map(({ score, lastSeenAt, ...result }) => result);
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
      .select("wclCanonicalCharacterId characterName characterRealm characterRegion classID reportGuildId reportGuildName reportGuildRealm reportCount lastSeenAt -_id")
      .lean();

    type BotCharacterRow = (typeof rows)[number];
    type BotCharacterGroup = {
      latest: BotCharacterRow;
      searchText: Set<string>;
      guilds: Map<string, BotCharacterGuild>;
    };

    const byCharacter = new Map<string, BotCharacterGroup>();
    for (const row of rows) {
      const key =
        typeof row.wclCanonicalCharacterId === "number"
          ? `wcl:${row.wclCanonicalCharacterId}:${row.classID}`
          : `name:${normalizeSearchText(row.characterRegion)}:${normalizeSearchText(row.characterName)}:${normalizeSearchText(row.characterRealm)}:${row.classID}`;
      let character = byCharacter.get(key);
      if (!character) {
        character = {
          latest: row,
          searchText: new Set<string>(),
          guilds: new Map<string, BotCharacterGuild>(),
        };
        byCharacter.set(key, character);
      } else if (row.lastSeenAt.getTime() > character.latest.lastSeenAt.getTime()) {
        character.latest = row;
      }

      [row.characterName, `${row.characterName} ${row.characterRealm}`, `${row.characterName}-${row.characterRealm}`]
        .map(normalizeSearchText)
        .forEach((text) => character.searchText.add(text));

      const guildKey = row.reportGuildId.toString();
      const guild = character.guilds.get(guildKey);
      if (!guild) {
        character.guilds.set(guildKey, {
          name: row.reportGuildName,
          realm: row.reportGuildRealm,
          reportCount: row.reportCount,
          lastSeenAt: row.lastSeenAt,
        });
      } else {
        guild.reportCount += row.reportCount;
        if (row.lastSeenAt.getTime() > guild.lastSeenAt.getTime()) {
          guild.name = row.reportGuildName;
          guild.realm = row.reportGuildRealm;
          guild.lastSeenAt = row.lastSeenAt;
        }
      }
    }

    const candidates = Array.from(byCharacter.values()).map((character) => {
      const popularGuild = Array.from(character.guilds.values()).sort(
        (a, b) =>
          b.reportCount - a.reportCount ||
          b.lastSeenAt.getTime() - a.lastSeenAt.getTime() ||
          a.name.localeCompare(b.name) ||
          a.realm.localeCompare(b.realm),
      )[0];

      return {
        name: character.latest.characterName,
        realm: character.latest.characterRealm,
        type: "character" as const,
        href: `/characters/${encodeURIComponent(character.latest.characterRealm)}/${encodeURIComponent(character.latest.characterName)}`,
        classID: character.latest.classID,
        guild: popularGuild
          ? {
              name: popularGuild.name,
              realm: popularGuild.realm,
            }
          : null,
        lastSeenAt: character.latest.lastSeenAt,
        searchText: Array.from(character.searchText),
      };
    });

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

    const [guild, characterProfile, exactHistoricalCharacters] = await Promise.all([
      Guild.findOne({
        name: createAccentInsensitiveSearchRegex(name, { exact: true }),
        realm: createAccentInsensitiveSearchRegex(realm, { exact: true }),
      })
        .select("name realm iconUrl crest faction -_id")
        .lean(),
      characterService.getCharacterProfileByRealmName(realm, name),
      characterService.searchExactHistoricalCharacters(name, 20),
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

    const normalizedRealm = normalizeSearchText(realm);
    const historicalCharacter = exactHistoricalCharacters.find((character) => normalizeSearchText(character.realm) === normalizedRealm);
    if (historicalCharacter) {
      return {
        name: historicalCharacter.name,
        realm: historicalCharacter.realm,
        type: "character",
        href: `/characters/${encodeURIComponent(historicalCharacter.realm)}/${encodeURIComponent(historicalCharacter.name)}`,
        classID: historicalCharacter.classID,
        guild: historicalCharacter.guild ?? null,
        lastSeenAt: historicalCharacter.lastReportSeenAt,
      };
    }

    return null;
  }
}

export default new SearchService();
