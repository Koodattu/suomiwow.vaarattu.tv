import "server-only";

import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { ReactNode } from "react";
import sharp from "sharp";
import type { CcgArtVariant, CcgCard, CcgOpening, CcgShare } from "@/types";
import { CCG_FINISH_COLORS, CCG_RARITY_COLORS, compareCcgPullQuality } from "@/lib/ccg";
import {
  getBestPackResult,
  getCcgEmbedCopy,
  getCcgFinishLabel,
  getCcgPackType,
  getCcgRarityLabel,
  getSharedOpening,
  interpolate,
  type CcgEmbedLocale,
} from "@/lib/ccg-share-metadata";
import { formatRealmName } from "@/lib/utils";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;

function imageDataUri(bytes: Uint8Array, mimeType: string) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

type ImageBytes = { bytes: Uint8Array; mimeType: string };

async function readPublicImage(path: string | null | undefined): Promise<ImageBytes | null> {
  if (!path?.startsWith("/")) return null;
  const relativePath = normalize(path.split("?")[0].slice(1).replaceAll("/", sep));
  const publicRoot = join(process.cwd(), "public");
  const absolutePath = join(publicRoot, relativePath);
  if (!absolutePath.startsWith(`${publicRoot}${sep}`)) return null;
  const mimeType = IMAGE_MIME_TYPES[extname(absolutePath).toLowerCase()];
  if (!mimeType) return null;

  try {
    return { bytes: await readFile(absolutePath), mimeType };
  } catch {
    return null;
  }
}

async function loadPublicImage(path: string | null | undefined): Promise<string | null> {
  const image = await readPublicImage(path);
  return image ? imageDataUri(image.bytes, image.mimeType) : null;
}

type TrimmedRender = { source: string; width: number; height: number };

