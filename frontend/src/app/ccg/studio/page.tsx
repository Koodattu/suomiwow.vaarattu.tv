"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { FaCheck, FaChevronDown, FaLock, FaMagnifyingGlass, FaPlus, FaSpinner, FaTwitch, FaXmark } from "react-icons/fa6";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { CCG_CLASS_COLORS } from "@/lib/ccg";
import { getStudioSlots } from "@/lib/ccg-studio";
import { getClassInfoById } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import type { StudioState, StudioOverview } from "@/types/ccg-studio";
import CcgShell from "@/components/ccg/CcgShell";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import StudioEditor from "@/components/ccg/StudioEditor";
import StudioAccounts from "@/components/ccg/StudioAccounts";
import type { StudioAccountPanel, StudioFeedback } from "@/components/ccg/StudioAccounts";
import StudioRewardsDialog from "@/components/ccg/StudioRewardsDialog";
import StudioLoading from "@/components/ccg/StudioLoading";
import StudioRaidGallery from "@/components/ccg/StudioRaidGallery";
import styles from "@/components/ccg/studio.module.css";
import cardStyles from "@/components/ccg/ccg.module.css";

type Workspace = { kind: "choose"; slotId: string | null } | { kind: "edit"; sourceId: string } | null;
type Character = StudioState["characters"][number];
const characterKey = (character: Pick<Character, "realmId" | "id">) => `${character.realmId}:${character.id}`;

