"use client";

import { useTranslations } from "next-intl";
import { FaBolt, FaShieldHalved, FaWandMagicSparkles } from "react-icons/fa6";
import type { CcgGameAssignments } from "@/types";
import type { CcgRosterOption } from "./CcgRosterBuilder";
import styles from "./ccg-games.module.css";

type Props = {
  cards: CcgRosterOption[];
  assignments: CcgGameAssignments;
  phases: Array<{ id: string; label: string }>;
  raidSize: boolean;
  onChange: (assignments: CcgGameAssignments) => void;
};

export const EMPTY_ASSIGNMENTS: CcgGameAssignments = {
  interruptCardIds: [],
  dispelCardId: null,
  soakCardIds: [],
  heroismPhase: null,
  defensivePhase: null,
  strategy: "standard",
};

export function createAutoAssignments(cards: CcgRosterOption[], phases: Array<{ id: string }>, raidSize: boolean): CcgGameAssignments {
  const byMechanics = [...cards].sort((left, right) => right.mechanics - left.mechanics);
  const interrupts = byMechanics.filter((card) => card.utilities.includes("interrupt")).slice(0, raidSize ? 4 : 2).map((card) => card.id);
  const dispeller = byMechanics.find((card) => card.utilities.includes("dispel"))?.id ?? null;
  const soaks = byMechanics.slice(0, raidSize ? 6 : 2).map((card) => card.id);
  const heroismPhase = phases.at(-1)?.id ?? null;
  const healingPhase = phases.find((phase) => /collapse|light|maze|gallery/i.test(phase.id))?.id ?? phases.at(-1)?.id ?? null;
  return { interruptCardIds: interrupts, dispelCardId: dispeller, soakCardIds: soaks, heroismPhase, defensivePhase: healingPhase, strategy: "standard" };
}

export default function CcgTacticsPanel({ cards, assignments, phases, raidSize, onChange }: Props) {
  const t = useTranslations("ccg.play");
  const interruptTarget = raidSize ? 4 : 2;
  const soakTarget = raidSize ? 6 : 2;
  const toggleList = (key: "interruptCardIds" | "soakCardIds", id: string, maximum: number) => {
    const values = assignments[key];
    onChange({ ...assignments, [key]: values.includes(id) ? values.filter((value) => value !== id) : values.length < maximum ? [...values, id] : values });
  };

  return (
    <section className={styles.tacticsPanel} aria-labelledby="tactics-title">
      <div className={styles.sectionHeading}>
        <div><span className={styles.eyebrow}>{t("tactics.eyebrow")}</span><h2 id="tactics-title">{t("tactics.title")}</h2></div>
        <button type="button" className={styles.secondaryButton} onClick={() => onChange(createAutoAssignments(cards, phases, raidSize))}>
          <FaWandMagicSparkles aria-hidden="true" />{t("tactics.autoAssign")}
        </button>
      </div>

      <div className={styles.tacticsGrid}>
        <fieldset>
          <legend><FaBolt aria-hidden="true" />{t("tactics.interrupts", { count: interruptTarget })}</legend>
          <div className={styles.assignmentCards}>
            {cards.filter((card) => card.utilities.includes("interrupt")).map((card) => (
              <button type="button" key={card.id} data-selected={assignments.interruptCardIds.includes(card.id)} onClick={() => toggleList("interruptCardIds", card.id, interruptTarget)}>
                {card.name}<small>{Math.round(card.mechanics)}</small>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t("tactics.dispeller")}</legend>
          <select value={assignments.dispelCardId ?? ""} onChange={(event) => onChange({ ...assignments, dispelCardId: event.target.value || null })}>
            <option value="">{t("tactics.unassigned")}</option>
            {cards.filter((card) => card.utilities.includes("dispel")).map((card) => <option value={card.id} key={card.id}>{card.name}</option>)}
          </select>
        </fieldset>
        <fieldset>
          <legend>{t("tactics.soakers", { count: soakTarget })}</legend>
          <div className={styles.assignmentCards}>
            {cards.map((card) => (
              <button type="button" key={card.id} data-selected={assignments.soakCardIds.includes(card.id)} onClick={() => toggleList("soakCardIds", card.id, soakTarget)}>
                {card.name}<small>{Math.round(card.mechanics)}</small>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className={styles.timingFields}>
          <legend><FaShieldHalved aria-hidden="true" />{t("tactics.timing")}</legend>
          <label><span>{t("tactics.heroism")}</span><select value={assignments.heroismPhase ?? ""} onChange={(event) => onChange({ ...assignments, heroismPhase: event.target.value || null })}><option value="">{t("tactics.none")}</option>{phases.map((phase) => <option value={phase.id} key={phase.id}>{phase.label}</option>)}</select></label>
          <label><span>{t("tactics.defensive")}</span><select value={assignments.defensivePhase ?? ""} onChange={(event) => onChange({ ...assignments, defensivePhase: event.target.value || null })}><option value="">{t("tactics.none")}</option>{phases.map((phase) => <option value={phase.id} key={phase.id}>{phase.label}</option>)}</select></label>
        </fieldset>
      </div>
      <fieldset className={styles.strategyPicker}>
        <legend>{t("tactics.strategy")}</legend>
        {(["safe", "standard", "aggressive"] as const).map((strategy) => (
          <button type="button" key={strategy} data-selected={assignments.strategy === strategy} onClick={() => onChange({ ...assignments, strategy })}>
            <strong>{t(`strategy.${strategy}`)}</strong><small>{t(`strategy.${strategy}Hint`)}</small>
          </button>
        ))}
      </fieldset>
    </section>
  );
}
