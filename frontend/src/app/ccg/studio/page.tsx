"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { CCG_RARITY_KEYS } from "@/lib/ccg";
import { formatSpecName } from "@/lib/utils";
import type { CcgCustomFinish, CcgTierGrade } from "@/types";
import type { StudioCreation, StudioDraft, StudioState } from "@/types/ccg-studio";
import CcgShell from "@/components/ccg/CcgShell";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import styles from "@/components/ccg/studio.module.css";

function Editor({ source, data, pending, run, onDirty }: { source: StudioCreation; data: StudioState; pending: boolean; onDirty: (dirty: boolean) => void;
  run: (path: string, body?: Record<string, unknown>, method?: string) => Promise<unknown> }) {
  const t = useTranslations("ccg");
  const locale = useLocale();
  const [confirm, setConfirm] = useState(false);
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

  return <section className={styles.editor} aria-label={t("studio.editor")}>
    <div className={styles.preview}>
      {preview && <CollectibleCard card={preview} finish={form.creatorFinish} width={280} />}
      <p>{t("studio.creatorCopy")}</p>
      {source.cardId && <Link href={`/ccg/collection?set=supporter&character=${source.preview?.characterId}`}>{t("studio.viewCollection")}</Link>}
    </div>
    <div className={styles.form}>
      <div><span className={styles.eyebrow}>{t(source.cardId ? "studio.published" : "studio.draft")}</span><h2>{source.name} <small>{source.realm}</small></h2></div>
      {(!owned || source.editsFrozen) && <p role="status">{t(source.editsFrozen ? "studio.errors.editing_frozen" : "studio.errors.ownership_required")}</p>}
      <p>{t("studio.manualScores")}</p>
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
          {(["performance", "mechanics", "mythicPlus"] as const).map((key) => <label key={key}>{t(`studio.${key}`)}
            <input type="number" min={0} max={key === "mythicPlus" ? 100000 : 100} step="0.1" value={form[key] ?? ""}
              onChange={(event) => changeScore(key, event.target.value)} />
          </label>)}
          <label>{t("studio.combined")}<output>{combined ?? "—"}</output></label>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => { setForm((previous) => ({ ...previous, performance: Math.floor(Math.random() * 101), mechanics: Math.floor(Math.random() * 101) })); setConfirm(false); }}>{t("studio.randomize")}</button>
          <button type="button" disabled={!dirty && Boolean(source.draft)} onClick={() => void run(path, { ...form, revision: source.revision }, "PATCH")}>{t(source.draft ? "studio.save" : "studio.edit")}</button>
        </div>
      </fieldset>
      {source.cardId && <p className={styles.hint}>{t("studio.locked")}</p>}
      {source.draft && <>
        <div className={styles.media}>
          <button type="button" disabled={disabled || dirty || Date.parse(source.nextRenderRefreshAt) > now} onClick={() => void run(`${path}/render`)}>{t("studio.refreshRender")}</button>
          <small>{t("studio.renderCooldown", { date: date(source.nextRenderRefreshAt) })}</small>
          {source.renderError && <p role="status">{t("studio.errors.render_missing")}</p>}
          {source.renderUnchanged && <p>{t("studio.renderUnchanged")}</p>}
        </div>
        {dirty && <p role="status">{t("studio.unsaved")}</p>}
        {Date.parse(source.nextEditAt) > now && <p>{t("studio.editCooldown", { date: date(source.nextEditAt) })}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={disabled || dirty || !preview?.renderUrl || Date.parse(source.nextEditAt) > now || (!source.cardId && data.allowance.available < 1)} onClick={() => setConfirm(true)}>{t(source.cardId ? "studio.apply" : "studio.publish")}</button>
          <button type="button" disabled={pending} onClick={() => { if (window.confirm(t("studio.confirmDiscard"))) void run(path, { revision: source.revision }, "DELETE"); }}>{t("studio.discard")}</button>
        </div>
        {confirm && <div className={styles.confirm} role="alert">
          <p>{t(source.cardId ? "studio.confirmApply" : "studio.confirmPublish")}</p>
          <div className={styles.actions}><button className={styles.primary} disabled={pending} onClick={() => void run(`${path}/publish`, { revision: source.revision })}>{t(source.cardId ? "studio.apply" : "studio.publish")}</button>
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
  const [connecting, setConnecting] = useState(false);
  const dirtyRef = useRef(false);
  const onDirty = useCallback((dirty: boolean) => { dirtyRef.current = dirty; }, []);
  const switchView = (nextTab: "characters" | "creations", nextSelection = selected) => {
    if (nextTab === tab && nextSelection === selected) return;
    if (dirtyRef.current && !window.confirm(t("studio.discardUnsaved"))) return;
    dirtyRef.current = false; setSelected(nextSelection); setTab(nextTab);
  };
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const query = useQuery({ queryKey: key, queryFn: () => api.getCcgStudio(), enabled: Boolean(user), staleTime: 60_000, refetchOnWindowFocus: false });
  const data = query.data;
  const mutation = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body: Record<string, unknown>; method: string }) => api.updateCcgStudio(path, body, method),
    onSuccess: (next, input) => {
      client.setQueryData(key, next); setError(null);
      if (input.path.startsWith("drafts")) dirtyRef.current = false;
      if (input.path === "drafts") { setSelected(next.creations.find((entry) => !data?.creations.some((old) => old.id === entry.id))?.id ?? next.creations[0]?.id ?? null); setTab("creations"); }
      if (input.path.endsWith("/publish")) void client.invalidateQueries({ predicate: (item) => item.queryKey[0] === "ccg" && item.queryKey[1] !== "studio" });
    },
    onError: (failure) => setError(failure instanceof ApiError && failure.code ? failure.code : "studio_unavailable"),
  });
  const run = async (path: string, body: Record<string, unknown> = {}, method = "POST") => {
    setError(null);
    try { return await mutation.mutateAsync({ path, body, method }); } catch { return undefined; }
  };
  const connect = async (provider: "twitch" | "battlenet") => {
    setConnecting(true); setError(null);
    try { const result = provider === "twitch" ? await api.getTwitchConnectUrl("/ccg/studio") : await api.getBattleNetConnectUrl("/ccg/studio"); window.location.assign(result.url); }
    catch { setError("connection_failed"); setConnecting(false); }
  };
  const errorText = (code: string) => t.has(`studio.errors.${code}`) ? t(`studio.errors.${code}`) : t("studio.errors.studio_unavailable");
  const selection = data?.creations.find((entry) => entry.id === selected) ?? data?.creations[0];
  const statusText = (value: boolean | null) => t(value === null ? "studio.unknown" : value ? "studio.yes" : "studio.no");

  return <CcgShell><div className={styles.studio}>
    <header className={styles.heading}><span className={styles.eyebrow}>{t("studio.eyebrow")}</span><h1>{t("studio.title")}</h1><p>{t("studio.description")}</p></header>
    {isLoading ? <p>{t("studio.loading")}</p> : !user ? <div className={styles.panel}><h2>{t("studio.signInTitle")}</h2><p>{t("studio.signInDescription")}</p><button onClick={() => void login("/ccg/studio")}>{t("studio.signIn")}</button></div> : <>
      {query.isLoading && <p>{t("studio.loading")}</p>}
      {(error || query.error) && <div className={styles.error} role="alert">{errorText(error ?? "studio_unavailable")}<button onClick={() => { setError(null); void query.refetch(); }}>{t("studio.reload")}</button></div>}
      {data && <>
        <div className={styles.connections}>
          <section className={styles.panel}><h2>Battle.net <small>EU</small></h2><p>{t(data.battlenetConnected ? "studio.bnetConnected" : "studio.bnetRequired")}</p>
            {data.rosterError && <p role="status">{errorText(data.rosterError)}</p>}
            <div className={styles.actions}><button disabled={connecting} onClick={() => void connect("battlenet")}>{t(data.battlenetConnected ? "studio.reconnect" : "studio.connect")}</button>
              {data.battlenetConnected && <button disabled={mutation.isPending} onClick={() => void run("roster")}>{t("studio.refreshCharacters")}</button>}</div>
          </section>
          <section className={styles.panel}><h2>Twitch <small>vaarattu</small></h2><p>{t("studio.allowanceRules")}</p>
            {data.twitchConnected && <p>{t("studio.following", { status: statusText(data.status.following) })} · {t("studio.subscribed", { status: statusText(data.status.subscribed) })}</p>}
            {data.status.checkedAt && <small>{t("studio.checked", { date: new Date(data.status.checkedAt).toLocaleString(locale) })}</small>}
            {data.status.error && <p role="status">{errorText(data.status.error)}</p>}
            <div className={styles.actions}><button disabled={connecting} onClick={() => void connect("twitch")}>{t(data.twitchConnected ? "studio.reconnect" : "studio.connect")}</button>
              {data.twitchConnected && <button disabled={mutation.isPending || Date.parse(data.status.nextManualCheckAt) > now} onClick={() => void run("status")}>{t("studio.refreshStatus")}</button>}</div>
          </section>
        </div>
        <div className={styles.allowance}><strong>{t("studio.slots", { available: data.allowance.available, earned: data.allowance.earned })}</strong><span>{t("studio.drafts", { count: data.allowance.drafts, limit: data.allowance.draftLimit })}</span><small>{t("studio.permanent")}</small></div>
        <nav className={styles.tabs} aria-label={t("studio.views")}><button aria-pressed={tab === "characters"} onClick={() => switchView("characters")}>{t("studio.characters")}</button><button aria-pressed={tab === "creations"} onClick={() => switchView("creations")}>{t("studio.creations")}</button></nav>
        {tab === "characters" ? <div className={styles.characters}>
          {data.characters.length === 0 && <p>{t("studio.noCharacters")}</p>}
          {data.characters.map((character) => {
            const creation = data.creations.find((entry) => entry.characterId === character.id && entry.realmId === character.realmId);
            return <section key={`${character.realmId}:${character.id}`} className={styles.panel}>
              <div className={styles.characterHeader}><div><h2>{character.name} <small>{character.realm}</small></h2><span>{character.className} · {character.level}</span></div>
                <button disabled={mutation.isPending || (!creation && data.allowance.drafts >= data.allowance.draftLimit)} onClick={() => creation ? (setSelected(creation.id), setTab("creations")) : void run("drafts", { characterId: character.id, realmId: character.realmId })}>{t(creation ? "studio.openCreation" : "studio.create")}</button></div>
              {character.cards.length === 0 ? <p className={styles.hint}>{t("studio.noCards")}</p> : <div className={styles.catalogue}>{character.cards.map((card) => <Link key={card.id} href={`/ccg/collection?set=${card.set.slug}&character=${card.characterId}`}>
                <strong>{card.set.raidName}</strong><span>{t("studio.catalogueCard", { snapshots: card.snapshots, owned: card.owned })}</span>
              </Link>)}</div>}
            </section>;
          })}
        </div> : <>
          {data.creations.length === 0 ? <div className={styles.panel}><p>{t("studio.noCreations")}</p><button onClick={() => setTab("characters")}>{t("studio.characters")}</button></div> : <>
            <div className={styles.creationList}>{data.creations.map((source) => <button key={source.id} aria-pressed={selection?.id === source.id} onClick={() => switchView("creations", source.id)}><strong>{source.name}</strong><small>{t(source.draft ? "studio.draft" : "studio.published")}</small></button>)}</div>
            {selection?.preview && <Editor key={`${selection.id}:${selection.revision}`} source={selection} data={data} pending={mutation.isPending} run={run} onDirty={onDirty} />}
          </>}
        </>}
      </>}
    </>}
  </div></CcgShell>;
}
