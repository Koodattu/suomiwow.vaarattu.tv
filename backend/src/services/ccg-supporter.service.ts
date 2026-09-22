import mongoose, { ClientSession } from "mongoose";
import { randomUUID } from "crypto";
import { CLASSES } from "../config/classes";
import { CCG_GRADING_VERSION, CCG_SUPPORTER_SET, CCG_THEME_VERSION, CcgFinish } from "../config/ccg";
import User, { IWoWCharacter } from "../models/User";
import Guild from "../models/Guild";
import CcgCard from "../models/CcgCard";
import CcgSet from "../models/CcgSet";
import CcgOwnership from "../models/CcgOwnership";
import CcgPackCredit from "../models/CcgPackCredit";
import CcgLedgerEntry from "../models/CcgLedgerEntry";
import CcgSupporterCreator from "../models/CcgSupporterCreator";
import CcgSupporterGrant from "../models/CcgSupporterGrant";
import CcgSupporterCharacter from "../models/CcgSupporterCharacter";
import CcgLeaderboardInvalidation from "../models/CcgLeaderboardInvalidation";
import { CcgSupporterError, SUPPORTER_BASE_SLOTS, SUPPORTER_CREATOR_FINISHES, SUPPORTER_DRAFT_LIMIT, SUPPORTER_RENDER_COOLDOWN_MS,
  supporterScores, validateSupporterDraft, SUPPORTER_BACKGROUNDS } from "../utils/ccg-supporter";
import { createWowCharacterIdentityKey } from "../utils/ccg-identity";
import { resolveCardCrop } from "../utils/ccg-random";
import { normalizeRealmSlug } from "../utils/realm";
import { slugifySpecName } from "../utils/spec";
import battlenet from "./battlenet-auth.service";
import blizzard from "./blizzard.service";
import renders from "./character-render-storage.service";
import publisher from "./ccg-publisher.service";
import ccg from "./ccg.service";
import status, { supporterLimit } from "./ccg-supporter-status.service";
import cache from "./cache.service";
import { refreshCcgCollectionReadModelsForSeries } from "./ccg-collection-read-model.service";
import identities from "./ccg-character-identity.service";
import Media from "../models/CcgSupporterMedia";
import media, { SupporterMediaKind } from "./ccg-supporter-media.service";

type Source = mongoose.HydratedDocument<mongoose.InferSchemaType<typeof CcgSupporterCharacter.schema>>;
const CREATION_REWARD_PACKS = 10;
const rewardKey = (id: mongoose.Types.ObjectId) => `supporter-creation:${id}`;

type Proof = { accountId: string; connectionAt: Date; character: IWoWCharacter };

function objectId(value: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new CcgSupporterError(400, "invalid_character");
  return new mongoose.Types.ObjectId(value);
}