/** Cuts a character render down to the character itself so a lineup can stand everyone on one floor. */
async function loadTrimmedCharacterRender(url: string | null | undefined): Promise<TrimmedRender | null> {
  const image = await readCharacterRender(url);
  if (!image) return null;
  try {
    const { data, info } = await sharp(image.bytes)
      .trim()
      .resize({ height: 640, withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { source: imageDataUri(data, "image/png"), width: info.width, height: info.height };
  } catch {
    return null;
  }
}

async function readCharacterRender(url: string | null | undefined): Promise<ImageBytes | null> {
  if (!url) return null;
  if (/^\/api\/ccg\/media\/(?:assets|supporter)\/[a-f\d]{24}$/i.test(url)) {
    const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    try {
      const response = await fetch(new URL(url, apiBase), {
        ...(url.includes("/supporter/") ? { cache: "no-store" as const } : { next: { revalidate: 3600 } }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
      if (mimeType !== "image/webp") return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_REMOTE_IMAGE_BYTES) return null;
      return { bytes, mimeType };
    } catch {
      return null;
    }
  }
  if (url.startsWith("/")) return readPublicImage(url);

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
    return { bytes, mimeType };
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

type LineupPull = {
  result: CcgOpening["results"][number];
  render: TrimmedRender | null;
  featured: boolean;
};

const LINEUP_COLUMN_WIDTH = 214;

/** One pull in a pack preview: the character itself on a glow in its finish colour, not a drawn card. */
function PullFigure({ pull, locale }: { pull: LineupPull; locale: CcgEmbedLocale }) {
  const { result, render, featured } = pull;
  const color = CCG_FINISH_COLORS[result.finish];
  const maxHeight = featured ? 268 : 232;
  const scale = render ? Math.min(maxHeight / render.height, (LINEUP_COLUMN_WIDTH - 12) / render.width) : 1;
  const imageWidth = render ? Math.round(render.width * scale) : 0;
  const imageHeight = render ? Math.round(render.height * scale) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: LINEUP_COLUMN_WIDTH, margin: "0 4px" }}>
      <div style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center", width: LINEUP_COLUMN_WIDTH, height: 276 }}>
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: 22,
            right: 22,
            height: featured ? 226 : 190,
            display: "flex",
            borderRadius: 999,
            background: `radial-gradient(ellipse at 50% 72%, ${color}${featured ? "66" : "3d"} 0%, transparent 70%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -12,
            left: 14,
            right: 14,
            height: 44,
            display: "flex",
            borderRadius: 999,
            background: `radial-gradient(ellipse at 50% 50%, ${color}d9 0%, ${color}4d 42%, transparent 72%)`,
          }}
        />
        {render ? (
          <img src={render.source} alt="" width={imageWidth} height={imageHeight} style={{ position: "relative", width: imageWidth, height: imageHeight }} />
        ) : (
          <div style={{ position: "relative", display: "flex", width: 120, height: 200, marginBottom: 8, borderRadius: 999, background: `${color}26` }} />
        )}
      </div>
      <div
        style={{
          display: "flex",
          maxWidth: LINEUP_COLUMN_WIDTH,
          marginTop: 16,
          color: "#ffffff",
          fontSize: featured ? 27 : 23,
          fontWeight: 850,
          letterSpacing: "-0.01em",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        {result.card.name}
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 8 }}>
        <Pill accent={color}>{getCcgFinishLabel(locale, result.finish)}</Pill>
        <div style={{ display: "flex", marginLeft: 8, color: CCG_RARITY_COLORS[result.card.tierGrade], fontSize: 15, fontWeight: 800 }}>
          {getCcgRarityLabel(locale, result.card.tierGrade)}
        </div>
      </div>
    </div>
  );
}

const HERO_WIDTH = 400;
const HERO_HEIGHT = 500;

/** The character from a shared card, standing on a glow in its finish colour instead of a drawn card. */
function CharacterHero({ render, color }: { render: TrimmedRender | null; color: string }) {
  const scale = render ? Math.min((HERO_HEIGHT - 30) / render.height, (HERO_WIDTH - 20) / render.width) : 1;
  const imageWidth = render ? Math.round(render.width * scale) : 0;
  const imageHeight = render ? Math.round(render.height * scale) : 0;
  return (
    <div
      style={{
        position: "absolute",
        top: 50,
        left: 52,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        width: HERO_WIDTH,
        height: HERO_HEIGHT,
      }}
    >
      <div
        style={{
          position: "absolute",
          bottom: 30,
          left: 30,
          right: 30,
          height: 420,
          display: "flex",
          borderRadius: 999,
          background: `radial-gradient(ellipse at 50% 70%, ${color}5c 0%, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -6,
          left: 24,
          right: 24,
          height: 70,
          display: "flex",
          borderRadius: 999,
          background: `radial-gradient(ellipse at 50% 50%, ${color}e6 0%, ${color}4d 42%, transparent 72%)`,
        }}
      />
      {render ? (
        <img src={render.source} alt="" width={imageWidth} height={imageHeight} style={{ position: "relative", width: imageWidth, height: imageHeight, marginBottom: 14 }} />
      ) : (
        <div style={{ position: "relative", display: "flex", width: 180, height: 340, marginBottom: 24, borderRadius: 999, background: `${color}26` }} />
      )}
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
    const { card, finish } = share.card;
    const art = getCardArt(card, share.card.artVariant);
    const [backgroundSource, render] = await Promise.all([
      loadPublicImage(art.backgroundPath),
      loadTrimmedCharacterRender(art.renderPath),
    ]);
    const accent = CCG_FINISH_COLORS[finish];
    const rarity = getCcgRarityLabel(locale, card.tierGrade);
    const finishLabel = getCcgFinishLabel(locale, finish);
    return (
      <RootImage>
        <ImageBackdrop source={backgroundSource} accent={card.set.theme.accent || accent} />
        <CharacterHero render={render} color={accent} />
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
            <div style={{ display: "flex", marginLeft: 10 }}><Pill accent={CCG_RARITY_COLORS[card.tierGrade]}>{rarity}</Pill></div>
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

  const { pack, packCount } = getSharedOpening(share);
  // A batch preview shows its five best pulls, in the order they were opened.
  const shownResults = packCount > 1
    ? [...pack.results]
      .sort((left, right) => compareCcgPullQuality(left, right) || left.position - right.position)
      .slice(0, 5)
      .sort((left, right) => left.position - right.position)
    : pack.results;
  const bestResult = getBestPackResult(pack);
  const targetSetId = pack.selection.type === "raid" ? pack.selection.setId : null;
  const primarySet = targetSetId
    ? pack.sets.find((set) => set.id === targetSetId) ?? pack.sets[0]
    : pack.sets[0];
  const accent = primarySet?.theme.accent || "#67e8f9";
  const backgroundSource = await loadPublicImage(primarySet?.backgroundPath ?? "/ccg/general_alt_wide.png");
  const pulls: LineupPull[] = await Promise.all(shownResults.map(async (result) => ({
    result,
    render: await loadTrimmedCharacterRender(getCardArt(result.card, result.artVariant).renderPath),
    featured: Boolean(bestResult && result.position === bestResult.position),
  })));
  const packType = getCcgPackType(pack, locale);

  return (
    <RootImage>
      <ImageBackdrop source={backgroundSource} accent={accent} />
      <div style={{ position: "absolute", top: 38, left: 52, display: "flex" }}><Brand logoSource={logoSource} compact /></div>
      <div style={{ position: "absolute", top: 43, right: 54, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <div style={{ display: "flex", color: accent, fontSize: 17, fontWeight: 850, letterSpacing: "0.1em", textTransform: "uppercase" }}>{packType}</div>
        <div style={{ display: "flex", color: "#ffffff", fontSize: 39, fontWeight: 900, letterSpacing: "-0.025em", marginTop: 4 }}>{share.unboxedBy.username}</div>
      </div>
      <div style={{ position: "absolute", top: 104, left: 30, right: 30, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        {pulls.map((pull) => <PullFigure key={`${pull.result.card.id}:${pull.result.position}`} pull={pull} locale={locale} />)}
      </div>
      <div style={{ position: "absolute", left: 54, right: 54, bottom: 69, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Pill accent={accent}>{packCount > 1 ? interpolate(copy.batchCards, { count: packCount }) : copy.fiveCards}</Pill>
          {bestResult ? (
            <div style={{ display: "flex", color: "#dbe5f1", fontSize: 17, marginLeft: 14 }}>
              {copy.bestPull}: <span style={{ color: CCG_FINISH_COLORS[bestResult.finish], fontWeight: 800, marginLeft: 5 }}>{bestResult.card.name}</span>
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
