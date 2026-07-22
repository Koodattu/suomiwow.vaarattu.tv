"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { CcgFinish } from "@/types";
import { useCcgCatalog, useCcgSets } from "@/lib/queries";
import { formatRealmName } from "@/lib/utils";
import CcgShell from "@/components/ccg/CcgShell";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import CollectibleCard from "@/components/ccg/CollectibleCard";
import vaultStyles from "@/components/ccg/ccg.module.css";
import styles from "@/components/ccg/card-prototypes.module.css";

type PrototypeFinish = CcgFinish | "void";

const prototypeFinishes: readonly PrototypeFinish[] = ["standard", "foil", "golden", "prismatic", "holographic", "void", "negative"];

export default function PrototypeLab() {
  const t = useTranslations("ccg");
  const setsQuery = useCcgSets();
  const sets = setsQuery.data?.sets ?? [];
  const [setSlug, setSetSlug] = useState("");
  const [samplePage, setSamplePage] = useState(1);
  const [cardId, setCardId] = useState("");
  const [finish, setFinish] = useState<PrototypeFinish>("standard");
  const [cardWidth, setCardWidth] = useState(400);
  const [guides, setGuides] = useState(false);
  const [hideCornerIcons, setHideCornerIcons] = useState(false);
  const [hideBadges, setHideBadges] = useState(false);

  useEffect(() => {
    if (sets.length === 0 || setSlug) return;
    const requested = new URLSearchParams(window.location.search).get("set");
    const selected = sets.find((set) => set.slug === requested) ?? sets.find((set) => set.state === "current" && set.cardCount > 0) ?? sets.find((set) => set.cardCount > 0);
    if (selected) setSetSlug(selected.slug);
  }, [setSlug, sets]);

  const catalogQuery = useCcgCatalog(setSlug, samplePage, "all", "", "", Boolean(setSlug));
  const cards = useMemo(() => catalogQuery.data?.cards.filter((card) => card.renderUrl) ?? [], [catalogQuery.data?.cards]);
  const card = cards.find((candidate) => candidate.id === cardId) ?? cards[0];
  const samplePages = catalogQuery.data?.pages ?? 1;

  const changeSet = (slug: string) => {
    setSetSlug(slug);
    setSamplePage(1);
    setCardId("");
    const url = new URL(window.location.href);
    url.searchParams.set("set", slug);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <CcgShell>
      <div className={styles.labPage}>
        <header className={styles.labHeader}>
          <div>
            <p className={styles.labKicker}>{t("prototypes.kicker")}</p>
            <h1>{t("prototypes.title")}</h1>
            <p>{t("prototypes.body")}</p>
          </div>
          <Link href="/fun/ccg/open" className={vaultStyles.secondaryButton}>{t("prototypes.back")}</Link>
        </header>

        <section className={styles.controls} aria-label={t("prototypes.controls")}>
          <label>
            <span>{t("prototypes.set")}</span>
            <select value={setSlug} onChange={(event) => changeSet(event.target.value)}>
              {sets.filter((set) => set.cardCount > 0).map((set) => <option key={set.id} value={set.slug}>{set.raidName}</option>)}
            </select>
          </label>
          <label>
            <span>{t("prototypes.sample")}</span>
            <select value={card?.id ?? ""} onChange={(event) => setCardId(event.target.value)} disabled={cards.length === 0}>
              {cards.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {formatRealmName(candidate.realm)}</option>)}
            </select>
          </label>
          <div className={styles.pageControl}>
            <span>{t("prototypes.samplePage")}</span>
            <div>
              <button type="button" onClick={() => { setSamplePage((page) => Math.max(1, page - 1)); setCardId(""); }} disabled={samplePage <= 1} aria-label={t("prototypes.previousPage")}>←</button>
              <strong>{samplePage} / {samplePages}</strong>
              <button type="button" onClick={() => { setSamplePage((page) => Math.min(samplePages, page + 1)); setCardId(""); }} disabled={samplePage >= samplePages} aria-label={t("prototypes.nextPage")}>→</button>
            </div>
          </div>
          <label>
            <span>{t("prototypes.finish")}</span>
            <select value={finish} onChange={(event) => setFinish(event.target.value as PrototypeFinish)}>
              {prototypeFinishes.map((value) => <option key={value} value={value}>{t(`finish.${value}`)}</option>)}
            </select>
          </label>
          <label>
            <span>{t("prototypes.size")}</span>
            <select value={cardWidth} onChange={(event) => setCardWidth(Number(event.target.value))}>
              {[320, 360, 400, 440].map((value) => <option key={value} value={value}>{value} px</option>)}
            </select>
          </label>
          <label className={styles.guideControl}><input type="checkbox" checked={guides} onChange={(event) => setGuides(event.target.checked)} /><span>{t("prototypes.showGuides")}</span></label>
          <label className={styles.guideControl}><input type="checkbox" checked={hideCornerIcons} onChange={(event) => setHideCornerIcons(event.target.checked)} /><span>{t("prototypes.hideCornerIcons")}</span></label>
          <label className={styles.guideControl}><input type="checkbox" checked={hideBadges} onChange={(event) => setHideBadges(event.target.checked)} /><span>{t("prototypes.hideBadges")}</span></label>
        </section>

        {setsQuery.isError || catalogQuery.isError ? (
          <div className={styles.loadState}><CcgLoadError onRetry={() => { void setsQuery.refetch(); void catalogQuery.refetch(); }} /></div>
        ) : !card ? (
          <div className={styles.loadState}>{setsQuery.isLoading || catalogQuery.isLoading ? t("prototypes.loading") : t("prototypes.noCards")}</div>
        ) : (
          <>
            <div className={styles.labNotes}><p>{t("prototypes.hint")}</p><p>{t("prototypes.rarityExplainer")}</p></div>
            <div className={styles.prototypeGrid}>
              <section className={styles.prototypeStage}>
                <header>
                  <div><strong>{t("prototypes.frames.vaultSteel.title")}</strong><span>{t("prototypes.frames.vaultSteel.tag")}</span></div>
                  <p>{t("prototypes.frames.vaultSteel.body")}</p>
                </header>
                <div className={styles.cardMount}>
                  <CollectibleCard card={card} finish={finish} width={cardWidth} guides={guides} hideCornerIcons={hideCornerIcons} hideBadges={hideBadges} />
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </CcgShell>
  );
}
