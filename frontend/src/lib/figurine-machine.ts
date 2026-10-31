import * as THREE from "three";
import { cardGlow } from "@/lib/figurine-glow";
import { woodTexture } from "@/lib/figurine-shop";
import { SILHOUETTE } from "@/lib/figurine-packaging";
import type { PlaceProp } from "@/lib/figurine-props";
import type { FigurineQuality } from "@/lib/figurine-collection";

// The two machine stations. Both stand beside a pegboard of cards with three card slots, a display
// and a trigger: tap a card on the board to load it, tap a loaded card to take it back, work the
// trigger to run.
// - The recycler is a gnomish grinder: the three drop into its hopper, its rollers chew them up,
//   it shakes and clanks, and a blind box slides out of the chute.
// - The trade-up forge is an anvil before a rune stele: the three fly onto the anvil, fuse under
//   three blows of the trip hammer, and the figure rises again one quality up.
export type MachineCard = { key: string; quality: FigurineQuality; name: string; texture: THREE.Texture | null };
// `accent` tints the forge's runes with the quality a run would make.
export type MachineView = { tray: (MachineCard & { spare: number })[]; slots: MachineCard[]; title: string; detail: string; ready: boolean; accent?: FigurineQuality };
export type MachinePick = { kind: "tray"; key: string; quality: FigurineQuality } | { kind: "slot"; index: number } | { kind: "trigger" };
export type MachineOutput = { kind: "box"; box: THREE.Mesh | null } | { kind: "figure"; card: MachineCard };
export type MachineCue = "pull" | "clank" | "charge" | "strike" | "drop" | "sparkle";
export type Machine = ReturnType<typeof buildRecycler>;

const CARD_W = 0.4, CARD_H = 0.53, PORTRAIT_H = 0.42, PORTRAIT_W = PORTRAIT_H * SILHOUETTE.w / SILHOUETTE.h;
const BOARD_COLUMNS = 5, BOARD_ROWS = 5, BOARD_W = 2.4, BOARD_H = 3.05;
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

// A trading-card style backing: quality-coloured frame, the figure's name, and a spare count.
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

// The display: what the three would make, or what is missing. Scanlines for the gnomish screen.
function displayPanel(colors: { back: string; idle: string; ready: string }, scanlines: boolean) {
  const [element, context] = canvas(512, 150), map = srgb(element);
  let painted = "";
  const paint = (title: string, detail: string, ready: boolean, working = false) => {
    const key = `${title}|${detail}|${ready}|${working}`;
    if (key === painted) return;
    painted = key;
    context.fillStyle = colors.back; context.fillRect(0, 0, 512, 150);
    if (scanlines) for (let y = 0; y < 150; y += 4) { context.fillStyle = "rgba(0,0,0,.25)"; context.fillRect(0, y, 512, 2); }
    context.textAlign = "center"; context.textBaseline = "middle"; context.shadowBlur = 14;
    context.shadowColor = context.fillStyle = ready || working ? colors.ready : colors.idle;
    context.font = `700 40px ${scanlines ? "ui-monospace, monospace" : "Georgia, serif"}`; context.letterSpacing = "4px"; context.fillText(title.toUpperCase(), 256, 56, 480);
    context.font = `500 28px ${scanlines ? "ui-monospace, monospace" : "Georgia, serif"}`; context.letterSpacing = "2px"; context.fillText(detail.toUpperCase(), 256, 108, 480);
    context.shadowBlur = 0; map.needsUpdate = true;
  };
  return { map, paint };
}

type Card = { group: THREE.Group; back: ReturnType<typeof backing>; portrait: THREE.MeshBasicMaterial; pick: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; fly: { from: THREE.Vector3; t: number } | null };

