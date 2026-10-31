import * as THREE from "three";

// Procedural blind-box packaging: printed card stock with gold-foil stamping,
// a printed interior, and a holographic seal sticker across the lid seam.
export type PackagingLabels = { title: string; subtitle: string; blind: string; collect: string; contents: string; openHere: string };
// Per-series print palette. Accent is an "r,g,b" triple used for rays, glows and cards.
export type PackagingTheme = {
  number: string; deep: [string, string]; back: [string, string]; side: [string, string]; lid: [string, string];
  accent: string; glow: string; glowSoft: string; glowBright: string; window: string;
  pale: string; paler: string; muted: string; ink: string; edge: number;
};
export const PACKAGING_THEMES = {
  amethyst: {
    number: "001", deep: ["#2a1760", "#0c1a33"], back: ["#16173a", "#0b1428"], side: ["#251660", "#0c1a33"], lid: ["#20135a", "#1a1446"],
    accent: "160,130,255", glow: "#9a7bff", glowSoft: "#7e5cff", glowBright: "#b49bff", window: "rgba(10,6,30,.55)",
    pale: "#cbbcff", paler: "#d9cdfa", muted: "#a99fc9", ink: "#1c1236", edge: 0x1a1640,
  },
  verdigris: {
    number: "002", deep: ["#0f4a52", "#081a2c"], back: ["#0b3138", "#07141f"], side: ["#0f4f57", "#081a2c"], lid: ["#0d4650", "#0a3640"],
    accent: "90,230,210", glow: "#3fd6c4", glowSoft: "#2bb8a8", glowBright: "#8ff5e6", window: "rgba(4,24,28,.55)",
    pale: "#bff3ec", paler: "#d2f7f1", muted: "#8fc4bd", ink: "#082a2e", edge: 0x0c3a40,
  },
} satisfies Record<string, PackagingTheme>;
// Any further series prints in the same scheme around its own hue: dark card stock in the hue
// (shading toward its cooler neighbour) with light glows and inks of the same hue.
export function seriesTheme(number: number, hue: number): PackagingTheme {
  // Print colours are sRGB, as the canvas paints them.
  const channels = (h: number, s: number, l: number) => {
    const hue = ((h % 360) + 360) % 360, chroma = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
    return [0, 8, 4].map((n) => { const k = (n + hue / 30) % 12; return Math.round(255 * (l / 100 - chroma / 2 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); });
  };
  const hex = (h: number, s: number, l: number) => `#${channels(h, s, l).map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  const rgb = (h: number, s: number, l: number) => channels(h, s, l).join(",");
  return {
    number: String(number).padStart(3, "0"),
    deep: [hex(hue, 60, 23), hex(hue - 40, 62, 12)], back: [hex(hue - 20, 45, 16), hex(hue - 40, 57, 10)],
    side: [hex(hue, 62, 23), hex(hue - 40, 62, 12)], lid: [hex(hue, 65, 21), hex(hue - 5, 55, 18)],
    accent: rgb(hue, 100, 72), glow: hex(hue, 85, 64), glowSoft: hex(hue, 80, 55), glowBright: hex(hue, 95, 78),
    window: `rgba(${rgb(hue, 60, 7)},.55)`, pale: hex(hue, 90, 87), paler: hex(hue, 80, 90), muted: hex(hue, 30, 70), ink: hex(hue, 50, 13),
    edge: parseInt(hex(hue, 45, 17).slice(1), 16),
  };
}
export const PACKAGING_FALLBACK: Omit<PackagingLabels, "title" | "subtitle"> = { blind: "BLIND BOX", collect: "COLLECT ALL {count}", contents: "1 random figure inside · equal odds", openHere: "OPEN HERE" };

// Finish map channels: R = foil emboss (bump), G = roughness, B = metalness.
const PAPER = "rgb(0,170,0)", FOIL = "rgb(255,52,255)";
const PX = 500; // canvas pixels per world unit
const random = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

type Print = { color: CanvasRenderingContext2D; finish: CanvasRenderingContext2D; w: number; h: number };
type Sheet = HTMLImageElement | null;
// Layout of scripts/bake-figurine-silhouettes.mjs: catalog order, 8 columns of 280×360 cells, feet on the bottom edge.
export const SILHOUETTE = { columns: 8, rows: 2, w: 280, h: 360 };
function canvas(w: number, h: number) {
  const element = document.createElement("canvas");
  element.width = w; element.height = h;
  return element;
}
// Draws the same shape as gold ink on the print and as foil on the finish map.
function foil(print: Print, draw: (context: CanvasRenderingContext2D) => void) {
  const gold = print.color.createLinearGradient(0, 0, print.w * 0.35, print.h);
  [[0, "#f8e7b0"], [0.3, "#c6994b"], [0.55, "#f3d892"], [0.8, "#a9772f"], [1, "#e9cd85"]].forEach(([at, color]) => gold.addColorStop(at as number, color as string));
  for (const [context, style] of [[print.color, gold], [print.finish, FOIL]] as const) {
    context.save(); context.fillStyle = context.strokeStyle = style; draw(context); context.restore();
  }
}
function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, { font = "Georgia, serif", weight = 600, spacing = 0, maxWidth }: { font?: string; weight?: number; spacing?: number; maxWidth?: number } = {}) {
  context.font = `${weight} ${size}px ${font}`; context.textAlign = "center"; context.textBaseline = "middle";
  context.letterSpacing = `${spacing}px`;
  context.fillText(value, x, y, maxWidth);
}
function stars(context: CanvasRenderingContext2D, w: number, h: number, count: number, seed: number) {
  const next = random(seed);
  for (let i = 0; i < count; i++) {
    context.globalAlpha = 0.2 + next() * 0.6; context.fillStyle = "#fff";
    context.beginPath(); context.arc(next() * w, next() * h, 0.6 + next() * 1.8, 0, Math.PI * 2); context.fill();
  }
  context.globalAlpha = 1;
}
// A generic armored silhouette with a staff: the mystery figure.
function hero(context: CanvasRenderingContext2D, cx: number, top: number, size: number) {
  const p = (x: number, y: number) => [cx + x * size, top + y * size] as const;
  context.beginPath();
  context.arc(...p(0, 0.11), 0.085 * size, 0, Math.PI * 2);
  context.moveTo(...p(-0.26, 0.3)); context.arc(...p(-0.2, 0.27), 0.095 * size, Math.PI, Math.PI * 1.9);
  context.lineTo(...p(0.12, 0.2)); context.arc(...p(0.2, 0.27), 0.095 * size, Math.PI * 1.1, 0);
  context.lineTo(...p(0.3, 0.55)); context.quadraticCurveTo(...p(0.36, 0.8), ...p(0.42, 1));
  context.lineTo(...p(-0.42, 1)); context.quadraticCurveTo(...p(-0.36, 0.8), ...p(-0.3, 0.55)); context.closePath();
  context.rect(...p(0.355, 0.12), 0.03 * size, 0.88 * size);
  context.moveTo(...p(0.41, 0.09)); context.arc(...p(0.37, 0.09), 0.045 * size, 0, Math.PI * 2);
  context.fill();
}
// A baked character silhouette, bottom-centred at (cx, base); falls back to the generic figure until the sheet loads.
function figure(context: CanvasRenderingContext2D, sheet: Sheet, index: number, cx: number, base: number, height: number) {
  if (!sheet) { hero(context, cx, base - height, height); return; }
  // Crop the loaded atlas, including older cached sheets with narrower cells.
  const cellW = sheet.naturalWidth / SILHOUETTE.columns, cellH = sheet.naturalHeight / SILHOUETTE.rows;
  const width = height * cellW / cellH;
  context.drawImage(sheet, (index % SILHOUETTE.columns) * cellW, Math.floor(index / SILHOUETTE.columns) * cellH, cellW, cellH, cx - width / 2, base - height, width, height);
}
function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath(); context.roundRect(x, y, w, h, r);
}
function backdrop(print: Print, top: string, bottom: string, seed: number) {
  const { color, w, h } = print;
  const gradient = color.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
  color.fillStyle = gradient; color.fillRect(0, 0, w, h);
  stars(color, w, h, Math.round(w * h / 9000), seed);
}
function border(print: Print) {
  foil(print, (context) => {
    context.lineWidth = 6; roundedRect(context, 26, 26, print.w - 52, print.h - 52, 22); context.stroke();
    context.lineWidth = 2; roundedRect(context, 40, 40, print.w - 80, print.h - 80, 14); context.stroke();
  });
}
function ribbon(context: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  const x = cx - w / 2, y = cy - h / 2, notch = h * 0.35;
  context.beginPath();
  context.moveTo(x - notch * 1.6, y + h * 0.2); context.lineTo(x, y); context.lineTo(x + w, y); context.lineTo(x + w + notch * 1.6, y + h * 0.2);
  context.lineTo(x + w + notch, y + h * 0.6); context.lineTo(x + w + notch * 1.6, y + h); context.lineTo(x - notch * 1.6, y + h); context.lineTo(x - notch, y + h * 0.6);
  context.closePath(); context.fill();
}

function face(width: number, height: number, envMap: THREE.Texture, paint: (print: Print, sheet: Sheet) => void, density = PX, finishDensityCap = 250) {
  // Paint at full scale and let the canvas transform shrink it, so layouts stay resolution-independent.
  const w = Math.round(width * density), h = Math.round(height * density), full = { w: Math.round(width * PX), h: Math.round(height * PX) };
  // Foil/roughness/bump masks need less detail than the printed text and silhouettes.
  // Keep artwork resolution intact; cap only the shared finish mask.
  const finishDensity = Math.min(density, finishDensityCap);
  const fw = Math.round(width * finishDensity), fh = Math.round(height * finishDensity);
  const colorCanvas = canvas(w, h), finishCanvas = canvas(fw, fh);
  const print = { color: colorCanvas.getContext("2d")!, finish: finishCanvas.getContext("2d")!, w, h };
  const draw = (sheet: Sheet) => {
    print.color.setTransform(w / full.w, 0, 0, h / full.h, 0, 0);
    print.finish.setTransform(fw / full.w, 0, 0, fh / full.h, 0, 0);
    print.finish.fillStyle = PAPER; print.finish.fillRect(0, 0, full.w, full.h); paint({ ...print, ...full }, sheet);
  };
  draw(null);
  const map = new THREE.CanvasTexture(colorCanvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const finish = new THREE.CanvasTexture(finishCanvas); finish.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map, roughnessMap: finish, metalnessMap: finish, bumpMap: finish, bumpScale: 1.4, roughness: 1, metalness: 1, envMap, envMapIntensity: 1.1 });
  const repaint = (sheet: Sheet) => { draw(sheet); map.needsUpdate = finish.needsUpdate = true; };
  return { material, repaint };
}

const front = (labels: PackagingLabels, count: number, theme: PackagingTheme) => (print: Print, sheet: Sheet) => {
  const { color, w, h } = print;
  backdrop(print, theme.deep[0], theme.deep[1], 11);
  color.save(); color.translate(w / 2, h * 0.47);
  for (let i = 0; i < 32; i++) { color.rotate(Math.PI / 16); color.fillStyle = i % 2 ? "rgba(255,255,255,.035)" : `rgba(${theme.accent},.06)`; color.beginPath(); color.moveTo(0, 0); color.lineTo(-40, -h); color.lineTo(40, -h); color.fill(); }
  color.restore();
  const glow = color.createRadialGradient(w / 2, h * 0.47, 0, w / 2, h * 0.47, w * 0.48);
  glow.addColorStop(0, `rgba(${theme.accent},.55)`); glow.addColorStop(1, `rgba(${theme.accent},0)`);
  color.fillStyle = glow; color.fillRect(0, 0, w, h);
  border(print);
  color.fillStyle = theme.pale; text(color, labels.subtitle, w / 2, 96, 22, { font: "system-ui, sans-serif", weight: 600, spacing: 5, maxWidth: w - 160 });
  foil(print, (context) => { text(context, labels.title, w / 2, 176, 78, { weight: 700, spacing: 3, maxWidth: w - 120 }); context.fillRect(w / 2 - 210, 232, 420, 3); });
  // Arched window with the mystery silhouette.
  const left = w * 0.2, right = w * 0.8, archTop = 300, archBottom = h * 0.74;
  const arch = (context: CanvasRenderingContext2D) => { context.beginPath(); context.moveTo(left, archBottom); context.lineTo(left, archTop + (right - left) / 2); context.arc(w / 2, archTop + (right - left) / 2, (right - left) / 2, Math.PI, 0); context.lineTo(right, archBottom); context.closePath(); };
  color.save(); arch(color); color.fillStyle = "rgba(10,6,30,.55)"; color.fill(); color.clip();
  const crowd = archBottom - archTop;
  if (sheet && count > 4) {
    // Four smaller figures behind, one large one in front: who will it be?
    color.shadowColor = theme.glowSoft; color.shadowBlur = 30; color.globalAlpha = 0.85;
    [[-0.3, 1], [0.3, 2], [-0.14, 3], [0.14, 4]].forEach(([dx, index]) => figure(color, sheet, (index * 5) % count, w / 2 + dx * (right - left) * 1.15, archBottom - 6, crowd * 0.6));
    color.globalAlpha = 1; color.shadowBlur = 50; color.shadowColor = theme.glowBright;
    figure(color, sheet, 0, w / 2, archBottom + 4, crowd * 0.86);
  } else { color.shadowColor = theme.glow; color.shadowBlur = 50; color.fillStyle = "#05070f"; hero(color, w / 2, archTop + 70, crowd * 0.98); }
  color.restore();
  foil(print, (context) => { context.lineWidth = 9; arch(context); context.stroke(); context.lineWidth = 3; context.beginPath(); context.arc(w / 2, archTop + (right - left) / 2, (right - left) / 2 + 18, Math.PI * 1.08, Math.PI * 1.92); context.stroke(); });
  foil(print, (context) => text(context, "?", w / 2, h * 0.5, 420, { weight: 700 }));
  foil(print, (context) => ribbon(context, w / 2, h * 0.8, w * 0.56, 100));
  color.fillStyle = theme.ink; text(color, labels.blind, w / 2, h * 0.8 + 4, 50, { weight: 700, spacing: 10, maxWidth: w * 0.52 });
  color.fillStyle = theme.paler; text(color, labels.contents, w / 2, h * 0.875, 24, { font: "system-ui, sans-serif", weight: 500, spacing: 1, maxWidth: w - 200 });
  foil(print, (context) => { context.beginPath(); context.arc(w - 140, h - 140, 72, 0, Math.PI * 2); context.fill(); });
  color.fillStyle = theme.ink; text(color, `1/${count}`, w - 140, h - 140, 46, { weight: 700 });
  foil(print, (context) => text(context, theme.number, 140, h - 140, 40, { weight: 700, spacing: 4 }));
};

const back = (labels: PackagingLabels, lineup: string[], theme: PackagingTheme) => (print: Print, sheet: Sheet) => {
  const { color, w, h } = print;
  backdrop(print, theme.back[0], theme.back[1], 23);
  border(print);
  foil(print, (context) => text(context, labels.collect.replace("{count}", String(lineup.length)), w / 2, 120, 56, { weight: 700, spacing: 4, maxWidth: w - 140 }));
  const cols = 4, cellW = (w - 150) / cols, cellH = 196, gap = 12, startY = 190;
  lineup.forEach((name, index) => {
    const row = Math.floor(index / cols), inRow = Math.min(cols, lineup.length - row * cols);
    const x = (w - inRow * cellW) / 2 + (index % cols) * cellW + gap / 2, y = startY + row * (cellH + gap);
    const cardW = cellW - gap;
    roundedRect(color, x, y, cardW, cellH, 14); color.fillStyle = `rgba(${theme.accent},.12)`; color.fill();
    color.save(); roundedRect(color, x, y, cardW, cellH, 14); color.clip();
    color.shadowColor = theme.glow; color.shadowBlur = 18; color.fillStyle = "#06080f"; figure(color, sheet, index, x + cardW / 2, y + cellH - 46, cellH - 60); color.restore();
    foil(print, (context) => { context.lineWidth = 2; roundedRect(context, x, y, cardW, cellH, 14); context.stroke(); });
    color.fillStyle = theme.paler; text(color, name, x + cardW / 2, y + cellH - 24, 22, { font: "system-ui, sans-serif", weight: 600, maxWidth: cardW - 16 });
  });
  const barcodeY = h - 230, next = random(7);
  color.fillStyle = "#f4efe4"; color.fillRect(80, barcodeY, 280, 130);
  color.fillStyle = "#111";
  for (let x = 96; x < 344;) { const bar = 2 + Math.floor(next() * 4); if (next() > 0.4) color.fillRect(x, barcodeY + 14, bar, 86); x += bar + 2; }
  text(color, "6 420017 001174", 220, barcodeY + 114, 16, { font: "monospace", weight: 500, spacing: 2 });
  color.fillStyle = theme.muted; color.textAlign = "left";
  color.font = "500 19px system-ui, sans-serif"; color.textAlign = "left"; color.letterSpacing = "0px";
  [labels.contents, "Collectible figure · Not a toy for children under 3", "Series 001 · Community edition"].forEach((line, index) => color.fillText(line, 400, barcodeY + 30 + index * 34, w - 480));
  foil(print, (context) => text(context, labels.title, w - 210, h - 72, 30, { weight: 700, spacing: 2, maxWidth: 300 }));
};

const side = (labels: PackagingLabels, members: number[], theme: PackagingTheme) => (print: Print, sheet: Sheet) => {
  const { color, w, h } = print;
  backdrop(print, theme.side[0], theme.side[1], 37);
  color.save(); color.fillStyle = "rgba(255,255,255,.05)"; color.font = "700 64px Georgia, serif"; color.textAlign = "center";
  for (let y = 0; y < h + 100; y += 110) for (let x = (y / 110) % 2 ? 0 : 60; x < w + 100; x += 120) { color.save(); color.translate(x, y); color.rotate(-0.25); color.fillText("?", 0, 0); color.restore(); }
  color.restore();
  border(print);
  foil(print, (context) => text(context, "?", w / 2, h * 0.17, 300, { weight: 700 }));
  const perRow = Math.ceil(members.length / 2), slot = (w - 120) / Math.max(1, perRow);
  members.forEach((index, i) => {
    const row = Math.floor(i / perRow), cx = 60 + slot * (i % perRow + 0.5), base = h * (row ? 0.79 : 0.55);
    color.save(); color.shadowColor = theme.glow; color.shadowBlur = 22; color.fillStyle = "#06080f";
    figure(color, sheet, index, cx, base, h * 0.21); color.restore();
  });
  foil(print, (context) => { context.fillRect(70, h * 0.555, w - 140, 3); context.fillRect(70, h * 0.795, w - 140, 3); });
  foil(print, (context) => text(context, labels.title, w / 2, h * 0.865, 52, { weight: 700, spacing: 4, maxWidth: w - 120 }));
  color.fillStyle = theme.pale; text(color, labels.blind, w / 2, h * 0.915, 26, { font: "system-ui, sans-serif", weight: 700, spacing: 8, maxWidth: w - 140 });
};

const lid = (labels: PackagingLabels, theme: PackagingTheme) => (print: Print) => {
  const { color, w, h } = print;
  backdrop(print, theme.lid[0], theme.lid[1], 41);
  border(print);
  foil(print, (context) => {
    context.save(); context.translate(w / 2, h * 0.4); context.lineWidth = 4;
    for (let i = 0; i < 8; i++) { context.rotate(Math.PI / 4); context.beginPath(); context.moveTo(0, -150); context.lineTo(40, -42); context.lineTo(150, 0); context.stroke(); }
    context.beginPath(); context.arc(0, 0, 175, 0, Math.PI * 2); context.stroke();
    context.restore();
    text(context, "?", w / 2, h * 0.4 + 8, 120, { weight: 700 });
    text(context, labels.title, w / 2, h * 0.7, 46, { weight: 700, spacing: 3, maxWidth: w - 140 });
  });
  // Perforated tear strip along the front edge.
  for (const context of [color, print.finish]) { context.save(); context.setLineDash([14, 10]); context.lineWidth = 3; context.strokeStyle = context === color ? "rgba(255,255,255,.55)" : "rgb(0,230,0)"; context.beginPath(); context.moveTo(60, h - 82); context.lineTo(w - 60, h - 82); context.stroke(); context.restore(); }
};

function interior(title: string) {
  const element = canvas(512, 512), context = element.getContext("2d")!;
  context.fillStyle = "#ece2cc"; context.fillRect(0, 0, 512, 512);
  context.fillStyle = "rgba(150,115,60,.22)"; context.font = "600 22px Georgia, serif"; context.textAlign = "center";
  for (let y = 40; y < 512; y += 96) for (let x = (y / 96) % 2 ? 0 : 128; x < 640; x += 256) { context.save(); context.translate(x, y); context.rotate(-0.3); context.fillText(title, 0, 0); context.restore(); }
  const next = random(5); context.fillStyle = "rgba(170,130,60,.35)";
  for (let i = 0; i < 40; i++) { const x = next() * 512, y = next() * 512, r = 3 + next() * 4; context.beginPath(); for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; context.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr); } context.fill(); }
  const texture = new THREE.CanvasTexture(element); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2.2, 2.2);
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
}

export function tapeTexture(label: string) {
  const element = canvas(256, 1200), context = element.getContext("2d")!;
  // Printed rainbow foil under the iridescent coat so the tape reads as holographic from every angle.
  const rainbow = context.createLinearGradient(0, 0, 256, 1200);
  ["#ffd1f0", "#c9d8ff", "#bff7ee", "#fff3b8", "#ffc9d9", "#d5c6ff", "#bdf2ff", "#ffe0c4"].forEach((color, index, all) => rainbow.addColorStop(index / (all.length - 1), color));
  context.fillStyle = rainbow; context.fillRect(0, 0, 256, 1200);
  context.strokeStyle = "rgba(90,80,120,.45)"; context.lineWidth = 3; context.setLineDash([10, 8]);
  for (const x of [14, 242]) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 1200); context.stroke(); }
  context.setLineDash([]); context.fillStyle = "rgba(70,60,105,.7)"; context.textAlign = "center"; context.textBaseline = "middle";
  context.font = "700 26px system-ui, sans-serif"; context.letterSpacing = "6px";
  for (let y = 180; y < 1000; y += 210) { context.save(); context.translate(128, y); context.rotate(-Math.PI / 2); context.fillText(label, 0, 0, 200); context.restore(); }
  // Pull tab at the free end (the bottom of the texture).
  context.fillStyle = "rgba(40,30,70,.85)"; context.fillRect(0, 1085, 256, 115);
  context.fillStyle = "#fff6dc"; context.font = "700 54px system-ui, sans-serif"; context.fillText("▲", 128, 1142);
  const texture = new THREE.CanvasTexture(element); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}

export type TearTape = {
  group: THREE.Group; mesh: THREE.Mesh; hit: THREE.Mesh; material: THREE.MeshPhysicalMaterial;
  // Hover glow around the tape; set `glow.visible` and `glowStrength.value` (0..1).
  glow: THREE.Mesh; glowStrength: { value: number };
  // Path ends in the parent's space: the pull tab, and where the tape ends on the lid.
  start: THREE.Vector3; end: THREE.Vector3;
  // Lifts the first `amount` (0..1) of the tape, aimed at `toward` (parent space) or straight out.
  // `lidTilt` (radians, front edge up) keeps the part stuck to the lid on the lid as it lifts.
  peel: (amount: number, toward?: THREE.Vector3 | null, lidTilt?: number) => THREE.Vector3;
};
const TAPE_SEGMENTS = 56, TAPE_TAB = 0.06;
// Holographic tear tape: up the front, over the lid edge and across the top.
function tearTape(parent: THREE.Group, { depth, height, bottom, lid, label, envMap, map = tapeTexture(label) }: { depth: number; height: number; bottom: number; lid: number; label: string; envMap: THREE.Texture; map?: THREE.Texture | null }): TearTape {
  const w = 0.27, z = depth / 2 + 0.01, y0 = bottom + height - 0.92, yTop = bottom + height + lid + 0.004, across = 0.55;
  const rise = yTop - y0, length = rise + across;
  const at = (u: number, out: THREE.Vector3) => u < rise ? out.set(0, y0 + u, z) : out.set(0, yTop, z - (u - rise));
  const normalAt = (u: number) => u < rise ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const tangentAt = (u: number) => u < rise ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);
  const rows = TAPE_SEGMENTS + 1, positions = new Float32Array(rows * 6), uvs = new Float32Array(rows * 4), indices: number[] = [];
  for (let i = 0; i < rows; i++) {
    const v = i / TAPE_SEGMENTS; uvs.set([0, v, 1, v], i * 4);
    if (i < TAPE_SEGMENTS) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.MeshPhysicalMaterial({ map, side: THREE.DoubleSide, transparent: true, metalness: 0.35, roughness: 0.28, iridescence: 1, iridescenceIOR: 2.1, iridescenceThicknessRange: [120, 900], clearcoat: 1, clearcoatRoughness: 0.1, envMap, envMapIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const group = new THREE.Group(); parent.add(group);
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.renderOrder = 2; group.add(mesh);
  // An invisible grab area a little wider than the tape, reaching below the pull tab.
  const hitMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.75), hitMaterial);
  hit.position.set(0, y0 + 0.225, z + 0.02); group.add(hit);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.36, rise - 0.6), hitMaterial);
  strip.position.set(0, y0 + 0.6 + (rise - 0.6) / 2, z + 0.02); hit.attach(strip);
  // The glow is a wider band traced from the same points every peel, so it bends with the tape;
  // it runs a margin past both ends and fades out across its edges and ends.
  const MARGIN = 0.04, glowRows = rows + 2, glowPositions = new Float32Array(glowRows * 6), glowUvs = new Float32Array(glowRows * 4), glowIndices: number[] = [];
  for (let i = 0; i < glowRows; i++) {
    const end = i === 0 || i === glowRows - 1 ? 0 : 1; glowUvs.set([0, end, 1, end], i * 4);
    if (i < glowRows - 1) glowIndices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const glowGeometry = new THREE.BufferGeometry();
  glowGeometry.setAttribute("position", new THREE.BufferAttribute(glowPositions, 3));
  glowGeometry.setAttribute("uv", new THREE.BufferAttribute(glowUvs, 2));
  glowGeometry.setIndex(glowIndices);
  const glowStrength = { value: 0 }, inner = (w / 2) / (w / 2 + MARGIN);
  const glow = new THREE.Mesh(glowGeometry, new THREE.ShaderMaterial({
    uniforms: { strength: glowStrength, color: { value: new THREE.Color(0xffd27a) } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform float strength; uniform vec3 color; varying vec2 vUv;
void main() {
  float across = abs(vUv.x - 0.5) * 2.0;
  float edge = 1.0 - smoothstep(${inner.toFixed(3)}, 1.0, across);
  gl_FragColor = vec4(color * strength * edge * edge * vUv.y * 0.75, 1.0);
}`,
    side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    // In front of the print, behind the tape (which draws after it).
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  // Drawn after the walls (it writes no depth, so they would cover it) and before the tape.
  glow.frustumCulled = false; glow.visible = false; glow.renderOrder = 1; glow.raycast = () => {}; group.add(glow);
  const point = new THREE.Vector3(), anchor = new THREE.Vector3(), direction = new THREE.Vector3();
  const tip = new THREE.Vector3(), bend = new THREE.Vector3(), past = new THREE.Vector3();
  // Points above the walls belong to the lid, which hinges on its back edge.
  const hingeY = bottom + height, hingeZ = -depth / 2;
  const onLid = (out: THREE.Vector3, tilt: number) => {
    if (!tilt || out.y <= hingeY + 1e-4) return out;
    const y = out.y - hingeY, z = out.z - hingeZ, c = Math.cos(tilt), s = Math.sin(tilt);
    return out.set(out.x, hingeY + y * c + z * s, hingeZ - y * s + z * c);
  };
  const peel = (amount: number, toward?: THREE.Vector3 | null, lidTilt = 0) => {
    const front = Math.max(TAPE_TAB, THREE.MathUtils.clamp(amount, 0, 1) * length);
    onLid(at(front, anchor), lidTilt);
    const normal = normalAt(front), tangent = tangentAt(front);
    if (toward) direction.copy(toward).sub(anchor).normalize();
    else direction.copy(normal).multiplyScalar(front <= TAPE_TAB ? 0.3 : 0.8).addScaledVector(tangent, -0.6).normalize();
    const lift = direction.dot(normal);
    if (lift < 0.2) direction.addScaledVector(normal, 0.2 - lift).normalize();
    // Held closer than the peeled length, the free end stays at the finger and the slack
    // bows out from the box (a quadratic curve); otherwise the tape runs straight at the finger.
    const reach = toward ? toward.distanceTo(anchor) : Infinity;
    const slack = reach < front;
    if (slack) {
      tip.copy(anchor).addScaledVector(direction, reach);
      bend.copy(anchor).lerp(tip, 0.5).addScaledVector(normal, Math.sqrt(front * front - reach * reach) * 0.55);
    }
    for (let i = 0; i < rows; i++) {
      const u = i / TAPE_SEGMENTS * length;
      if (u >= front) onLid(at(u, point).addScaledVector(normalAt(u), 0.0015 * (u > rise ? 1 : 0)), lidTilt);
      else if (slack) {
        const s = (front - u) / front;
        point.copy(anchor).multiplyScalar((1 - s) ** 2).addScaledVector(bend, 2 * (1 - s) * s).addScaledVector(tip, s * s);
      } else point.copy(anchor).addScaledVector(direction, front - u).addScaledVector(normal, 0.012 * Math.min(1, (front - u) / 0.06));
      positions.set([point.x - w / 2, point.y, point.z, point.x + w / 2, point.y, point.z], i * 6);
      glowPositions.set([point.x - w / 2 - MARGIN, point.y, point.z, point.x + w / 2 + MARGIN, point.y, point.z], (i + 1) * 6);
    }
    // End caps: one row a margin beyond each end, along the strip.
    for (const [cap, from, toward] of [[0, 1, 2], [glowRows - 1, glowRows - 2, glowRows - 3]]) {
      past.fromArray(glowPositions, from * 6).sub(point.fromArray(glowPositions, toward * 6)).normalize().multiplyScalar(MARGIN);
      for (let k = 0; k < 6; k++) glowPositions[cap * 6 + k] = glowPositions[from * 6 + k] + past.getComponent(k % 3);
    }
    glowGeometry.attributes.position.needsUpdate = true;
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return anchor;
  };
  peel(0);
  return { group, mesh, hit, material, glow, glowStrength, start: at(0, new THREE.Vector3()), end: at(length, new THREE.Vector3()), peel };
}

export type BlindBoxParts = {
  walls: { pivot: THREE.Group; mesh: THREE.Mesh; w: number }[];
  lidPivot: THREE.Group;
  tape: TearTape;
  meshes: THREE.Mesh[];
  // Transparent from the start so fading the box never forces a shader recompile.
  materials: THREE.Material[];
  thickness: number;
  ready: Promise<void>;
  // Cancels a pending silhouette repaint.
  stop: () => void;
};

export type BakedBoxTextures = { maps: Record<string, THREE.Texture>; ready: Promise<void>; stop: () => void };
export type BoxDesign = { labels: PackagingLabels; lineup: string[]; theme: PackagingTheme; silhouettes?: string; baked?: (density: number) => BakedBoxTextures };
/** All unreleased slots borrow one neutral design; their shelf labels carry the series number. */
export const unreleasedBoxDesign = (labels: PackagingLabels): BoxDesign => ({ labels, lineup: Array(16).fill("?"), theme: {
  number: "???", deep: ["#343943", "#1c2129"], back: ["#292e37", "#171b23"], side: ["#303640", "#1b2028"], lid: ["#343b45", "#242a33"],
  accent: "150,160,175", glow: "#a0a8b5", glowSoft: "#858e9c", glowBright: "#bbc2cc", window: "rgba(15,18,24,.55)",
  pale: "#c2c8d0", paler: "#d4d8df", muted: "#8f98a6", ink: "#20252d", edge: 0x242a33,
} });
export type BoxPrints = { front: THREE.MeshStandardMaterial; back: THREE.MeshStandardMaterial; left: THREE.MeshStandardMaterial; right: THREE.MeshStandardMaterial; lid: THREE.MeshStandardMaterial; edge: THREE.MeshStandardMaterial; inside: THREE.MeshStandardMaterial; seal?: THREE.Texture; ready: Promise<void>; stop: () => void };
// A content-derived key avoids accidentally serving another locale or roster's artwork.
export const boxPrintKey = ({ labels, lineup, theme }: BoxDesign) => JSON.stringify([labels.title, labels.subtitle, labels.blind, labels.collect, labels.contents, labels.openHere, lineup, theme]);
export const BOX_SIZE = { width: 2.05, depth: 1.8, height: 2.75 };

// The five printed faces plus card edge and interior. `density` is canvas pixels per world unit.
export function createBoxPrints(design: BoxDesign, envMap: THREE.Texture, density = PX, finishDensityCap = 250): BoxPrints {
  const { labels, lineup, theme, silhouettes } = design;
  if (design.baked) {
    const textures = design.baked(density), { maps } = textures;
    const face = () => new THREE.MeshStandardMaterial({ bumpScale: 1.4, roughness: 1, metalness: 1, envMap, envMapIntensity: 1.1 });
    const result: BoxPrints = { front: face(), back: face(), left: face(), right: face(), lid: face(), edge: new THREE.MeshStandardMaterial({ color: theme.edge, roughness: 0.6 }), inside: new THREE.MeshStandardMaterial({ roughness: 0.85 }), ready: textures.ready, stop: textures.stop };
    let stopped = false, fallback: BoxPrints | undefined;
    result.stop = () => { stopped = true; textures.stop(); fallback?.stop(); };
    // Baked maps arrive from the transcoder, so they are attached once all of them have loaded.
    result.ready = textures.ready.then(() => {
      if (stopped) return;
      for (const name of ["front", "back", "left", "right", "lid"] as const) {
        const material = result[name], finish = maps[`${name}-finish`];
        material.map = maps[`${name}-color`]; material.roughnessMap = material.metalnessMap = material.bumpMap = finish; material.needsUpdate = true;
      }
      result.inside.map = maps.inside; result.inside.needsUpdate = true; result.seal = maps.seal;
    }, async () => {
      if (stopped) return;
      // A transient image failure must not leave the whole world's loading screen stuck.
      textures.stop(); fallback = createBoxPrints({ ...design, baked: undefined }, envMap, density);
      for (const name of ["front", "back", "left", "right", "lid", "inside", "edge"] as const) {
        const { transparent, opacity } = result[name];
        result[name].copy(fallback[name]); result[name].transparent = transparent; result[name].opacity = opacity; result[name].needsUpdate = true; fallback[name].dispose();
      }
      await fallback.ready;
    });
    return result;
  }
  const { width, depth, height } = BOX_SIZE;
  const edge = new THREE.MeshStandardMaterial({ color: theme.edge, roughness: 0.6 });
  const inside = interior(labels.title);
  const members = lineup.map((_, index) => index), half = Math.ceil(members.length / 2);
  const printed = [front(labels, lineup.length, theme), back(labels, lineup, theme), side(labels, members.slice(0, half), theme), side(labels, members.slice(half), theme), lid(labels, theme)]
    .map((paint, index) => face(index === 4 ? width : index > 1 ? depth : width, index === 4 ? depth : height, envMap, paint, density, finishDensityCap));
  const [front_, back_, left, right, top] = printed.map(({ material }) => material);
  let cancelled = false;
  let ready = Promise.resolve();
  // The print is repainted with the baked silhouette sheet once it loads.
  if (silhouettes) {
    const sheet = new Image(); sheet.src = silhouettes;
    ready = sheet.decode().then(() => { if (!cancelled) printed.slice(0, 4).forEach(({ repaint }) => repaint(sheet)); }, () => undefined);
  }
  return { front: front_, back: back_, left, right, lid: top, edge, inside, ready, stop: () => { cancelled = true; } };
}

// Builds the box inside `parent`. Walls hinge on their bottom edges (front, back, left, right).
export function buildBlindBox(parent: THREE.Group, { bottom, design, envMap }: { bottom: number; design: BoxDesign; envMap: THREE.Texture }): BlindBoxParts {
  const { width, depth, height } = BOX_SIZE, { labels } = design;
  const t = 0.028;
  const prints = createBoxPrints(design, envMap);
  const { edge, inside, front: frontPrint, back: backPrint, left: leftPrint, right: rightPrint, lid: lidPrint } = prints;
  // BoxGeometry material order: +x, -x, +y, -y, +z (outside), -z (inside).
  const wall = (w: number, x: number, z: number, ry: number, print: THREE.Material) => {
    // YXZ order: tilting about local x always swings the wall outward, whatever its facing.
    const pivot = new THREE.Group(); pivot.position.set(x, bottom, z); pivot.rotation.order = "YXZ"; pivot.rotation.y = ry; parent.add(pivot);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, t), [edge, edge, edge, edge, print, inside]);
    mesh.position.y = height / 2; pivot.add(mesh);
    return { pivot, mesh, w };
  };
  const walls = [
    wall(width, 0, depth / 2 - t / 2, 0, frontPrint), wall(width, 0, -depth / 2 + t / 2, Math.PI, backPrint),
    wall(depth - 2 * t, -width / 2 + t / 2, 0, -Math.PI / 2, leftPrint), wall(depth - 2 * t, width / 2 - t / 2, 0, Math.PI / 2, rightPrint),
  ];
  // Fitted inside the walls: a full-size floor shares the walls' outer faces along the bottom
  // edge, and the two z-fight into a flickering strip.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(width - 2 * t - 0.002, t, depth - 2 * t - 0.002), [edge, edge, inside, edge, edge, edge]);
  floor.position.y = bottom + t / 2; parent.add(floor);
  const lidPivot = new THREE.Group(); parent.add(lidPivot);
  const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(width + 0.012, t, depth + 0.012), [edge, edge, lidPrint, inside, edge, edge]);
  lidMesh.position.set(0, t / 2, depth / 2); lidPivot.add(lidMesh);
  const tape = tearTape(parent, { depth, height, bottom, lid: t, label: labels.openHere, envMap, map: design.baked ? null : undefined });
  const materials = [edge, inside, frontPrint, backPrint, leftPrint, rightPrint, lidPrint];
  materials.forEach((material) => { material.transparent = true; });
  let stopped = false;
  const ready = prints.ready.then(() => {
    // Baked boxes print their seal only once it has loaded, or paint it if the bake failed.
    if (!stopped && design.baked) {
      const map = prints.seal ?? tapeTexture(labels.openHere); tape.material.map = map;
      tape.material.emissiveMap = map;
      tape.material.needsUpdate = true;
    }
  });
  return { walls, lidPivot, tape, thickness: t, meshes: [...walls.map(({ mesh }) => mesh), floor, lidMesh], materials, ready, stop: () => { stopped = true; prints.stop(); } };
}
