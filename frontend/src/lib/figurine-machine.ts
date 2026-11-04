import * as THREE from "three";
import { cardGlow } from "@/lib/figurine-glow";
import { woodTexture } from "@/lib/figurine-shop";
import { SILHOUETTE } from "@/lib/figurine-packaging";
import type { PlaceProp } from "@/lib/figurine-props";
import type { FigurineQuality } from "@/lib/figurine-collection";

// The two workshop stations. Each has three card slots, a display and a trigger. Cards are chosen
// in the page's picker (a grid that scales to any collection) and fly into the slots; tap a loaded
// card to take it back, work the trigger to run.
// - The recycler is a furnace: the three are laid on its feed table and thrown in at the top, the
//   bellows fire it, and a blind box is drawn out of the crucible of molten metal at its foot.
// - The trade-up forge is an anvil before a carved stele: the three fly onto the anvil, fuse under
//   three blows of the trip hammer, and the figure rises again one quality up.
export type MachineCard = { key: string; quality: FigurineQuality; name: string; texture: THREE.Texture | null };
// `accent` tints the forge's runes with the quality a run would make.
export type MachineView = { slots: MachineCard[]; title: string; detail: string; ready: boolean; accent?: FigurineQuality };
export type MachinePick = { kind: "slot"; index: number } | { kind: "trigger" };
export type MachineOutput = { kind: "box"; box: THREE.Mesh | null } | { kind: "figure"; card: MachineCard };
export type MachineCue = "pull" | "clank" | "charge" | "strike" | "drop" | "sparkle";
export type Machine = ReturnType<typeof buildRecycler>;

