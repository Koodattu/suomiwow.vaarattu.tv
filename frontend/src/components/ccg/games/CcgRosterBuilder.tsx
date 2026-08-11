"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { FaArrowsRotate, FaMagnifyingGlass, FaUserGroup, FaWandMagicSparkles, FaXmark } from "react-icons/fa6";
import type { CcgCard, CcgGameUtility } from "@/types";
import styles from "./ccg-games.module.css";

export type CcgRosterOption = {
  id: string;
  identityId: string;
  name: string;
  realm: string;
  role: "tank" | "healer" | "dps";
  classID: number;
  specName: string;
  tierGrade: string;
  performance: number;
  mechanics: number;
  combined: number;
  avatarUrl: string | null;
  utilities: CcgGameUtility[];
  card?: CcgCard;
  mercenary?: boolean;
};

type Formation = { tank: number; healer: number; dps: number };

type Props = {
  cards: CcgRosterOption[];
  activeIds: string[];
  benchIds: string[];
  formation: Formation;
  rosterLimit: number;
  allowMercenaries: boolean;
  onChange: (activeIds: string[], benchIds: string[]) => void;
};

const ROLE_ORDER = ["tank", "healer", "dps"] as const;
const UTILITY_ORDER: CcgGameUtility[] = ["interrupt", "dispel", "battle_resurrection", "heroism", "mobility", "raid_defensive", "crowd_control", "ranged"];

export function getCcgMercenaries(formation: Formation): CcgRosterOption[] {
  return ROLE_ORDER.flatMap((role) => Array.from({ length: formation[role] }, (_, index) => ({
    id: `merc:${role}:${index + 1}`,
    identityId: `merc:${role}:${index + 1}`,
    name: role === "tank" ? "PUG Vanguard" : role === "healer" ? "PUG Mender" : "PUG Striker",
    realm: "Looking for Group",
    role,
    classID: role === "tank" ? 1 : role === "healer" ? 5 : 3,
    specName: role === "tank" ? "Protection" : role === "healer" ? "Holy" : "Marksmanship",
    tierGrade: "C",
    performance: 56,
    mechanics: 62,
    combined: 59,
    avatarUrl: null,
    utilities: role === "tank"
      ? ["interrupt", "melee", "sustained", "crowd_control"]
      : role === "healer"
        ? ["ranged", "sustained", "dispel"]
        : ["interrupt", "ranged_interrupt", "ranged", "burst", "heroism", "mobility", "crowd_control"],
    mercenary: true,
  } satisfies CcgRosterOption)));
}

function getRoleCount(ids: string[], options: ReadonlyMap<string, CcgRosterOption>, role: CcgRosterOption["role"]): number {
  return ids.filter((id) => options.get(id)?.role === role).length;
}

function compactScore(score: number): string {
  return Number.isFinite(score) ? String(Math.round(score)) : "—";
}

