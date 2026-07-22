"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { CcgCard, CcgFinish, CcgTierGrade, GuildCrest as GuildCrestData } from "@/types";
import { useCcgCatalog, useCcgSets, useGuildSummaryByRealmName } from "@/lib/queries";
import { formatRealmName, formatSpecName, getClassInfoById, getSpecIconUrl } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import GuildCrest from "@/components/GuildCrest";
import CcgShell from "@/components/ccg/CcgShell";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import vaultStyles from "@/components/ccg/ccg.module.css";
import styles from "@/components/ccg/card-prototypes.module.css";

const roleIcons: Record<CcgCard["role"], string> = {
  tank: "/ccg/role_tank.png",
  healer: "/ccg/role_healer.png",
  dps: "/ccg/role_damage.png",
};

const rarityKeys: Record<CcgTierGrade, "legendary" | "epic" | "rare" | "uncommon" | "common"> = {
  Crown: "legendary",
  S: "legendary",
  A: "epic",
  B: "rare",
  C: "uncommon",
  D: "common",
  E: "common",
  F: "common",
};

const classColors: Record<string, string> = {
  "Death Knight": "#C41E3A",
  "Demon Hunter": "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

const frameVariants = ["vaultSteel"] as const;

type FrameVariant = (typeof frameVariants)[number];

function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(value >= 1000 ? 0 : 1);
}

