"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { CcgCard, CcgFinish, CcgTierGrade, GuildCrest as GuildCrestData } from "@/types";
import { normalizeCcgTierGrade } from "@/lib/ccg";
import { useCcgCatalog, useCcgSets, useGuildSummaryByRealmName } from "@/lib/queries";
import { formatRealmName, formatSpecName, getClassInfoById, getSpecIconUrl } from "@/lib/utils";
import IconImage from "@/components/IconImage";
import GuildCrest from "@/components/GuildCrest";
import AlphaFittedCharacterRender from "@/components/ccg/AlphaFittedCharacterRender";
import CcgShell from "@/components/ccg/CcgShell";
import CcgLoadError from "@/components/ccg/CcgLoadError";
import vaultStyles from "@/components/ccg/ccg.module.css";
import styles from "@/components/ccg/card-prototypes.module.css";

const roleIcons: Record<CcgCard["role"], string> = {
  tank: "/ccg/role_tank.png",
  healer: "/ccg/role_healer.png",
  dps: "/ccg/role_damage.png",
};

const rarityKeys: Record<CcgTierGrade, "legendary" | "epic" | "rare" | "uncommon" | "common" | "junk"> = {
  S: "legendary",
  A: "epic",
  B: "rare",
  C: "uncommon",
  D: "common",
  E: "common",
  F: "junk",
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
const SHOW_ROLE_AND_GUILD_CRESTS = false;

type FrameVariant = (typeof frameVariants)[number];

const frameRingPath = [
  "M 24 4 H 476 Q 496 4 496 24 V 676 Q 496 696 476 696",
  "H 24 Q 4 696 4 676 V 24 Q 4 4 24 4 Z",
  "M 82 14 H 418 Q 422 14 422 18 V 66 Q 422 74 430 74 H 470 Q 486 74 486 90",
  "V 676 Q 486 686 476 686",
  "H 377 C 367 686 365 668 355 668 H 145 C 135 668 133 686 123 686",
  "H 24 Q 14 686 14 676 V 90 Q 14 74 30 74 H 70 Q 78 74 78 66",
  "V 18 Q 78 14 82 14 Z",
].join(" ");

const frameInnerEdgePath = [
  "M 82 14 H 418 Q 422 14 422 18 V 66 Q 422 74 430 74 H 470 Q 486 74 486 90",
  "V 676 Q 486 686 476 686",
  "H 377 C 367 686 365 668 355 668 H 145 C 135 668 133 686 123 686",
  "H 24 Q 14 686 14 676 V 90 Q 14 74 30 74 H 70 Q 78 74 78 66",
  "V 18 Q 78 14 82 14 Z",
].join(" ");

function FrameGeometry() {
  const gradientId = `vault-frame-${useId().replace(/:/g, "")}`;

  return (
    <svg className={styles.frameGeometry} viewBox="0 0 500 700" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(-90 0.5 0.5)">
          <stop offset="0" stopColor="var(--metal-light)" />
          <stop offset="0.13" stopColor="var(--metal-dark)" />
          <stop offset="0.28" stopColor="var(--metal-mid)" />
          <stop offset="0.48" stopColor="#030507" />
          <stop offset="0.66" stopColor="color-mix(in srgb, var(--lab-accent) 25%, var(--metal-light))" />
          <stop offset="0.84" stopColor="var(--metal-dark)" />
          <stop offset="1" stopColor="var(--metal-mid)" />
        </linearGradient>
      </defs>
      <path d={frameRingPath} fill={`url(#${gradientId})`} fillRule="evenodd" />
      <rect x="4.75" y="4.75" width="490.5" height="690.5" rx="19.25" fill="none" stroke="rgba(255, 255, 255, 0.38)" strokeWidth="1.5" />
      <path d={frameInnerEdgePath} fill="none" stroke="color-mix(in srgb, var(--lab-accent) 42%, rgba(255, 255, 255, 0.34))" strokeWidth="1.5" />
    </svg>
  );
}

function score(value: number | null): string {
  return value === null ? "—" : value.toFixed(value >= 1000 ? 0 : 1);
}

function PrototypeCard({
  card,
  finish,
  width,
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
  frameVariant: FrameVariant;
  guides: boolean;
  hideCornerIcons: boolean;
  hideBadges: boolean;
  guildCrest?: GuildCrestData;
  guildFaction?: string;
}) {
  const t = useTranslations("ccg");
  const materialFrame = useRef<number | null>(null);
  const pendingMaterial = useRef<{ element: HTMLElement; x: number; y: number } | null>(null);
  const classInfo = getClassInfoById(card.classID);
  const specIcon = getSpecIconUrl(card.classID, card.specName);
  const tierGrade = normalizeCcgTierGrade(card.tierGrade);
  const rarity = t(`rarity.${rarityKeys[tierGrade]}`);
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
    "--tilt-x": "0deg",
    "--tilt-y": "0deg",
    "--pointer-x": "50%",
    "--pointer-y": "38%",
    "--pointer-left": 0.5,
    "--pointer-top": 0.38,
    "--pointer-distance": 0,
    "--foil-x": "50%",
    "--foil-y": "50%",
    "--foil-x-reverse": "50%",
    "--foil-y-reverse": "50%",
    "--foil-angle": "118deg",
  } as CSSProperties;

  useEffect(
    () => () => {
      if (materialFrame.current !== null) cancelAnimationFrame(materialFrame.current);
    },
    [],
  );

  const applyMaterial = (element: HTMLElement, x: number, y: number) => {
    const distance = Math.min(1, Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2);
    element.style.setProperty("--tilt-x", `${((0.5 - y) * 7).toFixed(2)}deg`);
    element.style.setProperty("--tilt-y", `${((x - 0.5) * 8).toFixed(2)}deg`);
    element.style.setProperty("--pointer-x", `${(x * 100).toFixed(1)}%`);
    element.style.setProperty("--pointer-y", `${(y * 100).toFixed(1)}%`);
    element.style.setProperty("--pointer-left", x.toFixed(3));
    element.style.setProperty("--pointer-top", y.toFixed(3));
    element.style.setProperty("--pointer-distance", distance.toFixed(3));
    element.style.setProperty("--foil-x", `${(50 + (x - 0.5) * 54).toFixed(1)}%`);
    element.style.setProperty("--foil-y", `${(50 + (y - 0.5) * 46).toFixed(1)}%`);
    element.style.setProperty("--foil-x-reverse", `${(50 - (x - 0.5) * 76).toFixed(1)}%`);
    element.style.setProperty("--foil-y-reverse", `${(50 - (y - 0.5) * 64).toFixed(1)}%`);
    element.style.setProperty("--foil-angle", `${(118 + (x - 0.5) * 18 - (y - 0.5) * 10).toFixed(1)}deg`);
  };

  const updateMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    pendingMaterial.current = { element: event.currentTarget, x, y };
    if (materialFrame.current !== null) return;

    materialFrame.current = requestAnimationFrame(() => {
      const material = pendingMaterial.current;
      if (material) applyMaterial(material.element, material.x, material.y);
      pendingMaterial.current = null;
      materialFrame.current = null;
    });
  };

  const resetMaterial = (event: ReactPointerEvent<HTMLElement>) => {
    if (materialFrame.current !== null) cancelAnimationFrame(materialFrame.current);
    materialFrame.current = null;
    pendingMaterial.current = null;
    applyMaterial(event.currentTarget, 0.5, 0.38);
  };

  return (
    <article
      className={`${styles.prototypeCard} ${styles.vaultRelic} ${styles[finish]} ${guides ? styles.guides : ""}`}
      data-grade={tierGrade}
      data-finish={finish}
      data-frame={frameVariant}
      style={cardStyle}
      onPointerMove={updateMaterial}
      onPointerLeave={resetMaterial}
      aria-label={`${card.name}, ${guild}, ${realm}, ${card.set.raidName}, ${formatSpecName(card.specName)} ${classInfo.name}, ${t(`role.${card.role}`)}, ${rarity}, ${t(`finish.${finish}`)}`}
    >
      <span className={styles.outerFrame} aria-hidden="true" />
      <span className={styles.innerFrame} aria-hidden="true" />
      <FrameGeometry />
      <span className={styles.artworkClip} aria-hidden="true">
        <span className={styles.raidArt} />
        <span className={styles.raidShade} />
      </span>
      <span className={styles.lowerDeck} aria-hidden="true" />
      <span className={styles.renderWindow} aria-hidden="true">
        {card.renderUrl ? <AlphaFittedCharacterRender src={card.renderUrl} sizes={`${width}px`} className={styles.renderImage} /> : null}
      </span>

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

          {SHOW_ROLE_AND_GUILD_CRESTS ? (
            <>
              <span className={styles.roleCrest}>
                <Image src={roleIcons[card.role]} alt="" width={28} height={28} />
                <span>{t(`role.${card.role}`)}</span>
              </span>

              <span className={styles.guildCrest} aria-label={t("prototypes.guildCrest", { guild: card.guildName ?? t("independent") })}>
                <GuildCrest crest={guildCrest} faction={guildFaction} size={128} className={styles.guildCrestCanvas} />
              </span>
            </>
          ) : null}
        </>
      ) : null}

      <span className={styles.rarityPlate} data-quality={finish}>
        <span className={styles.qualityLabel}>{t(`finish.${finish}`)}</span>
        <strong>{rarity}</strong>
      </span>

      <span className={styles.characterMeta}>
        <span>{formatSpecName(card.specName)}</span>
        <span>{classInfo.name}</span>
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

      <span className={`${styles.cardBrand} ${styles.cardBrandLeft}`} aria-hidden="true">
        SUOMIWOW
      </span>
      <span className={`${styles.cardBrand} ${styles.cardBrandRight}`} aria-hidden="true">
        {realm}
      </span>

      <span className={styles.cardFooter}>
        <span>{realm}</span>
        <span>
          {String(card.setNumber).padStart(3, "0")} / {String(card.set.cardCount).padStart(3, "0")}
        </span>
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
  const guildQuery = useGuildSummaryByRealmName(SHOW_ROLE_AND_GUILD_CRESTS ? (card?.guildRealm ?? "") : "", SHOW_ROLE_AND_GUILD_CRESTS ? (card?.guildName ?? "") : "");

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
          <Link href="/fun/ccg/open" className={vaultStyles.secondaryButton}>
            {t("prototypes.back")}
          </Link>
        </header>

        <section className={styles.controls} aria-label={t("prototypes.controls")}>
          <label>
            <span>{t("prototypes.set")}</span>
            <select value={setSlug} onChange={(event) => changeSet(event.target.value)}>
              {sets
                .filter((set) => set.cardCount > 0)
                .map((set) => (
                  <option key={set.id} value={set.slug}>
                    {set.raidName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>{t("prototypes.sample")}</span>
            <select value={card?.id ?? ""} onChange={(event) => setCardId(event.target.value)} disabled={cards.length === 0}>
              {cards.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {formatRealmName(candidate.realm)}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.pageControl}>
            <span>{t("prototypes.samplePage")}</span>
            <div>
              <button
                type="button"
                onClick={() => {
                  setSamplePage((page) => Math.max(1, page - 1));
                  setCardId("");
                }}
                disabled={samplePage <= 1}
                aria-label={t("prototypes.previousPage")}
              >
                ←
              </button>
              <strong>
                {samplePage} / {samplePages}
              </strong>
              <button
                type="button"
                onClick={() => {
                  setSamplePage((page) => Math.min(samplePages, page + 1));
                  setCardId("");
                }}
                disabled={samplePage >= samplePages}
                aria-label={t("prototypes.nextPage")}
              >
                →
              </button>
            </div>
          </div>
          <label>
            <span>{t("prototypes.finish")}</span>
            <select value={finish} onChange={(event) => setFinish(event.target.value as CcgFinish)}>
              {(["standard", "golden", "prismatic"] as CcgFinish[]).map((value) => (
                <option key={value} value={value}>
                  {t(`finish.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("prototypes.size")}</span>
            <select value={cardWidth} onChange={(event) => setCardWidth(Number(event.target.value))}>
              {[320, 360, 400, 440].map((value) => (
                <option key={value} value={value}>
                  {value} px
                </option>
              ))}
            </select>
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
          <div className={styles.loadState}>
            <CcgLoadError
              onRetry={() => {
                void setsQuery.refetch();
                void catalogQuery.refetch();
              }}
            />
          </div>
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
                    <div>
                      <strong>{t(`prototypes.frames.${frameVariant}.title`)}</strong>
                      <span>{t(`prototypes.frames.${frameVariant}.tag`)}</span>
                    </div>
                    <p>{t(`prototypes.frames.${frameVariant}.body`)}</p>
                  </header>
                  <div className={styles.cardMount}>
                    <PrototypeCard
                      card={card}
                      finish={finish}
                      width={cardWidth}
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