const CARD_W = 0.4, CARD_H = 0.53, PORTRAIT_H = 0.42, PORTRAIT_W = PORTRAIT_H * SILHOUETTE.w / SILHOUETTE.h;
export const QUALITY_COLORS: Record<FigurineQuality, string> = { standard: "#a08a62", golden: "#f2c75c", galaxy: "#9a7bff" };

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  return [element, element.getContext("2d")!] as const;
}
const srgb = (element: HTMLCanvasElement) => { const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map; };
const add = (target: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, shadow = true) => {
  const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = shadow; target.add(mesh); return mesh;
};
const invisible = () => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
function glowMap() {
  const [element, context] = canvas(64, 64);
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(0.35, "rgba(255,255,255,.45)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
  return srgb(element);
}

// A trading-card style backing: quality-coloured frame and the figure's name.
function backing() {
  const [element, context] = canvas(160, 212), map = srgb(element);
  let painted = "";
  const paint = (name: string, quality: FigurineQuality, spare: number | null) => {
    const key = `${name}|${quality}|${spare}`;
    if (key === painted) return;
    painted = key;
    const color = QUALITY_COLORS[quality];
    context.clearRect(0, 0, 160, 212);
    context.fillStyle = "#16121a"; context.beginPath(); context.roundRect(2, 2, 156, 208, 12); context.fill();
    context.strokeStyle = color; context.lineWidth = quality === "standard" ? 4 : 7; context.stroke();
    const glow = context.createLinearGradient(0, 0, 0, 170);
    glow.addColorStop(0, `${color}55`); glow.addColorStop(1, "#16121a00");
    context.fillStyle = glow; context.fillRect(8, 8, 144, 162);
    context.fillStyle = "#efe2c4"; context.font = "600 17px system-ui, sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(name, 80, 192, 140);
    if (spare !== null) {
      context.fillStyle = spare > 0 ? color : "#4a4450"; context.beginPath(); context.roundRect(106, 10, 46, 28, 10); context.fill();
      context.fillStyle = "#16121a"; context.font = "700 18px system-ui, sans-serif"; context.fillText(`×${spare}`, 129, 25);
    }
    map.needsUpdate = true;
  };
  return { map, paint };
}

// The display: what the three would make, or what is missing.
function displayPanel(colors: { back: string; idle: string; ready: string }) {
  const [element, context] = canvas(512, 150), map = srgb(element);
  let painted = "";
  const paint = (title: string, detail: string, ready: boolean, working = false) => {
    const key = `${title}|${detail}|${ready}|${working}`;
    if (key === painted) return;
    painted = key;
    context.fillStyle = colors.back; context.fillRect(0, 0, 512, 150);
    context.textAlign = "center"; context.textBaseline = "middle"; context.shadowBlur = 14;
    context.shadowColor = context.fillStyle = ready || working ? colors.ready : colors.idle;
    context.font = "700 40px Georgia, serif"; context.letterSpacing = "4px"; context.fillText(title.toUpperCase(), 256, 56, 480);
    context.font = "500 28px Georgia, serif"; context.letterSpacing = "2px"; context.fillText(detail.toUpperCase(), 256, 108, 480);
    context.shadowBlur = 0; map.needsUpdate = true;
  };
  return { map, paint };
}

type Card = { group: THREE.Group; back: ReturnType<typeof backing>; portrait: THREE.MeshBasicMaterial; pick: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; fly: { from: THREE.Vector3; t: number } | null };

// The cards and the three slots, shared by both machines. `slots` are the loaded cards' rest
// positions in the station's space; a newly loaded card flies in from in front, low, as if handed in.
function machineKit(parent: THREE.Group, { slots: slotSpots }: { slots: THREE.Vector3[] }) {
  const frame: THREE.Mesh[] = [];
  const cardGeometry = new THREE.PlaneGeometry(CARD_W, CARD_H), portraitGeometry = new THREE.PlaneGeometry(PORTRAIT_W, PORTRAIT_H);
  const handIn = (spot: THREE.Vector3) => spot.clone().add(new THREE.Vector3(0, -1.1, 2.2));

  const makeCard = (): Card => {
    const group = new THREE.Group(); parent.add(group);
    const back = backing();
    const pick = new THREE.Mesh(cardGeometry, new THREE.MeshBasicMaterial({ map: back.map, transparent: true, alphaTest: 0.05 })); group.add(pick);
    const portrait = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.02 });
    const face = new THREE.Mesh(portraitGeometry, portrait); face.position.set(0, 0.035, 0.003); face.raycast = () => {}; group.add(face);
    return { group, back, portrait, pick, fly: null };
  };
  const dropCard = (card: Card) => {
    parent.remove(card.group); card.back.map.dispose();
    card.pick.material.dispose(); card.portrait.dispose();
  };
  const dress = (card: Card, entry: MachineCard) => {
    card.back.paint(entry.name, entry.quality, null);
    if (card.portrait.map !== entry.texture) { card.portrait.map = entry.texture; card.portrait.needsUpdate = true; }
    card.portrait.opacity = entry.texture ? 1 : 0;
  };
  let loaded: (Card | null)[] = [null, null, null];
  const glow = cardGlow(CARD_W, CARD_H, 0xffd98a); parent.add(glow.mesh);
  const triggers: THREE.Mesh[] = [], picks: THREE.Mesh[] = [];
  const refreshPicks = () => {
    picks.length = 0; picks.push(...triggers);
    loaded.forEach((card) => { if (card) picks.push(card.pick); });
  };
  return {
    frame, picks, makeCard, dropCard, dress,
    trigger(mesh: THREE.Mesh) { mesh.userData.machine = { kind: "trigger" } satisfies MachinePick; triggers.push(mesh); refreshPicks(); },
    set(view: MachineView) {
      loaded = [0, 1, 2].map((index) => {
        const entry = view.slots[index], current = loaded[index];
        if (!entry) { if (current) dropCard(current); return null; }
        const card = current ?? makeCard();
        if (!current) card.fly = { from: handIn(slotSpots[index]), t: 0 };
        card.pick.userData.machine = { kind: "slot", index } satisfies MachinePick;
        dress(card, entry);
        return card;
      });
      refreshPicks();
    },
    // Hands the loaded cards to a run; they are no longer slots.
    take() {
      const taken = loaded.filter((card): card is Card => !!card);
      loaded = [null, null, null];
      taken.forEach((card) => { card.fly = null; card.pick.userData.machine = undefined; });
      refreshPicks();
      return taken;
    },
    update(hovered: MachinePick | null, delta: number) {
      const hoveredCard = hovered?.kind === "slot" ? loaded[hovered.index] : null;
      glow.update(hoveredCard?.pick ?? null, 1, delta);
      loaded.forEach((card, index) => {
        if (!card) return;
        const target = slotSpots[index];
        if (card.fly) {
          card.fly.t = Math.min(1, card.fly.t + delta / 0.45);
          const t = 1 - (1 - card.fly.t) ** 3;
          card.group.position.lerpVectors(card.fly.from, target, t); card.group.position.y += Math.sin(Math.PI * t) * 0.35;
          card.group.rotation.z = (1 - t) * 0.4;
          if (card.fly.t >= 1) card.fly = null;
        } else { card.group.position.copy(target); card.group.rotation.z = 0; }
      });
    },
  };
}

// Small additive sprites with a lifetime: steam puffs, sparks, shreds of card.
function particles(parent: THREE.Object3D, map: THREE.Texture, count: number, blending: THREE.Blending = THREE.NormalBlending) {
  const items = Array.from({ length: count }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, opacity: 0, depthWrite: false, blending }));
    sprite.visible = false; parent.add(sprite);
    return { sprite, age: Infinity, life: 1, velocity: new THREE.Vector3(), size: 0.1, grow: 0, gravity: 0 };
  });
  return {
    emit(at: THREE.Vector3, velocity: THREE.Vector3, { life = 1, size = 0.1, grow = 0, gravity = 0, color = 0xffffff }: { life?: number; size?: number; grow?: number; gravity?: number; color?: THREE.ColorRepresentation } = {}) {
      const free = items.find((item) => item.age >= item.life);
      if (!free) return;
      Object.assign(free, { age: 0, life, size, grow, gravity }); free.velocity.copy(velocity); free.sprite.position.copy(at); free.sprite.material.color.set(color);
    },
    update(delta: number, fade = 1) {
      items.forEach((item) => {
        item.age += delta;
        item.sprite.visible = item.age < item.life;
        if (!item.sprite.visible) return;
        item.velocity.y -= item.gravity * delta;
        item.sprite.position.addScaledVector(item.velocity, delta);
        item.sprite.scale.setScalar(item.size + item.age * item.grow);
        item.sprite.material.opacity = fade * (1 - item.age / item.life);
      });
    },
  };
}

