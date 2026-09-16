"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { FaCheck, FaMagnifyingGlass, FaSpinner, FaPlus } from "react-icons/fa6";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { CCG_CLASS_COLORS, CCG_RARITY_KEYS } from "@/lib/ccg";
import { formatSpecName, getClassInfoById } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import type { CcgCustomFinish, CcgTierGrade } from "@/types";
import type { StudioCreation, StudioDraft, StudioState } from "@/types/ccg-studio";
import CcgShell from "@/components/ccg/CcgShell";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import SupporterMediaUploader from "@/components/ccg/SupporterMediaUploader";
import styles from "@/components/ccg/studio.module.css";

function classStyle(classID: number): CSSProperties {
  return { "--class-color": CCG_CLASS_COLORS[classID] ?? "#c4cddd" } as CSSProperties;
}

function Editor({ source, data, pending, action, run, onDirty }: { source: StudioCreation; data: StudioState; pending: boolean; action: string | null; onDirty: (dirty: boolean) => void;
  run: (path: string, body?: Record<string, unknown>, method?: string) => Promise<unknown> }) {
  const t = useTranslations("ccg");
  const locale = useLocale();
  const [confirm, setConfirm] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirm) {
      confirmationRef.current?.focus({ preventScroll: true });
      confirmationRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [confirm]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const original: StudioDraft = source.draft ?? { specName: source.preview!.specName, role: source.preview!.role,
    tierGrade: source.tierGrade!, creatorFinish: source.creatorFinish!, performance: source.preview!.scores.performance,
    mechanics: source.preview!.scores.mechanics, mythicPlus: source.preview!.scores.mythicPlus };
  const [form, setForm] = useState<StudioDraft>(original);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  useEffect(() => {
    onDirty(dirty);
    const preventLoss = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty, onDirty]);
  const owned = data.characters.some((character) => character.id === source.characterId && character.realmId === source.realmId);
  const disabled = pending || !owned || source.editsFrozen;
  const valid = (["performance", "mechanics", "mythicPlus"] as const).every((key) => form[key] === null || (Number.isFinite(form[key]) && form[key]! >= 0 && form[key]! <= (key === "mythicPlus" ? 100000 : 100)));
  const path = `drafts/${source.id}`;
  const specs = data.classes.find((entry) => entry.id === source.classID)?.specs ?? [];
  const combined = form.performance === null || form.mechanics === null ? null : Math.round((form.performance + form.mechanics) * 5) / 10;
  const preview = source.preview ? { ...source.preview, tierGrade: form.tierGrade, specName: form.specName, role: form.role,
    metric: form.role === "healer" ? "hps" as const : "dps" as const,
    scores: { performance: form.performance, mechanics: form.mechanics, combined, mythicPlus: form.mythicPlus } } : null;
  const date = (value: string) => new Date(value).toLocaleString(locale);
  const changeScore = (key: "performance" | "mechanics" | "mythicPlus", value: string) => {
    setConfirm(false);
    setForm((previous) => ({ ...previous, [key]: value === "" ? null : Number(value) }));
  };

  return <section className={styles.editor} aria-label={t("studio.editor")} aria-busy={pending} style={classStyle(source.classID)}>
    <div className={styles.preview}>
      {preview && <CollectibleCard card={preview} finish={form.creatorFinish} width={280} />}
      <span className={styles.previewLabel}>{t("studio.livePreview")}</span>
      {source.cardId && <Link href={`/ccg/collection?set=supporter&character=${source.preview?.characterId}`}>{t("studio.viewCollection")}</Link>}
    </div>
    <div className={styles.form}>
      <div className={styles.editorHeading}><div><h2 className={styles.className}>{source.name}</h2><small>{source.realm} · {getClassInfoById(source.classID).name}</small></div>
        <span className={styles.badge} data-tone={source.cardId && !source.draft ? "success" : "draft"}>{t(source.cardId ? source.draft ? "studio.unpublishedChanges" : "studio.published" : "studio.draft")}</span></div>
      {(!owned || source.editsFrozen) && <p role="status">{t(source.editsFrozen ? "studio.errors.editing_frozen" : "studio.errors.ownership_required")}</p>}
      <fieldset disabled={disabled}>
        <div className={styles.fields}>
          <label>{t("studio.spec")}<select value={form.specName} onChange={(event) => {
            const spec = specs.find((entry) => entry.name === event.target.value)!;
            setForm((previous) => ({ ...previous, specName: spec.name, role: spec.role })); setConfirm(false);
          }}>{specs.map((spec) => <option key={spec.name} value={spec.name}>{formatSpecName(spec.name)} · {t(`role.${spec.role}`)}</option>)}</select></label>
          <label>{t("studio.rarity")}<select value={form.tierGrade} disabled={Boolean(source.cardId)} onChange={(event) => {
            setForm((previous) => ({ ...previous, tierGrade: event.target.value as CcgTierGrade })); setConfirm(false);
          }}>{Object.entries(CCG_RARITY_KEYS).map(([grade, key]) => <option key={grade} value={grade}>{t(`rarity.${key}`)}</option>)}</select></label>
          <label className={styles.wide}>{t("studio.finish")}<select value={form.creatorFinish} disabled={Boolean(source.cardId)} onChange={(event) => {
            setForm((previous) => ({ ...previous, creatorFinish: event.target.value as CcgCustomFinish })); setConfirm(false);
          }}>{data.finishes.map((finish) => <option key={finish} value={finish}>{t(`finish.${finish}`)}</option>)}</select></label>
        </div>
        {source.cardId && <p className={styles.hint}>{t("studio.locked")}</p>}
        <div className={styles.sectionHeading}><h3>{t("studio.scores")}</h3><button type="button" className={styles.textButton} onClick={() => { setForm((previous) => ({ ...previous, performance: Math.floor(Math.random() * 101), mechanics: Math.floor(Math.random() * 101) })); setConfirm(false); }}>{t("studio.randomize")}</button></div>
        <div className={styles.scoreFields}>
          {(["performance", "mechanics", "mythicPlus"] as const).map((key) => <label key={key}>{t(`studio.${key}`)}
            <input type="number" min={0} max={key === "mythicPlus" ? 100000 : 100} step="0.1" value={form[key] ?? ""}
              onChange={(event) => changeScore(key, event.target.value)} />
          </label>)}
          <label>{t("studio.combined")}<output>{combined ?? "—"}</output></label>
        </div>
        <p className={styles.hint}>{t("studio.manualScores")}</p>
      </fieldset>
      {!valid && <p className={styles.inlineError} role="alert">{t("studio.errors.invalid_scores")}</p>}
      <div className={styles.saveBar}><span className={styles.hint} role="status">{t(dirty ? "studio.unsavedShort" : source.draft ? "studio.savedDraft" : "studio.published")}</span>
        <button type="button" className={dirty ? styles.primary : undefined} disabled={disabled || !valid || (!dirty && Boolean(source.draft))} onClick={() => void run(path, { ...form, revision: source.revision }, "PATCH")}>
          {action === path && pending && <FaSpinner className={styles.spinner} aria-hidden="true" />}{t(action === path && pending ? "studio.saving" : source.draft || dirty ? "studio.save" : "studio.edit")}</button>
      </div>
      {source.draft && <>
        <div className={styles.media}>
          <button type="button" disabled={disabled || dirty || Date.parse(source.nextRenderRefreshAt) > now} onClick={() => void run(`${path}/render`)}>{action === `${path}/render` && <FaSpinner className={styles.spinner} aria-hidden="true" />}{t(action === `${path}/render` ? "studio.refreshing" : "studio.refreshRender")}</button>
          {Date.parse(source.nextRenderRefreshAt) > now && <small>{t("studio.renderCooldown", { date: date(source.nextRenderRefreshAt) })}</small>}
          {source.renderError && <p role="status">{t("studio.errors.render_missing")}</p>}
          {source.renderUnchanged && <p>{t("studio.renderUnchanged")}</p>}
        </div>
        {dirty && <p role="status">{t("studio.unsaved")}</p>}
        {!source.cardId && data.allowance.available < 1 && <p className={styles.hint}>{t("studio.noPublishSlots")}</p>}
        {Date.parse(source.nextEditAt) > now && <p>{t("studio.editCooldown", { date: date(source.nextEditAt) })}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={disabled || dirty || !preview?.renderUrl || Date.parse(source.nextEditAt) > now || (!source.cardId && data.allowance.available < 1)} onClick={() => setConfirm(true)}>{t(source.cardId ? "studio.apply" : "studio.publish")}</button>
          <button type="button" disabled={pending} onClick={() => { if (window.confirm(t("studio.confirmDiscard"))) void run(path, { revision: source.revision }, "DELETE"); }}>{t("studio.discard")}</button>
        </div>
        {confirm && <div ref={confirmationRef} tabIndex={-1} className={styles.confirm} role="alert">
          <p>{t(source.cardId ? "studio.confirmApply" : "studio.confirmPublish")}</p>
          <div className={styles.actions}><button className={styles.primary} disabled={pending} onClick={() => void run(`${path}/publish`, { revision: source.revision })}>{pending && <FaSpinner className={styles.spinner} aria-hidden="true" />}{t(pending ? "studio.publishing" : source.cardId ? "studio.apply" : "studio.publish")}</button>
            <button disabled={pending} onClick={() => setConfirm(false)}>{t("studio.cancel")}</button></div>
        </div>}
      </>}
    </div>
  </section>;
}

export default function StudioPage() {
  const { user, login, isLoading } = useAuth();
  const t = useTranslations("ccg");
  const locale = useLocale();
  const client = useQueryClient();
  const key = ["ccg", "studio", user?.discord.username];
  const [tab, setTab] = useState<"characters" | "creations">("characters");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creationFilter, setCreationFilter] = useState<"all" | "drafts" | "published">("all");
  const [connecting, setConnecting] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const focusWorkspace = useRef(false);
  useEffect(() => {
    if (error) {
      errorRef.current?.focus({ preventScroll: true });
      errorRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [error]);
  const dirtyRef = useRef(false);
  const onDirty = useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);
  const switchView = (nextTab: "characters" | "creations", nextSelection = selected) => {
    if (nextTab === tab && nextSelection === selected) return;
    if (dirtyRef.current && !window.confirm(t("studio.discardUnsaved"))) return;
    dirtyRef.current = false; focusWorkspace.current = nextTab === "creations"; setSelected(nextSelection); setTab(nextTab); setNotice(null);
  };
  useEffect(() => {
    if (!focusWorkspace.current) return;
    focusWorkspace.current = false;
    workspaceRef.current?.focus({ preventScroll: true });
    workspaceRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [selected, tab, notice, error]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const query = useQuery({ queryKey: key, queryFn: () => api.getCcgStudio(), enabled: Boolean(user), staleTime: 60_000, refetchOnWindowFocus: false,
    refetchInterval: (current) => current.state.data?.media?.some((row) => row.status === "pending" || row.status === "processing") ? 60_000 : false });
  const data = query.data;
  const mutation = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body: Record<string, unknown>; method: string }) => api.updateCcgStudio(path, body, method),
    onSuccess: (next, input) => {
      client.setQueryData(key, next); setError(null);
      if (input.path.startsWith("drafts")) dirtyRef.current = false;
      if (input.path === "drafts") {
        focusWorkspace.current = true; setCreationFilter("all");
        setSelected(next.creations.find((entry) => entry.characterId === input.body.characterId && entry.realmId === input.body.realmId)?.id ?? null); setTab("creations");
      }
      setNotice(input.path === "drafts" ? "created" : input.method === "DELETE" ? "discarded" : input.path.endsWith("/publish")
        ? data?.creations.find((entry) => input.path.includes(entry.id))?.cardId ? "applied" : "published"
        : input.path.endsWith("/render") ? "appearanceRefreshed" : input.path === "status" ? "statusChecked" : input.path === "roster" ? "rosterRefreshed" : "saved");
      if (input.path.endsWith("/publish")) {
        focusWorkspace.current = true;
        void client.invalidateQueries({ predicate: (item) => item.queryKey[0] === "ccg" && item.queryKey[1] !== "studio" });
      }
    },
    onError: (failure) => setError(failure instanceof ApiError && failure.code ? failure.code : "studio_unavailable"),
  });
  const run = async (path: string, body: Record<string, unknown> = {}, method = "POST") => {
    setError(null); setNotice(null);
    try { return await mutation.mutateAsync({ path, body, method }); } catch { return undefined; }
  };
  const connect = async (provider: "twitch" | "battlenet") => {
    if (dirtyRef.current && !window.confirm(t("studio.discardUnsaved"))) return;
    setConnecting(true); setError(null);
    try { const result = provider === "twitch" ? await api.getTwitchConnectUrl("/ccg/studio") : await api.getBattleNetConnectUrl("/ccg/studio"); window.location.assign(result.url); }
    catch { setError("connection_failed"); setConnecting(false); }
  };
  const errorText = (code: string) => t.has(`studio.errors.${code}`) ? t(`studio.errors.${code}`) : t("studio.errors.studio_unavailable");
  const statusText = (value: boolean | null) => t(value === null ? "studio.unknown" : value ? "studio.yes" : "studio.no");
  const activePath = mutation.isPending ? mutation.variables.path : null;
  const creatingCharacter = activePath === "drafts" ? data?.characters.find((character) => character.id === mutation.variables?.body.characterId && character.realmId === mutation.variables?.body.realmId) : null;
  const visibleCharacters = data?.characters.filter((character) => `${character.name} ${character.realm} ${character.className}`.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale))) ?? [];
  const visibleCreations = data?.creations.filter((source) => creationFilter === "all" || (creationFilter === "drafts" ? source.draft : source.cardId)) ?? [];
  const selection = visibleCreations.find((entry) => entry.id === selected) ?? visibleCreations[0];

  return <CcgShell><div className={styles.studio}>
    <header className={styles.heading}><div><h1>{t("studio.title")}</h1><p>{t("studio.description")}</p></div>
      {data && <div className={styles.capacity}><strong>{data.allowance.available}<span>{t("studio.availableSlots")}</span></strong><span>{t("studio.drafts", { count: data.allowance.drafts, limit: data.allowance.draftLimit })}</span></div>}
    </header>
    {isLoading ? <p role="status">{t("studio.loading")}</p> : !user ? <div className={styles.empty}><h2>{t("studio.signInTitle")}</h2><p>{t("studio.signInDescription")}</p><button className={styles.primary} onClick={() => void login("/ccg/studio")}>{t("studio.signIn")}</button></div> : <>
      {query.isLoading && <div className={styles.loading} role="status"><FaSpinner className={styles.spinner} aria-hidden="true" />{t("studio.loading")}</div>}
      {(error || query.error) && <div ref={errorRef} tabIndex={-1} className={styles.error} role="alert">{errorText(error ?? "studio_unavailable")}<button onClick={() => { setError(null); void query.refetch(); }}>{t("studio.reload")}</button></div>}
      {data && <>
        <div className={styles.connections}>
          <details className={styles.connection} open={!data.battlenetConnected}>
            <summary><strong>Battle.net <small>EU</small></strong><span className={styles.badge} data-tone={data.rosterError ? "draft" : data.battlenetConnected ? "success" : undefined}>{t(data.rosterError ? "studio.needsAttention" : data.battlenetConnected ? "studio.connected" : "studio.notConnected")}</span></summary>
            {!data.battlenetConnected && <p>{t("studio.bnetRequired")}</p>}
            {data.rosterError && <p role="status">{errorText(data.rosterError)}</p>}
            <div className={styles.actions}><button disabled={connecting || mutation.isPending} onClick={() => void connect("battlenet")}>{t(data.battlenetConnected ? "studio.reconnect" : "studio.connect")}</button>
              {data.battlenetConnected && <button disabled={mutation.isPending} onClick={() => void run("roster")}>{t(activePath === "roster" ? "studio.refreshing" : "studio.refreshCharacters")}</button>}</div>
          </details>
          <details className={styles.connection} open={!data.twitchConnected}>
            <summary><strong>Twitch <small>vaarattu</small></strong><span className={styles.badge} data-tone={data.status.error ? "draft" : data.twitchConnected ? "success" : undefined}>{t(data.status.error ? "studio.needsAttention" : !data.twitchConnected ? "studio.notConnected" : data.status.subscribed ? "studio.subscriber" : data.status.following ? "studio.follower" : "studio.connected")}</span></summary>
            {data.twitchConnected && <p>{t("studio.following", { status: statusText(data.status.following) })} · {t("studio.subscribed", { status: statusText(data.status.subscribed) })}</p>}
            {data.status.checkedAt && <small>{t("studio.checked", { date: new Date(data.status.checkedAt).toLocaleString(locale) })}</small>}
            {data.status.error && <p role="status">{errorText(data.status.error)}</p>}
            <div className={styles.actions}><button disabled={connecting || mutation.isPending} onClick={() => void connect("twitch")}>{t(data.twitchConnected ? "studio.reconnect" : "studio.connect")}</button>
              {data.twitchConnected && <button disabled={mutation.isPending || Date.parse(data.status.nextManualCheckAt) > now} onClick={() => void run("status")}>{t(activePath === "status" ? "studio.checking" : "studio.refreshStatus")}</button>}</div>
            {data.twitchConnected && Date.parse(data.status.nextManualCheckAt) > now && <p className={styles.hint}>{t("studio.statusCooldown", { date: new Date(data.status.nextManualCheckAt).toLocaleTimeString(locale) })}</p>}
          </details>
          <details className={styles.rules}><summary>{t("studio.slotRules")}</summary><p>{t("studio.allowanceRules")}</p><p>{t("studio.permanent")}</p></details>
        </div>
        <nav className={styles.tabs} aria-label={t("studio.views")}>
          <button aria-pressed={tab === "characters"} disabled={mutation.isPending} onClick={() => switchView("characters")}>{t("studio.characters")}<span>{data.characters.length}</span></button>
          <button aria-pressed={tab === "creations"} disabled={mutation.isPending} onClick={() => switchView("creations")}>{t("studio.creations")}<span>{data.creations.length}</span></button>
        </nav>
        <div ref={workspaceRef} tabIndex={-1} className={styles.workspace}>
          <div className={styles.feedback} role="status" aria-live="polite">
            {mutation.isPending ? <><FaSpinner className={styles.spinner} aria-hidden="true" />{creatingCharacter ? t("studio.creatingCharacter", { name: creatingCharacter.name }) : t("studio.working")}</>
              : notice ? <><FaCheck aria-hidden="true" />{t(`studio.feedback.${notice}`)}</> : null}
          </div>
          {tab === "characters" ? <>
            <div className={styles.toolbar}><label className={styles.search}><FaMagnifyingGlass aria-hidden="true" /><input type="search" aria-label={t("studio.searchCharacters")} placeholder={t("studio.searchCharacters")} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              <span className={styles.hint}>{t("studio.characterCount", { count: visibleCharacters.length, total: data.characters.length })}</span>
            </div>
            {data.allowance.drafts >= data.allowance.draftLimit && <p className={styles.inlineError}>{t("studio.draftLimitReached", { limit: data.allowance.draftLimit })}</p>}
            {visibleCharacters.length === 0 && <div className={styles.empty}><p>{t(data.characters.length ? "studio.noMatches" : "studio.noCharacters")}</p>{search && <button onClick={() => setSearch("")}>{t("studio.clearSearch")}</button>}</div>}
            <div className={styles.characters}>{visibleCharacters.map((character) => {
              const creation = data.creations.find((entry) => entry.characterId === character.id && entry.realmId === character.realmId);
              const classID = data.classes.find((entry) => entry.name === character.className)?.id ?? 0;
              const creating = creatingCharacter?.id === character.id && creatingCharacter?.realmId === character.realmId;
              return <section key={`${character.realmId}:${character.id}`} className={styles.character} style={classStyle(classID)} aria-busy={creating}>
                <div className={styles.characterHeader}><IconImage iconFilename={getClassInfoById(classID).iconUrl} alt="" width={36} height={36} />
                  <div className={styles.characterIdentity}><h2 className={styles.className}>{character.name}</h2><small>{character.realm}</small><span className={styles.className}>{character.className} · {character.level}</span></div>
                  {creation && <span className={styles.badge} data-tone={creation.cardId ? "success" : "draft"}>{t(creation.cardId ? "studio.published" : "studio.draft")}</span>}
                </div>
                <div className={styles.characterFooter}><span className={styles.hint}>{t("studio.raidCards", { count: character.cards.length })}</span>
                  <button className={creation ? styles.textButton : undefined} disabled={mutation.isPending || (!creation && data.allowance.drafts >= data.allowance.draftLimit)} onClick={() => creation ? (setCreationFilter("all"), switchView("creations", creation.id)) : void run("drafts", { characterId: character.id, realmId: character.realmId })}>
                    {creating ? <FaSpinner className={styles.spinner} aria-hidden="true" /> : !creation ? <FaPlus aria-hidden="true" /> : null}{t(creating ? "studio.creating" : creation ? "studio.openCreation" : "studio.create")}</button>
                </div>
                {character.cards.length > 0 && <details className={styles.catalogue}><summary>{t("studio.browseCards")}</summary><div>{character.cards.map((card) => <Link key={card.id} href={`/ccg/collection?set=${card.set.slug}&character=${card.characterId}`}>
                  <strong>{card.set.raidName}</strong><span>{t("studio.catalogueCard", { snapshots: card.snapshots, owned: card.owned })}</span>
                </Link>)}</div></details>}
              </section>;
            })}</div>
          </> : data.creations.length === 0 ? <div className={styles.empty}><h2>{t("studio.noCreationsTitle")}</h2><p>{t("studio.noCreations")}</p><button className={styles.primary} onClick={() => switchView("characters")}>{t("studio.chooseCharacter")}</button></div> : <div className={styles.creationWorkspace}>
            <aside className={styles.creationSidebar} aria-label={t("studio.creations")}>
              <label className={styles.filterLabel}>{t("studio.showCreations")}<select value={creationFilter} disabled={mutation.isPending} onChange={(event) => {
                const filter = event.target.value as typeof creationFilter;
                const choices = data.creations.filter((source) => filter === "all" || (filter === "drafts" ? source.draft : source.cardId));
                const next = choices.find((source) => source.id === selection?.id) ?? choices[0];
                if (next?.id !== selection?.id) {
                  if (dirtyRef.current && !window.confirm(t("studio.discardUnsaved"))) return;
                  dirtyRef.current = false;
                }
                setSelected(next?.id ?? null); setCreationFilter(filter);
              }}>
                {(["all", "drafts", "published"] as const).map((filter) => <option key={filter} value={filter}>{t(`studio.filter.${filter}`)}</option>)}
              </select></label>
              <div className={styles.creationList}>{visibleCreations.map((source) => <button key={source.id} style={classStyle(source.classID)} aria-pressed={selection?.id === source.id} disabled={mutation.isPending} onClick={() => switchView("creations", source.id)}>
                <IconImage iconFilename={getClassInfoById(source.classID).iconUrl} alt="" width={28} height={28} /><span><strong className={styles.className}>{source.name}</strong><small>{source.realm}</small><span className={styles.creationStatus} data-tone={source.draft ? "draft" : "success"}>{t(source.cardId ? source.draft ? "studio.unpublishedChanges" : "studio.published" : "studio.draft")}</span></span>
              </button>)}</div>
              {visibleCreations.length === 0 && <p className={styles.hint}>{t("studio.noMatchingCreations")}</p>}
              <button className={styles.textButton} disabled={mutation.isPending} onClick={() => switchView("characters")}><FaPlus aria-hidden="true" />{t("studio.newCard")}</button>
            </aside>
            <div className={styles.creationContent}>
              {!selection && <div className={styles.empty}><p>{t("studio.noMatchingCreations")}</p></div>}
              {selection?.preview && <Editor key={`${selection.id}:${selection.revision}`} source={selection} data={data} pending={mutation.isPending} action={mutation.variables?.method === "DELETE" ? null : activePath} run={run} onDirty={onDirty} />}
              {selection?.cardId && <SupporterMediaUploader key={selection.id} source={selection} media={data.media ?? []}
                disabled={selection.editsFrozen || !data.characters.some((character) => character.id === selection.characterId && character.realmId === selection.realmId)} />}
            </div>
          </div>}
        </div>
      </>}
    </>}
  </div></CcgShell>;
}
