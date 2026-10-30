import * as THREE from "three";
import { woodTexture } from "@/lib/figurine-shop";
import { cardGlow } from "@/lib/figurine-glow";
import { SILHOUETTE } from "@/lib/figurine-packaging";

// Collection display: a lit cubby cabinet with one 4×4 grid per series, like the acrylic display
// boxes blind-box collectors use. Unowned figures stand as pitch-black silhouettes; owned ones
// show a portrait framed exactly like their silhouette cell, so both stand on the cubby floor.
export type CaseSeries = { id: string; number: string; accent: string; silhouettes: string; keys: string[] };
export type CaseLabels = { series: (number: string) => string; collected: (got: number, total: number) => string };
export type SlotState = "locked" | "pending" | "owned";
const COLUMNS = 4, ROWS = 4, SHEET_COLUMNS = SILHOUETTE.columns;
// Cubby interior, divider thickness and depth; cards keep the silhouette cell's aspect.
const CELL_W = 0.64, CELL_H = 0.92, FRAME = 0.05, DEPTH = 0.5, CARD_H = 0.78, CARD_W = CARD_H * SILHOUETTE.w / SILHOUETTE.h;
const SECTION_W = COLUMNS * CELL_W + (COLUMNS + 1) * FRAME, GRID_H = ROWS * CELL_H + (ROWS + 1) * FRAME;
const BASE = 0.55, PILLAR = 0.16;
export const CASE_HEIGHT = BASE + GRID_H + 0.12;

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  return [element, element.getContext("2d")!] as const;
}
const srgb = (element: HTMLCanvasElement) => { const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map; };

// The back wall of one section: every cubby washed by its LED from the top, in the series accent.
function backPanel(accent: string) {
  const scale = 160, [element, context] = canvas(Math.round(SECTION_W * scale), Math.round(GRID_H * scale));
  const tint = new THREE.Color(accent);
  context.fillStyle = "#07060b"; context.fillRect(0, 0, element.width, element.height);
  for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLUMNS; column++) {
    const x = (FRAME + column * (CELL_W + FRAME)) * scale, y = (FRAME + row * (CELL_H + FRAME)) * scale, w = CELL_W * scale, h = CELL_H * scale;
    const wash = context.createLinearGradient(0, y, 0, y + h);
    wash.addColorStop(0, `rgb(${tint.r * 150 + 70},${tint.g * 150 + 70},${tint.b * 150 + 70})`);
    wash.addColorStop(0.45, `rgb(${tint.r * 90 + 14},${tint.g * 90 + 14},${tint.b * 90 + 14})`);
    wash.addColorStop(1, `rgb(${tint.r * 40 + 6},${tint.g * 40 + 6},${tint.b * 40 + 6})`);
    context.fillStyle = wash; context.fillRect(x, y, w, h);
    const spot = context.createRadialGradient(x + w / 2, y, 0, x + w / 2, y, h * 0.8);
    spot.addColorStop(0, "rgba(255,240,215,.55)"); spot.addColorStop(1, "rgba(255,240,215,0)");
    context.fillStyle = spot; context.fillRect(x, y, w, h);
  }
  return srgb(element);
}

function plaque(accent: string) {
  const [element, context] = canvas(768, 200);
  const map = srgb(element);
  const paint = (title: string, count: string) => {
    context.fillStyle = "#120e16"; context.fillRect(0, 0, 768, 200);
    context.strokeStyle = "#c9a565"; context.lineWidth = 6; context.strokeRect(12, 12, 744, 176);
    context.textAlign = "center"; context.textBaseline = "middle";
    context.fillStyle = "#f1d48a"; context.font = "700 64px Georgia, serif"; context.letterSpacing = "8px"; context.fillText(title.toUpperCase(), 384, 84, 700);
    context.fillStyle = accent; context.font = "600 34px system-ui, sans-serif"; context.letterSpacing = "4px"; context.fillText(count.toUpperCase(), 384, 150, 700);
    map.needsUpdate = true;
  };
  return { map, paint };
}