const RECYCLER_X = 0.1, FURNACE_H = 2.75, FURNACE_Z = -0.75, TABLE_Z = 1, TABLE_TOP = 0.56;
const SLOT_Y = TABLE_TOP + CARD_H / 2 + 0.02, SLOT_GAP = 0.58;
const RUN_SECONDS = 3.1, SWALLOW = 0.45, POP = 2.15;
// Where the crucible stands, and the bellows that fire the furnace.
const CRUCIBLE = { x: -1.72, z: 0.5 }, BELLOWS = { x: 1.95, z: -0.55 };

export function buildRecycler(parent: THREE.Group, { placeProp }: { envMap: THREE.Texture; placeProp: PlaceProp }) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(41, [74, 48, 30]), roughness: 0.75 });
  const slotSpots = [-1, 0, 1].map((step) => new THREE.Vector3(RECYCLER_X + step * SLOT_GAP, SLOT_Y, TABLE_Z - 0.1));
  const kit = machineKit(parent, { slots: slotSpots });
  const loads: Promise<THREE.Group>[] = [];
  const prop = (target: THREE.Object3D, ...[name, placement]: [Parameters<PlaceProp>[1], Parameters<PlaceProp>[2]]) => { const placed = placeProp(target, name, placement); loads.push(placed.ready); return placed; };
  // The furnace shakes as a whole while it works; the table and tools stay put.
  const furnace = new THREE.Group(); furnace.position.set(RECYCLER_X, 0, FURNACE_Z); parent.add(furnace);
  prop(furnace, "forgeFurnace", { height: FURNACE_H, yaw: -Math.PI / 2 });
  // The feed table, its slot marks burned into the top and the display hung from its front.
  prop(parent, "marketTable", { height: 1, length: 2.3, x: RECYCLER_X, z: TABLE_Z, yaw: -Math.PI / 2 });
  for (const spot of slotSpots) add(parent, new THREE.BoxGeometry(CARD_W + 0.08, 0.02, 0.14), wood, spot.x, TABLE_TOP + 0.01, spot.z, false);
  const display = displayPanel({ back: "#1a100a", idle: "#ffcf7a", ready: "#ffe9b0" });
  // The display holds what a run is making until it is done, then shows the machine as it is now.
  let title = "", shown: MachineView | null = null;
  const screen = add(parent, new THREE.PlaneGeometry(1.15, 0.33), new THREE.MeshBasicMaterial({ map: display.map, toneMapped: false }), RECYCLER_X, 0.32, TABLE_Z + 0.975, false);
  screen.raycast = () => {};
  kit.frame.push(add(parent, new THREE.BoxGeometry(1.25, 0.42, 0.04), wood, RECYCLER_X, 0.32, TABLE_Z + 0.95));
  // The crucible the run ends in.
  prop(parent, "forgeCrucible", { height: 0.72, x: RECYCLER_X + CRUCIBLE.x, z: CRUCIBLE.z, yaw: 0.6 });
  // The bellows beside the furnace: tap them once three are loaded.
  const bellows = new THREE.Group(); bellows.position.set(RECYCLER_X + BELLOWS.x - 0.1, 0, BELLOWS.z); parent.add(bellows);
  prop(bellows, "forgeBellows", { height: 1.1, yaw: 0 });
  kit.trigger(add(bellows, new THREE.BoxGeometry(1, 1.25, 1.5), invisible(), 0, 0.6, 0, false));
  // Firelight at the furnace's door and throat, heat from its chimney, embers while it burns.
  const glows = glowMap();
  const fire = (x: number, y: number, z: number, size: number) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glows, color: 0xff8a3a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sprite.position.set(x, y, z); sprite.scale.setScalar(size); furnace.add(sprite);
    return sprite;
  };
  const door = fire(0, 0.82, 1.28, 1.25), throat = fire(0, FURNACE_H + 0.05, 0, 1.15);
  const [puffCanvas, puff] = canvas(64, 64);
  const cloud = puff.createRadialGradient(32, 32, 0, 32, 32, 32);
  cloud.addColorStop(0, "rgba(255,255,255,.85)"); cloud.addColorStop(1, "rgba(255,255,255,0)");
  puff.fillStyle = cloud; puff.fillRect(0, 0, 64, 64);
  const smoke = particles(furnace, srgb(puffCanvas), 10);
  const embers = particles(furnace, glows, 28, THREE.AdditiveBlending);
  const emberColors = [0xffb24a, 0xff7a2a, 0xffe08a, 0xf2c75c];

  let run: { t: number; swallowed: Card[]; output: MachineOutput; done: () => void; cue: (cue: MachineCue) => void; clanks: number; popped: boolean } | null = null;
  // What the run made, lifted out of the crucible; `rest` is its height above the ground at its centre.
  let output: THREE.Object3D | null = null, outputCard: Card | null = null, outputClock = 0, outputRest = 0;
  let ready = false, bellowsHover = 0, pump = 0, heat = 0, smokeClock = 0, emberClock = 0;
  const clearOutput = () => {
    if (output) { parent.remove(output); output = null; }
    if (outputCard) { kit.dropCard(outputCard); outputCard = null; }
  };
  const into = new THREE.Vector3(RECYCLER_X, FURNACE_H + 0.15, FURNACE_Z), mouth = new THREE.Vector3(0, FURNACE_H + 0.05, 0);

  return {
    picks: kit.picks, frame: kit.frame,
    // The outline's meshes, once the game props are in.
    ready: Promise.all(loads).then((groups) => {
      const meshes = [...kit.frame];
      groups.forEach((group) => group.traverse((object) => { if (object instanceof THREE.Mesh && !object.userData.outline) meshes.push(object); }));
      return meshes;
    }),
    set(view: MachineView) {
      shown = view;
      if (!run) display.paint(view.title, view.detail, view.ready);
      ready = view.ready;
      kit.set(view);
    },
    // Runs the machine on what is loaded now; `done` fires once the output has landed.
    run(made: MachineOutput, cue: (cue: MachineCue) => void, done: () => void) {
      clearOutput();
      run = { t: 0, swallowed: kit.take(), output: made, done, cue, clanks: 0, popped: false };
      title = shown?.title ?? ""; display.paint(title, shown?.detail ?? "", false, true);
      cue("pull");
    },
    get running() { return !!run; },
    clear() { if (!run) clearOutput(); },
    update(hovered: MachinePick | null, delta: number, time: number) {
      bellowsHover = THREE.MathUtils.damp(bellowsHover, hovered?.kind === "trigger" ? 1 : 0, 10, delta);
      kit.update(hovered, delta);
      let shake = 0, burning = false;
      if (run) {
        const previous = run.t;
        run.t += delta;
        const t = run.t;
        // The three are thrown up and over into the furnace's throat.
        run.swallowed.forEach((card, index) => {
          const k = THREE.MathUtils.clamp((t - index * 0.08) / SWALLOW, 0, 1), ease = k * k;
          card.group.position.lerpVectors(slotSpots[index], into, ease); card.group.position.y += Math.sin(Math.PI * k) * 0.9;
          card.group.scale.setScalar(1 - 0.75 * ease); card.group.rotation.set(-ease * 1.2, 0, ease * 0.6);
          card.group.visible = k < 1;
        });
        // It burns: the bellows pump, the fire roars, smoke and embers leave by the chimney.
        burning = t > SWALLOW && t < POP;
        shake = burning ? Math.min(1, (t - SWALLOW) / 0.3) * Math.min(1, (POP - t) / 0.2) : 0;
        pump = burning ? Math.abs(Math.sin((t - SWALLOW) * 6.5)) : t < SWALLOW ? Math.min(1, t / 0.25) : 0;
        if (burning && Math.floor((t - SWALLOW) / 0.24) > run.clanks) { run.clanks++; run.cue("clank"); }
        if (previous < SWALLOW && t >= SWALLOW) display.paint(title, "· · ·", false, true);
        if (burning) {
          emberClock -= delta;
          if (emberClock <= 0 && t < POP - 0.3) {
            emberClock = 0.05;
            embers.emit(mouth, new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.6 + Math.random() * 1.4, (Math.random() - 0.2) * 1), { life: 0.9, size: 0.07, gravity: 4, color: emberColors[Math.floor(Math.random() * emberColors.length)] });
          }
        }
        // What it made is drawn out of the crucible and set down in front of it.
        if (!run.popped && t >= POP) {
          run.popped = true; outputClock = 0;
          if (run.output.kind === "box" && run.output.box) {
            output = run.output.box; output.scale.setScalar(1.3); parent.add(output);
            run.output.box.geometry.computeBoundingBox(); outputRest = -run.output.box.geometry.boundingBox!.min.y * 1.3;
          } else if (run.output.kind === "figure") { outputCard = kit.makeCard(); kit.dress(outputCard, run.output.card); output = outputCard.group; outputRest = CARD_H / 2; }
          run.cue(run.output.kind === "figure" ? "sparkle" : "drop");
        }
        if (t >= RUN_SECONDS) { const done = run.done; run.swallowed.forEach(kit.dropCard); run = null; if (shown) display.paint(shown.title, shown.detail, shown.ready); done(); }
      } else pump = THREE.MathUtils.damp(pump, 0, 8, delta);
      if (output) {
        outputClock += delta;
        const k = Math.min(1, outputClock / 0.55), bounce = Math.abs(Math.sin(Math.min(1, outputClock / 0.9) * Math.PI * 2.5)) * (1 - Math.min(1, outputClock / 0.9)) * 0.12;
        output.position.set(RECYCLER_X + CRUCIBLE.x, THREE.MathUtils.lerp(0.7, outputRest, k) + Math.sin(Math.PI * k) * 0.55 + bounce, CRUCIBLE.z + THREE.MathUtils.lerp(0, 0.95, k));
        output.rotation.set(0, 0.3 + (outputCard ? Math.sin(time * 1.5) * 0.2 : 0), 0);
      }
      // The fire idles low, wakes when three are loaded, and roars through a run.
      heat = THREE.MathUtils.damp(heat, burning ? 1 : ready ? 0.45 : 0.18, 4, delta);
      const flicker = 0.85 + 0.15 * Math.sin(time * 11) * Math.sin(time * 7.3);
      door.material.opacity = (0.35 + heat * 0.65) * flicker; throat.material.opacity = heat * 0.8 * flicker;
      smokeClock -= delta;
      if (smokeClock <= 0) { smokeClock = burning ? 0.14 : 0.9; smoke.emit(mouth, new THREE.Vector3(0.12, 0.7 + heat * 0.5, 0), { life: 1.8, size: 0.28, grow: 0.5, color: burning ? 0x54504c : 0x8a8682 }); }
      bellows.scale.y = 1 - pump * 0.16 - bellowsHover * 0.03 - (ready && !run ? 0.02 + 0.02 * Math.sin(time * 4) : 0);
      furnace.position.set(RECYCLER_X + Math.sin(time * 53) * 0.012 * shake, Math.abs(Math.sin(time * 31)) * 0.016 * shake, FURNACE_Z + Math.cos(time * 47) * 0.01 * shake);
      smoke.update(delta, 0.4); embers.update(delta);
    },
  };
}

