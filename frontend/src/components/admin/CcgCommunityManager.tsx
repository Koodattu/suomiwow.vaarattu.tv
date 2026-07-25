"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import type { CcgAdminCommunityCharacter, CcgTierGrade } from "@/types";

type Props = {
  characters: CcgAdminCommunityCharacter[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

const grades: readonly CcgTierGrade[] = ["S", "A", "B", "C", "D", "E", "F"];
const metricKeys = ["performance", "mechanics", "combined", "mythicPlus"] as const;
type MetricKey = (typeof metricKeys)[number];
type CharacterDraft = {
  tierGrade: CcgTierGrade;
  scores: Record<MetricKey, string>;
};
type UpdateInput = {
  tierGrade?: CcgTierGrade;
  scores?: Record<MetricKey, number | null>;
  active?: boolean;
  refresh?: boolean;
};
const fieldClass = "min-h-10 w-full rounded-md border border-white/10 bg-gray-950/75 px-3 text-sm text-white outline-none transition-colors placeholder:text-gray-500 focus:border-cyan-400/70 focus:ring-2 focus:ring-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "min-h-10 rounded-md bg-gray-800 px-3 py-2 text-xs font-semibold text-gray-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] transition-[background-color,transform] duration-150 ease-out hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = "min-h-10 rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50";

function draftFromCharacter(character: CcgAdminCommunityCharacter): CharacterDraft {
  return {
    tierGrade: character.tierGrade,
    scores: {
      performance: character.scores.performance === null ? "" : String(character.scores.performance),
      mechanics: character.scores.mechanics === null ? "" : String(character.scores.mechanics),
      combined: character.scores.combined === null ? "" : String(character.scores.combined),
      mythicPlus: character.scores.mythicPlus === null ? "" : String(character.scores.mythicPlus),
    },
  };
}

function parseScore(value: string, maximum: number): number | null | undefined {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) return undefined;
  return parsed;
}

function parseScores(draft: CharacterDraft): Record<MetricKey, number | null> | null {
  const performance = parseScore(draft.scores.performance, 100);
  const mechanics = parseScore(draft.scores.mechanics, 100);
  const combined = parseScore(draft.scores.combined, 100);
  const mythicPlus = parseScore(draft.scores.mythicPlus, 100_000);
  if ([performance, mechanics, combined, mythicPlus].some((value) => value === undefined)) return null;
  return {
    performance: performance ?? null,
    mechanics: mechanics ?? null,
    combined: combined ?? null,
    mythicPlus: mythicPlus ?? null,
  };
}

