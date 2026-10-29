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
export const PACKAGING_FALLBACK: Omit<PackagingLabels, "title" | "subtitle"> = { blind: "BLIND BOX", collect: "COLLECT ALL {count}", contents: "1 random figure inside · equal odds", openHere: "OPEN HERE" };

// Finish map channels: R = foil emboss (bump), G = roughness, B = metalness.
const PAPER = "rgb(0,170,0)", FOIL = "rgb(255,52,255)";
const PX = 500; // canvas pixels per world unit
const random = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

type Print = { color: CanvasRenderingContext2D; finish: CanvasRenderingContext2D; w: number; h: number };
type Sheet = HTMLImageElement | null;
// Layout of scripts/bake-figurine-silhouettes.mjs: catalog order, 8 columns of 200×360 cells, feet on the bottom edge.
const SILHOUETTE = { columns: 8, w: 200, h: 360 };
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
  const width = height * SILHOUETTE.w / SILHOUETTE.h;
  context.drawImage(sheet, (index % SILHOUETTE.columns) * SILHOUETTE.w, Math.floor(index / SILHOUETTE.columns) * SILHOUETTE.h, SILHOUETTE.w, SILHOUETTE.h, cx - width / 2, base - height, width, height);
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

function face(width: number, height: number, envMap: THREE.Texture, paint: (print: Print, sheet: Sheet) => void, density = PX) {
  // Paint at full scale and let the canvas transform shrink it, so layouts stay resolution-independent.
  const w = Math.round(width * density), h = Math.round(height * density), full = { w: Math.round(width * PX), h: Math.round(height * PX) };
  const colorCanvas = canvas(w, h), finishCanvas = canvas(w, h);
  const print = { color: colorCanvas.getContext("2d")!, finish: finishCanvas.getContext("2d")!, w, h };
  const draw = (sheet: Sheet) => {
    for (const context of [print.color, print.finish]) context.setTransform(w / full.w, 0, 0, h / full.h, 0, 0);
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

function tapeTexture(label: string) {
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
  // Path ends in the parent's space: the pull tab, and where the tape ends on the lid.
  start: THREE.Vector3; end: THREE.Vector3;
  // Lifts the first `amount` (0..1) of the tape, aimed at `toward` (parent space) or straight out.
  // `lidTilt` (radians, front edge up) keeps the part stuck to the lid on the lid as it lifts.
  peel: (amount: number, toward?: THREE.Vector3 | null, lidTilt?: number) => THREE.Vector3;
};
const TAPE_SEGMENTS = 56, TAPE_TAB = 0.06;
// Holographic tear tape: up the front, over the lid edge and across the top.
function tearTape(parent: THREE.Group, { depth, height, bottom, lid, label, envMap }: { depth: number; height: number; bottom: number; lid: number; label: string; envMap: THREE.Texture }): TearTape {
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
  const map = tapeTexture(label);
  const material = new THREE.MeshPhysicalMaterial({ map, side: THREE.DoubleSide, transparent: true, metalness: 0.35, roughness: 0.28, iridescence: 1, iridescenceIOR: 2.1, iridescenceThicknessRange: [120, 900], clearcoat: 1, clearcoatRoughness: 0.1, envMap, envMapIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const group = new THREE.Group(); parent.add(group);
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; group.add(mesh);
  // A generous invisible grab area around the pull tab.
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  hit.position.set(0, y0 + 0.2, z + 0.02); group.add(hit);
  const point = new THREE.Vector3(), anchor = new THREE.Vector3(), direction = new THREE.Vector3();
  const tip = new THREE.Vector3(), bend = new THREE.Vector3();
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
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return anchor;
  };
  peel(0);
  return { group, mesh, hit, material, start: at(0, new THREE.Vector3()), end: at(length, new THREE.Vector3()), peel };
}

export type BlindBoxParts = {
  walls: { pivot: THREE.Group; mesh: THREE.Mesh; w: number }[];
  lidPivot: THREE.Group;
  tape: TearTape;
  meshes: THREE.Mesh[];
  // Transparent from the start so fading the box never forces a shader recompile.
  materials: THREE.Material[];
  thickness: number;
  // Cancels a pending silhouette repaint.
  stop: () => void;
};

export type BoxDesign = { labels: PackagingLabels; lineup: string[]; theme: PackagingTheme; silhouettes?: string };
export const BOX_SIZE = { width: 2.05, depth: 1.8, height: 2.75 };

// The five printed faces plus card edge and interior. `density` is canvas pixels per world unit.
export function createBoxPrints({ labels, lineup, theme, silhouettes }: BoxDesign, envMap: THREE.Texture, density = PX) {
  const { width, depth, height } = BOX_SIZE;
  const edge = new THREE.MeshStandardMaterial({ color: theme.edge, roughness: 0.6 });
  const inside = interior(labels.title);
  const members = lineup.map((_, index) => index), half = Math.ceil(members.length / 2);
  const printed = [front(labels, lineup.length, theme), back(labels, lineup, theme), side(labels, members.slice(0, half), theme), side(labels, members.slice(half), theme), lid(labels, theme)]
    .map((paint, index) => face(index === 4 ? width : index > 1 ? depth : width, index === 4 ? depth : height, envMap, paint, density));
  const [front_, back_, left, right, top] = printed.map(({ material }) => material);
  let cancelled = false;
  // The print is repainted with the baked silhouette sheet once it loads.
  if (silhouettes) {
    const sheet = new Image(); sheet.src = silhouettes;
    sheet.decode().then(() => { if (!cancelled) printed.slice(0, 4).forEach(({ repaint }) => repaint(sheet)); }, () => undefined);
  }
  return { front: front_, back: back_, left, right, lid: top, edge, inside, stop: () => { cancelled = true; } };
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
  const floor = new THREE.Mesh(new THREE.BoxGeometry(width, t, depth), [edge, edge, inside, edge, edge, edge]);
  floor.position.y = bottom + t / 2; parent.add(floor);
  const lidPivot = new THREE.Group(); parent.add(lidPivot);
  const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(width + 0.012, t, depth + 0.012), [edge, edge, lidPrint, inside, edge, edge]);
  lidMesh.position.set(0, t / 2, depth / 2); lidPivot.add(lidMesh);
  const tape = tearTape(parent, { depth, height, bottom, lid: t, label: labels.openHere, envMap });
  const materials = [edge, inside, frontPrint, backPrint, leftPrint, rightPrint, lidPrint];
  materials.forEach((material) => { material.transparent = true; });
  return { walls, lidPivot, tape, thickness: t, meshes: [...walls.map(({ mesh }) => mesh), floor, lidMesh], materials, stop: prints.stop };
}