// Rune circle for the stele: rings, tick marks and glyphs, drawn white and tinted by the material.
function runeCircle() {
  const [element, context] = canvas(512, 512), next = (() => { let seed = 7; return () => (seed = (seed * 16807) % 2147483647) / 2147483647; })();
  context.translate(256, 256); context.strokeStyle = context.fillStyle = "#fff"; context.lineCap = "round";
  for (const [radius, width] of [[236, 6], [214, 2], [150, 4], [132, 2]] as const) { context.lineWidth = width; context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.stroke(); }
  context.lineWidth = 3;
  for (let i = 0; i < 72; i++) { const angle = i / 72 * Math.PI * 2, inner = i % 6 ? 220 : 204; context.beginPath(); context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner); context.lineTo(Math.cos(angle) * 232, Math.sin(angle) * 232); context.stroke(); }
  // Glyphs between the rings: short angular strokes, a few per rune.
  for (let i = 0; i < 18; i++) {
    context.save(); context.rotate(i / 18 * Math.PI * 2); context.translate(0, -182);
    context.beginPath();
    for (let s = 0; s < 3; s++) { const x = (next() - 0.5) * 22, y = (next() - 0.5) * 30; context.moveTo(x, y); context.lineTo(x + (next() - 0.5) * 24, y + (next() - 0.5) * 24); }
    context.stroke(); context.restore();
  }
  // A triangle joining the three cradles, inside the inner ring.
  context.lineWidth = 4; context.beginPath();
  for (let i = 0; i <= 3; i++) { const angle = -Math.PI / 2 + i / 3 * Math.PI * 2; context[i ? "lineTo" : "moveTo"](Math.cos(angle) * 128, Math.sin(angle) * 128); }
  context.stroke();
  const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