export default function StudioPage() {
  const { user, login, isLoading } = useAuth();
  const t = useTranslations("ccg");
  const locale = useLocale();
  const client = useQueryClient();
  const key = ["ccg", "studio", user?.discord.username];
  const [workspace, setWorkspace] = useState<Workspace>(null);
  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<StudioFeedback | null>(null);
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<StudioAccountPanel | null>(null);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [savedDrafts, setSavedDrafts] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const characterButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusWorkspace = useRef(false);
  const dirtyRef = useRef(false);
  const requestRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    if (error) {
      setAccounts("battlenet");
      const errorKey = t.has(`studio.errors.${error}`) ? `studio.errors.${error}` : "studio.errors.battlenet_failed";
      setFeedback({ path: "battlenet", message: t(errorKey), error: true, code: error });
    } else if (params.get("connected") === "battlenet") {
      setAccounts("battlenet");
      setFeedback({ path: "battlenet", message: t("studio.feedback.battlenetConnected") });
    } else return;
    window.history.replaceState(null, "", "/ccg/studio");
  }, [t]);
  const onDirty = useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);
  useEffect(() => {
    if (feedback?.error && feedback.characterKey) characterButtons.current[feedback.characterKey]?.focus({ preventScroll: true });
  }, [feedback]);
  useEffect(() => {
    if (!focusWorkspace.current || !workspace) return;
    focusWorkspace.current = false;
    workspaceRef.current?.focus({ preventScroll: true });
    workspaceRef.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [workspace]);
  const query = useQuery({ queryKey: key, queryFn: () => api.getCcgStudio(), enabled: Boolean(user), staleTime: 60_000, refetchOnWindowFocus: false,
    refetchInterval: (current) => current.state.data?.media?.some((row) => row.status === "pending" || row.status === "processing") ? 60_000 : false });
  const charactersKey = ["ccg", "studio-characters", user?.discord.username];
  const charactersQuery = useQuery({ queryKey: charactersKey, queryFn: () => api.getCcgStudioCharacters(),
    enabled: Boolean(user && query.data?.battlenetConnected), staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  const rosterMutation = useMutation({ mutationFn: () => api.getCcgStudioCharacters(true) });
  const charactersLoading = Boolean(query.data?.battlenetConnected && !charactersQuery.data && charactersQuery.isPending);
  const data: StudioState | undefined = query.data ? { ...query.data,
    characters: query.data.battlenetConnected ? charactersQuery.data?.characters ?? [] : [],
    rosterError: query.data.battlenetConnected ? charactersQuery.error ? "armory_unavailable" : charactersQuery.data?.rosterError ?? null : null } : undefined;
  const slots = data ? getStudioSlots(data, placements) : [];
  const selection = workspace?.kind === "edit" ? data?.creations.find((source) => source.id === workspace.sourceId) : null;
  const drafts = data?.creations.filter((source) => source.draft) ?? [];
  const mutation = useMutation({ mutationFn: ({ path, body, method }: { path: string; body: Record<string, unknown>; method: string }) => api.updateCcgStudio(path, body, method) });
  const busy = mutation.isPending || rosterMutation.isPending || creating !== null;
  const activePath = rosterMutation.isPending ? "roster" : mutation.isPending ? mutation.variables.path : null;
  const errorText = (failure: unknown) => {
    const code = failure instanceof ApiError ? failure.code : typeof failure === "string" ? failure : null;
    return code && t.has(`studio.errors.${code}`) ? t(`studio.errors.${code}`) : t("studio.errors.studio_unavailable");
  };
  const rememberSlots = () => Object.fromEntries(slots.flatMap((slot) => slot.creation ? [[slot.creation.id, slot.id]] : []));
  const switchWorkspace = (next: Workspace) => {
    if (requestRef.current) return;
    if (workspace?.kind === "edit" && next?.kind === "edit" && workspace.sourceId === next.sourceId) return;
    if (dirtyRef.current && !window.confirm(t("studio.discardUnsaved"))) return;
    dirtyRef.current = false;
    setPlacements(rememberSlots());
    setFeedback(null);
    focusWorkspace.current = true;
    setWorkspace(next);
  };
  const run = async (path: string, body: Record<string, unknown> = {}, method = "POST") => {
    if (requestRef.current) return;
    requestRef.current = true;
    setFeedback(null);
    try {
      if (path === "roster") {
        await client.cancelQueries({ queryKey: charactersKey });
        const characters = await rosterMutation.mutateAsync();
        client.setQueryData(charactersKey, characters);
        setFeedback({ path, message: characters.rosterError ? errorText(characters.rosterError) : t("studio.feedback.rosterRefreshed"), error: Boolean(characters.rosterError), code: characters.rosterError ?? undefined });
        return query.data;
      }
      const next = await mutation.mutateAsync({ path, body, method });
      client.setQueryData(key, next);
      const message = method === "DELETE" ? "discarded" : path.endsWith("/publish") ? selection?.cardId ? "applied" : "published"
        : path.endsWith("/render") ? "appearanceRefreshed" : path === "status" ? "statusChecked" : path === "roster" ? "rosterRefreshed" : "saved";
      setFeedback({ path, message: t(`studio.feedback.${message}`) });
      if (method === "DELETE" && selection && !next.creations.some((source) => source.id === selection.id)) {
        setWorkspace({ kind: "choose", slotId: slots.find((slot) => slot.creation?.id === selection.id)?.id ?? null });
      }
      if (path.endsWith("/publish")) void client.invalidateQueries({ predicate: (item) => item.queryKey[0] === "ccg" && item.queryKey[1] !== "studio" });
      return next;
    } catch (failure) { setFeedback({ path, message: errorText(failure), error: true, code: failure instanceof ApiError ? failure.code : undefined }); }
    finally { requestRef.current = false; }
  };
  const chooseCharacter = async (character: Character) => {
    if (requestRef.current || !data) return;
    const existing = data.creations.find((source) => source.characterId === character.id && source.realmId === character.realmId);
    if (existing) { switchWorkspace({ kind: "edit", sourceId: existing.id }); return; }
    requestRef.current = true;
    const targetSlot = workspace?.kind === "choose" ? workspace.slotId : null;
    const placed = rememberSlots();
    setCreating(characterKey(character));
    setFeedback(null);
    try {
      // A lost response may have left a saved draft. Reconcile before repeating creation.
      const retrying = feedback?.error && feedback.path === "drafts" && feedback.characterKey === characterKey(character);
      const current = retrying ? await api.getCcgStudio() : data;
      client.setQueryData(key, current);
      const recovered = current.creations.find((source) => source.characterId === character.id && source.realmId === character.realmId);
      const next = recovered ? current : await mutation.mutateAsync({ path: "drafts", body: { characterId: character.id, realmId: character.realmId }, method: "POST" });
      client.setQueryData(key, next);
      const source = next.creations.find((entry) => entry.characterId === character.id && entry.realmId === character.realmId);
      if (!source) throw new Error("Missing creation");
      setPlacements({ ...placed, ...(targetSlot ? { [source.id]: targetSlot } : {}) });
      focusWorkspace.current = true;
      setWorkspace({ kind: "edit", sourceId: source.id });
    } catch (failure) { setFeedback({ path: "drafts", characterKey: characterKey(character), message: errorText(failure), error: true }); }
    finally { requestRef.current = false; setCreating(null); }
  };
  const connect = async (provider: "twitch" | "battlenet") => {
    if (dirtyRef.current && !window.confirm(t("studio.discardUnsaved"))) return;
    setAccounts(provider); setConnecting(true); setFeedback(null);
    try {
      const result = provider === "twitch" ? await api.getTwitchConnectUrl("/ccg/studio") : await api.getBattleNetConnectUrl("/ccg/studio");
      window.location.assign(result.url);
    } catch { setFeedback({ path: provider, message: t("studio.errors.connection_failed"), error: true }); setConnecting(false); }
  };
  const visibleCharacters = data?.characters.filter((character) => `${character.name} ${character.realm} ${character.className}`.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale))) ?? [];

  return <CcgShell><div className={styles.studio}>
    <header className={styles.heading}>
      <h1>{t("studio.title")}</h1>
      {data && <small className={styles.slotCount}>{t("studio.slots", { available: data.allowance.available, earned: data.allowance.earned })}</small>}
      {data && <div className={styles.accountLinks}>
        {(["battlenet", "twitch", "rules"] as const).map((panel) => <button key={panel} aria-expanded={accounts === panel} aria-controls="studio-accounts" onClick={() => setAccounts(accounts === panel ? null : panel)}>
          {panel === "twitch" && <FaTwitch aria-hidden="true" />}{panel === "rules" ? t("studio.slotRules") : panel === "battlenet" ? "Battle.net" : "Twitch"}
          {panel === "rules" ? <FaChevronDown aria-hidden="true" /> : <><span className={styles.connectionDot} data-connected={panel === "battlenet" ? data.battlenetConnected && !data.rosterError : data.twitchConnected && !data.status.error} /><span className={styles.srOnly}>{t(panel === "battlenet" ? data.rosterError ? "studio.needsAttention" : data.battlenetConnected ? "studio.connected" : "studio.notConnected" : data.status.error ? "studio.needsAttention" : data.twitchConnected ? "studio.connected" : "studio.notConnected")}</span></>}
        </button>)}
      </div>}
      {data && <div className={styles.headerActions}>
        <button className={styles.textButton} aria-expanded={savedDrafts} aria-controls="studio-drafts" onClick={() => setSavedDrafts(!savedDrafts)}>{t("studio.drafts", { count: data.allowance.drafts, limit: data.allowance.draftLimit })}<FaChevronDown aria-hidden="true" /></button>
        <button className={data.rewards.availablePacks > 0 ? styles.primary : undefined} aria-haspopup="dialog" onClick={() => setRewardsOpen(true)}>
          {t("studio.rewards.title")}{data.rewards.availablePacks > 0 && <span className={styles.rewardBadge}>{data.rewards.availablePacks}</span>}
        </button>
      </div>}
    </header>
    {rewardsOpen && data && <StudioRewardsDialog rewards={data.rewards} close={() => setRewardsOpen(false)} onClaim={(result) => {
      client.setQueryData<StudioOverview>(key, (previous) => previous ? { ...previous, rewards: result.rewards } : previous);
      void client.invalidateQueries({ queryKey: key, exact: true });
      void client.invalidateQueries({ predicate: (item) => item.queryKey[0] === "ccg" && !String(item.queryKey[1]).startsWith("studio") });
    }} />}
    {(isLoading || (user && query.isPending)) && <StudioLoading label={t("studio.loading")} />}
    {accounts && data && <StudioAccounts panel={accounts} data={data} busy={busy} connecting={connecting} action={activePath} feedback={feedback} connect={(provider) => void connect(provider)} run={run} close={() => setAccounts(null)} />}
    {isLoading ? null : !user ? <div className={styles.empty}><h2>{t("studio.signInTitle")}</h2><p>{t("studio.signInDescription")}</p><button className={styles.primary} onClick={() => void login("/ccg/studio")}>{t("studio.signIn")}</button></div> : <>
      {query.error && <div className={styles.error} role="alert">{errorText(query.error)}<button onClick={() => void query.refetch()}>{t("studio.reload")}</button></div>}
      {data && <>
        <section className={styles.shelf} aria-label={t("studio.supporterCard")}>
          <div className={styles.slotGrid}>{slots.map((slot, index) => {
            const source = slot.creation;
            const approvedArt = source?.cardId ? data.media.find((row) => row.sourceId === source.id && row.kind === "image" && row.status === "approved")?.url : null;
            const alternativeArt = approvedArt ? { characterArtPath: approvedArt, characterArtFilename: null, characterArtEnabled: true,
              backgroundArtPath: null, backgroundArtFilename: null, backgroundArtEnabled: false } : null;
            const selected = workspace?.kind === "choose" ? workspace.slotId === slot.id : workspace?.kind === "edit" && source?.id === workspace.sourceId;
            return <div key={slot.id} className={styles.slot} data-selected={selected} data-locked={Boolean(slot.unlock)}>
              <button className={source?.preview ? styles.filledSlot : styles.emptySlot} aria-pressed={Boolean(selected)} aria-controls={slot.unlock ? "studio-accounts" : "studio-workspace"}
                disabled={busy || (slot.used && !source)} onClick={() => slot.unlock ? setAccounts("twitch") : switchWorkspace(source ? { kind: "edit", sourceId: source.id } : { kind: "choose", slotId: slot.id })}>
                {source?.preview ? <><CollectibleCard card={{ ...source.preview, alternativeArt }} artVariant={alternativeArt ? "alternative" : "standard"} finish={source.draft?.creatorFinish ?? source.creatorFinish ?? "standard"} compact effectsPaused className={cardStyles.scaledCardTypography} />
                  <span className={styles.slotBadge} data-tone={source.draft ? "draft" : "success"}>{t(source.cardId ? source.draft ? "studio.unpublishedChanges" : "studio.published" : "studio.draft")}</span><span className={styles.srOnly}>{t("studio.openCreation")} {source.name}</span></>
                  : <><span className={styles.slotNumber}>{String(index + 1).padStart(2, "0")}</span><span className={styles.slotIcon}>{slot.unlock ? <FaLock aria-hidden="true" /> : slot.used ? <FaCheck aria-hidden="true" /> : <FaPlus aria-hidden="true" />}</span>
                    <strong>{t(slot.unlock === "follower" ? "studio.followUnlock" : slot.unlock === "subscriber" ? "studio.subscribeUnlock" : slot.used ? "studio.published" : "studio.createCard")}</strong>
                    <small>{slot.unlock ? <FaTwitch aria-hidden="true" /> : t("studio.supporterCard")}</small></>}
              </button>
            </div>;
          })}</div>
          {savedDrafts && <div id="studio-drafts" className={styles.draftDrawer}><div className={styles.sectionHeading}><p>{t("studio.draftExplanation")}</p><button disabled={busy || data.allowance.drafts >= data.allowance.draftLimit} onClick={() => switchWorkspace({ kind: "choose", slotId: null })}><FaPlus aria-hidden="true" />{t("studio.newDraft")}</button></div>
            {drafts.length ? <div className={styles.draftList}>{drafts.map((source) => <button key={source.id} disabled={busy} aria-pressed={selection?.id === source.id} onClick={() => switchWorkspace({ kind: "edit", sourceId: source.id })}><strong>{source.name}</strong><small>{source.realm}</small><span className={styles.badge} data-tone="draft">{t(source.cardId ? "studio.unpublishedChanges" : "studio.draft")}</span></button>)}</div> : <p>{t("studio.noSavedDrafts")}</p>}
          </div>}
        </section>
        {(!data.battlenetConnected || data.rosterError) && <div className={styles.connectionPrompt}><div><strong>{t(data.battlenetConnected ? "studio.needsAttention" : "studio.findCharacters")}</strong><p>{data.rosterError ? errorText(data.rosterError) : t("studio.connectDescription")}</p></div><button disabled={connecting || busy} onClick={() => data.battlenetConnected ? setAccounts("battlenet") : void connect("battlenet")}>{t(data.battlenetConnected ? "studio.manageConnection" : "studio.connectBnet")}</button></div>}
        {workspace && <div id="studio-workspace" ref={workspaceRef} tabIndex={-1} role="region" aria-labelledby="studio-workspace-heading" className={styles.workspace}>
          <div className={styles.workbenchHeading}><div><span className={styles.eyebrow}>{t("studio.workbench")}</span><h2 id="studio-workspace-heading">{workspace.kind === "choose" ? t("studio.chooseCharacter") : selection?.name ?? t("studio.editor")}</h2></div>
            <button disabled={busy} onClick={() => switchWorkspace(null)} aria-label={t("studio.closeEditor")}><FaXmark aria-hidden="true" /></button></div>
          {workspace.kind === "choose" ? <div className={styles.picker}>
            {feedback && !feedback.error && feedback.path.startsWith("drafts/") && <p className={styles.success} role="status">{feedback.message}</p>}
            {charactersLoading ? <div className={styles.sectionLoading} role="status"><FaSpinner className={styles.spinner} aria-hidden="true" />{t("studio.loadingCharacters")}</div> : !data.battlenetConnected ? <div className={styles.empty}><p>{t("studio.bnetRequired")}</p><button disabled={connecting} className={styles.primary} onClick={() => void connect("battlenet")}>{t("studio.connectBnet")}</button></div> : <>
              <div className={styles.toolbar}><label className={styles.search}><FaMagnifyingGlass aria-hidden="true" /><input type="search" disabled={busy} aria-label={t("studio.searchCharacters")} placeholder={t("studio.searchCharacters")} value={search} onChange={(event) => setSearch(event.target.value)} /></label><span className={styles.hint}>{t("studio.characterCount", { count: visibleCharacters.length, total: data.characters.length })}</span></div>
              {data.allowance.drafts >= data.allowance.draftLimit && <p className={styles.inlineError}>{t("studio.draftLimitReached", { limit: data.allowance.draftLimit })}</p>}
              {visibleCharacters.length === 0 && <div className={styles.empty}><p>{t(data.characters.length ? "studio.noMatches" : "studio.noCharacters")}</p><button onClick={() => search ? setSearch("") : setAccounts("battlenet")}>{t(search ? "studio.clearSearch" : "studio.manageConnection")}</button></div>}
              <div className={styles.characters}>{visibleCharacters.map((character) => {
                const creation = data.creations.find((entry) => entry.characterId === character.id && entry.realmId === character.realmId);
                const classID = data.classes.find((entry) => entry.name === character.className)?.id ?? 0;
                const loading = creating === characterKey(character);
                const failure = feedback?.path === "drafts" && feedback.characterKey === characterKey(character) ? feedback : null;
                return <div key={characterKey(character)} className={styles.character} data-loading={loading} style={{ "--class-color": CCG_CLASS_COLORS[classID] ?? "#c4cddd" } as CSSProperties}>
                  <button ref={(element) => { characterButtons.current[characterKey(character)] = element; }} className={styles.characterSelect} disabled={busy || (!creation && data.allowance.drafts >= data.allowance.draftLimit)} aria-busy={loading} onClick={() => void chooseCharacter(character)}>
                    <IconImage iconFilename={getClassInfoById(classID).iconUrl} alt="" width={30} height={30} /><span className={styles.characterIdentity}><strong className={styles.className}>{character.name}</strong><small>{character.realm} · {character.className} · {character.level}</small></span>
                    <span className={styles.characterAction}>{loading ? <FaSpinner className={styles.spinner} aria-hidden="true" /> : creation ? t(creation.cardId ? "studio.openCreation" : "studio.resumeDraft") : failure ? t("studio.retry") : <FaPlus aria-hidden="true" />}</span>
                    {!creation && !failure && <span className={styles.srOnly}>{t("studio.createCard")}</span>}
                  </button>
                  {loading && <p className={styles.characterFeedback} role="status">{t("studio.loadingArmory", { name: character.name })}</p>}
                  {failure && <p className={`${styles.characterFeedback} ${styles.inlineError}`} role="alert">{failure.message}</p>}
                </div>;
              })}</div>
            </>}
          </div> : selection?.preview ? <>
            <StudioEditor key={selection.id} source={selection} data={data} pending={busy} action={mutation.variables?.method === "DELETE" ? null : activePath} run={run} onDirty={onDirty}
              feedback={feedback?.path.startsWith(`drafts/${selection.id}`) ? feedback : null} />
          </> : <div className={styles.empty}><p>{t("studio.errors.character_not_found")}</p><button onClick={() => void query.refetch()}>{t("studio.reload")}</button></div>}
        </div>}
        {charactersLoading ? <div className={styles.sectionLoading} role="status"><FaSpinner className={styles.spinner} aria-hidden="true" />{t("studio.loadingCharacters")}</div>
          : charactersQuery.error ? <div className={styles.error} role="alert">{errorText(charactersQuery.error)}<button onClick={() => void charactersQuery.refetch()}>{t("studio.reload")}</button></div>
          : <StudioRaidGallery data={data} />}
      </>}
    </>}
  </div></CcgShell>;
}
