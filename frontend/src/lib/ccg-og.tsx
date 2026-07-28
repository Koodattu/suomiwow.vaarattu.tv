import "server-only";

import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { ReactNode } from "react";
import type { CcgArtVariant, CcgCard, CcgFinish, CcgShare, CcgTierGrade } from "@/types";
import {
  getBestPackResult,
  getCcgEmbedCopy,
  getCcgFinishLabel,
  getCcgPackType,
  getCcgRarityLabel,
  type CcgEmbedLocale,
} from "@/lib/ccg-share-metadata";
import { formatRealmName, formatSpecName, getClassInfoById } from "@/lib/utils";

const FINISH_COLORS: Record<CcgFinish, string> = {
  standard: "#d8dee9",
  foil: "#7dd3fc",
  golden: "#f4c152",
  prismatic: "#d8b4fe",
  holographic: "#67e8f9",
  void: "#a78bfa",
  toxic: "#86efac",
  negative: "#f9a8d4",
};

const RARITY_COLORS: Record<CcgTierGrade, string> = {
  H: "#00ccff",
  S: "#e6cc80",
  A: "#ff8a1f",
  B: "#c36bff",
  C: "#3b9cff",
  D: "#62e968",
  E: "#ffffff",
  F: "#a3a3a3",
};

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;

type PreparedCard = {
  card: CcgCard;
  finish: CcgFinish;
  artVariant: CcgArtVariant;
  backgroundSource: string | null;
  renderSource: string | null;
};

function imageDataUri(bytes: Uint8Array, mimeType: string) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function loadPublicImage(path: string | null | undefined): Promise<string | null> {
  if (!path?.startsWith("/")) return null;
  const relativePath = normalize(path.split("?")[0].slice(1).replaceAll("/", sep));
  const publicRoot = join(process.cwd(), "public");
  const absolutePath = join(publicRoot, relativePath);
  if (!absolutePath.startsWith(`${publicRoot}${sep}`)) return null;
  const mimeType = IMAGE_MIME_TYPES[extname(absolutePath).toLowerCase()];
  if (!mimeType) return null;

  try {
    return imageDataUri(await readFile(absolutePath), mimeType);
  } catch {
    return null;
  }
}

async function loadCharacterRender(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("/")) return loadPublicImage(url);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "render.worldofwarcraft.com") return null;

  try {
    const response = await fetch(parsedUrl, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (mimeType !== "image/png" && mimeType !== "image/jpeg") return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_REMOTE_IMAGE_BYTES) return null;
    return imageDataUri(bytes, mimeType);
  } catch {
    return null;
  }
}

function getCardArt(card: CcgCard, artVariant: CcgArtVariant) {
  const alternativeActive = artVariant === "alternative" && card.alternativeArt;
  return {
    backgroundPath: alternativeActive
      && card.set.kind === "community"
      && card.alternativeArt?.backgroundArtEnabled
      && card.alternativeArt.backgroundArtPath
      ? card.alternativeArt.backgroundArtPath
      : card.set.backgroundPath,
    renderPath: alternativeActive
      && card.alternativeArt?.characterArtEnabled
      && card.alternativeArt.characterArtPath
      ? card.alternativeArt.characterArtPath
      : card.renderUrl,
  };
}

async function prepareCard(card: CcgCard, finish: CcgFinish, artVariant: CcgArtVariant): Promise<PreparedCard> {
  const art = getCardArt(card, artVariant);
  const [backgroundSource, renderSource] = await Promise.all([
    loadPublicImage(art.backgroundPath),
    loadCharacterRender(art.renderPath),
  ]);
  return { card, finish, artVariant, backgroundSource, renderSource };
}

function Brand({ logoSource, compact = false }: { logoSource: string | null; compact?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {logoSource ? (
        <img
          src={logoSource}
          alt=""
          width={compact ? 66 : 84}
          height={compact ? 48 : 60}
          style={{ objectFit: "contain" }}
        />
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", marginLeft: logoSource ? 14 : 0 }}>
        <div style={{ color: "#ffffff", fontSize: compact ? 21 : 26, fontWeight: 800, letterSpacing: "0.04em" }}>
          SUOMIWOW CCG
        </div>
        <div style={{ color: "#9fb1c7", fontSize: compact ? 12 : 15, letterSpacing: "0.14em", marginTop: 2 }}>
          COMMUNITY CARD GAME
        </div>
      </div>
    </div>
  );
}

function ImageBackdrop({ source, accent }: { source: string | null; accent: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        display: "flex",
        overflow: "hidden",
        background: `linear-gradient(135deg, #050913 0%, #091628 54%, ${accent}33 100%)`,
      }}
    >
      {source ? (
        <img
          src={source}
          alt=""
          width={1200}
          height={630}
          style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", opacity: 0.3 }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: "flex",
          background: "linear-gradient(90deg, rgba(3,7,16,.98) 0%, rgba(3,7,16,.86) 46%, rgba(3,7,16,.42) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -180,
          right: -120,
          width: 520,
          height: 520,
          display: "flex",
          borderRadius: 260,
          background: accent,
          opacity: 0.12,
        }}
      />
    </div>
  );
}

