import * as THREE from "three";
import { woodTexture } from "@/lib/figurine-shop";
import { cardGlow } from "@/lib/figurine-glow";
import { SILHOUETTE } from "@/lib/figurine-packaging";
import type { FigurineQuality } from "@/lib/figurine-collection";

// Collection display: lit glass cases, one shelf per series, five shelves to a case. Each shelf
// holds its series' box at the left end and sixteen figures on round bases in two staggered rows,
// the back row raised on a clear riser, as collectors line them up. Owned figures stand as
// portraits in their finest quality; missing ones are faint frosted outlines. Spare copies show
// as a count by the base. Announced series wait on dim shelves with their greyed box.
export type CaseSeries = { id: string; number: string; accent: string; silhouettes?: string; keys: string[]; released: boolean; box: THREE.Mesh | null };
export type CaseLabels = { series: (number: string) => string; collected: (got: number, total: number) => string; comingSoon: string };
export type SlotState = "locked" | "pending" | "owned";
export type SlotView = { state: SlotState; portrait?: THREE.Texture; quality?: FigurineQuality | null; count?: number };
const SHELVES = 5, COLUMNS = 8, SHEET_COLUMNS = SILHOUETTE.columns;
const FIG_H = 0.5, FIG_W = FIG_H * SILHOUETTE.w / SILHOUETTE.h, SPACING = 0.42;
const INNER_W = 4.1, INNER_D = 0.66, PITCH = 0.84, SHELF_T = 0.04, BASE = 0.45, POST = 0.07, RISER_H = 0.15, BASE_H = 0.025;
const CASE_W = INNER_W + 2 * POST, GAP = 0.08;
export const CASE_HEIGHT = BASE + SHELVES * PITCH + 0.12;
const BASE_COLORS: Record<FigurineQuality | "missing", number> = { missing: 0x3b3a42, standard: 0x1d1b22, golden: 0xd4a63c, galaxy: 0x6e52f0 };

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  return [element, element.getContext("2d")!] as const;
}
const srgb = (element: HTMLCanvasElement) => { const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map; };

// A shelf's back wall, washed from above in its series' accent (gold once complete, grey while announced).
function backPanel() {
  const [element, context] = canvas(512, 96), map = srgb(element);
  const paint = (accent: string, level: "upcoming" | "open" | "complete") => {
    const tint = new THREE.Color(level === "complete" ? "#e8c068" : accent), strength = level === "upcoming" ? 0.4 : 1;
    const wash = context.createLinearGradient(0, 0, 0, 96);
    wash.addColorStop(0, `rgb(${(tint.r * 150 + 60) * strength},${(tint.g * 150 + 60) * strength},${(tint.b * 150 + 60) * strength})`);
    wash.addColorStop(0.5, `rgb(${(tint.r * 70 + 12) * strength},${(tint.g * 70 + 12) * strength},${(tint.b * 70 + 12) * strength})`);
    wash.addColorStop(1, `rgb(${tint.r * 26 + 6},${tint.g * 26 + 6},${tint.b * 26 + 6})`);
    context.fillStyle = wash; context.fillRect(0, 0, 512, 96);
    const spot = context.createRadialGradient(256, 0, 0, 256, 0, 300);
    spot.addColorStop(0, `rgba(255,240,215,${0.35 * strength})`); spot.addColorStop(1, "rgba(255,240,215,0)");
    context.fillStyle = spot; context.fillRect(0, 0, 512, 96);
    map.needsUpdate = true;
  };
  return { map, paint };
}

// The shelf edge label: series number on the left, progress on the right.
function shelfLabel() {
  const [element, context] = canvas(1024, 40), map = srgb(element);
  const paint = (title: string, count: string, color: string, accent: string) => {
    context.fillStyle = "#120e16"; context.fillRect(0, 0, 1024, 40);
    context.fillStyle = accent; context.fillRect(0, 38, 1024, 2);
    context.textBaseline = "middle";
    context.textAlign = "left"; context.fillStyle = color; context.font = "700 24px Georgia, serif"; context.letterSpacing = "5px"; context.fillText(title.toUpperCase(), 18, 21);
    context.textAlign = "right"; context.fillStyle = accent; context.font = "600 19px system-ui, sans-serif"; context.letterSpacing = "3px"; context.fillText(count.toUpperCase(), 1006, 21);
    map.needsUpdate = true;
  };
  return { map, paint };
}