export default function CcgRosterBuilder({ cards, activeIds, benchIds, formation, rosterLimit, allowMercenaries, onChange }: Props) {
  const t = useTranslations("ccg.play");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | CcgRosterOption["role"]>("all");
  const options = useMemo(() => allowMercenaries ? [...cards, ...getCcgMercenaries(formation)] : cards, [allowMercenaries, cards, formation]);
  const optionById = useMemo(() => new Map(options.map((card) => [card.id, card])), [options]);
  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);
  const benchSet = useMemo(() => new Set(benchIds), [benchIds]);
  const selectedIdentityIds = useMemo(() => new Set([...activeIds, ...benchIds].map((id) => optionById.get(id)?.identityId).filter(Boolean)), [activeIds, benchIds, optionById]);
  const query = search.trim().toLocaleLowerCase();
  const filtered = useMemo(() => options.filter((card) => {
    if (roleFilter !== "all" && card.role !== roleFilter) return false;
    if (!query) return true;
    return `${card.name} ${card.realm} ${card.specName} ${card.utilities.join(" ")}`.toLocaleLowerCase().includes(query);
  }).sort((left, right) => right.combined - left.combined || right.mechanics - left.mechanics || left.name.localeCompare(right.name)), [options, query, roleFilter]);

  const activeCards = activeIds.map((id) => optionById.get(id)).filter((card): card is CcgRosterOption => Boolean(card));
  const benchCards = benchIds.map((id) => optionById.get(id)).filter((card): card is CcgRosterOption => Boolean(card));
  const targetCount = formation.tank + formation.healer + formation.dps;

  const toggleCard = (card: CcgRosterOption) => {
    if (activeSet.has(card.id)) {
      if (rosterLimit > targetCount && benchIds.length < rosterLimit - targetCount) onChange(activeIds.filter((id) => id !== card.id), [...benchIds, card.id]);
      else onChange(activeIds.filter((id) => id !== card.id), benchIds);
      return;
    }
    if (benchSet.has(card.id)) {
      const sameRoleActive = [...activeIds].reverse().find((id) => optionById.get(id)?.role === card.role);
      const canActivate = getRoleCount(activeIds, optionById, card.role) < formation[card.role];
      if (canActivate) onChange([...activeIds, card.id], benchIds.filter((id) => id !== card.id));
      else if (sameRoleActive) onChange(activeIds.map((id) => id === sameRoleActive ? card.id : id), benchIds.map((id) => id === card.id ? sameRoleActive : id));
      return;
    }
    if (selectedIdentityIds.has(card.identityId)) return;
    if (activeIds.length < targetCount && getRoleCount(activeIds, optionById, card.role) < formation[card.role]) {
      onChange([...activeIds, card.id], benchIds);
    } else if (benchIds.length < rosterLimit - targetCount) {
      onChange(activeIds, [...benchIds, card.id]);
    }
  };

  const autoFill = () => {
    const identityIds = new Set<string>();
    const nextActive: string[] = [];
    for (const role of ROLE_ORDER) {
      const owned = options.filter((card) => card.role === role && !card.mercenary).sort((left, right) => right.combined - left.combined || right.mechanics - left.mechanics);
      const mercenaries = options.filter((card) => card.role === role && card.mercenary);
      for (const card of [...owned, ...mercenaries]) {
        if (nextActive.filter((id) => optionById.get(id)?.role === role).length >= formation[role]) break;
        if (identityIds.has(card.identityId)) continue;
        identityIds.add(card.identityId);
        nextActive.push(card.id);
      }
    }
    onChange(nextActive, []);
  };

  const clear = () => onChange([], []);
  const utilityCounts = new Map<CcgGameUtility, number>();
  activeCards.forEach((card) => card.utilities.forEach((utility) => utilityCounts.set(utility, (utilityCounts.get(utility) ?? 0) + 1)));
  const valid = ROLE_ORDER.every((role) => getRoleCount(activeIds, optionById, role) === formation[role]);

  return (
    <section className={styles.rosterBuilder} aria-labelledby="roster-builder-title">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>{t("roster.eyebrow")}</span>
          <h2 id="roster-builder-title">{t("roster.title")}</h2>
        </div>
        <div className={styles.rosterActions}>
          <button type="button" className={styles.secondaryButton} onClick={autoFill}>
            <FaWandMagicSparkles aria-hidden="true" />
            {t("roster.autoFill")}
          </button>
          <button type="button" className={styles.iconButton} onClick={clear} aria-label={t("roster.clear")} title={t("roster.clear")}>
            <FaArrowsRotate aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={styles.roleLanes}>
        {ROLE_ORDER.map((role) => {
          const laneCards = activeCards.filter((card) => card.role === role);
          return (
            <div className={styles.roleLane} key={role} data-valid={laneCards.length === formation[role]}>
              <div className={styles.roleLaneHeading}>
                <span>{t(`role.${role}`)}</span>
                <span className={styles.tabular}>{laneCards.length}/{formation[role]}</span>
              </div>
              <div className={styles.roleSlots}>
                {Array.from({ length: formation[role] }, (_, index) => {
                  const card = laneCards[index];
                  return card ? (
                    <button type="button" className={styles.rosterChip} key={card.id} onClick={() => toggleCard(card)} title={rosterLimit > targetCount ? t("roster.moveToBench") : t("roster.remove")}>
                      {card.avatarUrl ? <Image src={card.avatarUrl} alt="" width={32} height={32} /> : <FaUserGroup aria-hidden="true" />}
                      <span><strong>{card.name}</strong><small>{card.specName}</small></span>
                      <FaXmark aria-hidden="true" />
                    </button>
                  ) : <span className={styles.emptySlot} key={`${role}-${index}`}>{t("roster.empty")}</span>;
                })}
              </div>
            </div>
          );
        })}
      </div>

      {rosterLimit > targetCount ? (
        <div className={styles.benchLane}>
          <div className={styles.roleLaneHeading}><span>{t("roster.bench")}</span><span className={styles.tabular}>{benchCards.length}/{rosterLimit - targetCount}</span></div>
          <div className={styles.benchCards}>
            {benchCards.length > 0 ? benchCards.map((card) => (
              <button type="button" className={styles.benchChip} key={card.id} onClick={() => toggleCard(card)}>
                {card.name}<small>{t("roster.swapIn")}</small>
              </button>
            )) : <span className={styles.emptyBench}>{t("roster.benchHint")}</span>}
          </div>
        </div>
      ) : null}

      <div className={styles.coverage} aria-label={t("roster.coverage")}>
        {UTILITY_ORDER.map((utility) => (
          <span key={utility} data-covered={(utilityCounts.get(utility) ?? 0) > 0}>
            {t(`utility.${utility}`)} <strong className={styles.tabular}>{utilityCounts.get(utility) ?? 0}</strong>
          </span>
        ))}
      </div>

      <div className={styles.cardBrowser}>
        <div className={styles.cardBrowserControls}>
          <label className={styles.searchField}>
            <FaMagnifyingGlass aria-hidden="true" />
            <span className="sr-only">{t("roster.search")}</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("roster.search")} />
          </label>
          <div className={styles.roleFilters}>
            {(["all", ...ROLE_ORDER] as const).map((role) => (
              <button type="button" key={role} data-active={roleFilter === role} onClick={() => setRoleFilter(role)}>{t(`role.${role}`)}</button>
            ))}
          </div>
          <span className={valid ? styles.validRoster : styles.invalidRoster} role="status">
            {valid ? t("roster.valid") : t("roster.incomplete")}
          </span>
        </div>
        <div className={styles.cardGrid}>
          {filtered.map((card) => {
            const state = activeSet.has(card.id) ? "active" : benchSet.has(card.id) ? "bench" : "available";
            const duplicateIdentity = state === "available" && selectedIdentityIds.has(card.identityId);
            return (
              <button
                type="button"
                className={styles.rosterCard}
                key={card.id}
                data-state={state}
                data-mercenary={card.mercenary || undefined}
                disabled={duplicateIdentity}
                onClick={() => toggleCard(card)}
                aria-pressed={state !== "available"}
              >
                <span className={styles.rosterCardPortrait}>
                  {card.avatarUrl ? <Image src={card.avatarUrl} alt="" width={42} height={42} /> : <FaUserGroup aria-hidden="true" />}
                  <small>{card.role === "dps" ? t("role.dpsShort") : t(`role.${card.role}`)}</small>
                </span>
                <span className={styles.rosterCardCopy}>
                  <strong>{card.name}</strong>
                  <small>{card.specName} · {card.realm}</small>
                  <span>
                    {t("roster.performance")} <b className={styles.tabular}>{compactScore(card.performance)}</b>
                    {t("roster.mechanics")} <b className={styles.tabular}>{compactScore(card.mechanics)}</b>
                  </span>
                </span>
                <span className={styles.gradeBadge}>{card.tierGrade}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
