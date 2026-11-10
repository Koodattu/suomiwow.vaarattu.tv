"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LuCheck } from "react-icons/lu";
import { questBoard, questState, readRecords, type FigurineRecords } from "@/lib/figurine-collection";
import { playFigurineCue } from "@/lib/figurine-audio";
import type { PanelActions } from "./WorldPanels";
import { Action, Coins, HeaderExtra } from "./FacilityParts";
import { nextTurn } from "./FacilityOverlay";
import { pointOf } from "./RewardLayer";
import styles from "./quests.module.css";

// How far each quest had got when the board was last looked at, so opening it again shows only
// what was gained since: "<period key>:<progress>" by quest id.
const SEEN_KEY = "suomiwow-figurine-quests-seen";
const readSeen = (): Record<string, string> => { try { return JSON.parse(window.sessionStorage.getItem(SEEN_KEY) ?? "{}"); } catch { return {}; } };
const STEPS = 10, STEP_MS = 85, BETWEEN_MS = 220, OPEN_MS = 420;

// The notice board: daily, weekly and monthly notes side by side. Opening it runs each bar up from
// where it stood, ticking as it climbs and chiming when a quest completes; a claim stamps the note
// and sends its coins to the wallet.
export default function Quests({ records, complete, actions }: { records: FigurineRecords; complete: boolean; actions: PanelActions }) {
  const t = useTranslations("figurineLab.world.quests"), format = useFormatter();
  const board = questBoard(records, complete, actions.now);
  // What to play, fixed as the board opens: each unclaimed quest that has moved since it was seen.
  const [plan] = useState(() => {
    const seen = readSeen(), state = questState(records, actions.now);
    const gains = board.filter(quest => !quest.claimed).flatMap(quest => {
      const [key, value] = (seen[quest.id] ?? "").split(":"), from = key === state[quest.period].key ? Math.min(Number(value) || 0, quest.progress) : 0;
      return from < quest.progress ? [{ id: quest.id, from, to: quest.progress, goal: quest.goal }] : [];
    });
    return gains;
  });
  // While the bars run, a quest shows the value it has climbed to; afterwards its real one.
  const [climbing, setClimbing] = useState<Record<string, number> | null>(() => plan.length ? Object.fromEntries(plan.map(gain => [gain.id, gain.from])) : null);
  const [fresh, setFresh] = useState<string[]>([]);
  // Seen now: the next visit starts its bars from here.
  useEffect(() => {
    const state = questState(readRecords(), new Date());
    try { window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(questBoard(readRecords(), complete, new Date()).map(quest => [quest.id, `${state[quest.period].key}:${quest.progress}`])))); } catch { /* the bars simply replay */ }
  }, [complete, records]);
  useEffect(() => {
    if (!plan.length) return;
    const timers: number[] = [];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { timers.push(window.setTimeout(() => setClimbing(null), 0)); return () => timers.forEach(window.clearTimeout); }
    let at = OPEN_MS;
    for (const gain of plan) {
      const steps = Math.min(STEPS, gain.to - gain.from);
      for (let step = 1; step <= steps; step++) {
        const value = Math.round(gain.from + (gain.to - gain.from) * step / steps);
        timers.push(window.setTimeout(() => {
          setClimbing(current => current && { ...current, [gain.id]: value });
          playFigurineCue("blip", { intensity: 0.8, rate: 0.85 + 0.75 * value / gain.goal });
          if (value >= gain.goal) { playFigurineCue("questDone"); setFresh(current => [...current, gain.id]); }
        }, at + step * STEP_MS));
      }
      at += steps * STEP_MS + BETWEEN_MS;
    }
    timers.push(window.setTimeout(() => setClimbing(null), at));
    return () => timers.forEach(window.clearTimeout);
  }, [plan]);

  const notes = useRef(new Map<string, HTMLElement>());
  const claim = (id: string) => actions.onClaim(id, pointOf(notes.current.get(id)?.querySelector("button") ?? notes.current.get(id) ?? null));
  const ready = board.filter(quest => quest.done && !quest.claimed && (climbing?.[quest.id] ?? quest.goal) >= quest.goal);
  const pending = useRef<number[]>([]);
  useEffect(() => () => pending.current.forEach(window.clearTimeout), []);
  const claimAll = () => ready.forEach((quest, index) => pending.current.push(window.setTimeout(() => claim(quest.id), index * 170)));
  // Ready notes rise to the top of their column, claimed ones sink.
  const columns = useMemo(() => (["daily", "weekly", "monthly"] as const).map(period => ({ period, quests: board.filter(quest => quest.period === period).sort((a, b) => Number(a.claimed) - Number(b.claimed)) })), [board]);
  return <>
    {ready.length > 1 && <HeaderExtra><Action onClick={claimAll}>{t("claimAll")}<Coins count={ready.reduce((sum, quest) => sum + quest.reward, 0)} size={18} /></Action></HeaderExtra>}
    <div className={styles.board}>{columns.map(({ period, quests }) => <section key={period} className={styles.column}>
      <header><h3>{t(period)}</h3><small>{t("resets", { time: format.relativeTime(nextTurn(period, actions.now), actions.now) })}</small></header>
      <ul>{quests.map(quest => {
        const value = climbing?.[quest.id] ?? quest.progress, full = value >= quest.goal;
        return <li key={quest.id} ref={element => { if (element) notes.current.set(quest.id, element); else notes.current.delete(quest.id); }} className={styles.note} data-state={quest.claimed ? "claimed" : full ? "ready" : undefined} data-fresh={fresh.includes(quest.id) || undefined}>
          <div className={styles.top}><b>{t(`items.${quest.id}`)}</b><span className={styles.reward}><Coins count={quest.reward} size={24} /></span></div>
          <div className={styles.foot}>{quest.claimed ? <span className={styles.seal}><LuCheck aria-hidden="true" />{t("claimed")}</span>
            : full && quest.done ? <Action onClick={() => claim(quest.id)}>{t("claim")}</Action>
              : <><div className={styles.progress} role="progressbar" aria-label={t(`items.${quest.id}`)} aria-valuenow={value} aria-valuemin={0} aria-valuemax={quest.goal}><i style={{ width: `${value / quest.goal * 100}%` }} /></div><span className={styles.count}>{value}/{quest.goal}</span></>}</div>
        </li>;
      })}</ul>
    </section>)}</div>
  </>;
}