export default function CcgCommunityManager({ characters, onChanged, onError, onNotice }: Props) {
  const t = useTranslations("admin.ccg.community");
  const ccgT = useTranslations("ccg");
  const [form, setForm] = useState<{ name: string; realmSlug: string; region: string; tierGrade: CcgTierGrade }>({ name: "", realmSlug: "", region: "eu", tierGrade: "C" });
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, CharacterDraft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(Object.fromEntries(characters.map((character) => [character.id, draftFromCharacter(character)])));
  }, [characters]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return characters;
    return characters.filter((character) => [character.name, character.realm, character.guildName, character.specName]
      .some((value) => value?.toLocaleLowerCase().includes(needle)));
  }, [characters, search]);

  const addCharacter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAdding(true);
    try {
      const result = await api.createAdminCcgCommunityCharacter(form);
      setForm((current) => ({ ...current, name: "", realmSlug: "" }));
      onNotice(t("added", { name: result.character.name, realm: result.character.realm }));
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      setAdding(false);
    }
  };

  const updateCharacter = async (character: CcgAdminCommunityCharacter, input: UpdateInput, noticeKey: "saved" | "refreshed" | "restored") => {
    setBusyId(character.id);
    setConfirmingId(null);
    try {
      await api.updateAdminCcgCommunityCharacter(character.id, input);
      onNotice(t(noticeKey, { name: character.name }));
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const removeCharacter = async (character: CcgAdminCommunityCharacter) => {
    setBusyId(character.id);
    setConfirmingId(null);
    try {
      await api.removeAdminCcgCommunityCharacter(character.id);
      onNotice(t("removed", { name: character.name }));
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="ccg-community-title">
      <div className="grid gap-5 xl:grid-cols-[minmax(24rem,.72fr)_minmax(32rem,1.28fr)]">
        <form className="rounded-lg bg-gray-900/65 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" onSubmit={(event) => void addCharacter(event)}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 id="ccg-community-title" className="text-lg font-bold text-white">{t("addTitle")}</h3>
              <p className="mt-1 text-sm leading-6 text-gray-400">{t("description")}</p>
            </div>
            <span className="shrink-0 rounded-full bg-cyan-950/80 px-2.5 py-1 text-xs font-semibold text-cyan-200">{t("cards", { count: characters.filter((character) => character.active).length })}</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-gray-400">
              {t("name")}
              <input className={fieldClass} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoComplete="off" required disabled={adding} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-gray-400">
              {t("realm")}
              <input className={fieldClass} value={form.realmSlug} onChange={(event) => setForm((current) => ({ ...current, realmSlug: event.target.value }))} placeholder="stormreaver" autoComplete="off" required disabled={adding} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-gray-400">
              {t("region")}
              <select className={fieldClass} value={form.region} onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} disabled={adding}>
                {(["eu", "us", "kr", "tw"] as const).map((region) => <option key={region} value={region}>{region.toUpperCase()}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-gray-400">
              {t("rarity")}
              <select className={fieldClass} value={form.tierGrade} onChange={(event) => setForm((current) => ({ ...current, tierGrade: event.target.value as CcgTierGrade }))} disabled={adding}>
                {grades.map((grade) => <option key={grade} value={grade}>{t(`rarityNames.${grade}`)}</option>)}
              </select>
            </label>
          </div>
          <button type="submit" className={`${primaryButton} mt-4 w-full`} disabled={adding || !form.name.trim() || !form.realmSlug.trim()}>
            {adding ? t("adding") : t("add")}
          </button>
        </form>

        <div className="min-w-0 rounded-lg bg-gray-900/65 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-bold text-white">{t("manageTitle")}</h3>
              <p className="mt-1 text-xs text-gray-500">{t("manageDescription")}</p>
            </div>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} className={`${fieldClass} sm:w-64`} placeholder={t("search")} autoComplete="off" />
          </div>

          <div className="mt-3 max-h-[32rem] overflow-y-auto rounded-md bg-gray-950/45">
            {filtered.length === 0 ? (
              <p className="p-5 text-center text-sm text-gray-500">{t(characters.length === 0 ? "empty" : "noResults")}</p>
            ) : (
              <ul className="divide-y divide-white/6">
                {filtered.map((character) => {
                  const busy = busyId === character.id;
                  const draft = drafts[character.id] ?? draftFromCharacter(character);
                  const savedDraft = draftFromCharacter(character);
                  const scores = parseScores(draft);
                  const changed = JSON.stringify(draft) !== JSON.stringify(savedDraft);
                  return (
                    <li key={character.id} className={`p-3 ${character.active ? "" : "opacity-60"}`}>
                      <div className="grid gap-3 sm:grid-cols-[2.5rem_minmax(10rem,1fr)_9rem_auto] sm:items-center">
                        <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-md bg-gray-800">
                          {character.avatarUrl ? <img src={character.avatarUrl} alt="" className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-white/10" /> : <span className="text-xs text-gray-500">?</span>}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="truncate text-sm text-white">{character.name} <span className="font-medium text-gray-500">· {character.realm}</span></strong>
                            <span className={`rounded px-1.5 py-0.5 text-[.65rem] font-semibold ${character.active ? "bg-emerald-950 text-emerald-300" : "bg-gray-800 text-gray-400"}`}>{t(character.active ? "active" : "inactive")}</span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-gray-500">{character.guildName ?? t("noGuild")} · {character.specName} · {t(character.linkedCharacterId ? "linked" : "blizzardOnly")}</p>
                        </div>
                        <select
                          className={fieldClass}
                          value={draft.tierGrade}
                          onChange={(event) => setDrafts((current) => ({
                            ...current,
                            [character.id]: { ...draft, tierGrade: event.target.value as CcgTierGrade },
                          }))}
                          aria-label={t("rarityFor", { name: character.name })}
                          disabled={busy}
                        >
                          {grades.map((grade) => <option key={grade} value={grade}>{t(`rarityNames.${grade}`)}</option>)}
                        </select>
                        <div className="flex flex-wrap justify-start gap-1.5 sm:justify-end">
                          <button type="button" className={secondaryButton} onClick={() => void updateCharacter(character, { tierGrade: draft.tierGrade, scores: scores ?? undefined }, "saved")} disabled={busy || !changed || !scores || !character.active}>{t("save")}</button>
                          <button type="button" className={secondaryButton} onClick={() => void updateCharacter(character, { refresh: true }, "refreshed")} disabled={busy || !character.active}>{t("refresh")}</button>
                          {character.active ? (
                            confirmingId === character.id ? (
                              <button type="button" className="min-h-10 rounded-md bg-red-950 px-3 py-2 text-xs font-bold text-red-200 shadow-[inset_0_0_0_1px_rgba(248,113,113,.3)] transition-[background-color,transform] duration-150 ease-out hover:bg-red-900 active:scale-[0.96]" onClick={() => void removeCharacter(character)} disabled={busy}>{t("confirmRemove")}</button>
                            ) : (
                              <button type="button" className={secondaryButton} onClick={() => setConfirmingId(character.id)} disabled={busy}>{t("remove")}</button>
                            )
                          ) : (
                            <button type="button" className={secondaryButton} onClick={() => void updateCharacter(character, { active: true }, "restored")} disabled={busy}>{t("restore")}</button>
                          )}
                        </div>
                      </div>

                      <fieldset className="mt-3 rounded-lg bg-gray-950/55 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] sm:ml-[3.25rem]">
                        <legend className="px-1 text-xs font-semibold text-gray-400">{t("metrics")}</legend>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {metricKeys.map((key) => {
                            const label = key === "performance"
                              ? ccgT(character.role === "healer" ? "score.healing" : "score.damage")
                              : ccgT(`score.${key}`);
                            return (
                              <label key={key} className="grid gap-1 text-[.68rem] font-semibold text-gray-500">
                                {label}
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  max={key === "mythicPlus" ? 100000 : 100}
                                  step={key === "mythicPlus" ? 1 : 0.1}
                                  value={draft.scores[key]}
                                  onChange={(event) => setDrafts((current) => ({
                                    ...current,
                                    [character.id]: {
                                      ...draft,
                                      scores: { ...draft.scores, [key]: event.target.value },
                                    },
                                  }))}
                                  className={`${fieldClass} tabular-nums`}
                                  placeholder="—"
                                  disabled={busy || !character.active}
                                />
                              </label>
                            );
                          })}
                        </div>
                        <p className={`mt-2 text-xs text-pretty ${scores ? "text-gray-600" : "text-red-300"}`}>{t(scores ? "metricsHelp" : "invalidMetric")}</p>
                      </fieldset>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
