"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FaGift, FaIdCard, FaTicket } from "react-icons/fa6";
import { api } from "@/lib/api";
import { CCG_BASE_FINISH_ORDER, getCcgRedeemFinishOrder, hasAlternativeArtwork } from "@/lib/ccg";
import { formatRealmName } from "@/lib/utils";
import type { CcgAdminRedeemCode, CcgArtVariant, CcgCard, CcgFinish } from "@/types";

type Props = {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

type Draft = {
  code: string;
  rewardType: "packs" | "card";
  packs: number;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
};

const emptyDraft: Draft = {
  code: "",
  rewardType: "packs",
  packs: 0,
  finish: "standard",
  artVariant: "standard",
};
const codePattern = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/;
const fieldClass = "min-h-10 w-full rounded-md border border-white/10 bg-gray-950/75 px-3 text-sm text-white outline-none transition-[border-color,box-shadow] placeholder:text-gray-500 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "min-h-10 rounded-md bg-gray-800 px-3 py-2 text-sm font-semibold text-gray-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] transition-[background-color,scale] duration-150 ease-out hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = "min-h-10 rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[background-color,scale] duration-150 ease-out hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";

export default function CcgRedeemCodeManager({ onError, onNotice }: Props) {
  const t = useTranslations("admin.ccg.redeemCodes");
  const ccg = useTranslations("ccg");
  const locale = useLocale();
  const [codes, setCodes] = useState<CcgAdminRedeemCode[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cards, setCards] = useState<CcgCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<CcgCard | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [loadingCodes, setLoadingCodes] = useState(true);
  const [loadingCards, setLoadingCards] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const activeSearchRef = useRef("");
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const variants = useMemo(
    () => selectedCard?.variants?.map((variant) => variant.card) ?? (selectedCard ? [selectedCard] : []),
    [selectedCard],
  );
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) ?? variants[0] ?? null;
  const finishes = useMemo(
    () => selectedVariant
      ? getCcgRedeemFinishOrder(selectedVariant.set.kind, selectedVariant.set.customFinish?.key)
      : CCG_BASE_FINISH_ORDER,
    [selectedVariant?.set.customFinish?.key, selectedVariant?.set.kind],
  );
  const customArtAvailable = hasAlternativeArtwork(selectedVariant);

  useEffect(() => {
    let cancelled = false;
    setLoadingCodes(true);
    void api.getAdminCcgRedeemCodes()
      .then((response) => {
        if (!cancelled) setCodes(response.codes);
      })
      .catch((error) => {
        if (!cancelled) onError(error instanceof Error ? error.message : t("loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoadingCodes(false);
      });
    return () => { cancelled = true; };
  }, [onError, t]);

  useEffect(() => {
    if (draft.rewardType !== "card") return;
    const trimmedSearch = search.trim();
    activeSearchRef.current = trimmedSearch;
    if (trimmedSearch.length < 2) {
      setDebouncedSearch("");
      setCards([]);
      setLoadingCards(false);
      setSearchError(null);
      return;
    }
    setLoadingCards(true);
    const timer = window.setTimeout(() => setDebouncedSearch(trimmedSearch), 180);
    return () => window.clearTimeout(timer);
  }, [draft.rewardType, search]);

  useEffect(() => {
    if (draft.rewardType !== "card" || debouncedSearch.length < 2) return;
    let cancelled = false;
    setLoadingCards(true);
    setSearchError(null);
    void api.searchAdminCcgCards(debouncedSearch, 12)
      .then((result) => {
        if (!cancelled && result.search === activeSearchRef.current) setCards(result.cards);
      })
      .catch((error) => {
        if (!cancelled) setSearchError(error instanceof Error ? error.message : t("cardSearchError"));
      })
      .finally(() => {
        if (!cancelled) setLoadingCards(false);
      });
    return () => { cancelled = true; };
  }, [debouncedSearch, draft.rewardType, t]);

  useEffect(() => {
    if (draft.artVariant === "alternative" && !customArtAvailable) {
      setDraft((current) => ({ ...current, artVariant: "standard" }));
    }
  }, [customArtAvailable, draft.artVariant]);

  useEffect(() => {
    if (finishes.includes(draft.finish)) return;
    setDraft((current) => ({ ...current, finish: "standard" }));
  }, [draft.finish, finishes]);

  const normalizedCode = draft.code.trim().toUpperCase();
  const validCode = normalizedCode.length >= 3 && normalizedCode.length <= 64 && codePattern.test(normalizedCode);
  const validPackReward = draft.rewardType === "packs"
    && Number.isSafeInteger(draft.packs)
    && draft.packs > 0
    && draft.packs <= 10_000;
  const canCreate = validCode && !saving && (draft.rewardType === "card" ? Boolean(selectedVariant) : validPackReward);

  const createCode = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      const result = await api.createAdminCcgRedeemCode({
        code: normalizedCode,
        rewardType: draft.rewardType,
        packs: draft.rewardType === "packs" ? draft.packs : 0,
        cardId: draft.rewardType === "card" ? selectedVariant?.id ?? null : null,
        finish: draft.rewardType === "card" ? draft.finish : null,
        artVariant: draft.rewardType === "card" ? draft.artVariant : null,
      });
      setCodes((current) => [result.code, ...current]);
      setDraft(emptyDraft);
      setSearch("");
      setCards([]);
      setSelectedCard(null);
      setSelectedVariantId("");
      onNotice(t("created", { code: result.code.code }));
    } catch (error) {
      onError(error instanceof Error ? error.message : t("createError"));
    } finally {
      setSaving(false);
    }
  };

  const updateActive = async (code: CcgAdminRedeemCode) => {
    setUpdatingId(code.id);
    try {
      const result = await api.setAdminCcgRedeemCodeActive(code.id, !code.active);
      setCodes((current) => current.map((row) => row.id === code.id ? result.code : row));
      onNotice(t(result.code.active ? "enabledNotice" : "disabledNotice", { code: result.code.code }));
    } catch (error) {
      onError(error instanceof Error ? error.message : t("updateError"));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(21rem,27rem)_minmax(0,1fr)]" aria-labelledby="ccg-redeem-code-title">
      <div className="self-start rounded-xl bg-gray-900/70 p-5 shadow-[0_0_0_1px_rgba(255,255,255,.08),0_12px_28px_rgba(0,0,0,.16)]">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-500/12 text-amber-300 shadow-[inset_0_0_0_1px_rgba(251,191,36,.18)]" aria-hidden="true"><FaTicket /></span>
          <div>
            <h3 id="ccg-redeem-code-title" className="text-lg font-bold text-white text-balance">{t("title")}</h3>
            <p className="mt-1 text-sm leading-6 text-gray-400 text-pretty">{t("description")}</p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <label className="grid gap-1.5 text-xs font-semibold text-gray-400">
            {t("code")}
            <input
              type="text"
              value={draft.code}
              onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
              className={`${fieldClass} font-mono tracking-[0.08em] uppercase`}
              placeholder={t("codePlaceholder")}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {draft.code && !validCode ? <p className="text-xs text-amber-300">{t("codeHelp")}</p> : null}

          <fieldset>
            <legend className="text-xs font-semibold text-gray-400">{t("rewardType")}</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(["packs", "card"] as const).map((rewardType) => (
                <button
                  key={rewardType}
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, rewardType }))}
                  className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-[background-color,color,scale] duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96] ${draft.rewardType === rewardType ? "bg-cyan-950/80 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(103,232,249,.28)]" : "bg-gray-800/70 text-gray-400 hover:bg-gray-800 hover:text-white"}`}
                  aria-pressed={draft.rewardType === rewardType}
                >
                  {rewardType === "packs" ? <FaGift aria-hidden="true" /> : <FaIdCard aria-hidden="true" />}
                  {t(rewardType)}
                </button>
              ))}
            </div>
          </fieldset>

          {draft.rewardType === "packs" ? (
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-xs font-semibold text-gray-400">
                {t("packCount")}
                <input type="number" min={1} max={10_000} step={1} value={draft.packs} onChange={(event) => setDraft((current) => ({ ...current, packs: Number(event.target.value) }))} className={`${fieldClass} tabular-nums`} />
              </label>
              <p className="text-xs leading-5 text-gray-500 text-pretty">{t("packHelp")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="grid gap-1.5 text-xs font-semibold text-gray-400">
                {t("cardSearch")}
                <input
                  type="search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="ccg-redeem-card-results"
                  aria-expanded={search.trim().length >= 2}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className={fieldClass}
                  placeholder={t("cardSearchPlaceholder")}
                  autoComplete="off"
                />
              </label>
              {search.trim().length >= 2 ? (
                <div id="ccg-redeem-card-results" className="max-h-52 overflow-y-auto rounded-lg bg-gray-950/55 p-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]" aria-live="polite">
                  {loadingCards ? <p className="p-3 text-sm text-gray-400">{t("searching")}</p> : searchError ? <p className="p-3 text-sm text-red-300" role="alert">{searchError}</p> : cards.length === 0 ? <p className="p-3 text-sm text-gray-500">{t("noCards")}</p> : (
                    <ul role="listbox" className="divide-y divide-white/5">
                      {cards.map((card) => (
                        <li key={card.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selectedCard?.id === card.id}
                            onClick={() => {
                              setSelectedCard(card);
                              setSelectedVariantId(card.variants?.[0]?.card.id ?? card.id);
                            }}
                            className={`min-h-14 w-full rounded-md px-3 py-2 text-left transition-[background-color,color,scale] duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300 active:scale-[0.96] ${selectedCard?.id === card.id ? "bg-cyan-950/65 text-white" : "text-gray-300 hover:bg-white/5"}`}
                          >
                            <strong className="block truncate text-sm">{card.name} <span className="font-medium text-gray-500">· {formatRealmName(card.realm)}</span></strong>
                            <span className="mt-0.5 block truncate text-xs text-gray-500">{card.guildName ?? ccg("independent")} · {t("variants", { count: card.variants?.length ?? 1 })}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {selectedVariant ? (
                <div className="space-y-3 rounded-xl bg-gray-950/45 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]">
                  <div className="min-w-0">
                    <strong className="block truncate text-sm text-white">{selectedVariant.name} · {formatRealmName(selectedVariant.realm)}</strong>
                    <span className="text-xs text-gray-500">{selectedVariant.set.raidName}</span>
                  </div>
                  {variants.length > 1 ? (
                    <label className="grid gap-1.5 text-xs font-semibold text-gray-400">
                      {t("cardVersion")}
                      <select value={selectedVariant.id} onChange={(event) => setSelectedVariantId(event.target.value)} className={fieldClass}>
                        {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.set.raidName}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <label className="grid gap-1.5 text-xs font-semibold text-gray-400">
                    {t("quality")}
                    <select value={draft.finish} onChange={(event) => setDraft((current) => ({ ...current, finish: event.target.value as CcgFinish }))} className={fieldClass}>
                      {finishes.map((finish) => <option key={finish} value={finish}>{ccg(`finish.${finish}`)}</option>)}
                    </select>
                  </label>
                  {selectedVariant.set.kind === "community" ? (
                    <p className="text-xs leading-5 text-gray-500 text-pretty">{t("communityFinishHelp")}</p>
                  ) : null}
                  <fieldset>
                    <legend className="text-xs font-semibold text-gray-400">{t("artwork")}</legend>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {(["standard", "alternative"] as const).map((artVariant) => (
                        <button
                          key={artVariant}
                          type="button"
                          disabled={artVariant === "alternative" && !customArtAvailable}
                          onClick={() => setDraft((current) => ({ ...current, artVariant }))}
                          className={`min-h-10 rounded-md px-2 text-xs font-semibold transition-[background-color,color,scale] duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 ${draft.artVariant === artVariant ? "bg-cyan-950/80 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(103,232,249,.28)]" : "bg-gray-800/70 text-gray-400 hover:bg-gray-800 hover:text-white"}`}
                          aria-pressed={draft.artVariant === artVariant}
                        >
                          {t(artVariant === "alternative" ? "customArt" : "regularArt")}
                        </button>
                      ))}
                    </div>
                    {!customArtAvailable ? <p className="mt-2 text-xs leading-5 text-gray-500 text-pretty">{t("customArtUnavailable")}</p> : null}
                  </fieldset>
                </div>
              ) : null}
            </div>
          )}

          <button type="button" className={`${primaryButton} w-full`} onClick={() => void createCode()} disabled={!canCreate}>
            {saving ? t("creating") : t("create")}
          </button>
          <p className="text-center text-xs text-gray-500">{t("noExpiry")}</p>
        </div>
      </div>

      <div className="min-w-0 rounded-xl bg-gray-900/55 p-5 shadow-[0_0_0_1px_rgba(255,255,255,.07),0_12px_28px_rgba(0,0,0,.12)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-white text-balance">{t("listTitle")}</h3>
            <p className="mt-1 text-sm text-gray-400 text-pretty">{t("listDescription")}</p>
          </div>
          <span className="rounded-full bg-gray-950/70 px-2.5 py-1 text-xs font-semibold tabular-nums text-gray-400">{t("codeCount", { count: codes.length })}</span>
        </div>

        {loadingCodes ? (
          <div className="mt-5 space-y-3" aria-label={t("loading")}>
            {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-lg bg-gray-800/70" />)}
          </div>
        ) : codes.length === 0 ? (
          <div className="mt-5 rounded-lg bg-gray-950/40 p-8 text-center text-sm text-gray-500 shadow-[inset_0_0_0_1px_rgba(255,255,255,.05)]">{t("empty")}</div>
        ) : (
          <div className="mt-5 space-y-3">
            {codes.map((code) => (
              <article key={code.id} className="rounded-xl bg-gray-950/42 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,.065)]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="truncate font-mono text-sm font-bold tracking-[0.08em] text-white">{code.code}</code>
                      <span className={`rounded-full px-2 py-0.5 text-[.68rem] font-semibold ${code.active ? "bg-emerald-950 text-emerald-300" : "bg-gray-800 text-gray-400"}`}>{t(code.active ? "active" : "inactive")}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-300 text-pretty">
                      {code.reward.type === "packs"
                        ? t("packSummary", { packs: code.reward.packs })
                        : code.reward.card
                          ? t("cardSummary", { name: code.reward.card.name, set: code.reward.card.set.raidName, quality: code.reward.finish ? ccg(`finish.${code.reward.finish}`) : "—", artwork: t(code.reward.artVariant === "alternative" ? "customArt" : "regularArt") })
                          : t("missingCard")}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      <span className="tabular-nums">{t("redemptions", { count: code.redemptionCount })}</span> · {dateFormatter.format(new Date(code.createdAt))}
                    </p>
                  </div>
                  <button type="button" className={secondaryButton} disabled={updatingId === code.id} onClick={() => void updateActive(code)}>
                    {updatingId === code.id ? t("updating") : t(code.active ? "disable" : "enable")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