const FORGE_X = -0.3, PLINTH_H = 0.55, CAP = 0.06, ANVIL_H = 0.8, STELE_Z = -0.9, STELE_FACE = STELE_Z + 0.4;
const FACE_Y = PLINTH_H + CAP + ANVIL_H, ANVIL_X = FORGE_X - 0.1, ANVIL_Z = 0.22;
const RUNES_Y = 1.72, RUNE_RADIUS = 0.55;
// The trip hammer: an arm pivoting on a post right of the plinth, its head striking the anvil face.
// HIT is the arm angle at which the head's underside meets the face; the pivot sits high enough
// that the arm passes over the right-hand cradle.
const ARM = 1.15, HEAD_DROP = 0.36, PIVOT_Y = 2.3;
const HIT = Math.asin((PIVOT_Y - FACE_Y) / Math.hypot(ARM, HEAD_DROP)) - Math.atan2(HEAD_DROP, ARM), REST = HIT - 0.3, LIFT = HIT - 1;
const PIVOT_X = ANVIL_X + ARM * Math.cos(HIT);
const MERGE = 0.55, FIRST_STRIKE = 0.95, STRIKE_GAP = 0.5, STRIKES = 3, FUSE = 2.35, FORGE_SECONDS = 3.5;

export function buildForge(parent: THREE.Group, { envMap, placeProp }: { envMap: THREE.Texture; placeProp: PlaceProp }) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x8f8373, roughness: 0.92 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x5c5247, roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a63c, metalness: 1, roughness: 0.28, envMap });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2d33, metalness: 0.85, roughness: 0.38, envMap, envMapIntensity: 0.9 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(37, [66, 44, 30]), roughness: 0.75 });
  // The three cradles sit round the rune circle, at its top and lower corners.
  const corner = RUNE_RADIUS * Math.cos(Math.PI / 6);
  const slotSpots = [[0, RUNE_RADIUS], [-corner, -RUNE_RADIUS / 2], [corner, -RUNE_RADIUS / 2]].map(([x, y]) => new THREE.Vector3(FORGE_X + x, RUNES_Y + y, STELE_FACE + 0.04));
  const kit = machineKit(parent, { slots: slotSpots });
  const loads: Promise<THREE.Group>[] = [];
  const prop = (...[name, placement]: [Parameters<PlaceProp>[1], Parameters<PlaceProp>[2]]) => { const placed = placeProp(parent, name, placement); loads.push(placed.ready); return placed; };

  // A stone plinth with a gold-edged cap, the display set in its front.
  kit.frame.push(add(parent, new THREE.BoxGeometry(1.6, PLINTH_H, 1.1), stone, FORGE_X, PLINTH_H / 2, 0.1));
  add(parent, new THREE.BoxGeometry(1.75, CAP, 1.22), darkStone, FORGE_X, PLINTH_H + CAP / 2, 0.1);
  for (const z of [-1, 1]) add(parent, new THREE.BoxGeometry(1.78, 0.03, 0.03), gold, FORGE_X, PLINTH_H + CAP, 0.1 + z * 0.61, false);
  add(parent, new THREE.BoxGeometry(1.66, 0.08, 1.16), darkStone, FORGE_X, 0.04, 0.1);
  const display = displayPanel({ back: "#160f24", idle: "#f2c75c", ready: "#d9c8ff" });
  // The display holds what a run is making until it is done, then shows the machine as it is now.
  let title = "", shown: MachineView | null = null;
  const screen = add(parent, new THREE.PlaneGeometry(1.15, 0.33), new THREE.MeshBasicMaterial({ map: display.map, toneMapped: false }), FORGE_X, 0.3, 0.662, false);
  screen.raycast = () => {};
  add(parent, new THREE.BoxGeometry(1.25, 0.42, 0.03), gold, FORGE_X, 0.3, 0.645, false);
  // The anvil, and the carved stele behind it with the rune circle glowing on its face.
  prop("forgeAnvil", { height: ANVIL_H, x: ANVIL_X, y: PLINTH_H + CAP, z: ANVIL_Z, yaw: -Math.PI / 2 });
  prop("forgeStele", { height: 3.2, x: FORGE_X, z: STELE_Z, yaw: -Math.PI / 2 });
  const runeMaterial = new THREE.MeshBasicMaterial({ map: runeCircle(), color: QUALITY_COLORS.golden, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const runes = add(parent, new THREE.PlaneGeometry(1.5, 1.5), runeMaterial, FORGE_X, RUNES_Y, STELE_FACE + 0.01, false);
  runes.raycast = () => {};
  // Gold ledges for the cradles.
  for (const spot of slotSpots) add(parent, new THREE.BoxGeometry(CARD_W + 0.08, 0.035, 0.1), gold, spot.x, spot.y - CARD_H / 2 - 0.02, STELE_FACE + 0.04, false);
  // The trip hammer on its post.
  add(parent, new THREE.CylinderGeometry(0.07, 0.09, PIVOT_Y + 0.08, 12), iron, PIVOT_X, (PIVOT_Y + 0.08) / 2, ANVIL_Z);
  add(parent, new THREE.CylinderGeometry(0.16, 0.2, 0.12, 12), darkStone, PIVOT_X, 0.06, ANVIL_Z);
  add(parent, new THREE.CylinderGeometry(0.07, 0.07, 0.24, 14).rotateX(Math.PI / 2), gold, PIVOT_X, PIVOT_Y, ANVIL_Z);
  const arm = new THREE.Group(); arm.position.set(PIVOT_X, PIVOT_Y, ANVIL_Z); arm.rotation.z = REST; parent.add(arm);
  add(arm, new THREE.BoxGeometry(ARM + 0.12, 0.07, 0.08), wood, -ARM / 2 + 0.02, 0, 0);
  add(arm, new THREE.CylinderGeometry(0.025, 0.025, HEAD_DROP - 0.2, 8), iron, -ARM, -(HEAD_DROP - 0.2) / 2, 0);
  add(arm, new THREE.BoxGeometry(0.24, 0.22, 0.24), iron, -ARM, -HEAD_DROP + 0.11, 0);
  for (const y of [-HEAD_DROP + 0.03, -HEAD_DROP + 0.19]) add(arm, new THREE.BoxGeometry(0.26, 0.03, 0.26), gold, -ARM, y, 0, false);
  const gemMaterial = new THREE.MeshStandardMaterial({ color: 0x6a4fd8, roughness: 0.2, emissive: 0x8f6bff, emissiveIntensity: 0 });
  add(arm, new THREE.OctahedronGeometry(0.05), gemMaterial, -ARM, -HEAD_DROP + 0.11, 0.125, false);
  kit.trigger(add(arm, new THREE.BoxGeometry(ARM + 0.35, 0.65, 0.45), invisible(), -ARM / 2 - 0.05, -0.18, 0, false));
  // A brazier either side of the stele, the void-fire one burning in the colour a run would make.
  prop("forgeBrazier", { height: 0.72, x: FORGE_X - 1.5, z: STELE_Z + 0.75, yaw: 0.5 });
  prop("forgeBrazierVoid", { height: 1.25, x: FORGE_X + 1.62, z: STELE_Z + 0.75, yaw: -0.4 });
  // The glow where the three fuse, the light pillar the result rises in, and sparks from each blow.
  const glows = glowMap();
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glows, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  flame.position.set(FORGE_X + 1.62, 1.2, STELE_Z + 0.75); flame.scale.setScalar(0.9); parent.add(flame);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glows, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  core.position.set(ANVIL_X + 0.04, FACE_Y + 0.08, ANVIL_Z + 0.05); parent.add(core);
  const pillarMaterial = new THREE.MeshBasicMaterial({ map: glows, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  const pillar = add(parent, new THREE.CylinderGeometry(0.32, 0.4, 1.6, 20, 1, true), pillarMaterial, ANVIL_X + 0.04, FACE_Y + 0.8, ANVIL_Z, false);
  pillar.raycast = () => {};
  const sparks = particles(parent, glows, 40, THREE.AdditiveBlending);
  const face = new THREE.Vector3(ANVIL_X + 0.04, FACE_Y + 0.02, ANVIL_Z);

  let run: { t: number; swallowed: Card[]; output: MachineOutput; done: () => void; cue: (cue: MachineCue) => void; strikes: number; fused: boolean; color: THREE.Color } | null = null;
  let outputCard: Card | null = null, outputClock = 0;
  let ready = false, hover = 0, spin = 0;
  const accent = new THREE.Color(QUALITY_COLORS.golden);
  const clearOutput = () => { if (outputCard) { kit.dropCard(outputCard); outputCard = null; } };
  // The arm's angle `t` seconds into a run: three lift-and-slam cycles, then back to rest.
  const armAt = (t: number) => {
    const start = FIRST_STRIKE - 0.42, end = FIRST_STRIKE + (STRIKES - 1) * STRIKE_GAP + 0.08;
    if (t < start) return REST;
    if (t > end) return THREE.MathUtils.lerp(HIT, REST, Math.min(1, (t - end) / 0.45) ** 0.5);
    const index = Math.min(STRIKES - 1, Math.floor((t - start) / STRIKE_GAP)), local = t - start - index * STRIKE_GAP;
    if (local < 0.32) return THREE.MathUtils.lerp(index ? HIT : REST, LIFT, 1 - (1 - local / 0.32) ** 2);
    if (local < 0.42) return THREE.MathUtils.lerp(LIFT, HIT, ((local - 0.32) / 0.1) ** 2);
    return HIT;
  };

  return {
    picks: kit.picks, frame: kit.frame,
    // The outline's meshes, once the game props are in.
    ready: Promise.all(loads).then((groups) => {
      const meshes = [...kit.frame];
      groups.forEach((group) => group.traverse((object) => { if (object instanceof THREE.Mesh && !object.userData.outline) meshes.push(object); }));
      return meshes;
    }),
    set(view: MachineView) {
      shown = view;
      if (!run) display.paint(view.title, view.detail, view.ready);
      ready = view.ready;
      if (!run) accent.set(QUALITY_COLORS[view.accent ?? "golden"]);
      kit.set(view);
    },
    run(made: MachineOutput, cue: (cue: MachineCue) => void, done: () => void) {
      clearOutput();
      const color = new THREE.Color(made.kind === "figure" ? QUALITY_COLORS[made.card.quality] : QUALITY_COLORS.golden);
      run = { t: 0, swallowed: kit.take(), output: made, done, cue, strikes: 0, fused: false, color };
      accent.copy(color);
      title = shown?.title ?? ""; display.paint(title, shown?.detail ?? "", false, true);
      cue("pull"); cue("charge");
    },
    get running() { return !!run; },
    clear() { if (!run) clearOutput(); },
    update(hovered: MachinePick | null, delta: number, time: number) {
      hover = THREE.MathUtils.damp(hover, hovered?.kind === "trigger" ? 1 : 0, 10, delta);
      gemMaterial.emissiveIntensity = (ready ? 0.6 + 0.5 * Math.sin(time * 4) : 0.1) + hover * 0.6;
      kit.update(hovered, delta);
      let glow = 0, armAngle = REST + hover * -0.06 + (ready ? Math.sin(time * 2) * 0.015 : 0), pillarGlow = 0;
      if (run) {
        const previous = run.t;
        run.t += delta;
        const t = run.t;
        // The three leave their cradles, swirl in and sink into the anvil face.
        run.swallowed.forEach((card, index) => {
          const k = THREE.MathUtils.clamp((t - index * 0.06) / MERGE, 0, 1), ease = k * k * (3 - 2 * k);
          card.group.position.lerpVectors(slotSpots[index], face, ease);
          card.group.position.y += Math.sin(Math.PI * k) * 0.25; card.group.position.z += Math.sin(Math.PI * k) * 0.35;
          card.group.scale.setScalar(1 - 0.85 * ease); card.group.rotation.set(0, ease * Math.PI * 2, ease * (index - 1) * 0.8);
          card.group.visible = k < 1;
        });
        glow = THREE.MathUtils.clamp((t - MERGE * 0.6) / 0.3, 0, 1) * 0.6;
        armAngle = armAt(t);
        const strikes = Math.min(STRIKES, Math.max(0, Math.floor((t - FIRST_STRIKE) / STRIKE_GAP) + 1));
        if (strikes > run.strikes) {
          run.strikes = strikes; run.cue("strike");
          for (let i = 0; i < 14; i++) {
            const angle = Math.random() * Math.PI * 2, speed = 1.2 + Math.random() * 2.2;
            sparks.emit(face, new THREE.Vector3(Math.cos(angle) * speed, 1 + Math.random() * 2.4, Math.sin(angle) * speed * 0.6 + 0.4), { life: 0.5 + Math.random() * 0.4, size: 0.07, gravity: 7, color: Math.random() < 0.5 ? run.color : 0xffd27a });
          }
        }
        const sinceStrike = t - (FIRST_STRIKE + (run.strikes - 1) * STRIKE_GAP);
        if (run.strikes) glow += Math.max(0, 1 - sinceStrike / 0.25) * (0.4 + run.strikes * 0.2);
        if (previous < MERGE && t >= MERGE) display.paint(title, "· · ·", false, true);
        // Fused: a flash, and the new figure rises in a pillar of its quality's light.
        if (!run.fused && t >= FUSE) {
          run.fused = true; outputClock = 0;
          if (run.output.kind === "figure") { outputCard = kit.makeCard(); kit.dress(outputCard, run.output.card); }
          run.cue("sparkle");
        }
        if (run.fused) { const k = t - FUSE; glow += Math.max(0, 1.4 - k * 2); pillarGlow = Math.min(1, k * 4) * Math.max(0, 1 - (k - 0.6) / 0.6); }
        if (t >= FORGE_SECONDS) { const done = run.done; run.swallowed.forEach(kit.dropCard); run = null; if (shown) display.paint(shown.title, shown.detail, shown.ready); done(); }
      }
      if (outputCard) {
        outputClock += delta;
        const k = Math.min(1, outputClock / 0.9), ease = 1 - (1 - k) ** 3;
        outputCard.group.position.set(ANVIL_X + 0.04, FACE_Y + 0.05 + ease * 0.45 + Math.sin(time * 1.6) * 0.03 * k, ANVIL_Z + 0.12);
        outputCard.group.scale.setScalar(0.3 + 0.7 * ease); outputCard.group.rotation.set(0, (1 - ease) * Math.PI * 4, 0);
      }
      arm.rotation.z = armAngle;
      core.material.color.copy(run?.color ?? accent); core.material.opacity = Math.min(1, glow); core.scale.setScalar(0.35 + glow * 0.5);
      pillarMaterial.color.copy(run?.color ?? accent); pillarMaterial.opacity = pillarGlow * 0.55;
      spin += delta * (run ? 1.6 + glow * 3 : ready ? 0.35 : 0.08);
      runes.rotation.z = -spin;
      runeMaterial.color.copy(run?.color ?? accent);
      runeMaterial.opacity = run ? 0.55 + glow * 0.4 : ready ? 0.7 + 0.2 * Math.sin(time * 3) : 0.38;
      flame.material.color.copy(run?.color ?? accent); flame.material.opacity = 0.3 + (run ? glow * 0.7 : ready ? 0.2 + 0.1 * Math.sin(time * 3) : 0);
      sparks.update(delta);
    },
  };
}