function PrototypeCard({
  card,
  finish,
  width,
  renderWidth,
  renderBottom,
  frameVariant,
  guides,
  hideCornerIcons,
  hideBadges,
  guildCrest,
  guildFaction,
}: {
  card: CcgCard;
  finish: CcgFinish;
  width: number;
  renderWidth: number;
  renderBottom: number;
  frameVariant: FrameVariant;
  guides: boolean;
  hideCornerIcons: boolean;
  hideBadges: boolean;
  guildCrest?: GuildCrestData;
  guildFaction?: string;
}) {
  const t = useTranslations("ccg");
  const classInfo = getClassInfoById(card.classID);
  const specIcon = getSpecIconUrl(card.classID, card.specName);
  const rarity = t(`rarity.${rarityKeys[card.tierGrade]}`);
  const guild = card.guildName ? `<${card.guildName}>` : t("independent");
  const realm = formatRealmName(card.realm);
  const cardStyle = {
    "--lab-accent": card.set.theme.accent,
    "--lab-glow": card.set.theme.glow,
    "--class-color": classColors[classInfo.name] ?? "#ffffff",
    "--lab-art": `url("${card.set.backgroundPath}")`,
    "--crop-x": `${card.backgroundCrop.x}%`,
    "--crop-y": `${card.backgroundCrop.y}%`,
    "--crop-scale": card.backgroundCrop.scale,
    "--card-width": `${width}px`,
    "--render-width": `${renderWidth}%`,
    "--render-bottom": `${renderBottom}%`,
    "--tilt-x": "0deg",
    "--tilt-y": "0deg",
    "--pointer-x": "50%",
    "--pointer-y": "38%",
  } as CSSProperties;

  const updateMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    event.currentTarget.style.setProperty("--tilt-x", `${((0.5 - y) * 7).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--tilt-y", `${((x - 0.5) * 8).toFixed(2)}deg`);
    event.currentTarget.style.setProperty("--pointer-x", `${(x * 100).toFixed(1)}%`);
    event.currentTarget.style.setProperty("--pointer-y", `${(y * 100).toFixed(1)}%`);
  };

  const resetMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
    event.currentTarget.style.setProperty("--pointer-x", "50%");
    event.currentTarget.style.setProperty("--pointer-y", "38%");
  };

  return (
    <article
      className={`${styles.prototypeCard} ${styles.vaultRelic} ${finish === "standard" ? "" : styles[finish]} ${guides ? styles.guides : ""}`}
      data-grade={card.tierGrade}
      data-finish={finish}
      data-frame={frameVariant}
      style={cardStyle}
      onPointerMove={updateMaterial}
      onPointerLeave={resetMaterial}
      aria-label={`${card.name}, ${guild}, ${realm}, ${card.set.raidName}, ${formatSpecName(card.specName)} ${classInfo.name}, ${t(`role.${card.role}`)}, ${rarity}, ${t(`finish.${finish}`)}`}
    >
      <span className={styles.outerFrame} aria-hidden="true" />
      <span className={styles.innerFrame} aria-hidden="true" />
      <span className={styles.artworkClip} aria-hidden="true">
        <span className={styles.raidArt} />
        <span className={styles.raidShade} />
      </span>
      <span className={styles.lowerDeck} aria-hidden="true" />
      <span className={styles.renderWindow} aria-hidden="true">
        {card.renderUrl ? (
          <Image src={card.renderUrl} alt="" fill sizes={`${width}px`} className={styles.renderImage} unoptimized />
        ) : null}
      </span>

      {!hideBadges ? <span className={styles.realmLabel}>{realm}</span> : null}

      <span className={styles.identity}>
        <strong className={styles.characterName}>{card.name}</strong>
        <span className={styles.guildName}>{guild}</span>
      </span>

      {!hideCornerIcons ? (
        <>
          <span className={`${styles.cornerCrest} ${styles.classCrest}`}>
            <IconImage iconFilename={classInfo.iconUrl} alt="" width={40} height={40} />
            <span>{classInfo.name}</span>
          </span>
          <span className={`${styles.cornerCrest} ${styles.specCrest}`}>
            <IconImage iconFilename={specIcon} alt="" width={40} height={40} />
            <span>{formatSpecName(card.specName)}</span>
          </span>

          <span className={styles.roleCrest}>
            <Image src={roleIcons[card.role]} alt="" width={28} height={28} />
            <span>{t(`role.${card.role}`)}</span>
          </span>

          <span className={styles.guildCrest} aria-label={t("prototypes.guildCrest", { guild: card.guildName ?? t("independent") })}>
            <GuildCrest crest={guildCrest} faction={guildFaction} size={128} className={styles.guildCrestCanvas} />
          </span>
        </>
      ) : null}

      <span className={styles.rarityPlate}>
        <strong>{rarity}</strong>
      </span>

      <span className={styles.characterMeta}>
        <span>{classInfo.name}</span>
        <span aria-hidden="true">·</span>
        <span>{formatSpecName(card.specName)}</span>
        <span aria-hidden="true">·</span>
        <span>{t(`role.${card.role}`)}</span>
      </span>

      {!hideBadges ? (
        <span className={styles.setChip}>
          <span>{card.set.raidName}</span>
        </span>
      ) : null}

      <span className={styles.statsPanel}>
        <span className={styles.stat}>
          <span>{t(card.role === "healer" ? "score.healing" : "score.damage")}</span>
          <strong>{score(card.scores.performance)}</strong>
        </span>
        <span className={styles.stat}>
          <span>{t("score.mechanics")}</span>
          <strong>{score(card.scores.mechanics)}</strong>
        </span>
        <span className={styles.stat}>
          <span>{t("score.combined")}</span>
          <strong>{score(card.scores.combined)}</strong>
        </span>
        <span className={styles.stat}>
          <span>{t("score.mythicPlus")}</span>
          <strong>{score(card.scores.mythicPlus)}</strong>
        </span>
      </span>

      <span className={styles.cardFooter}>
        <span>{realm}</span>
        <span>{String(card.setNumber).padStart(3, "0")} / {String(card.set.cardCount).padStart(3, "0")}</span>
      </span>

      {finish !== "standard" ? (
        <span className={styles.finishMark} aria-label={t(`finish.${finish}`)} title={t(`finish.${finish}`)}>
          <span className={styles.finishGlyph} aria-hidden="true" />
        </span>
      ) : null}
      <span className={styles.finishLayer} aria-hidden="true" />
      <span className={styles.materialLight} aria-hidden="true" />
    </article>
  );
}

export default function PrototypeLab() {
  const t = useTranslations("ccg");
  const setsQuery = useCcgSets();
  const sets = setsQuery.data?.sets ?? [];
  const [setSlug, setSetSlug] = useState("");
  const [samplePage, setSamplePage] = useState(1);
  const [cardId, setCardId] = useState("");
  const [finish, setFinish] = useState<CcgFinish>("standard");
  const [cardWidth, setCardWidth] = useState(400);
  const [renderWidth, setRenderWidth] = useState(250);
  const [renderBottom, setRenderBottom] = useState(-50);
  const [guides, setGuides] = useState(false);
  const [hideCornerIcons, setHideCornerIcons] = useState(false);
  const [hideBadges, setHideBadges] = useState(false);

  useEffect(() => {
    if (sets.length === 0 || setSlug) return;
    const requested = new URLSearchParams(window.location.search).get("set");
    const selected = sets.find((set) => set.slug === requested)
      ?? sets.find((set) => set.state === "current" && set.cardCount > 0)
      ?? sets.find((set) => set.cardCount > 0);
    if (selected) setSetSlug(selected.slug);
  }, [setSlug, sets]);

  const catalogQuery = useCcgCatalog(setSlug, samplePage, "all", "", "", Boolean(setSlug));
  const cards = useMemo(() => catalogQuery.data?.cards.filter((card) => card.renderUrl) ?? [], [catalogQuery.data?.cards]);
  const card = cards.find((candidate) => candidate.id === cardId) ?? cards[0];
  const samplePages = catalogQuery.data?.pages ?? 1;
  const guildQuery = useGuildSummaryByRealmName(card?.guildRealm ?? "", card?.guildName ?? "");

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

        <section className={styles.controls} aria-label={t("prototypes.controls") }>
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
            <select value={finish} onChange={(event) => setFinish(event.target.value as CcgFinish)}>
              {(["standard", "golden", "prismatic"] as CcgFinish[]).map((value) => <option key={value} value={value}>{t(`finish.${value}`)}</option>)}
            </select>
          </label>
          <label>
            <span>{t("prototypes.size")}</span>
            <select value={cardWidth} onChange={(event) => setCardWidth(Number(event.target.value))}>
              {[320, 360, 400, 440].map((value) => <option key={value} value={value}>{value} px</option>)}
            </select>
          </label>
          <label className={styles.rangeControl}>
            <span>{t("prototypes.renderScale")} <strong>{renderWidth}%</strong></span>
            <input type="range" min="180" max="320" step="1" value={renderWidth} onChange={(event) => setRenderWidth(Number(event.target.value))} />
          </label>
          <label className={styles.rangeControl}>
            <span>{t("prototypes.renderOffset")} <strong>{renderBottom}%</strong></span>
            <input type="range" min="-70" max="-10" step="1" value={renderBottom} onChange={(event) => setRenderBottom(Number(event.target.value))} />
          </label>
          <label className={styles.guideControl}>
            <input type="checkbox" checked={guides} onChange={(event) => setGuides(event.target.checked)} />
            <span>{t("prototypes.showGuides")}</span>
          </label>
          <label className={styles.guideControl}>
            <input type="checkbox" checked={hideCornerIcons} onChange={(event) => setHideCornerIcons(event.target.checked)} />
            <span>{t("prototypes.hideCornerIcons")}</span>
          </label>
          <label className={styles.guideControl}>
            <input type="checkbox" checked={hideBadges} onChange={(event) => setHideBadges(event.target.checked)} />
            <span>{t("prototypes.hideBadges")}</span>
          </label>
        </section>

        {setsQuery.isError || catalogQuery.isError ? (
          <div className={styles.loadState}><CcgLoadError onRetry={() => { void setsQuery.refetch(); void catalogQuery.refetch(); }} /></div>
        ) : !card ? (
          <div className={styles.loadState}>{setsQuery.isLoading || catalogQuery.isLoading ? t("prototypes.loading") : t("prototypes.noCards")}</div>
        ) : (
          <>
            <div className={styles.labNotes}>
              <p>{t("prototypes.hint")}</p>
              <p>{t("prototypes.rarityExplainer")}</p>
            </div>
            <div className={styles.prototypeGrid}>
              {frameVariants.map((frameVariant) => (
                <section className={styles.prototypeStage} key={frameVariant}>
                  <header>
                    <div><strong>{t(`prototypes.frames.${frameVariant}.title`)}</strong><span>{t(`prototypes.frames.${frameVariant}.tag`)}</span></div>
                    <p>{t(`prototypes.frames.${frameVariant}.body`)}</p>
                  </header>
                  <div className={styles.cardMount}>
                    <PrototypeCard
                      card={card}
                      finish={finish}
                      width={cardWidth}
                      renderWidth={renderWidth}
                      renderBottom={renderBottom}
                      frameVariant={frameVariant}
                      guides={guides}
                      hideCornerIcons={hideCornerIcons}
                      hideBadges={hideBadges}
                      guildCrest={guildQuery.data?.crest}
                      guildFaction={guildQuery.data?.faction}
                    />
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </CcgShell>
  );
}
