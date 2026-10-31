import * as THREE from "three";
import { cardGlow } from "@/lib/figurine-glow";
import { woodTexture } from "@/lib/figurine-shop";
import { SILHOUETTE } from "@/lib/figurine-packaging";
import type { PlaceProp } from "@/lib/figurine-props";
import type { FigurineQuality } from "@/lib/figurine-collection";

// The recycler station: a gnomish machine with three card slots, a display, a lever and an output
// chute, beside a pegboard of the figures owned more than once. Tap a card on the board to load a
// copy, tap a loaded card to take it back, pull the lever to run. The machine swallows the three,
// shakes and clanks, and drops what it made out of the chute: a blind box, or the traded-up figure.
export type MachineCard = { key: string; quality: FigurineQuality; name: string; texture: THREE.Texture | null };
export type MachineView = { tray: (MachineCard & { spare: number })[]; slots: MachineCard[]; title: string; detail: string; ready: boolean };
export type MachinePick = { kind: "tray"; key: string; quality: FigurineQuality } | { kind: "slot"; index: number } | { kind: "lever" };
export type MachineOutput = { kind: "box"; box: THREE.Mesh | null } | { kind: "figure"; card: MachineCard };
export type MachineCue = "load" | "pull" | "clank" | "drop" | "sparkle";

const MACHINE_X = -1.3, BOARD_X = 1.45, BODY_W = 1.9, BODY_H = 1.7, BODY_D = 1.2, LEGS = 0.3;
const SLOT_Y = LEGS + 1.2, SLOT_GAP = 0.58;
const CARD_W = 0.4, CARD_H = 0.53, PORTRAIT_H = 0.42, PORTRAIT_W = PORTRAIT_H * SILHOUETTE.w / SILHOUETTE.h;
const BOARD_COLUMNS = 5, BOARD_ROWS = 5, BOARD_W = 2.4, BOARD_H = 3.05;
export const MACHINE_WIDTH = 5.2;
const QUALITY_COLORS: Record<FigurineQuality, string> = { standard: "#a08a62", golden: "#f2c75c", galaxy: "#9a7bff" };
const RUN_SECONDS = 3.1, SWALLOW = 0.45, POP = 2.15;

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  return [element, element.getContext("2d")!] as const;
}
const srgb = (element: HTMLCanvasElement) => { const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map; };

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

