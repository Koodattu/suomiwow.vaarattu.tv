"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import { api } from "@/lib/api";
import { formatRealmName } from "@/lib/utils";
import type { CcgAlternativeArt, CcgCard, CcgQuip } from "@/types";

type Props = {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

type Draft = {
  characterArtFilename: string;
  characterArtEnabled: boolean;
  backgroundArtFilename: string;
  backgroundArtEnabled: boolean;
  quipText: string;
  quipAudioFilename: string;
};

type AssetState = "idle" | "loading" | "ready" | "error";

const emptyDraft: Draft = {
  characterArtFilename: "",
  characterArtEnabled: false,
  backgroundArtFilename: "",
  backgroundArtEnabled: false,
  quipText: "",
  quipAudioFilename: "",
};
const imageFilenamePattern = /^[a-zA-Z0-9][a-zA-Z0-9 _.()-]*\.(?:avif|gif|jpe?g|png|webm|webp)$/i;
const audioFilenamePattern = /^[a-zA-Z0-9][a-zA-Z0-9 _.()-]*\.(?:aac|m4a|mp3|ogg|wav)$/i;
const fieldClass = "min-h-10 w-full rounded-md border border-white/10 bg-gray-950/75 px-3 text-sm text-white outline-none transition-colors placeholder:text-gray-500 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = "min-h-10 rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white transition-transform duration-150 ease-out hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";

function assetPath(kind: "character" | "background", filename: string): string | null {
  const trimmed = filename.trim();
  return trimmed ? `/ccg/alternative/${kind}/${encodeURIComponent(trimmed)}` : null;
}

function quipAudioPath(filename: string): string | null {
  const trimmed = filename.trim();
  return trimmed ? `/ccg/audio/quips/${encodeURIComponent(trimmed)}` : null;
}

function isWebmArtwork(path: string): boolean {
  return /\.webm(?:$|[?#])/i.test(path);
}

function draftFromCustomization(alternativeArt: CcgAlternativeArt | null, quip: CcgQuip | null): Draft {
  return {
    characterArtFilename: alternativeArt?.characterArtFilename ?? "",
    characterArtEnabled: alternativeArt?.characterArtEnabled ?? false,
    backgroundArtFilename: alternativeArt?.backgroundArtFilename ?? "",
    backgroundArtEnabled: alternativeArt?.backgroundArtEnabled ?? false,
    quipText: quip?.text ?? "",
    quipAudioFilename: quip?.audioFilename ?? "",
  };
}

function withCustomization(card: CcgCard, alternativeArt: CcgAlternativeArt | null, quip: CcgQuip | null): CcgCard {
  return {
    ...card,
    alternativeArt,
    quip,
    variants: card.variants?.map((variant) => ({
      ...variant,
      card: { ...variant.card, alternativeArt, quip },
    })),
  };
}

export default function CcgAlternativeArtManager({ onError, onNotice }: Props) {
  const t = useTranslations("admin.ccg.alternativeArt");
  const ccg = useTranslations("ccg");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cards, setCards] = useState<CcgCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<CcgCard | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [characterAssetState, setCharacterAssetState] = useState<AssetState>("idle");
  const [backgroundAssetState, setBackgroundAssetState] = useState<AssetState>("idle");
  const [quipAssetState, setQuipAssetState] = useState<AssetState>("idle");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const activeSearchRef = useRef("");

  useEffect(() => {
    const trimmedSearch = search.trim();
    activeSearchRef.current = trimmedSearch;
    if (trimmedSearch.length < 2) {
      setDebouncedSearch("");
      setCards([]);
      setLoading(false);
      setSearchError(null);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => setDebouncedSearch(trimmedSearch), 180);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (debouncedSearch.length < 2) return;
    let cancelled = false;
    setLoading(true);
    setSearchError(null);
    void api.searchAdminCcgCards(debouncedSearch, 12)
      .then((result) => {
        if (cancelled || result.search !== activeSearchRef.current) return;
        setCards(result.cards);
      })
      .catch((error) => {
        if (!cancelled) setSearchError(error instanceof Error ? error.message : t("loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, t]);

  const variants = useMemo(
    () => selectedCard?.variants?.map((variant) => variant.card) ?? (selectedCard ? [selectedCard] : []),
    [selectedCard],
  );
  const hasCommunityVariant = variants.some((variant) => variant.set.kind === "community");
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) ?? variants[0] ?? null;

  useEffect(() => {
    if (!selectedCard) {
      setDraft(emptyDraft);
      setSelectedVariantId("");
      return;
    }
    setDraft(draftFromCustomization(selectedCard.alternativeArt, selectedCard.quip));
    const communityVariant = selectedCard.variants?.find((variant) => variant.card.set.kind === "community")?.card;
    setSelectedVariantId((selectedCard.alternativeArt?.backgroundArtEnabled && communityVariant ? communityVariant : variants[0])?.id ?? "");
  }, [selectedCard, variants]);

  const characterFilenameValid = !draft.characterArtFilename.trim() || imageFilenamePattern.test(draft.characterArtFilename.trim());
  const backgroundFilenameValid = !draft.backgroundArtFilename.trim() || imageFilenamePattern.test(draft.backgroundArtFilename.trim());
  const quipFilenameValid = !draft.quipAudioFilename.trim() || audioFilenamePattern.test(draft.quipAudioFilename.trim());
  const quipTextValid = draft.quipText.trim().length <= 500;
  const characterPath = characterFilenameValid ? assetPath("character", draft.characterArtFilename) : null;
  const backgroundPath = backgroundFilenameValid ? assetPath("background", draft.backgroundArtFilename) : null;
  const quipPath = quipFilenameValid ? quipAudioPath(draft.quipAudioFilename) : null;

  useEffect(() => {
    setCharacterAssetState(characterPath ? "loading" : "idle");
  }, [characterPath]);
  useEffect(() => {
    setBackgroundAssetState(backgroundPath ? "loading" : "idle");
  }, [backgroundPath]);
  useEffect(() => {
    setQuipAssetState(quipPath ? "loading" : "idle");
  }, [quipPath]);

  const savedDraft = draftFromCustomization(selectedCard?.alternativeArt ?? null, selectedCard?.quip ?? null);
  const changed = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const characterReady = !draft.characterArtEnabled || (characterFilenameValid && characterAssetState === "ready");
  const backgroundReady = !draft.backgroundArtEnabled || (hasCommunityVariant && backgroundFilenameValid && backgroundAssetState === "ready");
  const quipReady = !draft.quipAudioFilename.trim() || (quipFilenameValid && quipAssetState === "ready");
  const canSave = Boolean(
    selectedCard
    && changed
    && characterFilenameValid
    && backgroundFilenameValid
    && quipFilenameValid
    && quipTextValid
    && characterReady
    && backgroundReady
    && quipReady
    && !saving,
  );
  const previewAlternativeArt: CcgAlternativeArt = {
    characterArtFilename: draft.characterArtFilename.trim() || null,
    characterArtPath: draft.characterArtEnabled ? characterPath : null,
    characterArtEnabled: draft.characterArtEnabled,
    backgroundArtFilename: draft.backgroundArtFilename.trim() || null,
    backgroundArtPath: draft.backgroundArtEnabled ? backgroundPath : null,
    backgroundArtEnabled: draft.backgroundArtEnabled,
  };
  const previewCard = selectedVariant ? { ...selectedVariant, alternativeArt: previewAlternativeArt } : null;
  const previewHasAlternative = Boolean(
    draft.characterArtEnabled
    || (selectedVariant?.set.kind === "community" && draft.backgroundArtEnabled),
  );

  const save = async () => {
    if (!selectedCard || !canSave) return;
    setSaving(true);
    try {
      const result = await api.updateAdminCcgAlternativeArt(selectedCard.id, {
        characterArtFilename: draft.characterArtFilename.trim() || null,
        characterArtEnabled: draft.characterArtEnabled,
        backgroundArtFilename: draft.backgroundArtFilename.trim() || null,
        backgroundArtEnabled: draft.backgroundArtEnabled,
        quipText: draft.quipText.trim() || null,
        quipAudioFilename: draft.quipAudioFilename.trim() || null,
      });
      const updatedCard = withCustomization(selectedCard, result.alternativeArt, result.quip);
      setSelectedCard(updatedCard);
      setCards((current) => current.map((card) => card.id === selectedCard.id ? withCustomization(card, result.alternativeArt, result.quip) : card));
      onNotice(t("saved", { name: selectedCard.name }));
    } catch (error) {
      onError(error instanceof Error ? error.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="grid min-h-[44rem] overflow-hidden rounded-lg bg-gray-900/65 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] xl:grid-cols-[29rem_minmax(32rem,1fr)]" aria-labelledby="ccg-alternative-art-title">
      <div className="min-w-0 border-b border-white/8 p-5 xl:border-b-0 xl:border-r">
        <h3 id="ccg-alternative-art-title" className="text-lg font-bold text-white text-balance">{t("title")}</h3>
        <p className="mt-1 text-sm leading-6 text-gray-400 text-pretty">{t("description")}</p>

        <label className="mt-5 grid gap-1.5 text-xs font-semibold text-gray-400">
          {t("search")}
          <input
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="ccg-alternative-art-results"
            aria-expanded={search.trim().length >= 2}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={fieldClass}
            placeholder={t("searchPlaceholder")}
            autoComplete="off"
          />
        </label>

        {search.trim().length >= 2 ? (
          <div id="ccg-alternative-art-results" className="mt-3 max-h-56 overflow-y-auto rounded-md bg-gray-950/55 p-1 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" aria-live="polite">
            {loading ? (
              <div className="space-y-1 p-1" aria-label={t("loading")}>
                {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded bg-gray-800/80" />)}
              </div>
            ) : searchError ? (
              <p className="p-3 text-sm text-red-300" role="alert">{searchError}</p>
            ) : cards.length === 0 ? (
              <p className="p-3 text-sm text-gray-500">{t("empty")}</p>
            ) : (
              <ul className="divide-y divide-white/5" role="listbox">
                {cards.map((card) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedCard?.id === card.id}
                      onClick={() => setSelectedCard(card)}
                      className={`min-h-14 w-full rounded px-3 py-2.5 text-left transition-[background-color,color,transform] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300 active:scale-[0.96] ${selectedCard?.id === card.id ? "bg-cyan-950/65 text-white" : "text-gray-300 hover:bg-white/5"}`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <strong className="truncate text-sm">{card.name} <span className="font-medium text-gray-500">· {formatRealmName(card.realm)}</span></strong>
                        {card.alternativeArt?.characterArtEnabled || card.alternativeArt?.backgroundArtEnabled || card.quip ? (
                          <span className="shrink-0 rounded-full bg-amber-950/80 px-2 py-0.5 text-[.65rem] font-semibold text-amber-200">{t("configured")}</span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {card.guildName ?? ccg("independent")} · {t("variants", { count: card.variants?.length ?? 1 })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {selectedCard ? (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <strong className="block truncate text-sm text-white">{selectedCard.name} · {formatRealmName(selectedCard.realm)}</strong>
                <span className="text-xs text-gray-500">{selectedCard.guildName ?? ccg("independent")}</span>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${hasCommunityVariant ? "bg-emerald-950 text-emerald-300" : "bg-gray-800 text-gray-400"}`}>
                {t(hasCommunityVariant ? "communityEligible" : "raidOnly")}
              </span>
            </div>

            <div className="rounded-lg bg-gray-950/45 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-gray-200">
                <input
                  type="checkbox"
                  checked={draft.characterArtEnabled}
                  onChange={(event) => setDraft((current) => ({ ...current, characterArtEnabled: event.target.checked }))}
                  className="h-4 w-4 accent-cyan-500"
                />
                {t("character.enable")}
              </label>
              <p className="mt-1 text-xs leading-5 text-gray-500 text-pretty">{t("character.help")}</p>
              <label className="mt-3 grid gap-1.5 text-xs font-semibold text-gray-400">
                {t("filename")}
                <span className="flex min-w-0 overflow-hidden rounded-md border border-white/10 bg-gray-950/75 focus-within:border-cyan-400/70 focus-within:ring-2 focus-within:ring-cyan-400/15">
                  <span className="hidden shrink-0 items-center bg-white/4 px-3 font-mono text-[.68rem] font-normal text-gray-500 sm:flex">/ccg/alternative/character/</span>
                  <input
                    value={draft.characterArtFilename}
                    onChange={(event) => setDraft((current) => ({ ...current, characterArtFilename: event.target.value }))}
                    className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-gray-600"
                    placeholder="laku_clap.png"
                    autoComplete="off"
                  />
                </span>
              </label>
              {!characterFilenameValid ? <p className="mt-2 text-xs text-red-300">{t("invalidFilename")}</p> : null}
              {characterPath ? (
                <div className="mt-3 flex items-center gap-3">
                  {isWebmArtwork(characterPath) ? (
                    <video
                      key={characterPath}
                      src={characterPath}
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="metadata"
                      className="h-16 w-16 rounded-md object-contain outline outline-1 -outline-offset-1 outline-white/10"
                      onLoadedData={() => setCharacterAssetState("ready")}
                      onError={() => setCharacterAssetState("error")}
                    />
                  ) : (
                    <img
                      key={characterPath}
                      src={characterPath}
                      alt=""
                      className="h-16 w-16 rounded-md object-contain outline outline-1 -outline-offset-1 outline-white/10"
                      onLoad={() => setCharacterAssetState("ready")}
                      onError={() => setCharacterAssetState("error")}
                    />
                  )}
                  <span className={`text-xs ${characterAssetState === "error" ? "text-red-300" : characterAssetState === "ready" ? "text-emerald-300" : "text-gray-500"}`}>
                    {t(`asset.${characterAssetState}`)}
                  </span>
                </div>
              ) : null}
            </div>

            <div className={`rounded-lg bg-gray-950/45 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] ${hasCommunityVariant ? "" : "opacity-60"}`}>
              <label className={`flex min-h-11 items-center gap-3 text-sm font-semibold text-gray-200 ${hasCommunityVariant ? "cursor-pointer" : "cursor-not-allowed"}`}>
                <input
                  type="checkbox"
                  checked={draft.backgroundArtEnabled}
                  onChange={(event) => setDraft((current) => ({ ...current, backgroundArtEnabled: event.target.checked }))}
                  disabled={!hasCommunityVariant}
                  className="h-4 w-4 accent-cyan-500"
                />
                {t("background.enable")}
              </label>
              <p className="mt-1 text-xs leading-5 text-gray-500 text-pretty">{t(hasCommunityVariant ? "background.help" : "background.unavailable")}</p>
              <label className="mt-3 grid gap-1.5 text-xs font-semibold text-gray-400">
                {t("filename")}
                <span className="flex min-w-0 overflow-hidden rounded-md border border-white/10 bg-gray-950/75 focus-within:border-cyan-400/70 focus-within:ring-2 focus-within:ring-cyan-400/15">
                  <span className="hidden shrink-0 items-center bg-white/4 px-3 font-mono text-[.68rem] font-normal text-gray-500 sm:flex">/ccg/alternative/background/</span>
                  <input
                    value={draft.backgroundArtFilename}
                    onChange={(event) => setDraft((current) => ({ ...current, backgroundArtFilename: event.target.value }))}
                    disabled={!hasCommunityVariant}
                    className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-gray-600 disabled:cursor-not-allowed"
                    placeholder="housing.png"
                    autoComplete="off"
                  />
                </span>
              </label>
              {!backgroundFilenameValid ? <p className="mt-2 text-xs text-red-300">{t("invalidFilename")}</p> : null}
              {backgroundPath && hasCommunityVariant ? (
                <div className="mt-3 flex items-center gap-3">
                  {isWebmArtwork(backgroundPath) ? (
                    <video
                      key={backgroundPath}
                      src={backgroundPath}
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="metadata"
                      className="h-16 w-24 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10"
                      onLoadedData={() => setBackgroundAssetState("ready")}
                      onError={() => setBackgroundAssetState("error")}
                    />
                  ) : (
                    <img
                      key={backgroundPath}
                      src={backgroundPath}
                      alt=""
                      className="h-16 w-24 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10"
                      onLoad={() => setBackgroundAssetState("ready")}
                      onError={() => setBackgroundAssetState("error")}
                    />
                  )}
                  <span className={`text-xs ${backgroundAssetState === "error" ? "text-red-300" : backgroundAssetState === "ready" ? "text-emerald-300" : "text-gray-500"}`}>
                    {t(`asset.${backgroundAssetState}`)}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg bg-gray-950/45 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              <h4 className="text-sm font-semibold text-gray-200 text-balance">{t("quip.title")}</h4>
              <p className="mt-1 text-xs leading-5 text-gray-500 text-pretty">{t("quip.help")}</p>
              <label className="mt-3 grid gap-1.5 text-xs font-semibold text-gray-400">
                <span className="flex items-baseline justify-between gap-3">
                  <span>{t("quip.quote")}</span>
                  <span className="font-normal text-gray-600 tabular-nums">{draft.quipText.length}/500</span>
                </span>
                <textarea
                  value={draft.quipText}
                  onChange={(event) => setDraft((current) => ({ ...current, quipText: event.target.value }))}
                  className={`${fieldClass} min-h-24 resize-y py-2.5 leading-5`}
                  maxLength={500}
                  placeholder={t("quip.quotePlaceholder")}
                />
              </label>
              <label className="mt-3 grid gap-1.5 text-xs font-semibold text-gray-400">
                {t("quip.audioFilename")}
                <span className="flex min-w-0 overflow-hidden rounded-md border border-white/10 bg-gray-950/75 focus-within:border-cyan-400/70 focus-within:ring-2 focus-within:ring-cyan-400/15">
                  <span className="hidden shrink-0 items-center bg-white/4 px-3 font-mono text-[.68rem] font-normal text-gray-500 sm:flex">/ccg/audio/quips/</span>
                  <input
                    value={draft.quipAudioFilename}
                    onChange={(event) => setDraft((current) => ({ ...current, quipAudioFilename: event.target.value }))}
                    className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-gray-600"
                    placeholder="tuhero.mp3"
                    autoComplete="off"
                  />
                </span>
              </label>
              {!quipFilenameValid ? <p className="mt-2 text-xs text-red-300">{t("quip.invalidFilename")}</p> : null}
              {quipPath ? (
                <div className="mt-3 text-xs">
                  <audio
                    key={quipPath}
                    src={quipPath}
                    preload="metadata"
                    className="hidden"
                    aria-hidden="true"
                    onLoadedMetadata={() => setQuipAssetState("ready")}
                    onError={() => setQuipAssetState("error")}
                  />
                  <span className={quipAssetState === "error" ? "text-red-300" : quipAssetState === "ready" ? "text-emerald-300" : "text-gray-500"}>
                    {t(`asset.${quipAssetState}`)}
                  </span>
                </div>
              ) : null}
            </div>

            <button type="button" className={`${primaryButton} w-full`} onClick={() => void save()} disabled={!canSave}>
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        ) : (
          <p className="mt-6 rounded-lg bg-gray-950/35 p-5 text-center text-sm text-gray-500 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">{t("selectCharacter")}</p>
        )}
      </div>

      <div className="relative grid min-h-[44rem] place-items-center overflow-hidden bg-gray-950 p-6 [perspective:1300px]">
        <div className="absolute inset-0 opacity-20" style={previewCard ? { background: `radial-gradient(circle at 50% 45%, ${previewCard.set.theme.glow}, transparent 55%), url(${previewCard.set.backgroundPath}) center/cover` } : undefined} aria-hidden="true" />
        {previewCard ? (
          <div className="relative z-10 grid place-items-center gap-4">
            <label className="grid gap-1.5 text-xs font-semibold text-gray-400">
              {t("previewVariant")}
              <select className={`${fieldClass} min-w-64`} value={selectedVariant?.id ?? ""} onChange={(event) => setSelectedVariantId(event.target.value)}>
                {variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.set.raidName}</option>)}
              </select>
            </label>
            <CollectibleCard card={previewCard} artVariant={previewHasAlternative ? "alternative" : "standard"} finish="standard" width={400} />
            <p className="max-w-lg text-center text-xs leading-5 text-gray-500 text-pretty">
              {t(previewHasAlternative ? "previewAlternative" : "previewRegular")}
            </p>
          </div>
        ) : (
          <p className="relative z-10 text-sm text-gray-500">{t("previewEmpty")}</p>
        )}
      </div>
    </section>
  );
}
