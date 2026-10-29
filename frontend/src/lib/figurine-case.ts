import * as THREE from "three";
import { woodTexture } from "@/lib/figurine-shop";

// Collection cabinet: one section per series, four shelves of four slots. Unowned figures stand
// as pitch-black silhouettes; owned ones show a portrait rendered from their model.
export type CaseSeries = { id: string; number: string; accent: string; silhouettes: string; keys: string[] };
export type SlotState = "locked" | "pending" | "owned";
const COLUMNS = 4, ROWS = 4, SHEET_COLUMNS = 8, SLOT_W = 0.5, SLOT_H = 0.9;

function plaque(text: string, accent: string) {
  const element = document.createElement("canvas");
  element.width = 768; element.height = 160;
  const context = element.getContext("2d")!;
  context.fillStyle = "#1b120c"; context.fillRect(0, 0, 768, 160);
  context.strokeStyle = accent; context.lineWidth = 8; context.strokeRect(10, 10, 748, 140);
  context.fillStyle = "#f1d48a"; context.font = "700 70px Georgia, serif"; context.textAlign = "center"; context.textBaseline = "middle";
  context.letterSpacing = "10px"; context.fillText(text.toUpperCase(), 384, 84, 700);
  const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

export function buildCase(parent: THREE.Group, { series, header }: { series: CaseSeries[]; header: (number: string) => string }) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(23, [70, 40, 26]), roughness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a565, metalness: 1, roughness: 0.3 });
  const sectionWidth = 3.5, gap = 0.3, total = series.length * sectionWidth + (series.length + 1) * gap, height = 4.5;
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  add(new THREE.BoxGeometry(total, 0.25, 1), wood, 0, 0.125, 0);
  add(new THREE.BoxGeometry(total + 0.2, 0.18, 1.1), wood, 0, height + 0.09, 0);
  add(new THREE.BoxGeometry(total, height, 0.1), wood, 0, height / 2, -0.45);
  const slots = new Map<string, { card: THREE.Mesh; material: THREE.MeshBasicMaterial; cell: THREE.Texture; hover: number }>();
  const picks: THREE.Mesh[] = [];
  const cardGeometry = new THREE.PlaneGeometry(SLOT_W, SLOT_H), discGeometry = new THREE.CylinderGeometry(0.2, 0.23, 0.05, 32);
  series.forEach((entry, index) => {
    const centre = -total / 2 + gap + sectionWidth / 2 + index * (sectionWidth + gap);
    for (const x of [centre - sectionWidth / 2 - gap / 2, centre + sectionWidth / 2 + gap / 2]) add(new THREE.BoxGeometry(gap, height, 1), wood, x, height / 2, 0);
    // Velvet back tinted with the series accent.
    const velvet = new THREE.MeshStandardMaterial({ color: new THREE.Color(entry.accent).multiplyScalar(0.18), roughness: 1 });
    add(new THREE.PlaneGeometry(sectionWidth, height - 0.25), velvet, centre, height / 2 + 0.06, -0.39);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), new THREE.MeshStandardMaterial({ map: plaque(header(entry.number), entry.accent), roughness: 0.6 }));
    sign.position.set(centre, height + 0.45, 0.2); parent.add(sign);
    const sheet = new THREE.TextureLoader().load(entry.silhouettes, () => slots.forEach(({ cell }) => { cell.needsUpdate = true; }));
    entry.keys.forEach((key, slot) => {
      // Catalog order reads left to right from the top shelf down.
      const row = ROWS - 1 - Math.floor(slot / COLUMNS), column = slot % COLUMNS;
      const shelfY = 0.25 + row * 1.08;
      if (column === 0 && row > 0) add(new THREE.BoxGeometry(sectionWidth, 0.06, 0.85), wood, centre, shelfY - 0.03, 0);
      const x = centre + (column - (COLUMNS - 1) / 2) * 0.84;
      add(discGeometry, gold, x, shelfY + 0.025, 0.05);
      const cell = sheet.clone();
      cell.repeat.set(1 / SHEET_COLUMNS, 0.5); cell.offset.set((slot % SHEET_COLUMNS) / SHEET_COLUMNS, 1 - (Math.floor(slot / SHEET_COLUMNS) + 1) * 0.5);
      const material = new THREE.MeshBasicMaterial({ map: cell, color: 0x000000, transparent: true, alphaTest: 0.35 });
      const card = new THREE.Mesh(cardGeometry, material);
      card.position.set(x, shelfY + 0.05 + SLOT_H / 2, 0.05); card.userData.figure = key; parent.add(card);
      slots.set(key, { card, material, cell, hover: 0 });
      picks.push(card);
    });
  });
  const lamp = new THREE.PointLight(0xffd8a0, 6, 7, 1.6); lamp.position.set(0, height - 0.3, 1.4); parent.add(lamp);

  return {
    picks,
    setSlot(key: string, state: SlotState, portrait?: THREE.Texture) {
      const slot = slots.get(key);
      if (!slot) return;
      const owned = state === "owned" && portrait;
      slot.material.map = owned ? portrait : slot.cell;
      // Owned portraits keep soft edges; pending ones glint gold until the portrait is ready.
      slot.material.color.set(owned ? 0xffffff : state === "pending" ? 0x6a5428 : 0x000000);
      slot.material.alphaTest = owned ? 0.02 : 0.35;
      slot.material.needsUpdate = true;
    },
    update(hovered: string | null, delta: number) {
      slots.forEach((slot, key) => {
        slot.hover = THREE.MathUtils.damp(slot.hover, key === hovered ? 1 : 0, 12, delta);
        slot.card.scale.setScalar(1 + slot.hover * 0.12);
      });
    },
  };
}