export function buildMachine(parent: THREE.Group, { envMap, placeProp }: { envMap: THREE.Texture; placeProp: PlaceProp }) {
  const add = (target: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = shadow; target.add(mesh); return mesh;
  };
  const steel = new THREE.MeshStandardMaterial({ color: 0x34495a, metalness: 0.55, roughness: 0.5, envMap, envMapIntensity: 0.7 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc89a4a, metalness: 1, roughness: 0.3, envMap });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.4, roughness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(31, [84, 54, 32]), roughness: 0.7 });
  const frame: THREE.Mesh[] = [];
  // The machine shakes as a whole while it works; the base stays on the ground.
  const machine = new THREE.Group(); machine.position.set(MACHINE_X, 0, -0.35); parent.add(machine);
  const body = new THREE.Group(); machine.add(body);
  for (const x of [-1, 1]) for (const z of [-1, 1]) add(machine, new THREE.CylinderGeometry(0.07, 0.09, LEGS, 10), dark, x * (BODY_W / 2 - 0.15), LEGS / 2, z * (BODY_D / 2 - 0.15));
  frame.push(add(body, new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D), steel, 0, LEGS + BODY_H / 2, 0));
  for (const y of [LEGS + 0.06, LEGS + BODY_H - 0.06]) add(body, new THREE.BoxGeometry(BODY_W + 0.04, 0.07, BODY_D + 0.04), brass, 0, y, 0);
  // Rivets along the bands.
  const rivet = new THREE.SphereGeometry(0.022, 8, 6);
  for (const y of [LEGS + 0.06, LEGS + BODY_H - 0.06]) for (let i = 0; i < 9; i++) add(body, rivet, brass, -BODY_W / 2 + 0.12 + i * (BODY_W - 0.24) / 8, y, BODY_D / 2 + 0.03, false);
  // The hopper the cards drop into.
  const hopper = add(body, new THREE.CylinderGeometry(0.62, 0.32, 0.6, 28, 1, true), brass, 0, LEGS + BODY_H + 0.3, 0);
  (hopper.material as THREE.Material).side = THREE.DoubleSide;
  add(body, new THREE.TorusGeometry(0.62, 0.04, 8, 32).rotateX(Math.PI / 2), brass, 0, LEGS + BODY_H + 0.6, 0);
  add(body, new THREE.CircleGeometry(0.6, 28).rotateX(-Math.PI / 2), dark, 0, LEGS + BODY_H + 0.08, 0, false);
  // Three recessed slots on the front, each a brass frame round a dark well.
  const slotFrames = [-1, 0, 1].map((step) => {
    const x = step * SLOT_GAP;
    add(body, new THREE.PlaneGeometry(CARD_W + 0.06, CARD_H + 0.06), dark, x, SLOT_Y, BODY_D / 2 + 0.002, false);
    for (const [w, h, ox, oy] of [[CARD_W + 0.1, 0.035, 0, (CARD_H + 0.06) / 2], [CARD_W + 0.1, 0.035, 0, -(CARD_H + 0.06) / 2], [0.035, CARD_H + 0.1, (CARD_W + 0.06) / 2, 0], [0.035, CARD_H + 0.1, -(CARD_W + 0.06) / 2, 0]])
      add(body, new THREE.BoxGeometry(w, h, 0.03), brass, x + ox, SLOT_Y + oy, BODY_D / 2 + 0.015, false);
    return new THREE.Vector3(MACHINE_X + x, SLOT_Y, -0.35 + BODY_D / 2 + 0.035);
  });
  // The display: what the three would make, or what is missing.
  const [displayCanvas, display] = canvas(512, 150);
  const displayMap = srgb(displayCanvas);
  let displayed = "", title = "";
  const paintDisplay = (title: string, detail: string, ready: boolean, working = false) => {
    const key = `${title}|${detail}|${ready}|${working}`;
    if (key === displayed) return;
    displayed = key;
    display.fillStyle = "#0b1410"; display.fillRect(0, 0, 512, 150);
    for (let y = 0; y < 150; y += 4) { display.fillStyle = "rgba(0,0,0,.25)"; display.fillRect(0, y, 512, 2); }
    display.textAlign = "center"; display.textBaseline = "middle"; display.shadowBlur = 14;
    display.shadowColor = display.fillStyle = ready || working ? "#9dffb0" : "#ffcf7a";
    display.font = "700 40px ui-monospace, monospace"; display.letterSpacing = "4px"; display.fillText(title.toUpperCase(), 256, 56, 480);
    display.font = "500 28px ui-monospace, monospace"; display.letterSpacing = "2px"; display.fillText(detail.toUpperCase(), 256, 108, 480);
    display.shadowBlur = 0; displayMap.needsUpdate = true;
  };
  const screen = add(body, new THREE.PlaneGeometry(1.3, 0.38), new THREE.MeshBasicMaterial({ map: displayMap, toneMapped: false }), 0, LEGS + 0.62, BODY_D / 2 + 0.012, false);
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
  const leverPick = add(lever, new THREE.BoxGeometry(0.3, 0.85, 0.3), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), 0.05, 0.4, 0, false);
  leverPick.userData.machine = { kind: "lever" } satisfies MachinePick;
  // Game props: the big gear turns behind the left flank, an exhaust pipe, a work lamp, pistons, a bucket.
  const gear = new THREE.Group(); gear.position.set(-BODY_W / 2 + 0.05, LEGS + 1.35, -BODY_D / 2 + 0.12); body.add(gear);
  const gearProp = placeProp(gear, "gear", { height: 1.1 });
  void gearProp.ready.then((group) => { group.position.y = -0.55; });
  placeProp(body, "pipe", { height: 0.75, x: 0.62, y: LEGS + BODY_H, z: -0.35, yaw: -Math.PI / 2 });
  placeProp(body, "lamp", { height: 0.32, x: -0.72, y: LEGS + BODY_H, z: 0.38, yaw: Math.PI / 2 });
  const pistons = new THREE.Group(); machine.add(pistons);
  placeProp(pistons, "pistons", { height: 1.5, x: 0.45, y: 0.2, z: -BODY_D / 2 - 0.12, yaw: Math.PI / 2 });
  placeProp(parent, "bucket", { height: 0.5, x: MACHINE_X - 1.55, z: 0.75, yaw: 0.6 });
  placeProp(parent, "tool", { height: 0.62, x: BOARD_X + 1.35, z: 0.55, yaw: -0.4 });
  // Steam puffs from the pipe while it works.
  const [puffCanvas, puff] = canvas(64, 64);
  const cloud = puff.createRadialGradient(32, 32, 0, 32, 32, 32);
  cloud.addColorStop(0, "rgba(255,255,255,.85)"); cloud.addColorStop(1, "rgba(255,255,255,0)");
  puff.fillStyle = cloud; puff.fillRect(0, 0, 64, 64);
  const puffMap = srgb(puffCanvas);
  const puffs = Array.from({ length: 8 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffMap, color: 0xe8e4dc, transparent: true, opacity: 0, depthWrite: false }));
    sprite.visible = false; machine.add(sprite);
    return { sprite, age: Infinity };
  });

  // The pegboard of spare copies.
  const board = add(parent, new THREE.BoxGeometry(BOARD_W, BOARD_H, 0.08), wood, BOARD_X, 0.25 + BOARD_H / 2, -0.25);
  frame.push(board);
  for (const side of [-1, 1]) frame.push(add(parent, new THREE.BoxGeometry(0.1, BOARD_H + 0.3, 0.1), wood, BOARD_X + side * (BOARD_W / 2 + 0.03), (BOARD_H + 0.3) / 2, -0.25));
  const peg = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6).rotateX(Math.PI / 2);
  const cardGeometry = new THREE.PlaneGeometry(CARD_W, CARD_H), portraitGeometry = new THREE.PlaneGeometry(PORTRAIT_W, PORTRAIT_H);
  const boardSpot = (index: number) => new THREE.Vector3(BOARD_X + (index % BOARD_COLUMNS - (BOARD_COLUMNS - 1) / 2) * 0.45, 0.25 + BOARD_H - 0.4 - Math.floor(index / BOARD_COLUMNS) * 0.6, -0.17);
  for (let index = 0; index < BOARD_COLUMNS * BOARD_ROWS; index++) { const spot = boardSpot(index); add(parent, peg, dark, spot.x, spot.y + CARD_H / 2 + 0.02, spot.z - 0.03, false); }

  type Card = { group: THREE.Group; back: ReturnType<typeof backing>; portrait: THREE.MeshBasicMaterial; pick: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; fly: { from: THREE.Vector3; t: number } | null };
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
    (card.pick.material as THREE.Material).dispose(); card.portrait.dispose();
  };
  const dress = (card: Card, entry: MachineCard, spare: number | null) => {
    card.back.paint(entry.name, entry.quality, spare);
    if (card.portrait.map !== entry.texture) { card.portrait.map = entry.texture; card.portrait.needsUpdate = true; }
    card.portrait.opacity = entry.texture ? (spare === 0 ? 0.35 : 1) : 0;
  };
  const tray = new Map<string, Card>();
  let slots: (Card | null)[] = [null, null, null];
  const glow = cardGlow(CARD_W, CARD_H, 0xffd98a); parent.add(glow.mesh);
  const picks = [leverPick];
  const refreshPicks = () => {
    picks.length = 1;
    tray.forEach((card) => picks.push(card.pick));
    slots.forEach((card) => { if (card) picks.push(card.pick); });
  };

  let run: { t: number; swallowed: Card[]; output: MachineOutput; done: () => void; cue: (cue: MachineCue) => void; clanks: number; popped: boolean } | null = null;
  // What the run made, sliding down the chute; `rest` is its height above the ground at its centre.
  let output: THREE.Object3D | null = null, outputCard: Card | null = null, outputClock = 0, outputRest = 0;
  let ready = false, leverHover = 0, leverPull = 0, gearSpeed = 0.15, puffClock = 0;
  const clearOutput = () => {
    if (output) { parent.remove(output); output = null; }
    if (outputCard) { dropCard(outputCard); outputCard = null; }
  };

  return {
    picks, frame,
    set(view: MachineView) {
      title = view.title;
      paintDisplay(view.title, view.detail, view.ready, !!run);
      ready = view.ready;
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
      slots = [0, 1, 2].map((index) => {
        const entry = view.slots[index], current = slots[index];
        if (!entry) { if (current) dropCard(current); return null; }
        const card = current ?? makeCard();
        if (!current) {
          const from = tray.get(`${entry.key}|${entry.quality}`)?.group.position ?? slotFrames[index];
          card.fly = { from: from.clone(), t: 0 };
        }
        card.pick.userData.machine = { kind: "slot", index } satisfies MachinePick;
        dress(card, entry, null);
        return card;
      });
      refreshPicks();
    },
    // Runs the machine on what is loaded now; `done` fires once the output has landed.
    run(made: MachineOutput, cue: (cue: MachineCue) => void, done: () => void) {
      clearOutput();
      const swallowed = slots.filter((card): card is Card => !!card);
      slots = [null, null, null];
      swallowed.forEach((card) => { card.fly = null; card.pick.userData.machine = undefined; });
      run = { t: 0, swallowed, output: made, done, cue, clanks: 0, popped: false };
      cue("pull");
      refreshPicks();
    },
    get running() { return !!run; },
    clear() { if (!run) clearOutput(); },
    update(hovered: MachinePick | null, delta: number, time: number) {
      leverHover = THREE.MathUtils.damp(leverHover, hovered?.kind === "lever" ? 1 : 0, 10, delta);
      knobMaterial.emissiveIntensity = (ready ? 0.35 + 0.35 * Math.sin(time * 4) : 0) + leverHover * 0.5;
      const hoveredCard = hovered?.kind === "tray" ? tray.get(`${hovered.key}|${hovered.quality}`) : hovered?.kind === "slot" ? slots[hovered.index] : null;
      glow.update(hoveredCard?.pick ?? null, 1, delta);
      slots.forEach((card, index) => {
        if (!card) return;
        const target = slotFrames[index];
        if (card.fly) {
          card.fly.t = Math.min(1, card.fly.t + delta / 0.35);
          const t = 1 - (1 - card.fly.t) ** 3;
          card.group.position.lerpVectors(card.fly.from, target, t); card.group.position.y += Math.sin(Math.PI * t) * 0.35;
          card.group.rotation.z = (1 - t) * 0.4;
          if (card.fly.t >= 1) card.fly = null;
        } else { card.group.position.copy(target); card.group.rotation.z = 0; }
      });
      let shake = 0;
      if (run) {
        const previous = run.t;
        run.t += delta;
        const t = run.t;
        leverPull = t < 0.25 ? t / 0.25 : t < 1.1 ? 1 : Math.max(0, 1 - (t - 1.1) / 0.4);
        // The three fly up and into the hopper.
        run.swallowed.forEach((card, index) => {
          const k = THREE.MathUtils.clamp((t - index * 0.08) / SWALLOW, 0, 1), ease = k * k;
          const from = slotFrames[index], into = new THREE.Vector3(MACHINE_X, LEGS + BODY_H + 0.2, -0.35);
          card.group.position.lerpVectors(from, into, ease); card.group.position.y += Math.sin(Math.PI * k) * 0.9;
          card.group.scale.setScalar(1 - 0.75 * ease); card.group.rotation.set(-ease * 1.2, 0, ease * 0.6);
          card.group.visible = k < 1;
        });
        // It works: shakes, clanks, the gear spins up and steam puffs from the pipe.
        const working = t > SWALLOW && t < POP;
        shake = working ? Math.min(1, (t - SWALLOW) / 0.3) * Math.min(1, (POP - t) / 0.2) : 0;
        if (working && Math.floor((t - SWALLOW) / 0.24) > run.clanks) { run.clanks++; run.cue("clank"); }
        if (previous < SWALLOW && t >= SWALLOW) paintDisplay(title, "· · ·", false, true);
        if (working) { puffClock -= delta; if (puffClock <= 0) { puffClock = 0.22; const free = puffs.find((entry) => entry.age > 1.2); if (free) free.age = 0; } }
        // The output drops out of the chute and slides down to the ground.
        if (!run.popped && t >= POP) {
          run.popped = true; outputClock = 0;
          if (run.output.kind === "box" && run.output.box) {
            output = run.output.box; output.scale.setScalar(1.3); parent.add(output);
            run.output.box.geometry.computeBoundingBox(); outputRest = -run.output.box.geometry.boundingBox!.min.y * 1.3;
          } else if (run.output.kind === "figure") { outputCard = makeCard(); dress(outputCard, run.output.card, null); output = outputCard.group; outputRest = CARD_H / 2; }
          run.cue(run.output.kind === "figure" ? "sparkle" : "drop");
        }
        if (t >= RUN_SECONDS) { const done = run.done; run.swallowed.forEach(dropCard); run = null; refreshPicks(); done(); }
      }
      if (output) {
        outputClock += delta;
        const k = Math.min(1, outputClock / 0.55), bounce = Math.abs(Math.sin(Math.min(1, outputClock / 0.9) * Math.PI * 2.5)) * (1 - Math.min(1, outputClock / 0.9)) * 0.12;
        output.position.set(MACHINE_X + chuteX, THREE.MathUtils.lerp(0.62, outputRest, k) + bounce, -0.35 + THREE.MathUtils.lerp(-0.05, 0.95, k));
        output.rotation.set(0, 0.3 + (outputCard ? Math.sin(time * 1.5) * 0.2 : 0), 0);
      }
      gearSpeed = THREE.MathUtils.damp(gearSpeed, run && run.t > SWALLOW && run.t < POP ? 7 : 0.15, 3, delta);
      gear.rotation.z += gearSpeed * delta;
      lever.rotation.z = -leverPull * 1.5 - leverHover * 0.08;
      body.position.set(Math.sin(time * 53) * 0.012 * shake, Math.abs(Math.sin(time * 31)) * 0.02 * shake, Math.cos(time * 47) * 0.01 * shake);
      body.rotation.z = Math.sin(time * 37) * 0.01 * shake;
      pistons.position.y = Math.max(0, Math.sin(time * 18)) * 0.08 * shake;
      puffs.forEach((entry) => {
        entry.age += delta;
        entry.sprite.visible = entry.age < 1.2;
        if (!entry.sprite.visible) return;
        entry.sprite.position.set(0.62 + entry.age * 0.2, LEGS + BODY_H + 0.8 + entry.age * 0.9, -0.35);
        entry.sprite.scale.setScalar(0.25 + entry.age * 0.6);
        entry.sprite.material.opacity = 0.55 * (1 - entry.age / 1.2);
      });
    },
  };
}