function Pill({ children, accent, subtle = false }: { children: ReactNode; accent: string; subtle?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 13px",
        borderRadius: 999,
        color: subtle ? "#d4deeb" : "#06101d",
        background: subtle ? "rgba(255,255,255,.08)" : accent,
        boxShadow: subtle ? "inset 0 0 0 1px rgba(255,255,255,.1)" : `0 10px 30px ${accent}33`,
        fontSize: 16,
        fontWeight: 750,
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </div>
  );
}

function CardFace({
  prepared,
  width,
  height,
  locale,
  featured = false,
}: {
  prepared: PreparedCard;
  width: number;
  height: number;
  locale: CcgEmbedLocale;
  featured?: boolean;
}) {
  const { card, finish, artVariant, backgroundSource, renderSource } = prepared;
  const compact = width < 230;
  const finishColor = FINISH_COLORS[finish];
  const rarityColor = RARITY_COLORS[card.tierGrade];
  const className = getClassInfoById(card.classID).name;
  const guild = card.guildName ? `<${card.guildName}>` : formatRealmName(card.realm);
  const copy = getCcgEmbedCopy(locale).share.embed;

  return (
    <div
      style={{
        display: "flex",
        width,
        height,
        padding: compact ? 5 : 8,
        borderRadius: compact ? 16 : 24,
        background: `linear-gradient(145deg, ${finishColor}, #172234 46%, ${finishColor})`,
        boxShadow: featured
          ? `0 0 0 2px ${finishColor}, 0 22px 55px ${finishColor}55, 0 28px 60px rgba(0,0,0,.48)`
          : "0 0 0 1px rgba(255,255,255,.12), 0 18px 42px rgba(0,0,0,.42)",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          borderRadius: compact ? 11 : 16,
          background: "#070b12",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)",
        }}
      >
        {backgroundSource ? (
          <img
            src={backgroundSource}
            alt=""
            width={width}
            height={height}
            style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            display: "flex",
            background: "linear-gradient(180deg, rgba(3,6,12,.2) 0%, rgba(3,6,12,.05) 43%, rgba(3,6,12,.96) 78%, #03060c 100%)",
          }}
        />
        {renderSource ? (
          <img
            src={renderSource}
            alt=""
            width={width}
            height={height}
            style={{
              position: "absolute",
              top: compact ? 20 : 35,
              left: compact ? -2 : 0,
              width: "100%",
              height: compact ? "72%" : "70%",
              objectFit: "contain",
              objectPosition: "center bottom",
            }}
          />
        ) : null}

        <div
          style={{
            position: "absolute",
            top: compact ? 9 : 14,
            left: compact ? 9 : 14,
            right: compact ? 9 : 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              maxWidth: compact ? width - 55 : width - 78,
              padding: compact ? "4px 7px" : "6px 9px",
              borderRadius: compact ? 7 : 9,
              color: "#f8fafc",
              background: "rgba(2,6,12,.72)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)",
              fontSize: compact ? 9 : 13,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              overflow: "hidden",
            }}
          >
            {card.set.raidName}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: compact ? 30 : 42,
              height: compact ? 30 : 42,
              borderRadius: compact ? 9 : 13,
              color: "#07101c",
              background: rarityColor,
              boxShadow: `0 8px 24px ${rarityColor}44`,
              fontSize: compact ? 17 : 24,
              fontWeight: 900,
            }}
          >
            {card.tierGrade}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: compact ? 9 : 14,
            bottom: compact ? 74 : 117,
            display: "flex",
            padding: compact ? "4px 7px" : "6px 10px",
            borderRadius: 999,
            color: "#06101d",
            background: finishColor,
            fontSize: compact ? 9 : 13,
            fontWeight: 800,
            textTransform: "uppercase",
          }}
        >
          {getCcgFinishLabel(locale, finish)}
        </div>

        <div
          style={{
            position: "absolute",
            left: compact ? 11 : 17,
            right: compact ? 11 : 17,
            bottom: compact ? 10 : 16,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", color: "#ffffff", fontSize: compact ? 21 : 34, fontWeight: 900, lineHeight: 1 }}>
            {card.name}
          </div>
          <div style={{ display: "flex", color: "#b9c6d6", fontSize: compact ? 10 : 15, marginTop: compact ? 5 : 7 }}>
            {guild}
          </div>
          {!compact ? (
            <div style={{ display: "flex", alignItems: "center", color: "#dfe7f1", fontSize: 14, marginTop: 11 }}>
              <span>{formatSpecName(card.specName)} {className}</span>
              <span style={{ color: "#6f829a", margin: "0 8px" }}>•</span>
              <span style={{ color: rarityColor, fontWeight: 750 }}>{getCcgRarityLabel(locale, card.tierGrade)}</span>
            </div>
          ) : null}
          {artVariant === "alternative" ? (
            <div style={{ display: "flex", color: finishColor, fontSize: compact ? 8 : 11, fontWeight: 750, marginTop: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {copy.alternativeArt}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RootImage({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        color: "#f8fafc",
        background: "#050913",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {children}
    </div>
  );
}

function FooterRule({ accent }: { accent: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 54,
        right: 54,
        bottom: 31,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 15,
        borderTop: "1px solid rgba(255,255,255,.14)",
        color: "#8394aa",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: "0.04em",
      }}
    >
      <span>suomiwow.vaarattu.tv</span>
      <span style={{ color: accent }}>SUOMIWOW CCG</span>
    </div>
  );
}

export async function renderCcgMainOg({
  title,
  description,
  cta,
  view,
}: {
  title: string;
  description: string;
  cta: string;
  view: "vault" | "open" | "collection";
}) {
  const accent = view === "collection" ? "#b69cff" : view === "open" ? "#f2bd57" : "#5dd8ff";
  const [logoSource, backgroundSource, cardBackSource] = await Promise.all([
    loadPublicImage("/ccg/ccg_logo.png"),
    loadPublicImage("/ccg/general_alt_wide.png"),
    loadPublicImage("/ccg/general_alt_tall.png"),
  ]);

  return (
    <RootImage>
      <ImageBackdrop source={backgroundSource} accent={accent} />
      <div style={{ position: "absolute", top: 48, left: 58, display: "flex" }}><Brand logoSource={logoSource} /></div>
      <div style={{ position: "absolute", top: 166, left: 58, width: 680, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", color: "#ffffff", fontSize: title.length > 45 ? 52 : 60, fontWeight: 900, lineHeight: 1.04, letterSpacing: "-0.035em" }}>
          {title}
        </div>
        <div style={{ display: "flex", color: "#c2cede", fontSize: 24, lineHeight: 1.34, marginTop: 22 }}>
          {description}
        </div>
        <div style={{ display: "flex", marginTop: 27 }}><Pill accent={accent}>{cta}</Pill></div>
      </div>

      <div style={{ position: "absolute", top: 89, right: 55, width: 385, height: 470, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            style={{
              position: "absolute",
              left: 32 + index * 72,
              top: 58 - Math.abs(1 - index) * 11,
              display: "flex",
              width: 205,
              height: 287,
              padding: 7,
              borderRadius: 22,
              background: `linear-gradient(145deg, ${accent}, #172234 54%, ${accent})`,
              boxShadow: index === 2 ? `0 24px 55px ${accent}35` : "0 20px 45px rgba(0,0,0,.5)",
              transform: `rotate(${(index - 1) * 7}deg)`,
            }}
          >
            <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", overflow: "hidden", borderRadius: 15, background: "#07101d", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)" }}>
              {cardBackSource ? <img src={cardBackSource} alt="" width={205} height={287} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} /> : null}
              <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, display: "flex", background: "linear-gradient(180deg, rgba(5,9,19,.2), rgba(5,9,19,.9))" }} />
              <div style={{ position: "absolute", top: 96, left: 30, right: 30, display: "flex", flexDirection: "column", alignItems: "center" }}>
                {logoSource ? <img src={logoSource} alt="" width={120} height={86} style={{ objectFit: "contain" }} /> : null}
                <div style={{ display: "flex", color: "#ffffff", fontSize: 15, fontWeight: 900, letterSpacing: "0.12em", marginTop: 10 }}>CHARACTER CARD</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <FooterRule accent={accent} />
    </RootImage>
  );
}

export async function renderCcgShareOg(share: CcgShare, locale: CcgEmbedLocale) {
  const logoSource = await loadPublicImage("/ccg/ccg_logo.png");
  const copy = getCcgEmbedCopy(locale).share.embed;

  if (share.kind === "card") {
    const prepared = await prepareCard(share.card.card, share.card.finish, share.card.artVariant);
    const { card, finish } = share.card;
    const accent = FINISH_COLORS[finish];
    const rarity = getCcgRarityLabel(locale, card.tierGrade);
    const finishLabel = getCcgFinishLabel(locale, finish);
    return (
      <RootImage>
        <ImageBackdrop source={prepared.backgroundSource} accent={card.set.theme.accent || accent} />
        <div style={{ position: "absolute", top: 58, left: 72, display: "flex" }}>
          <CardFace prepared={prepared} width={350} height={490} locale={locale} featured />
        </div>
        <div style={{ position: "absolute", top: 48, left: 480, right: 58, display: "flex", flexDirection: "column" }}>
          <Brand logoSource={logoSource} compact />
          <div style={{ display: "flex", color: card.set.theme.accent || accent, fontSize: 18, fontWeight: 800, letterSpacing: "0.1em", marginTop: 58, textTransform: "uppercase" }}>
            {card.set.raidName}
          </div>
          <div style={{ display: "flex", color: "#ffffff", fontSize: card.name.length > 16 ? 60 : 72, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.04em", marginTop: 11 }}>
            {card.name}
          </div>
          <div style={{ display: "flex", color: "#aebdd0", fontSize: 24, marginTop: 12 }}>
            {card.guildName ? `<${card.guildName}>` : formatRealmName(card.realm)}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 29 }}>
            <Pill accent={accent}>{finishLabel}</Pill>
            <div style={{ display: "flex", marginLeft: 10 }}><Pill accent={RARITY_COLORS[card.tierGrade]}>{rarity}</Pill></div>
            {share.card.artVariant === "alternative" ? <div style={{ display: "flex", marginLeft: 10 }}><Pill accent={accent} subtle>{copy.alternativeArt}</Pill></div> : null}
          </div>
          <div style={{ display: "flex", color: "#d6dfeb", fontSize: 20, marginTop: 32 }}>
            {getCcgEmbedCopy(locale).share.unboxedBy}: {share.unboxedBy.username}
          </div>
          <div style={{ display: "flex", color: accent, fontSize: 18, fontWeight: 800, marginTop: 24, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {copy.viewCard} • {copy.openFreePack}
          </div>
        </div>
        <FooterRule accent={accent} />
      </RootImage>
    );
  }

  const bestResult = getBestPackResult(share.pack);
  const primarySet = share.pack.targetSetId
    ? share.pack.sets.find((set) => set.id === share.pack.targetSetId) ?? share.pack.sets[0]
    : share.pack.sets[0];
  const accent = primarySet?.theme.accent || "#67e8f9";
  const backgroundSource = await loadPublicImage(primarySet?.backgroundPath ?? "/ccg/general_alt_wide.png");
  const preparedCards = await Promise.all(share.pack.results.map((result) => (
    prepareCard(result.card, result.finish, result.artVariant)
  )));
  const packType = getCcgPackType(share.pack, locale);

  return (
    <RootImage>
      <ImageBackdrop source={backgroundSource} accent={accent} />
      <div style={{ position: "absolute", top: 38, left: 52, display: "flex" }}><Brand logoSource={logoSource} compact /></div>
      <div style={{ position: "absolute", top: 43, right: 54, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <div style={{ display: "flex", color: accent, fontSize: 17, fontWeight: 850, letterSpacing: "0.1em", textTransform: "uppercase" }}>{packType}</div>
        <div style={{ display: "flex", color: "#ffffff", fontSize: 39, fontWeight: 900, letterSpacing: "-0.025em", marginTop: 4 }}>{share.unboxedBy.username}</div>
      </div>
      <div style={{ position: "absolute", top: 142, left: 53, right: 53, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        {preparedCards.map((prepared, index) => {
          const result = share.pack.results[index];
          const featured = Boolean(bestResult && result.position === bestResult.position);
          return (
            <div key={`${prepared.card.id}:${index}`} style={{ display: "flex", marginLeft: index === 0 ? 0 : 17, marginBottom: featured ? 20 : 0 }}>
              <CardFace prepared={prepared} width={198} height={277} locale={locale} featured={featured} />
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 54, right: 54, bottom: 69, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Pill accent={accent}>{copy.fiveCards}</Pill>
          {bestResult ? (
            <div style={{ display: "flex", color: "#dbe5f1", fontSize: 17, marginLeft: 14 }}>
              {copy.bestPull}: <span style={{ color: FINISH_COLORS[bestResult.finish], fontWeight: 800, marginLeft: 5 }}>{bestResult.card.name}</span>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", color: accent, fontSize: 17, fontWeight: 850, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {copy.viewOpening} • {copy.openFreePack}
        </div>
      </div>
      <FooterRule accent={accent} />
    </RootImage>
  );
}

export const CCG_OG_IMAGE_RESPONSE_OPTIONS = {
  width: 1200,
  height: 630,
  headers: {
    "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  },
} as const;