function countTag(count: number, quality: FigurineQuality) {
  const [element, context] = canvas(96, 44);
  context.fillStyle = quality === "golden" ? "#3a2a0c" : quality === "galaxy" ? "#1c1238" : "#141218";
  context.beginPath(); context.roundRect(2, 2, 92, 40, 12); context.fill();
  context.fillStyle = quality === "golden" ? "#f6d27a" : quality === "galaxy" ? "#c6b4ff" : "#e9dcc0";
  context.font = "700 28px system-ui, sans-serif"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(`×${count}`, 48, 23);
  return srgb(element);
}

export function buildCase(parent: THREE.Group, { series, labels, envMap }: { series: CaseSeries[]; labels: CaseLabels; envMap: THREE.Texture }) {
  const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x24160f, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25, envMap, envMapIntensity: 0.25 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(23, [70, 40, 26]), roughness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a565, metalness: 1, roughness: 0.3, envMap });
  const acrylic = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.08, envMap, envMapIntensity: 1.2, depthWrite: false });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, roughness: 0.04, metalness: 0, envMap, envMapIntensity: 2.2, depthWrite: false });
  const cases = Math.max(1, Math.ceil(series.length / SHELVES));
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = shadow; parent.add(mesh); return mesh;
  };
  const frame: THREE.Mesh[] = [];
  const interior = SHELVES * PITCH, caseX = (index: number) => (index - (cases - 1) / 2) * (CASE_W + GAP);
  for (let index = 0; index < cases; index++) {
    const x = caseX(index);
    // A wooden plinth with a gold trim line, a lacquered frame, a crown, and glass all round.
    frame.push(add(new THREE.BoxGeometry(CASE_W + 0.06, BASE, INNER_D + 0.16), wood, x, BASE / 2, 0));
    add(new THREE.BoxGeometry(CASE_W + 0.08, 0.02, 0.02), gold, x, BASE - 0.05, INNER_D / 2 + 0.09, false);
    frame.push(add(new THREE.BoxGeometry(CASE_W + 0.1, 0.12, INNER_D + 0.18), wood, x, BASE + interior + 0.06, 0));
    add(new THREE.BoxGeometry(CASE_W + 0.12, 0.02, 0.02), gold, x, BASE + interior + 0.02, INNER_D / 2 + 0.1, false);
    for (const side of [-1, 1]) for (const depth of [-1, 1]) frame.push(add(new THREE.BoxGeometry(POST, interior, POST), lacquer, x + side * (INNER_W / 2 + POST / 2), BASE + interior / 2, depth * (INNER_D / 2 - POST / 2 + 0.04)));
    add(new THREE.BoxGeometry(INNER_W, interior, 0.03), lacquer, x, BASE + interior / 2, -INNER_D / 2 - 0.015);
    // Clear panels: reflections only, never a tap target.
    for (const [w, px, pz, yaw] of [[INNER_W, x, INNER_D / 2 + 0.045, 0], [INNER_D, x - CASE_W / 2, 0, Math.PI / 2], [INNER_D, x + CASE_W / 2, 0, Math.PI / 2]] as const) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, interior), glass);
      pane.position.set(px, BASE + interior / 2, pz); pane.rotation.y = yaw; pane.renderOrder = 2; pane.raycast = () => {}; parent.add(pane);
    }
  }

  type Slot = { card: THREE.Mesh; material: THREE.MeshBasicMaterial; cell: THREE.Texture; accent: THREE.Color; bases: THREE.InstancedMesh; index: number; tag: THREE.Mesh; tagKey: string };
  const slots = new Map<string, Slot>();
  const shelves = new Map<string, { label: ReturnType<typeof shelfLabel>; back: ReturnType<typeof backPanel>; number: string; total: number; accent: string; released: boolean }>();
  const picks: THREE.Mesh[] = [];
  const cardGeometry = new THREE.PlaneGeometry(FIG_W, FIG_H).translate(0, FIG_H / 2, 0);
  const baseGeometry = new THREE.CylinderGeometry(0.135, 0.145, BASE_H, 24).translate(0, BASE_H / 2, 0);
  const tagGeometry = new THREE.PlaneGeometry(0.15, 0.07);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.32, envMap });
  const color = new THREE.Color(), place = new THREE.Matrix4();
  // Only a card's middle takes taps: the rows are staggered, so each figure's empty margins
  // overlap its neighbours in the other row.
  const narrowPick = function (this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    const found: THREE.Intersection[] = [];
    THREE.Mesh.prototype.raycast.call(this, raycaster, found);
    intersects.push(...found.filter((hit) => hit.uv && Math.abs(hit.uv.x - 0.5) < 0.3));
  };
  series.forEach((entry, order) => {
    const shelf = order % SHELVES, x = caseX(Math.floor(order / SHELVES));
    const floor = BASE + (SHELVES - 1 - shelf) * PITCH + SHELF_T;
    add(new THREE.BoxGeometry(INNER_W, SHELF_T, INNER_D), lacquer, x, floor - SHELF_T / 2, 0);
    const back = backPanel(), label = shelfLabel();
    back.paint(entry.accent, entry.released ? "open" : "upcoming");
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(INNER_W, PITCH - SHELF_T), new THREE.MeshBasicMaterial({ map: back.map }));
    wall.position.set(x, floor + (PITCH - SHELF_T) / 2, -INNER_D / 2 + 0.001); parent.add(wall);
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(INNER_W, 0.07), new THREE.MeshStandardMaterial({ map: label.map, roughness: 0.6 }));
    edge.position.set(x, floor - SHELF_T - 0.035, INNER_D / 2 + 0.002); parent.add(edge);
    shelves.set(entry.id, { label, back, number: entry.number, total: entry.keys.length, accent: entry.accent, released: entry.released });
    if (entry.released) label.paint(labels.series(entry.number), labels.collected(0, entry.keys.length), "#f1d48a", entry.accent);
    else label.paint(labels.series(entry.number), labels.comingSoon, "#8a8278", "#6d6a72");
    if (entry.box) {
      entry.box.geometry.computeBoundingBox();
      entry.box.position.set(x - INNER_W / 2 + 0.3, floor - entry.box.geometry.boundingBox!.min.y, 0.02); entry.box.rotation.y = 0.28; parent.add(entry.box);
    }
    if (!entry.released || !entry.keys.length) return;
    // A clear riser lifts the back row so both rows show.
    const rowX = x - INNER_W / 2 + 0.72;
    add(new THREE.BoxGeometry(COLUMNS * SPACING + 0.2, RISER_H, 0.3), acrylic, rowX + (COLUMNS - 1) * SPACING / 2 + SPACING / 4, floor + RISER_H / 2, -INNER_D / 2 + 0.17, false).renderOrder = 1;
    const bases = new THREE.InstancedMesh(baseGeometry, baseMaterial, entry.keys.length);
    bases.castShadow = bases.receiveShadow = true; bases.raycast = () => {}; parent.add(bases);
    const accent = new THREE.Color(entry.accent).lerp(new THREE.Color(0xffffff), 0.55);
    const sheet = entry.silhouettes ? new THREE.TextureLoader().load(entry.silhouettes, () => slots.forEach(({ cell }) => { cell.needsUpdate = true; })) : null;
    entry.keys.forEach((key, index) => {
      // Catalog order: the back row first, left to right, then the front row.
      const back = index < COLUMNS, column = index % COLUMNS;
      const px = rowX + column * SPACING + (back ? SPACING / 2 : 0), py = floor + (back ? RISER_H : 0), pz = back ? -INNER_D / 2 + 0.17 : 0.13;
      bases.setMatrixAt(index, place.makeTranslation(px, py, pz)); bases.setColorAt(index, color.setHex(BASE_COLORS.missing));
      const cell = sheet ? sheet.clone() : new THREE.Texture();
      cell.repeat.set(1 / SHEET_COLUMNS, 1 / SILHOUETTE.rows); cell.offset.set((index % SHEET_COLUMNS) / SHEET_COLUMNS, 1 - (Math.floor(index / SHEET_COLUMNS) + 1) / SILHOUETTE.rows);
      const material = new THREE.MeshBasicMaterial({ map: cell, color: accent, transparent: true, opacity: 0.22, alphaTest: 0.05, depthWrite: false });
      const card = new THREE.Mesh(cardGeometry, material);
      card.position.set(px, py + BASE_H, pz); card.userData.figure = key; card.raycast = narrowPick; parent.add(card);
      const tag = new THREE.Mesh(tagGeometry, new THREE.MeshBasicMaterial({ transparent: true })); tag.position.set(px + 0.1, py + 0.05, pz + 0.15); tag.visible = false; tag.raycast = () => {}; parent.add(tag);
      slots.set(key, { card, material, cell, accent, bases, index, tag, tagKey: "" });
      picks.push(card);
    });
    bases.instanceMatrix.needsUpdate = true;
  });
  const glow = cardGlow(FIG_W, FIG_H, 0xffd98a); parent.add(glow.mesh);
  const lamp = new THREE.PointLight(0xffd8a0, 3, 7, 1.6); lamp.position.set(0, CASE_HEIGHT - 0.4, 1.6); parent.add(lamp);

  return {
    picks, frame, width: cases * CASE_W + (cases - 1) * GAP,
    setSlot(key: string, { state, portrait, quality = null, count = 0 }: SlotView) {
      const slot = slots.get(key);
      if (!slot) return;
      const owned = state === "owned" && portrait;
      slot.material.map = owned ? portrait : slot.cell;
      // Owned portraits keep soft edges; pending ones glint gold until the portrait is ready.
      slot.material.color.copy(owned ? color.setHex(0xffffff) : state === "pending" ? color.setHex(0x6a5428) : slot.accent);
      slot.material.opacity = state === "locked" ? 0.22 : 1;
      slot.material.transparent = state === "locked"; slot.material.depthWrite = state !== "locked";
      // The cutoff applies after opacity, so the faint outline needs a low one.
      slot.material.alphaTest = owned ? 0.02 : state === "locked" ? 0.05 : 0.35;
      slot.material.needsUpdate = true;
      slot.bases.setColorAt(slot.index, color.setHex(BASE_COLORS[state === "locked" || !quality ? "missing" : quality]));
      if (slot.bases.instanceColor) slot.bases.instanceColor.needsUpdate = true;
      const tagKey = count > 1 && quality ? `${count}|${quality}` : "";
      if (tagKey !== slot.tagKey) {
        const material = slot.tag.material as THREE.MeshBasicMaterial;
        material.map?.dispose(); material.map = tagKey ? countTag(count, quality!) : null; material.needsUpdate = true;
        slot.tag.visible = !!tagKey; slot.tagKey = tagKey;
      }
    },
    setCollected(id: string, got: number) {
      const shelf = shelves.get(id);
      if (!shelf?.released) return;
      const complete = got >= shelf.total;
      shelf.label.paint(labels.series(shelf.number), labels.collected(got, shelf.total), complete ? "#ffe39a" : "#f1d48a", complete ? "#e8c068" : shelf.accent);
      shelf.back.paint(shelf.accent, complete ? "complete" : "open");
    },
    update(hovered: string | null, delta: number) {
      // Figures stay their size under the pointer; only the halo marks them.
      glow.update(hovered ? slots.get(hovered)?.card ?? null : null, 1, delta);
    },
  };
}
