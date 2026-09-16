"use client";

import { useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from "@headlessui/react";
import { useTranslations } from "next-intl";
import { FaXmark } from "react-icons/fa6";
import IconImage from "@/components/IconImage";
import type { CcgSet } from "@/types";
import styles from "./ccg.module.css";
import packStyles from "./pack-opening.module.css";

export default function CcgPackSetPicker({ sets, selectedSetIds, onApply, onClose }: {
  sets: CcgSet[];
  selectedSetIds: string[] | null;
  onApply: (setIds: string[] | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations("ccg.open");
  const [draft, setDraft] = useState(() => new Set(selectedSetIds ?? sets.map((set) => set.id)));
  const selected = sets.filter((set) => draft.has(set.id));

  return (
    <Dialog open onClose={onClose} className={styles.leaderboardScoringDialogRoot}>
      <DialogBackdrop className={styles.leaderboardScoringDialogBackdrop} />
      <div className={styles.leaderboardScoringDialogFrame}>
        <DialogPanel className={styles.leaderboardScoringDialog}>
          <div className={styles.leaderboardScoringDialogHeader}>
            <DialogTitle className={styles.leaderboardScoringDialogTitle}>{t("customizeTitle")}</DialogTitle>
            <button type="button" className={styles.leaderboardScoringDialogClose} onClick={onClose} aria-label={t("closeRaidSetPicker")}>
              <FaXmark aria-hidden="true" />
            </button>
          </div>
          <Description className="text-sm text-slate-400">{t("customizeDescription")}</Description>
          <div className={packStyles.setPickerActions}>
            <span aria-live="polite">{t("selectedSets", { count: selected.length, total: sets.length })}</span>
            <button type="button" className={styles.secondaryButton} onClick={() => setDraft(new Set(sets.map((set) => set.id)))}>{t("selectAllSets")}</button>
          </div>
          <div className={packStyles.setPickerList}>
            {sets.map((set) => (
              <label key={set.id} className={packStyles.setPickerChoice}>
                <input
                  type="checkbox"
                  checked={draft.has(set.id)}
                  onChange={(event) => {
                    const next = new Set(draft);
                    if (event.target.checked) next.add(set.id);
                    else next.delete(set.id);
                    setDraft(next);
                  }}
                />
                <IconImage iconFilename={set.iconUrl ?? undefined} alt="" width={32} height={32} />
                <span className={packStyles.modeChoiceCopy}>
                  <small>{set.expansionName}</small>
                  <strong>{set.raidName}</strong>
                </span>
              </label>
            ))}
          </div>
          <p className="text-sm text-slate-400">{t("communityStillIncluded")}</p>
          {selected.length === 0 ? <p className="text-sm text-amber-300" role="status">{t("selectAtLeastOneSet")}</p> : null}
          <div className={packStyles.setPickerActions}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>{t("cancelCustomization")}</button>
            <button type="button" className={styles.primaryButton} disabled={selected.length === 0} onClick={() => onApply(selected.length === sets.length ? null : selected.map((set) => set.id))}>{t("applySets")}</button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