class CcgSupporterService {
  private async roster(userId: string, refresh = false) {
    const user = await User.findById(userId);
    if (!user?.battlenet) throw new CcgSupporterError(409, "battlenet_required");
    const creator = await status.ensureCreator(userId);
    if (creator.battlenetId && creator.battlenetId !== user.battlenet.id) throw new CcgSupporterError(409, "account_bound");
    let characters: IWoWCharacter[];
    if (refresh) await supporterLimit(`roster:${userId}`, 1, 300_000);
    try { characters = await (refresh ? battlenet.refreshCharacters(userId) : battlenet.getCharacters(userId)); }
    catch (error) {
      const code = (error as { code?: string }).code;
      throw new CcgSupporterError(503, code === "BATTLENET_RECONNECT_REQUIRED" ? "battlenet_required" : "armory_unavailable");
    }
    if (!creator.battlenetId) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await this.fenceAccount(userId, { accountId: user.battlenet!.id, connectionAt: user.battlenet!.connectedAt }, session);
          const bound = await CcgSupporterCreator.updateOne({ _id: creator._id,
            $or: [{ battlenetId: { $exists: false } }, { battlenetId: user.battlenet!.id }] },
          { $set: { battlenetId: user.battlenet!.id } }, { session });
          if (!bound.matchedCount) throw new CcgSupporterError(409, "account_bound");
        });
      } catch (error) {
        if ((error as { code?: number }).code === 11000) throw new CcgSupporterError(409, "account_bound");
        throw error;
      } finally { await session.endSession(); }
    }
    return { creator, characters, accountId: user.battlenet.id, connectionAt: user.battlenet.connectedAt };
  }

  private async fenceAccount(userId: string, proof: Pick<Proof, "accountId" | "connectionAt">, session: ClientSession) {
    const result = await User.updateOne({ _id: userId, "battlenet.id": proof.accountId, "battlenet.connectedAt": proof.connectionAt },
      { $inc: { __v: 1 } }, { session });
    if (!result.matchedCount) throw new CcgSupporterError(409, "battlenet_required");
  }

  private async proof(userId: string, source: Source): Promise<Proof> {
    const roster = await this.roster(userId);
    const character = roster.characters.find((entry) => entry.id === source.blizzardCharacterId && entry.realmId === source.realmId);
    if (!character) throw new CcgSupporterError(403, "ownership_required");
    return { ...roster, character };
  }

  private async source(userId: string, id: string) {
    const creator = await status.ensureCreator(userId);
    const source = await CcgSupporterCharacter.findOne({ _id: objectId(id), creatorId: creator._id });
    if (!source) throw new CcgSupporterError(404, "character_not_found");
    if (source.editsFrozen) throw new CcgSupporterError(403, "editing_frozen");
    return source;
  }

  private checkRevision(source: Source, revision: unknown) {
    if (!Number.isInteger(revision) || source.revision !== revision) throw new CcgSupporterError(409, "draft_changed");
  }

  private cardFields(source: Source) {
    const draft = source.draft!;
    const background = SUPPORTER_BACKGROUNDS.find((entry) => entry.id === draft.backgroundId);
    return { name: source.name, realm: source.realm, specName: draft.specName, role: draft.role,
      ...(background ? { backgroundPath: background.path, backgroundCrop: { ...background.crop, x: draft.backgroundOffsetX ?? background.crop.x } } : {}),
      guildId: source.guildId ?? null, guildName: source.guildName ?? null, guildRealm: source.guildRealm ?? null,
      metric: draft.role === "healer" ? "hps" : "dps", communityScores: supporterScores(draft),
      renderUrl: draft.renderUrl, renderAssetId: draft.renderAssetId, renderFit: draft.renderFit,
      avatarUrl: draft.avatarUrl, mediaCapturedAt: draft.mediaCapturedAt };
  }

  private async rosterGuild(character: IWoWCharacter) {
    // An unavailable first guild lookup is not proof that the character left its guild.
    if (!character.guildCheckedAt && !character.guild && !character.inactive) return {};
    const guildName = character.inactive ? null : character.guild ?? null;
    const guildRealm = guildName ? character.guildRealm ?? character.realm : null;
    const guild = guildName && guildRealm
      ? await Guild.findOne({ name: guildName, realm: guildRealm, region: "eu" }).collation({ locale: "en", strength: 2 }).select("_id").lean()
      : null;
    return { guildId: guild?._id ?? null, guildName, guildRealm };
  }

  private async serialize(source: Source, set: NonNullable<Awaited<ReturnType<typeof CcgSet.findOne>>>) {
    const card = source.cardId ? await CcgCard.findById(source.cardId).lean() : null;
    const preview = source.draft ? { ...(card ?? {}), ...this.cardFields(source), _id: card?._id ?? source._id,
      characterId: source._id, setNumber: card?.setNumber ?? 0, region: "eu", classID: source.classID,
      tierGrade: source.draft.tierGrade, creatorFinish: source.draft.creatorFinish, snapshotVersion: 1, itemLevel: 0,
      backgroundCrop: this.cardFields(source).backgroundCrop ?? card?.backgroundCrop ?? resolveCardCrop(`${set.slug}:${source.identityKey}`, set.backgroundSafeCrop),
      performanceSnapshotAt: card?.performanceSnapshotAt ?? source.createdAt, publishedAt: card?.publishedAt ?? null } : card;
    return { id: String(source._id), cardId: source.cardId ? String(source.cardId) : null,
      characterId: source.blizzardCharacterId, realmId: source.realmId, name: source.name, realm: source.realm,
      classID: source.classID, revision: source.revision, draft: source.toObject().draft ?? null,
      creatorFinish: source.creatorFinish, tierGrade: source.tierGrade, editsFrozen: source.editsFrozen,
      nextEditAt: source.nextEditAt, nextRenderRefreshAt: source.nextRenderRefreshAt,
      renderError: source.renderError, renderUnchanged: source.renderUnchanged,
      preview: preview ? { ...ccg.serializeCard(preview, set), set: ccg.serializeSet(set) } : null };
  }

  async getState(userId: string) {
    await status.initializeExistingLink(userId);
    await publisher.ensureConfiguredSets();
    const [user, creator, set] = await Promise.all([
      User.findById(userId).select("battlenet.id twitch.id"),
      status.ensureCreator(userId),
      CcgSet.findOne({ zoneId: CCG_SUPPORTER_SET.zoneId }).orFail(),
    ]);
    const [earnedGrants, sources] = await Promise.all([
      CcgSupporterGrant.distinct("kind", { creatorId: creator._id }),
      CcgSupporterCharacter.find({ creatorId: creator._id, $or: [{ draft: { $ne: null } }, { cardId: { $exists: true } }] }).sort({ createdAt: -1 }),
    ]);
    const [creations, submissions, rewards] = await Promise.all([
      Promise.all(sources.map((source) => this.serialize(source, set))),
      media.list(sources.map((source) => source._id)),
      this.packRewards(userId, sources),
    ]);
    return { region: "eu", battlenetConnected: Boolean(user?.battlenet), twitchConnected: Boolean(user?.twitch),
      entitlements: { base: SUPPORTER_BASE_SLOTS, follower: earnedGrants.includes("follower"), subscriber: earnedGrants.includes("subscriber") },
      allowance: { earned: SUPPORTER_BASE_SLOTS + creator.earnedSlots, used: creator.usedSlots, available: SUPPORTER_BASE_SLOTS + creator.earnedSlots - creator.usedSlots,
        drafts: creator.draftCount, draftLimit: SUPPORTER_DRAFT_LIMIT },
      status: { tracking: creator.trackingEnabled, following: creator.following, subscribed: creator.subscribed,
        checkedAt: creator.checkedAt, error: creator.checkError, nextCheckAt: creator.nextCheckAt,
        nextManualCheckAt: creator.nextManualCheckAt, firstSubscriberMonth: creator.firstSubscriberMonth },
      finishes: SUPPORTER_CREATOR_FINISHES, backgrounds: SUPPORTER_BACKGROUNDS, classes: CLASSES.map(({ id, name, specs }) => ({ id, name, specs })),
      creations, media: submissions, rewards,
    };
  }

  async getCharacters(userId: string, refreshRoster = false) {
    const user = await User.findById(userId).select("battlenet.id battlenet.characters");
    let characters: IWoWCharacter[] = [];
    let rosterError: string | null = null;
    if (user?.battlenet) {
      try { characters = (await this.roster(userId, refreshRoster)).characters; }
      catch (error) {
        rosterError = error instanceof CcgSupporterError ? error.code : "armory_unavailable";
        if (rosterError !== "account_bound") characters = user.battlenet.characters.filter((character) => character.realmId);
      }
    }
    const tracked = await Promise.all(characters.map(async (character) => {
      const classID = CLASSES.find((entry) => entry.name === character.class)?.id;
      if (!classID) return null;
      try { return await identities.resolveTrackedCharacter({ name: character.name, realm: character.realmSlug, region: "eu", classID }); }
      catch { return null; }
    }));
    const matches = characters.length ? await CcgCard.aggregate([
      { $match: { region: "eu", $or: [
        ...characters.map((character) => ({ name: character.name, realm: { $in: [character.realm, character.realmSlug] } })),
        { characterId: { $in: tracked.flatMap((character) => character ? [character._id] : []) } },
      ] } },
      { $sort: { snapshotVersion: -1, publishedAt: -1 } },
      { $group: { _id: { setId: "$setId", characterId: "$characterId" }, card: { $first: "$$ROOT" }, snapshots: { $sum: 1 } } },
    ]).collation({ locale: "en", strength: 2 }) : [];
    const sets = await CcgSet.find({ _id: { $in: matches.map((match) => match.card.setId) }, enabledAt: { $ne: null } }).lean();
    const setById = new Map(sets.map((entry) => [String(entry._id), entry]));
    const owned = matches.length ? await CcgOwnership.aggregate([
      { $match: { ownerType: "user", ownerId: new mongoose.Types.ObjectId(userId), setId: { $in: sets.map((entry) => entry._id) } } },
      { $group: { _id: { setId: "$setId", characterId: "$characterId" }, quantity: { $sum: "$quantity" } } },
    ]) : [];
    const ownedBySeries = new Map(owned.map((entry) => [`${entry._id.setId}:${entry._id.characterId}`, entry.quantity]));
    return { rosterError,
      characters: characters.map((character, index) => ({ id: character.id, realmId: character.realmId, name: character.name,
        realm: character.realm, className: character.class, level: character.level,
        cards: matches.filter(({ card }) => setById.has(String(card.setId)) && ((card.name.toLowerCase() === character.name.toLowerCase()
          && normalizeRealmSlug(card.realm) === character.realmSlug) || String(card.characterId) === String(tracked[index]?._id)))
          .map(({ card, snapshots }) => ({ ...ccg.serializeCard(card, setById.get(String(card.setId))!),
            set: ccg.serializeSet(setById.get(String(card.setId))!), snapshots,
            owned: ownedBySeries.get(`${card.setId}:${card.characterId}`) ?? 0 })) })),
    };
  }

  private async packRewards(userId: string, sources: Array<{ _id: mongoose.Types.ObjectId; cardId?: mongoose.Types.ObjectId | null }>) {
    const keys = sources.filter((source) => source.cardId).map((source) => rewardKey(source._id));
    const claimed = keys.length ? await CcgPackCredit.countDocuments({ ownerId: userId, sourceKey: { $in: keys } }) : 0;
    return { packsPerCard: CREATION_REWARD_PACKS, availablePacks: (keys.length - claimed) * CREATION_REWARD_PACKS };
  }

  async claimPacks(userId: string) {
    await supporterLimit(`claim-packs:${userId}`, 10, 60_000);
    const creator = await status.ensureCreator(userId);
    const session = await mongoose.startSession();
    let claimedPacks = 0;
    try {
      await session.withTransaction(async () => {
        claimedPacks = 0;
        // Serialize claims for this creator, including requests from different tabs.
        await CcgSupporterCreator.updateOne({ _id: creator._id }, { $inc: { __v: 1 } }, { session });
        const sources = await CcgSupporterCharacter.find({ creatorId: creator._id, cardId: { $ne: null } })
          .select("_id cardId").session(session);
        const claimed = new Set(await CcgPackCredit.distinct("sourceKey", {
          ownerId: userId, sourceKey: { $in: sources.map((source) => rewardKey(source._id)) },
        }).session(session));
        for (const source of sources) {
          const sourceKey = rewardKey(source._id);
          if (claimed.has(sourceKey)) continue;
          await CcgPackCredit.create([{ ownerId: userId, source: "supporter_creation", sourceKey, remaining: CREATION_REWARD_PACKS }], { session });
          await CcgLedgerEntry.create([{ ownerType: "user", ownerId: userId, action: "supporter_creation",
            idempotencyKey: sourceKey, amount: CREATION_REWARD_PACKS,
            metadata: { sourceId: String(source._id), cardId: String(source.cardId) } }], { session });
          claimedPacks += CREATION_REWARD_PACKS;
        }
      });
    } finally { await session.endSession(); }
    const sources = await CcgSupporterCharacter.find({ creatorId: creator._id, cardId: { $ne: null } }).select("_id cardId");
    return { claimedPacks, rewards: await this.packRewards(userId, sources) };
  }

  async create(userId: string, input: Record<string, unknown>) {
    await supporterLimit(`draft:${userId}`, 30, 60_000);
    const roster = await this.roster(userId);
    const character = roster.characters.find((entry) => entry.id === input.characterId && entry.realmId === input.realmId);
    if (!character?.realmId) throw new CcgSupporterError(403, "ownership_required");
    let profile;
    try { profile = await blizzard.getCharacterProfile(character.name, character.realmSlug, "eu"); }
    catch { throw new CcgSupporterError(422, "armory_unavailable"); }
    if (profile.id !== character.id) throw new CcgSupporterError(403, "ownership_required");
    const guild = await this.rosterGuild(character);
    const classInfo = CLASSES.find((entry) => entry.name.toLowerCase() === profile.character_class.name.toLowerCase());
    if (!classInfo) throw new CcgSupporterError(422, "invalid_spec");
    const spec = classInfo.specs.find((entry) => entry.name === slugifySpecName(profile.active_spec?.name ?? "")) ?? classInfo.specs[0];
    const identityKey = `eu:${character.realmId}:${character.id}`;
    let sourceId: string = "";
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await this.fenceAccount(userId, roster, session);
        let source = await CcgSupporterCharacter.findOne({ identityKey }).session(session);
        if (source && (String(source.creatorId) !== String(roster.creator._id) || source.cardId || source.draft)) throw new CcgSupporterError(409, "character_exists");
        const reserved = await CcgSupporterCreator.updateOne({ _id: roster.creator._id, draftCount: { $lt: SUPPORTER_DRAFT_LIMIT } }, { $inc: { draftCount: 1 } }, { session });
        if (!reserved.modifiedCount) throw new CcgSupporterError(409, "draft_limit");
        if (!source) source = new CcgSupporterCharacter({ creatorId: roster.creator._id, identityKey,
          blizzardCharacterId: character.id, realmId: character.realmId, name: profile.name, realm: profile.realm.name,
          realmSlug: profile.realm.slug, classID: classInfo.id,
          collectorKey: createWowCharacterIdentityKey("eu", profile.realm.slug, profile.name) });
        source.set(guild);
        source.set("draft", { ...source.toObject().lastRender, specName: spec.name, role: spec.role, tierGrade: "S", creatorFinish: SUPPORTER_CREATOR_FINISHES[0] });
        source.revision += 1;
        await source.save({ session });
        sourceId = String(source._id);
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new CcgSupporterError(409, "character_exists");
      throw error;
    } finally { await session.endSession(); }
    try {
      const created = await CcgSupporterCharacter.findById(sourceId).orFail();
      if (!created.draft?.renderAssetId || created.nextRenderRefreshAt <= new Date()) await this.refreshRender(userId, sourceId);
    }
    catch (error) {
      if (!(error instanceof CcgSupporterError)) throw error;
      await CcgSupporterCharacter.updateOne({ _id: sourceId }, { $set: { renderError: true } });
    }
    return this.getState(userId);
  }

  async save(userId: string, id: string, input: Record<string, unknown>) {
    await supporterLimit(`draft:${userId}`, 30, 60_000);
    const source = await this.source(userId, id);
    const proof = await this.proof(userId, source);
    const values = validateSupporterDraft(source.classID, input);
    const guild = await this.rosterGuild(proof.character);
    if (source.cardId && (values.tierGrade !== source.tierGrade || values.creatorFinish !== source.creatorFinish)) throw new CcgSupporterError(409, "rarity_locked");
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await this.fenceAccount(userId, proof, session);
        const current = await CcgSupporterCharacter.findById(source._id).session(session).orFail();
        this.checkRevision(current, input.revision);
        if (current.editsFrozen) throw new CcgSupporterError(403, "editing_frozen");
        if (!current.draft) {
          if (!current.cardId) throw new CcgSupporterError(409, "draft_changed");
          const reserved = await CcgSupporterCreator.updateOne({ _id: source.creatorId, draftCount: { $lt: SUPPORTER_DRAFT_LIMIT } }, { $inc: { draftCount: 1 } }, { session });
          if (!reserved.modifiedCount) throw new CcgSupporterError(409, "draft_limit");
          const card = await CcgCard.findById(current.cardId).session(session).orFail();
          current.set("draft", { ...values, renderUrl: card.renderUrl, renderAssetId: card.renderAssetId, renderFit: card.renderFit,
            backgroundId: values.backgroundId ?? SUPPORTER_BACKGROUNDS.find((entry) => entry.path === card.backgroundPath)?.id,
            backgroundOffsetX: values.backgroundOffsetX ?? card.backgroundCrop.x,
            avatarUrl: card.avatarUrl, mediaCapturedAt: card.mediaCapturedAt });
        } else current.set("draft", { ...current.toObject().draft, ...values });
        current.set(guild);
        current.revision += 1;
        await current.save({ session });
      });
    } finally { await session.endSession(); }
    return this.getState(userId);
  }

  async discard(userId: string, id: string, revision: unknown) {
    const creator = await status.ensureCreator(userId);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const source = await CcgSupporterCharacter.findOne({ _id: objectId(id), creatorId: creator._id }).session(session).orFail();
        this.checkRevision(source, revision);
        if (!source.draft) return;
        source.set("draft", null);
        source.revision += 1;
        await source.save({ session });
        await CcgSupporterCreator.updateOne({ _id: creator._id }, { $inc: { draftCount: -1 } }, { session });
      });
    } finally { await session.endSession(); }
    return this.getState(userId);
  }

  async refreshRender(userId: string, id: string) {
    const source = await this.source(userId, id);
    const proof = await this.proof(userId, source);
    if (!source.draft) throw new CcgSupporterError(409, "draft_required");
    const now = new Date();
    const leaseToken = randomUUID();
    await supporterLimit(`render:${source.creatorId}`, 10, 86_400_000);
    const lease = await CcgSupporterCharacter.updateOne({ _id: source._id, nextRenderRefreshAt: { $lte: now }, draft: { $ne: null }, editsFrozen: false },
      { $set: { nextRenderRefreshAt: new Date(now.getTime() + 300_000), renderLeaseToken: leaseToken } });
    if (!lease.modifiedCount) throw new CcgSupporterError(429, "render_cooldown", source.nextRenderRefreshAt);
    try {
      const [profile, media] = await Promise.all([
        blizzard.getCharacterProfile(proof.character.name, proof.character.realmSlug, "eu"),
        blizzard.getCharacterMedia(proof.character.name, proof.character.realmSlug, "eu"),
      ]);
      if (profile.id !== source.blizzardCharacterId) throw new CcgSupporterError(403, "ownership_required");
      const guild = await this.rosterGuild(proof.character);
      if (!media.mainRawUrl) throw new CcgSupporterError(422, "render_missing");
      const stored = await renders.ingest(source._id, media.mainRawUrl, now);
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await this.fenceAccount(userId, proof, session);
          const current = await CcgSupporterCharacter.findById(source._id).session(session).orFail();
          if (!current.draft || current.editsFrozen || current.renderLeaseToken !== leaseToken) throw new CcgSupporterError(409, "draft_changed");
          current.renderUnchanged = String(current.draft.renderAssetId) === String(stored.assetId);
          current.set("draft", { ...current.toObject().draft, renderUrl: stored.url, renderAssetId: stored.assetId, renderFit: stored.fit,
            avatarUrl: media.avatarUrl, mediaCapturedAt: now });
          current.set("lastRender", { renderUrl: stored.url, renderAssetId: stored.assetId, renderFit: stored.fit,
            avatarUrl: media.avatarUrl, mediaCapturedAt: now });
          current.name = profile.name; current.realm = profile.realm.name; current.realmSlug = profile.realm.slug;
          current.set(guild);
          current.nextRenderRefreshAt = new Date(Date.now() + SUPPORTER_RENDER_COOLDOWN_MS);
          current.renderError = false; current.revision += 1;
          current.renderLeaseToken = null;
          await current.save({ session });
        });
      } finally { await session.endSession(); }
    } catch (error) {
      await CcgSupporterCharacter.updateOne({ _id: source._id, renderLeaseToken: leaseToken },
        { $set: { renderError: true, renderLeaseToken: null, nextRenderRefreshAt: new Date(Date.now() + 60_000) } });
      if (error instanceof CcgSupporterError) throw error;
      throw new CcgSupporterError(422, "armory_unavailable");
    }
    return this.getState(userId);
  }

  async publish(userId: string, id: string, revision: unknown) {
    await supporterLimit(`publish:${userId}`, 5, 60_000);
    const source = await this.source(userId, id);
    const proof = await this.proof(userId, source);
    const guild = await this.rosterGuild(proof.character);
    await publisher.ensureConfiguredSets();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await this.fenceAccount(userId, proof, session);
        const current = await CcgSupporterCharacter.findById(source._id).session(session).orFail();
        if (current.lastAppliedRevision === revision && !current.draft) return;
        this.checkRevision(current, revision);
        if (current.editsFrozen) throw new CcgSupporterError(403, "editing_frozen");
        if (!current.draft?.renderAssetId) throw new CcgSupporterError(422, "render_missing");
        if (current.nextEditAt > new Date()) throw new CcgSupporterError(429, "edit_cooldown", current.nextEditAt);
        validateSupporterDraft(current.classID, current.toObject().draft!);
        current.set(guild);
        if (current.cardId) {
          const previous = await CcgCard.findById(current.cardId).select("guildId guildName guildRealm").session(session).orFail();
          await CcgCard.collection.updateOne({ _id: current.cardId, supporterCharacterId: current._id, snapshotVersion: 1 },
            { $set: this.cardFields(current) }, { session });
          const card = await CcgCard.findById(current.cardId).session(session).orFail();
          await refreshCcgCollectionReadModelsForSeries(card.setId, card.characterId, session);
          if (String(previous.guildId) !== String(card.guildId) || previous.guildName !== card.guildName || previous.guildRealm !== card.guildRealm) {
            await publisher.rebuildPool(card.setId, undefined, session);
          }
        } else {
          const allowance = await CcgSupporterCreator.updateOne({ _id: current.creatorId, $expr: { $lt: ["$usedSlots", { $add: ["$earnedSlots", SUPPORTER_BASE_SLOTS] }] } },
            { $inc: { usedSlots: 1 } }, { session });
          if (!allowance.modifiedCount) throw new CcgSupporterError(409, "no_slots");
          const set = await CcgSet.findOneAndUpdate({ zoneId: CCG_SUPPORTER_SET.zoneId, kind: "supporter" },
            { $inc: { nextSetNumber: 1, publicationWave: 1 }, $set: { lastPublishedAt: new Date() } }, { session, returnDocument: "after" }).orFail();
          const card = new CcgCard({ ...this.cardFields(current), setId: set._id, setNumber: set.nextSetNumber,
            characterId: current._id, supporterCharacterId: current._id, creatorUserId: new mongoose.Types.ObjectId(userId),
            creatorFinish: current.draft.creatorFinish, collectorKey: current.collectorKey, region: "eu", classID: current.classID,
            snapshotVersion: 1, tierGrade: current.draft.tierGrade, itemLevel: 0, parseScore: 0, survivalScore: 0,
            survivalPercentile: 0, combinedScore: 0, scoreVersion: 1,
            backgroundCrop: this.cardFields(current).backgroundCrop ?? resolveCardCrop(`${set.slug}:${current.identityKey}`, set.backgroundSafeCrop),
            performanceSnapshotAt: new Date(), sourcePartition: "supporter", publicationWave: set.publicationWave,
            gradingVersion: CCG_GRADING_VERSION, eligibilityVersion: "supporter-v1", themeVersion: CCG_THEME_VERSION });
          await card.save({ session });
          current.cardId = card._id; current.tierGrade = current.draft.tierGrade; current.creatorFinish = current.draft.creatorFinish;
          await current.save({ session });
          await ccg.grantSupporterCreator(new mongoose.Types.ObjectId(userId), card, current.creatorFinish as CcgFinish, session);
          await publisher.rebuildPool(set._id, `supporter-${set.publicationWave}`, session);
          await CcgLeaderboardInvalidation.updateOne({ key: "supporter" }, { $inc: { revision: 1 }, $setOnInsert: { completedRevision: 0 } }, { upsert: true, session });
        }
        current.lastAppliedRevision = current.revision; current.revision += 1;
        current.nextEditAt = new Date(Date.now() + 300_000); current.set("draft", null);
        await current.save({ session });
        await CcgSupporterCreator.updateOne({ _id: current.creatorId }, { $inc: { draftCount: -1 } }, { session });
      });
    } finally { await session.endSession(); }
    ccg.invalidateCardAvailabilityCaches();
    await cache.invalidatePattern(/^ccg:/);
    return this.getState(userId);
  }

  async moderate(id: string, input: Record<string, unknown>) {
    if (typeof input.editsFrozen !== "boolean" || typeof input.distributable !== "boolean") throw new CcgSupporterError(400, "invalid_character");
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const source = await CcgSupporterCharacter.findById(objectId(id)).session(session).orFail();
        source.editsFrozen = input.editsFrozen as boolean; source.distributable = input.distributable as boolean;
        await source.save({ session });
        if (source.cardId) {
          await CcgCard.collection.updateOne({ _id: source.cardId, supporterCharacterId: source._id }, {
            $set: { availabilityStatus: source.distributable ? "active" : "archived", availabilityChangedAt: new Date() },
          }, { session });
          const set = await CcgSet.findOne({ zoneId: CCG_SUPPORTER_SET.zoneId }).session(session).orFail();
          await publisher.rebuildPool(set._id, `supporter-moderation-${Date.now()}`, session);
          await CcgLeaderboardInvalidation.updateOne({ key: "supporter" }, { $inc: { revision: 1 } }, { session, upsert: true });
        }
      });
    } finally { await session.endSession(); }
    ccg.invalidateCardAvailabilityCaches();
    await cache.invalidatePattern(/^ccg:/);
    return { ok: true };
  }

  async submitMedia(userId: string, id: string, kind: SupporterMediaKind, input: Buffer) {
    const source = await this.source(userId, id);
    if (!source.cardId) throw new CcgSupporterError(409, "media_publish_first");
    const proof = await this.proof(userId, source);
    await supporterLimit(`media:${userId}`, 6, 86_400_000);
    const submission = new Media({ sourceId: source._id, userId, kind, status: "processing", purgeAfter: new Date(Date.now() + 3_600_000) });
    submission.storageKey = `supporter/${submission._id}.${kind === "image" ? "webp" : "mp3"}`;
    try { await submission.save(); }
    catch (error) {
      if ((error as { code?: number }).code === 11000) throw new CcgSupporterError(409, "media_pending");
      throw error;
    }
    try {
      const stored = await media.prepare(submission._id, kind, input);
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await this.fenceAccount(userId, proof, session);
          const current = await CcgSupporterCharacter.updateOne({ _id: source._id, creatorId: source.creatorId, editsFrozen: false }, { $inc: { __v: 1 } }, { session });
          if (!current.matchedCount) throw new CcgSupporterError(403, "editing_frozen");
          const saved = await Media.updateOne({ _id: submission._id, status: "processing", purgedAt: null }, { $set: { ...stored, status: "pending", purgeAfter: null } }, { session });
          if (!saved.matchedCount) throw new CcgSupporterError(409, "media_changed");
        });
      } finally { await session.endSession(); }
    } catch (error) {
      await Media.updateOne({ _id: submission._id, status: "processing" }, { $set: { status: "failed", reason: error instanceof CcgSupporterError ? error.code : "media_upload_failed", purgeAfter: new Date() } });
      throw error;
    }
    if (kind === "image") await media.autoReview(String(submission._id));
    return this.getState(userId);
  }

  async withdrawMedia(userId: string, id: string) {
    const creator = await status.ensureCreator(userId);
    const submission = await Media.findOne({ _id: objectId(id), userId, status: { $in: ["pending", "approved"] } });
    if (!submission || !await CcgSupporterCharacter.exists({ _id: submission.sourceId, creatorId: creator._id })) throw new CcgSupporterError(404, "invalid_media");
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const source = await CcgSupporterCharacter.updateOne({ _id: submission.sourceId, creatorId: creator._id }, { $inc: { __v: 1 } }, { session });
        if (!source.matchedCount) throw new CcgSupporterError(404, "invalid_media");
        const result = await Media.updateOne({ _id: submission._id, status: submission.status },
          { $set: { status: "withdrawn", purgeAfter: new Date(Date.now() + 7 * 86_400_000) } }, { session });
        if (!result.modifiedCount) throw new CcgSupporterError(409, "media_changed");
      });
    } finally { await session.endSession(); }
    await cache.invalidatePattern(/^ccg:/);
    return this.getState(userId);
  }
}

export default new CcgSupporterService();