// The pegboard, the cards and the three slots, shared by both machines. `slots` are the loaded
// cards' rest positions in the station's space.
function machineKit(parent: THREE.Group, { boardX, wood, dark, slots: slotSpots }: { boardX: number; wood: THREE.Material; dark: THREE.Material; slots: THREE.Vector3[] }) {
  const frame: THREE.Mesh[] = [];
  frame.push(add(parent, new THREE.BoxGeometry(BOARD_W, BOARD_H, 0.08), wood, boardX, 0.25 + BOARD_H / 2, -0.25));
  for (const side of [-1, 1]) frame.push(add(parent, new THREE.BoxGeometry(0.1, BOARD_H + 0.3, 0.1), wood, boardX + side * (BOARD_W / 2 + 0.03), (BOARD_H + 0.3) / 2, -0.25));
  const peg = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6).rotateX(Math.PI / 2);
  const cardGeometry = new THREE.PlaneGeometry(CARD_W, CARD_H), portraitGeometry = new THREE.PlaneGeometry(PORTRAIT_W, PORTRAIT_H);
  const boardSpot = (index: number) => new THREE.Vector3(boardX + (index % BOARD_COLUMNS - (BOARD_COLUMNS - 1) / 2) * 0.45, 0.25 + BOARD_H - 0.4 - Math.floor(index / BOARD_COLUMNS) * 0.6, -0.17);
  for (let index = 0; index < BOARD_COLUMNS * BOARD_ROWS; index++) { const spot = boardSpot(index); add(parent, peg, dark, spot.x, spot.y + CARD_H / 2 + 0.02, spot.z - 0.03, false); }

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
  const dress = (card: Card, entry: MachineCard, spare: number | null) => {
    card.back.paint(entry.name, entry.quality, spare);
    if (card.portrait.map !== entry.texture) { card.portrait.map = entry.texture; card.portrait.needsUpdate = true; }
    card.portrait.opacity = entry.texture ? (spare === 0 ? 0.35 : 1) : 0;
  };
  const tray = new Map<string, Card>();
  let loaded: (Card | null)[] = [null, null, null];
  const glow = cardGlow(CARD_W, CARD_H, 0xffd98a); parent.add(glow.mesh);
  const triggers: THREE.Mesh[] = [], picks: THREE.Mesh[] = [];
  const refreshPicks = () => {
    picks.length = 0; picks.push(...triggers);
    tray.forEach((card) => picks.push(card.pick));
    loaded.forEach((card) => { if (card) picks.push(card.pick); });
  };
  return {
    frame, picks, makeCard, dropCard, dress,
    trigger(mesh: THREE.Mesh) { mesh.userData.machine = { kind: "trigger" } satisfies MachinePick; triggers.push(mesh); refreshPicks(); },
    set(view: MachineView) {
      const seen = new Set<string>();
      view.tray.slice(0, BOARD_COLUMNS * BOARD_ROWS).forEach((entry, index) => {
        const id = `${entry.key}|${entry.quality}`;
        seen.add(id);
        let card = tray.get(id);
        if (!card) { card = makeCard(); tray.set(id, card); }
        card.pick.userData.machine = { kind: "tray", key: entry.key, quality: entry.quality } satisfies MachinePick;
        card.group.position.copy(boardSpot(index)); card.group.rotation.set(0, 0, 0);
        dress(card, entry, entry.spare);
      });
      tray.forEach((card, id) => { if (!seen.has(id)) { dropCard(card); tray.delete(id); } });
      // A newly loaded slot flies in from its card on the board.
      loaded = [0, 1, 2].map((index) => {
        const entry = view.slots[index], current = loaded[index];
        if (!entry) { if (current) dropCard(current); return null; }
        const card = current ?? makeCard();
        if (!current) card.fly = { from: (tray.get(`${entry.key}|${entry.quality}`)?.group.position ?? slotSpots[index]).clone(), t: 0 };
        card.pick.userData.machine = { kind: "slot", index } satisfies MachinePick;
        dress(card, entry, null);
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
      const hoveredCard = hovered?.kind === "tray" ? tray.get(`${hovered.key}|${hovered.quality}`) : hovered?.kind === "slot" ? loaded[hovered.index] : null;
      glow.update(hoveredCard?.pick ?? null, 1, delta);
      loaded.forEach((card, index) => {
        if (!card) return;
        const target = slotSpots[index];
        if (card.fly) {
          card.fly.t = Math.min(1, card.fly.t + delta / 0.35);
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

const RECYCLER_X = -1.3, RECYCLER_BOARD_X = 1.45, BODY_W = 1.9, BODY_H = 1.7, BODY_D = 1.2, LEGS = 0.3;
const SLOT_Y = LEGS + 1.2, SLOT_GAP = 0.58;
const RUN_SECONDS = 3.1, SWALLOW = 0.45, POP = 2.15;

export function buildRecycler(parent: THREE.Group, { envMap, placeProp }: { envMap: THREE.Texture; placeProp: PlaceProp }) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x34495a, metalness: 0.55, roughness: 0.5, envMap, envMapIntensity: 0.7 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc89a4a, metalness: 1, roughness: 0.3, envMap });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.4, roughness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(31, [84, 54, 32]), roughness: 0.7 });
  const slotSpots = [-1, 0, 1].map((step) => new THREE.Vector3(RECYCLER_X + step * SLOT_GAP, SLOT_Y, -0.35 + BODY_D / 2 + 0.035));
  const kit = machineKit(parent, { boardX: RECYCLER_BOARD_X, wood, dark, slots: slotSpots });
  // The machine shakes as a whole while it works; the base stays on the ground.
  const machine = new THREE.Group(); machine.position.set(RECYCLER_X, 0, -0.35); parent.add(machine);
  const body = new THREE.Group(); machine.add(body);
  for (const x of [-1, 1]) for (const z of [-1, 1]) add(machine, new THREE.CylinderGeometry(0.07, 0.09, LEGS, 10), dark, x * (BODY_W / 2 - 0.15), LEGS / 2, z * (BODY_D / 2 - 0.15));
  kit.frame.push(add(body, new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D), steel, 0, LEGS + BODY_H / 2, 0));
  for (const y of [LEGS + 0.06, LEGS + BODY_H - 0.06]) add(body, new THREE.BoxGeometry(BODY_W + 0.04, 0.07, BODY_D + 0.04), brass, 0, y, 0);
  // Rivets along the bands.
  const rivet = new THREE.SphereGeometry(0.022, 8, 6);
  for (const y of [LEGS + 0.06, LEGS + BODY_H - 0.06]) for (let i = 0; i < 9; i++) add(body, rivet, brass, -BODY_W / 2 + 0.12 + i * (BODY_W - 0.24) / 8, y, BODY_D / 2 + 0.03, false);
  // The hopper the cards drop into, with two toothed rollers turning in its throat.
  const hopperMaterial = brass.clone(); hopperMaterial.side = THREE.DoubleSide;
  add(body, new THREE.CylinderGeometry(0.62, 0.32, 0.6, 28, 1, true), hopperMaterial, 0, LEGS + BODY_H + 0.3, 0);
  add(body, new THREE.TorusGeometry(0.62, 0.04, 8, 32).rotateX(Math.PI / 2), brass, 0, LEGS + BODY_H + 0.6, 0);
  add(body, new THREE.CircleGeometry(0.6, 28).rotateX(-Math.PI / 2), dark, 0, LEGS + BODY_H + 0.03, 0, false);
  const tooth = new THREE.BoxGeometry(0.5, 0.05, 0.05);
  const rollers = [-1, 1].map((side) => {
    const roller = new THREE.Group(); roller.position.set(0, LEGS + BODY_H + 0.13, side * 0.12); body.add(roller);
    add(roller, new THREE.CylinderGeometry(0.085, 0.085, 0.52, 14).rotateZ(Math.PI / 2), steel, 0, 0, 0, false);
    for (let i = 0; i < 6; i++) { const mesh = add(roller, tooth, dark, 0, Math.sin(i / 6 * Math.PI * 2) * 0.1, Math.cos(i / 6 * Math.PI * 2) * 0.1, false); mesh.rotation.x = -i / 6 * Math.PI * 2; }
    return { roller, side };
  });
  // Three recessed slots on the front, each a brass frame round a dark well.
  for (const spot of slotSpots) {
    const x = spot.x - RECYCLER_X;
    add(body, new THREE.PlaneGeometry(CARD_W + 0.06, CARD_H + 0.06), dark, x, SLOT_Y, BODY_D / 2 + 0.002, false);
    for (const [w, h, ox, oy] of [[CARD_W + 0.1, 0.035, 0, (CARD_H + 0.06) / 2], [CARD_W + 0.1, 0.035, 0, -(CARD_H + 0.06) / 2], [0.035, CARD_H + 0.1, (CARD_W + 0.06) / 2, 0], [0.035, CARD_H + 0.1, -(CARD_W + 0.06) / 2, 0]])
      add(body, new THREE.BoxGeometry(w, h, 0.03), brass, x + ox, SLOT_Y + oy, BODY_D / 2 + 0.015, false);
  }
  const display = displayPanel({ back: "#0b1410", idle: "#ffcf7a", ready: "#9dffb0" }, true);
  // The display holds what a run is making until it is done, then shows the machine as it is now.
  let title = "", shown: MachineView | null = null;
  const screen = add(body, new THREE.PlaneGeometry(1.3, 0.38), new THREE.MeshBasicMaterial({ map: display.map, toneMapped: false }), 0, LEGS + 0.62, BODY_D / 2 + 0.012, false);
  screen.raycast = () => {};
  add(body, new THREE.BoxGeometry(1.4, 0.48, 0.03), brass, 0, LEGS + 0.62, BODY_D / 2 - 0.01, false);
  // The output chute: a mouth at the bottom left and a slide down to the ground.
  const chuteX = -BODY_W / 2 - 0.32;
  add(machine, new THREE.BoxGeometry(0.62, 0.05, 0.9).rotateX(0.32), brass, chuteX, 0.3, 0.25);
  for (const side of [-1, 1]) add(machine, new THREE.BoxGeometry(0.03, 0.14, 0.9).rotateX(0.32), brass, chuteX + side * 0.31, 0.36, 0.25);
  add(machine, new THREE.BoxGeometry(0.66, 0.5, 0.5), steel, chuteX, 0.6, -0.25);
  // The lever on the right side: tap or pull it once three are loaded.
  const lever = new THREE.Group(); lever.position.set(BODY_W / 2 + 0.1, LEGS + 1.0, 0.15); machine.add(lever);
  add(machine, new THREE.CylinderGeometry(0.09, 0.09, 0.08, 16).rotateZ(Math.PI / 2), brass, BODY_W / 2 + 0.06, LEGS + 1.0, 0.15);
  add(lever, new THREE.CylinderGeometry(0.025, 0.025, 0.62, 10), dark, 0.05, 0.31, 0);
  const knobMaterial = new THREE.MeshStandardMaterial({ color: 0xc43a2a, roughness: 0.35, emissive: 0xff5a3a, emissiveIntensity: 0 });
  add(lever, new THREE.SphereGeometry(0.075, 16, 12), knobMaterial, 0.05, 0.64, 0);
  kit.trigger(add(lever, new THREE.BoxGeometry(0.3, 0.85, 0.3), invisible(), 0.05, 0.4, 0, false));
  // Game props: the big gear turns behind the left flank, an exhaust pipe, a work lamp, pistons, a bucket.
  const gear = new THREE.Group(); gear.position.set(-BODY_W / 2 + 0.05, LEGS + 1.35, -BODY_D / 2 + 0.12); body.add(gear);
  void placeProp(gear, "gear", { height: 1.1 }).ready.then((group) => { group.position.y = -0.55; });
  placeProp(body, "pipe", { height: 0.75, x: 0.62, y: LEGS + BODY_H, z: -0.35, yaw: -Math.PI / 2 });
  placeProp(body, "lamp", { height: 0.32, x: -0.72, y: LEGS + BODY_H, z: 0.38, yaw: Math.PI / 2 });
  const pistons = new THREE.Group(); machine.add(pistons);
  placeProp(pistons, "pistons", { height: 1.5, x: 0.45, y: 0.2, z: -BODY_D / 2 - 0.12, yaw: Math.PI / 2 });
  placeProp(parent, "bucket", { height: 0.5, x: RECYCLER_X - 1.55, z: 0.75, yaw: 0.6 });
  placeProp(parent, "tool", { height: 0.62, x: RECYCLER_BOARD_X + 1.35, z: 0.55, yaw: -0.4 });
  // Steam from the pipe, and shreds of card spat from the hopper while it grinds.
  const [puffCanvas, puff] = canvas(64, 64);
  const cloud = puff.createRadialGradient(32, 32, 0, 32, 32, 32);
  cloud.addColorStop(0, "rgba(255,255,255,.85)"); cloud.addColorStop(1, "rgba(255,255,255,0)");
  puff.fillStyle = cloud; puff.fillRect(0, 0, 64, 64);
  const steam = particles(machine, srgb(puffCanvas), 8);
  const [shredCanvas, shred] = canvas(16, 16); shred.fillStyle = "#fff"; shred.fillRect(3, 6, 10, 4);
  const shreds = particles(machine, srgb(shredCanvas), 24);
  const shredColors = ["#efe2c4", "#a08a62", "#16121a", "#f2c75c"];

  let run: { t: number; swallowed: Card[]; output: MachineOutput; done: () => void; cue: (cue: MachineCue) => void; clanks: number; popped: boolean } | null = null;
  // What the run made, sliding down the chute; `rest` is its height above the ground at its centre.
  let output: THREE.Object3D | null = null, outputCard: Card | null = null, outputClock = 0, outputRest = 0;
  let ready = false, leverHover = 0, leverPull = 0, gearSpeed = 0.15, puffClock = 0, shredClock = 0;
  const clearOutput = () => {
    if (output) { parent.remove(output); output = null; }
    if (outputCard) { kit.dropCard(outputCard); outputCard = null; }
  };
  const into = new THREE.Vector3(RECYCLER_X, LEGS + BODY_H + 0.2, -0.35), mouth = new THREE.Vector3(0, LEGS + BODY_H + 0.35, 0);

  return {
    picks: kit.picks, frame: kit.frame,
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
      leverHover = THREE.MathUtils.damp(leverHover, hovered?.kind === "trigger" ? 1 : 0, 10, delta);
      knobMaterial.emissiveIntensity = (ready ? 0.35 + 0.35 * Math.sin(time * 4) : 0) + leverHover * 0.5;
      kit.update(hovered, delta);
      let shake = 0;
      if (run) {
        const previous = run.t;
        run.t += delta;
        const t = run.t;
        leverPull = t < 0.25 ? t / 0.25 : t < 1.1 ? 1 : Math.max(0, 1 - (t - 1.1) / 0.4);
        // The three fly up and into the hopper.
        run.swallowed.forEach((card, index) => {
          const k = THREE.MathUtils.clamp((t - index * 0.08) / SWALLOW, 0, 1), ease = k * k;
          card.group.position.lerpVectors(slotSpots[index], into, ease); card.group.position.y += Math.sin(Math.PI * k) * 0.9;
          card.group.scale.setScalar(1 - 0.75 * ease); card.group.rotation.set(-ease * 1.2, 0, ease * 0.6);
          card.group.visible = k < 1;
        });
        // It grinds: shakes, clanks, the gear and rollers spin up, steam puffs and shreds fly.
        const working = t > SWALLOW && t < POP;
        shake = working ? Math.min(1, (t - SWALLOW) / 0.3) * Math.min(1, (POP - t) / 0.2) : 0;
        if (working && Math.floor((t - SWALLOW) / 0.24) > run.clanks) { run.clanks++; run.cue("clank"); }
        if (previous < SWALLOW && t >= SWALLOW) display.paint(title, "· · ·", false, true);
        if (working) {
          puffClock -= delta;
          if (puffClock <= 0) { puffClock = 0.22; steam.emit(new THREE.Vector3(0.62, LEGS + BODY_H + 0.8, 0), new THREE.Vector3(0.2, 0.9, 0), { life: 1.2, size: 0.25, grow: 0.6 }); }
          shredClock -= delta;
          if (shredClock <= 0 && t < POP - 0.5) {
            shredClock = 0.05;
            shreds.emit(mouth, new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.4 + Math.random() * 1.2, (Math.random() - 0.2) * 1.2), { life: 0.9, size: 0.06, gravity: 5, color: shredColors[Math.floor(Math.random() * shredColors.length)] });
          }
        }
        // The output drops out of the chute and slides down to the ground.
        if (!run.popped && t >= POP) {
          run.popped = true; outputClock = 0;
          if (run.output.kind === "box" && run.output.box) {
            output = run.output.box; output.scale.setScalar(1.3); parent.add(output);
            run.output.box.geometry.computeBoundingBox(); outputRest = -run.output.box.geometry.boundingBox!.min.y * 1.3;
          } else if (run.output.kind === "figure") { outputCard = kit.makeCard(); kit.dress(outputCard, run.output.card, null); output = outputCard.group; outputRest = CARD_H / 2; }
          run.cue(run.output.kind === "figure" ? "sparkle" : "drop");
        }
        if (t >= RUN_SECONDS) { const done = run.done; run.swallowed.forEach(kit.dropCard); run = null; if (shown) display.paint(shown.title, shown.detail, shown.ready); done(); }
      }
      if (output) {
        outputClock += delta;
        const k = Math.min(1, outputClock / 0.55), bounce = Math.abs(Math.sin(Math.min(1, outputClock / 0.9) * Math.PI * 2.5)) * (1 - Math.min(1, outputClock / 0.9)) * 0.12;
        output.position.set(RECYCLER_X + chuteX, THREE.MathUtils.lerp(0.62, outputRest, k) + bounce, -0.35 + THREE.MathUtils.lerp(-0.05, 0.95, k));
        output.rotation.set(0, 0.3 + (outputCard ? Math.sin(time * 1.5) * 0.2 : 0), 0);
      }
      const grinding = !!run && run.t > SWALLOW && run.t < POP;
      gearSpeed = THREE.MathUtils.damp(gearSpeed, grinding ? 7 : 0.15, 3, delta);
      gear.rotation.z += gearSpeed * delta;
      rollers.forEach(({ roller, side }) => { roller.rotation.x += side * gearSpeed * 1.6 * delta; });
      lever.rotation.z = -leverPull * 1.5 - leverHover * 0.08;
      body.position.set(Math.sin(time * 53) * 0.012 * shake, Math.abs(Math.sin(time * 31)) * 0.02 * shake, Math.cos(time * 47) * 0.01 * shake);
      body.rotation.z = Math.sin(time * 37) * 0.01 * shake;
      pistons.position.y = Math.max(0, Math.sin(time * 18)) * 0.08 * shake;
      steam.update(delta, 0.55); shreds.update(delta);
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

const FORGE_X = 1.25, FORGE_BOARD_X = -1.5, PLINTH_H = 0.9, CAP = 0.1, ANVIL_H = 0.42, STELE_Z = -0.62;
const FACE_Y = PLINTH_H + CAP + ANVIL_H, ANVIL_X = FORGE_X - 0.1, ANVIL_Z = 0.12;
const RUNES_Y = 2.08, RUNE_RADIUS = 0.55;
// The trip hammer: an arm pivoting on a post right of the plinth, its head striking the anvil face.
// HIT is the arm angle at which the head's underside meets the face; the pivot sits high enough
// that the arm passes over the right-hand cradle.
const ARM = 1.15, HEAD_DROP = 0.36, PIVOT_Y = 2.3;
const HIT = Math.asin((PIVOT_Y - FACE_Y) / Math.hypot(ARM, HEAD_DROP)) - Math.atan2(HEAD_DROP, ARM), REST = HIT - 0.3, LIFT = HIT - 1;
const PIVOT_X = ANVIL_X + ARM * Math.cos(HIT);
const MERGE = 0.55, FIRST_STRIKE = 0.95, STRIKE_GAP = 0.5, STRIKES = 3, FUSE = 2.35, FORGE_SECONDS = 3.5;

export function buildForge(parent: THREE.Group, { envMap, placeProp }: { envMap: THREE.Texture; placeProp: PlaceProp }) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x4a4553, roughness: 0.92 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x302c37, roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a63c, metalness: 1, roughness: 0.28, envMap });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2d33, metalness: 0.85, roughness: 0.38, envMap, envMapIntensity: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.4, roughness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(37, [66, 44, 30]), roughness: 0.75 });
  // The three cradles sit round the rune circle, at its top and lower corners.
  const corner = RUNE_RADIUS * Math.cos(Math.PI / 6);
  const slotSpots = [[0, RUNE_RADIUS], [-corner, -RUNE_RADIUS / 2], [corner, -RUNE_RADIUS / 2]].map(([x, y]) => new THREE.Vector3(FORGE_X + x, RUNES_Y + y, STELE_Z + 0.19));
  const kit = machineKit(parent, { boardX: FORGE_BOARD_X, wood, dark, slots: slotSpots });

  // A stone plinth with a gold-edged cap, the display set in its front.
  kit.frame.push(add(parent, new THREE.BoxGeometry(1.6, PLINTH_H, 1.1), stone, FORGE_X, PLINTH_H / 2, 0));
  add(parent, new THREE.BoxGeometry(1.75, CAP, 1.22), darkStone, FORGE_X, PLINTH_H + CAP / 2, 0);
  for (const z of [-1, 1]) add(parent, new THREE.BoxGeometry(1.78, 0.03, 0.03), gold, FORGE_X, PLINTH_H + CAP, z * 0.61, false);
  add(parent, new THREE.BoxGeometry(1.66, 0.08, 1.16), darkStone, FORGE_X, 0.04, 0);
  const display = displayPanel({ back: "#160f24", idle: "#f2c75c", ready: "#d9c8ff" }, false);
  // The display holds what a run is making until it is done, then shows the machine as it is now.
  let title = "", shown: MachineView | null = null;
  const screen = add(parent, new THREE.PlaneGeometry(1.3, 0.38), new THREE.MeshBasicMaterial({ map: display.map, toneMapped: false }), FORGE_X, 0.5, 0.562, false);
  screen.raycast = () => {};
  add(parent, new THREE.BoxGeometry(1.4, 0.48, 0.03), gold, FORGE_X, 0.5, 0.545, false);
  // The anvil, hand-built: foot, waist, face and horn (pointing left, toward the board).
  const anvil = new THREE.Group(); anvil.position.set(ANVIL_X, PLINTH_H + CAP, ANVIL_Z); parent.add(anvil);
  add(anvil, new THREE.BoxGeometry(0.42, 0.12, 0.3), iron, 0, 0.06, 0);
  add(anvil, new THREE.BoxGeometry(0.24, 0.16, 0.18), iron, 0, 0.2, 0);
  add(anvil, new THREE.BoxGeometry(0.6, 0.14, 0.26), iron, 0.04, ANVIL_H - 0.07, 0);
  add(anvil, new THREE.ConeGeometry(0.1, 0.3, 14).rotateZ(Math.PI / 2), iron, -0.4, ANVIL_H - 0.09, 0);
  // The rune stele behind: an arched slab, the circle glowing on its face.
  kit.frame.push(add(parent, new THREE.BoxGeometry(1.7, 2.55, 0.3), stone, FORGE_X, 2.55 / 2, STELE_Z));
  add(parent, new THREE.CylinderGeometry(0.85, 0.85, 0.3, 32, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), stone, FORGE_X, 2.55, STELE_Z);
  add(parent, new THREE.TorusGeometry(0.85, 0.035, 8, 32, Math.PI), gold, FORGE_X, 2.55, STELE_Z + 0.15, false);
  const runeMaterial = new THREE.MeshBasicMaterial({ map: runeCircle(), color: QUALITY_COLORS.golden, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const runes = add(parent, new THREE.PlaneGeometry(1.5, 1.5), runeMaterial, FORGE_X, RUNES_Y, STELE_Z + 0.152, false);
  runes.raycast = () => {};
  // Gold ledges for the cradles.
  for (const spot of slotSpots) add(parent, new THREE.BoxGeometry(CARD_W + 0.08, 0.035, 0.1), gold, spot.x, spot.y - CARD_H / 2 - 0.02, STELE_Z + 0.2, false);
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
  // Crystals flanking the stele, glowing with the runes.
  const crystalMaterial = new THREE.MeshStandardMaterial({ color: 0x7c62e0, roughness: 0.15, metalness: 0.1, emissive: 0x6b4cff, emissiveIntensity: 0.4, transparent: true, opacity: 0.92 });
  for (const [x, scale, tilt] of [[-0.98, 1, 0.15], [0.98, 0.8, -0.2], [-0.82, 0.55, -0.3]] as const) {
    const crystal = add(parent, new THREE.OctahedronGeometry(0.16).scale(0.8, 2.2, 0.8), crystalMaterial, FORGE_X + x, 0.34 * scale, STELE_Z + 0.25);
    crystal.scale.setScalar(scale); crystal.rotation.z = tilt;
  }
  placeProp(parent, "bucket", { height: 0.42, x: FORGE_X + 0.55, z: 0.95, yaw: 1.2 });
  placeProp(parent, "tool", { height: 0.55, x: FORGE_BOARD_X - 1.35, z: 0.6, yaw: 0.5 });
  // The glow where the three fuse, the light pillar the result rises in, and sparks from each blow.
  const glows = glowMap();
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
          if (run.output.kind === "figure") { outputCard = kit.makeCard(); kit.dress(outputCard, run.output.card, null); }
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
      crystalMaterial.emissiveIntensity = 0.35 + (run ? glow * 1.2 : ready ? 0.25 : 0);
      sparks.update(delta);
    },
  };
}