export function buildCase(parent: THREE.Group, { series, labels, envMap }: { series: CaseSeries[]; labels: CaseLabels; envMap: THREE.Texture }) {
  const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x24160f, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25, envMap, envMapIntensity: 0.25 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(23, [70, 40, 26]), roughness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a565, metalness: 1, roughness: 0.3, envMap });
  const led = new THREE.MeshBasicMaterial({ color: 0xfff1d8 });
  const total = series.length * SECTION_W + (series.length + 1) * PILLAR;
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = shadow; parent.add(mesh); return mesh;
  };
  // Wooden base cabinet with a gold trim line, the lacquered carcass on top and a cornice.
  const frame = [add(new THREE.BoxGeometry(total + 0.1, BASE, DEPTH + 0.2), wood, 0, BASE / 2, 0)];
  add(new THREE.BoxGeometry(total + 0.12, 0.025, 0.02), gold, 0, BASE - 0.04, DEPTH / 2 + 0.11, false);
  add(new THREE.BoxGeometry(total, GRID_H, 0.04), lacquer, 0, BASE + GRID_H / 2, -DEPTH / 2 - 0.02);
  frame.push(add(new THREE.BoxGeometry(total + 0.14, 0.12, DEPTH + 0.16), wood, 0, BASE + GRID_H + 0.06, 0));
  // Clear front panels: reflections only, never a tap target.
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, roughness: 0.04, metalness: 0, envMap, envMapIntensity: 2.2, depthWrite: false });
  const slots = new Map<string, { card: THREE.Mesh; material: THREE.MeshBasicMaterial; cell: THREE.Texture; shadow: THREE.MeshBasicMaterial; hover: number }>();
  const plaques = new Map<string, { paint: (title: string, count: string) => void; number: string; total: number }>();
  const picks: THREE.Mesh[] = [];
  const cardGeometry = new THREE.PlaneGeometry(CARD_W, CARD_H).translate(0, CARD_H / 2, 0);
  const [shadowCanvas, shadowContext] = canvas(64, 32);
  const blot = shadowContext.createRadialGradient(32, 16, 0, 32, 16, 32);
  blot.addColorStop(0, "rgba(0,0,0,.85)"); blot.addColorStop(1, "rgba(0,0,0,0)");
  shadowContext.setTransform(1, 0, 0, 0.5, 0, 8); shadowContext.fillStyle = blot; shadowContext.fillRect(0, 0, 64, 64);
  const shadowMap = new THREE.CanvasTexture(shadowCanvas), shadowGeometry = new THREE.PlaneGeometry(0.42, 0.16).rotateX(-Math.PI / 2);
  for (let pillar = 0; pillar <= series.length; pillar++) frame.push(add(new THREE.BoxGeometry(PILLAR, GRID_H, DEPTH + 0.04), lacquer, -total / 2 + PILLAR / 2 + pillar * (SECTION_W + PILLAR), BASE + GRID_H / 2, 0));
  series.forEach((entry, index) => {
    const centre = -total / 2 + PILLAR + SECTION_W / 2 + index * (SECTION_W + PILLAR);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(SECTION_W, GRID_H), new THREE.MeshBasicMaterial({ map: backPanel(entry.accent) }));
    back.position.set(centre, BASE + GRID_H / 2, -DEPTH / 2 + 0.001); parent.add(back);
    for (let row = 0; row <= ROWS; row++) {
      const y = BASE + FRAME / 2 + row * (CELL_H + FRAME);
      add(new THREE.BoxGeometry(SECTION_W, FRAME, DEPTH), lacquer, centre, y, 0);
      // An LED strip under the front edge of every cubby ceiling.
      if (row > 0) add(new THREE.BoxGeometry(SECTION_W - 0.1, 0.012, 0.012), led, centre, y - FRAME / 2 - 0.006, DEPTH / 2 - 0.05, false);
    }
    for (let column = 1; column < COLUMNS; column++) add(new THREE.BoxGeometry(FRAME, GRID_H, DEPTH), lacquer, centre - SECTION_W / 2 + FRAME / 2 + column * (CELL_W + FRAME), BASE + GRID_H / 2, 0);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(SECTION_W, GRID_H), glass);
    front.position.set(centre, BASE + GRID_H / 2, DEPTH / 2 + 0.02); front.renderOrder = 2; front.raycast = () => {}; parent.add(front);
    const sign = plaque(entry.accent);
    // Brass-framed label on the base cabinet, below its section.
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.54, 0.4), new THREE.MeshStandardMaterial({ map: sign.map, roughness: 0.6 }));
    board.position.set(centre, BASE / 2 - 0.02, DEPTH / 2 + 0.105); parent.add(board);
    plaques.set(entry.id, { paint: sign.paint, number: entry.number, total: entry.keys.length });
    sign.paint(labels.series(entry.number), labels.collected(0, entry.keys.length));
    const sheet = new THREE.TextureLoader().load(entry.silhouettes, () => slots.forEach(({ cell }) => { cell.needsUpdate = true; }));
    entry.keys.forEach((key, slot) => {
      // Catalog order reads left to right from the top shelf down.
      const row = ROWS - 1 - Math.floor(slot / COLUMNS), column = slot % COLUMNS;
      const floor = BASE + FRAME + row * (CELL_H + FRAME), x = centre - SECTION_W / 2 + FRAME + CELL_W / 2 + column * (CELL_W + FRAME);
      const cell = sheet.clone();
      cell.repeat.set(1 / SHEET_COLUMNS, 0.5); cell.offset.set((slot % SHEET_COLUMNS) / SHEET_COLUMNS, 1 - (Math.floor(slot / SHEET_COLUMNS) + 1) * 0.5);
      const material = new THREE.MeshBasicMaterial({ map: cell, color: 0x000000, transparent: true, alphaTest: 0.35 });
      const card = new THREE.Mesh(cardGeometry, material);
      card.position.set(x, floor, 0.02); card.userData.figure = key; parent.add(card);
      const shadow = new THREE.MeshBasicMaterial({ map: shadowMap, transparent: true, opacity: 0.35, depthWrite: false });
      const blob = new THREE.Mesh(shadowGeometry, shadow); blob.position.set(x, floor + 0.002, 0.04); blob.raycast = () => {}; parent.add(blob);
      slots.set(key, { card, material, cell, shadow, hover: 0 });
      picks.push(card);
    });
  });
  const glow = cardGlow(CARD_W, CARD_H, 0xffd98a); parent.add(glow.mesh);
  const lamp = new THREE.PointLight(0xffd8a0, 3, 7, 1.6); lamp.position.set(0, CASE_HEIGHT - 0.4, 1.6); parent.add(lamp);

  return {
    picks, frame,
    setSlot(key: string, state: SlotState, portrait?: THREE.Texture) {
      const slot = slots.get(key);
      if (!slot) return;
      const owned = state === "owned" && portrait;
      slot.material.map = owned ? portrait : slot.cell;
      // Owned portraits keep soft edges; pending ones glint gold until the portrait is ready.
      slot.material.color.set(owned ? 0xffffff : state === "pending" ? 0x6a5428 : 0x000000);
      slot.material.alphaTest = owned ? 0.02 : 0.35;
      slot.material.needsUpdate = true;
      slot.shadow.opacity = owned ? 0.6 : 0.35;
    },
    setCollected(id: string, got: number) {
      const sign = plaques.get(id);
      sign?.paint(labels.series(sign.number), labels.collected(got, sign.total));
    },
    update(hovered: string | null, delta: number) {
      slots.forEach((slot, key) => {
        slot.hover = THREE.MathUtils.damp(slot.hover, key === hovered ? 1 : 0, 12, delta);
        slot.card.scale.setScalar(1 + slot.hover * 0.1);
      });
      glow.update(hovered ? slots.get(hovered)?.card ?? null : null, 1, delta);
    },
  };
}
