"use client";

import { useTranslations } from "next-intl";
import { type Catch, type FigurineCollection, type FigurineRecords, type MachineItem, type MachineOutcome, type Reward } from "@/lib/figurine-collection";
import type { Station } from "@/lib/figurine-world";
import type { CastResult } from "@/lib/figurine-facilities";
import CollectionCatalogue, { type CatalogueActions } from "./CollectionCatalogue";
import styles from "./world-panels.module.css";

// The collection catalogue keeps its docked layout.
export type PanelSeries = { id: string; number: string; released: boolean; hidden?: boolean; keys: string[] };
export type MachinePanel = { kind: "recycler" | "forge"; slots: MachineItem[]; groups: (MachineItem & { spare: number })[]; onPick: (item: MachineItem) => void; onClear: () => void; onRemove: (index: number) => void; onRun: () => void; outcome: MachineOutcome; busy: boolean };
// What a station's last action brought, shown once its animation has played.
export type PanelResult = { station: "crate"; day: number; reward: Reward } | { station: "wheel"; reward: Reward; figure?: MachineItem }
  | { station: "pond"; caught: Catch; figure?: MachineItem } | { station: "pond"; missed: Exclude<CastResult, "caught"> };
// Where the line is: being cast, waiting, nibbled at (for a moment), or bitten.
export type LinePhase = "cast" | "wait" | "nibble" | "bite";
// The daily stations' actions, and whether one is playing now.
export type PanelActions = {
  busy: boolean; result: PanelResult | null; now: Date;
  onSpin: () => void; onClaim: (id: string) => void;
};
type Props = CatalogueActions & {
  view: Station; collection: FigurineCollection; records: FigurineRecords; series: PanelSeries[];
  onClose: () => void;
};
export default function WorldPanel(props: Props) {
  const t = useTranslations("figurineLab.world");
  const { view, onClose } = props;
  if (view !== "gallery") return null;
  const title = t("stations.gallery");
  return <aside className={styles.panel} data-wide="catalogue" aria-label={title}>
    <header className={styles.head}>
      <h2>{title}</h2>
      <button type="button" className={styles.close} onClick={onClose} aria-label={t("close")}>×</button>
    </header>
    <CollectionCatalogue {...props} />
  </aside>;
}
