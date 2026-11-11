import * as THREE from "three";
import { chestRewardPresentation, placeRewardCoin } from "@/lib/figurine-chest";
import { applyFinish, releaseFinishes } from "@/lib/figurine-finish";
import { disposeFigurineObject } from "@/lib/figurine-cache";
import { figurineBodyBounds, figurineScale, restoreFigurineMaterials } from "@/lib/figurine-materials";
import { SILHOUETTE } from "@/lib/figurine-packaging";
import type { PlaceProp } from "@/lib/figurine-props";
import type { FigurineQuality } from "@/lib/figurine-collection";

// The two workshop stations, worked entirely from their panels: in the world they are just game
// props. A run starts from the panel's slots: the three figures fly out of the interface, as cards,
// into the machine.
// - The recycler is a furnace: the cards go in at its door, the bellows fire it, and a single coin
//   leaps out to hang before the camera until it is tapped into the wallet.
// - The trade-up forge is an anvil: the cards land on it, the smith's hammer comes down three times,
//   and the figure forms on the anvil one quality up.
export type MachineCard = { key: string; quality: FigurineQuality; texture: THREE.Texture | null };
// Where a card starts: its panel slot, in normalised device coordinates.
export type MachineSource = { x: number; y: number; width: number };
export type MachineOutput = { kind: "coin" } | { kind: "figure"; model: string; quality: FigurineQuality };
// What the panel asks of a machine: take a card back out, or run.
export type MachinePick = { kind: "slot"; index: number } | { kind: "trigger" };
export type MachineCue = "feed" | "burn" | "clank" | "charge" | "strike" | "coin" | "sparkle" | "collected";
export type MachineRun = { cards: MachineCard[]; sources: MachineSource[]; output: MachineOutput; cue: (cue: MachineCue) => void; done: () => void };
export type Machine = { ready: Promise<THREE.Mesh[]>; running: boolean; run: (run: MachineRun) => void; present: (camera: THREE.PerspectiveCamera | null, reducedMotion: boolean, coinTarget: { x: number; y: number; width?: number } | null) => void; dismiss: () => void; update: (delta: number, time: number) => void; dispose: () => void };
type Options = { envMap: THREE.Texture; placeProp: PlaceProp; loadFigure?: (url: string) => Promise<THREE.Group> };

const CARD_W = 0.4, CARD_H = 0.53, PORTRAIT_H = 0.42, PORTRAIT_W = PORTRAIT_H * SILHOUETTE.w / SILHOUETTE.h, CARD_DEPTH = 3;
export const QUALITY_COLORS: Record<FigurineQuality, string> = { standard: "#a08a62", golden: "#f2c75c", galaxy: "#9a7bff" };

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  return [element, element.getContext("2d")!] as const;
}
const srgb = (element: HTMLCanvasElement) => { const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map; };
function glowMap() {
  const [element, context] = canvas(64, 64);
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(0.35, "rgba(255,255,255,.45)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
  return srgb(element);
}
const glowSprite = (map: THREE.Texture, color: THREE.ColorRepresentation, size: number) => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  sprite.scale.setScalar(size);
  return sprite;
};

// A figure as it leaves the panel: a dark card framed in its quality, with its portrait.
function flyingCard(parent: THREE.Object3D, entry: MachineCard) {
  const [element, context] = canvas(160, 212), color = QUALITY_COLORS[entry.quality];
  context.fillStyle = "#16121a"; context.beginPath(); context.roundRect(2, 2, 156, 208, 12); context.fill();
  context.strokeStyle = color; context.lineWidth = entry.quality === "standard" ? 4 : 7; context.stroke();
  const shine = context.createLinearGradient(0, 0, 0, 200);
  shine.addColorStop(0, `${color}55`); shine.addColorStop(1, "#16121a00");
  context.fillStyle = shine; context.fillRect(8, 8, 144, 196);
  const group = new THREE.Group(), map = srgb(element);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }));
  const portrait = new THREE.Mesh(new THREE.PlaneGeometry(PORTRAIT_W, PORTRAIT_H), new THREE.MeshBasicMaterial({ map: entry.texture, transparent: true, alphaTest: 0.02, opacity: entry.texture ? 1 : 0 }));
  portrait.position.z = 0.003; group.add(back, portrait); parent.add(group);
  return { group, dispose() { parent.remove(group); back.geometry.dispose(); portrait.geometry.dispose(); back.material.dispose(); portrait.material.dispose(); map.dispose(); } };
}

// The three cards' flight from the panel to `target` (in the station's space). Each starts exactly
// over its slot, a little in front of the camera, and stays pinned to that spot on the screen as it
// sets off, however the shot moves meanwhile; it arrives small and turned, and is gone.
const FLY_SECONDS = 0.7, FLY_STAGGER = 0.1;
export const cardFlightSeconds = (cards: number) => FLY_SECONDS + Math.max(0, cards - 1) * FLY_STAGGER;
function cardFlight(parent: THREE.Object3D, camera: THREE.PerspectiveCamera | null, run: MachineRun, target: THREE.Vector3, endScale: number) {
  const facing = new THREE.Quaternion(), from = new THREE.Vector3(), turned = new THREE.Quaternion();
  const cards = run.cards.map((entry, index) => ({
    card: flyingCard(parent, entry), source: run.sources[index] ?? { x: (index - 1) * 0.22, y: -0.7, width: 0.12 }, delay: index * FLY_STAGGER,
    turn: new THREE.Quaternion().setFromEuler(new THREE.Euler((index - 1) * 0.5, (index - 1) * 0.9, (index - 1) * 1.2)),
  }));
  const update = (t: number) => {
    const halfHeight = CARD_DEPTH * Math.tan(THREE.MathUtils.degToRad((camera?.fov ?? 36) / 2)), aspect = camera?.aspect ?? 16 / 9;
    if (camera) { camera.updateWorldMatrix(true, false); parent.updateWorldMatrix(true, false); parent.getWorldQuaternion(facing).invert().multiply(camera.quaternion); }
    for (const { card, source, delay, turn } of cards) {
      const k = THREE.MathUtils.clamp((t - delay) / FLY_SECONDS, 0, 1), ease = k * k * (3 - 2 * k);
      if (camera) parent.worldToLocal(from.set(source.x * halfHeight * aspect, source.y * halfHeight, -CARD_DEPTH).applyMatrix4(camera.matrixWorld));
      else from.copy(target).add(new THREE.Vector3(0, 1, 2));
      card.group.visible = k < 1;
      card.group.position.lerpVectors(from, target, ease); card.group.position.y += Math.sin(Math.PI * k) * 0.5;
      card.group.scale.setScalar(THREE.MathUtils.lerp(source.width * halfHeight * aspect / CARD_W, endScale, ease));
      card.group.quaternion.slerpQuaternions(facing, turned.copy(facing).multiply(turn), ease);
    }
  };
  update(0);
  return { update, dispose() { cards.forEach(({ card }) => card.dispose()); } };
}

// Small sprites with a lifetime: smoke, embers, sparks.
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
const outlineMeshes = (loads: Promise<THREE.Group>[]) => Promise.all(loads).then((groups) => {
  const meshes: THREE.Mesh[] = [];
  groups.forEach((group) => group.traverse((object) => { if (object instanceof THREE.Mesh && !object.userData.outline) meshes.push(object); }));
  return meshes;
});

const FURNACE_H = 2.75, FURNACE_Z = -0.45, DOOR_Y = 0.82, DOOR_Z = 1.1;
const BURN_SECONDS = 1.7;
// The bellows at its right hand, and the crucible at its left, full of what the fire leaves.
const CRUCIBLE = { x: -1.72, z: 0.45 }, BELLOWS = { x: 1.85, z: -0.25 };

export function buildRecycler(parent: THREE.Group, { placeProp }: Options): Machine {
  const loads: Promise<THREE.Group>[] = [];
  const prop = (target: THREE.Object3D, ...[name, placement]: [Parameters<PlaceProp>[1], Parameters<PlaceProp>[2]]) => { const placed = placeProp(target, name, placement); loads.push(placed.ready); return placed; };
  // The furnace shakes as a whole while it works; the crucible and bellows stay put.
  const furnace = new THREE.Group(); furnace.position.set(0, 0, FURNACE_Z); parent.add(furnace);
  prop(furnace, "forgeFurnace", { height: FURNACE_H, yaw: -Math.PI / 2 });
  prop(parent, "forgeCrucible", { height: 0.72, x: CRUCIBLE.x, z: CRUCIBLE.z, yaw: 0.6 });
  const bellows = new THREE.Group(); bellows.position.set(BELLOWS.x, 0, BELLOWS.z); parent.add(bellows);
  prop(bellows, "forgeBellows", { height: 1.1, yaw: 0 });
  // Firelight at the furnace's door and throat, heat from its chimney, embers while it burns.
  const glows = glowMap();
  const fire = (x: number, y: number, z: number, size: number) => { const sprite = glowSprite(glows, 0xff8a3a, size); sprite.position.set(x, y, z); furnace.add(sprite); return sprite; };
  const door = fire(0, DOOR_Y, DOOR_Z + 0.5, 1.7), throat = fire(0, FURNACE_H + 0.05, 0, 1.15);
  const [puffCanvas, puff] = canvas(64, 64);
  const cloud = puff.createRadialGradient(32, 32, 0, 32, 32, 32);
  cloud.addColorStop(0, "rgba(255,255,255,.85)"); cloud.addColorStop(1, "rgba(255,255,255,0)");
  puff.fillStyle = cloud; puff.fillRect(0, 0, 64, 64);
  const puffMap = srgb(puffCanvas), smoke = particles(furnace, puffMap, 10);
  const embers = particles(furnace, glows, 36, THREE.AdditiveBlending);
  const emberColors = [0xffb24a, 0xff7a2a, 0xffe08a, 0xf2c75c];
  const mouth = new THREE.Vector3(0, FURNACE_H + 0.05, 0), doorway = new THREE.Vector3(0, DOOR_Y, DOOR_Z), into = new THREE.Vector3(0, DOOR_Y, FURNACE_Z + DOOR_Z - 0.2);
  // The coin that comes out: the same one, and the same show, as the chest's and the pond's.
  const coin = placeRewardCoin(parent, placeProp);
  loads.push(coin.ready);
  const burst = (at: THREE.Vector3) => { for (let i = 0; i < 20; i++) { const angle = Math.random() * Math.PI * 2, speed = 0.8 + Math.random() * 1.8; embers.emit(furnace.worldToLocal(parent.localToWorld(at.clone())), new THREE.Vector3(Math.cos(angle) * speed, 1.6 + Math.random() * 2.4, Math.sin(angle) * speed), { life: 0.9, size: 0.09, gravity: 6, color: 0xffd27a }); } };
  let collected: (() => void) | null = null;
  const reward = chestRewardPresentation(parent, coin.group, puffMap, burst, () => collected?.(), new THREE.Vector3(0, DOOR_Y, FURNACE_Z + DOOR_Z + 0.2));
  let camera: THREE.PerspectiveCamera | null = null;
  let run: { t: number; job: MachineRun; flight: ReturnType<typeof cardFlight>; burnFrom: number; clanks: number; out: boolean } | null = null;
  let pump = 0, heat = 0, smokeClock = 0, emberClock = 0;
  return {
    ready: outlineMeshes(loads),
    get running() { return !!run; },
    run(job) {
      if (run) return;
      reward.reset();
      run = { t: 0, job, flight: cardFlight(parent, camera, job, into, 0.25), burnFrom: cardFlightSeconds(job.cards.length), clanks: 0, out: false };
      collected = () => job.cue("collected");
      job.cue("feed");
    },
    present(next, reducedMotion, target) { camera = next; reward.present(next, reducedMotion, target); },
    dismiss() { reward.dismiss(); },
    update(delta, time) {
      let shake = 0, burning = false;
      if (run) {
        run.t += delta;
        const { t, burnFrom } = run, burned = t - burnFrom;
        run.flight.update(t);
        // It burns: the bellows pump, the fire roars, smoke and embers leave by the chimney.
        burning = burned > 0 && burned < BURN_SECONDS;
        shake = burning ? Math.min(1, burned / 0.3) * Math.min(1, (BURN_SECONDS - burned) / 0.2) : 0;
        pump = burning ? Math.abs(Math.sin(burned * 6.5)) : pump;
        if (burning && Math.floor(burned / 0.26) > run.clanks) { if (!run.clanks) run.job.cue("burn"); run.clanks++; run.job.cue("clank"); }
        if (burning) {
          emberClock -= delta;
          if (emberClock <= 0) {
            emberClock = 0.05;
            const from = Math.random() < 0.6 ? mouth : doorway;
            embers.emit(from, new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.6 + Math.random() * 1.4, (Math.random() - 0.2) * 1), { life: 0.9, size: 0.07, gravity: 4, color: emberColors[Math.floor(Math.random() * emberColors.length)] });
          }
        }
        // The coin leaps out of the door; the run ends once it hangs before the camera.
        if (!run.out && burned >= BURN_SECONDS) {
          run.out = true; run.flight.dispose(); run.job.cue("coin");
          const finished = run.job;
          reward.begin(() => { run = null; finished.done(); });
        }
      }
      if (!burning) pump = THREE.MathUtils.damp(pump, 0, 8, delta);
      reward.update(delta);
      // The fire idles low and roars through a run.
      heat = THREE.MathUtils.damp(heat, burning ? 1 : 0.2, 4, delta);
      const flicker = 0.85 + 0.15 * Math.sin(time * 11) * Math.sin(time * 7.3);
      door.material.opacity = (0.35 + heat * 0.65) * flicker; throat.material.opacity = heat * 0.8 * flicker;
      smokeClock -= delta;
      if (smokeClock <= 0) { smokeClock = burning ? 0.14 : 0.9; smoke.emit(mouth, new THREE.Vector3(0.12, 0.7 + heat * 0.5, 0), { life: 1.8, size: 0.28, grow: 0.5, color: burning ? 0x54504c : 0x8a8682 }); }
      bellows.scale.y = 1 - pump * 0.16;
      furnace.position.set(Math.sin(time * 53) * 0.012 * shake, Math.abs(Math.sin(time * 31)) * 0.016 * shake, FURNACE_Z + Math.cos(time * 47) * 0.01 * shake);
      smoke.update(delta, 0.4); embers.update(delta);
    },
    dispose() { if (run && !run.out) run.flight.dispose(); run = null; },
  };
}

const ANVIL_H = 1, ANVIL_Z = 0.3, STELE_Z = -0.95, BRAZIER_X = 1.5, BRAZIER_H = 1.25;
// The hammer turns about the end of its handle, its head toward -x at angle 0 and falling as the
// angle grows. It rests head-down against the anvil's end and swings from the air above it.
const HAMMER_LENGTH = 1.4, GRIP = new THREE.Vector3(1.34, ANVIL_H + 0.46, ANVIL_Z + 0.1);
const REST_AT = new THREE.Vector3(1.2, 1.34, ANVIL_Z + 0.3), REST_ANGLE = Math.PI / 2 + 0.2, HIT = 0.2, RAISED = -0.95;
const RAISE_SECONDS = 0.34, STRIKE_GAP = 0.56, STRIKES = 3, FORM_SECONDS = 1.1, HOLD_SECONDS = 0.7;
// The figure stays on the anvil while the camera leaves for the viewer.
const LINGER_SECONDS = 1.6;

export function buildForge(parent: THREE.Group, { envMap, placeProp, loadFigure }: Options): Machine {
  const loads: Promise<THREE.Group>[] = [];
  const prop = (target: THREE.Object3D, ...[name, placement]: [Parameters<PlaceProp>[1], Parameters<PlaceProp>[2]]) => { const placed = placeProp(target, name, placement); loads.push(placed.ready); return placed; };
  prop(parent, "forgeStele", { height: 3.2, z: STELE_Z, yaw: -Math.PI / 2 });
  prop(parent, "forgeAnvilBlock", { height: ANVIL_H, z: ANVIL_Z, yaw: Math.PI / 2 });
  prop(parent, "forgeBrazierVoid", { height: BRAZIER_H, x: BRAZIER_X, z: STELE_Z + 0.65, yaw: -0.4 });
  const swing = new THREE.Group(); parent.add(swing);
  prop(swing, "forgeHammer", { height: 1, length: HAMMER_LENGTH, x: -HAMMER_LENGTH / 2, yaw: Math.PI });
  // The glow where the three fuse, the light the figure forms in, sparks from each blow.
  const glows = glowMap();
  const flame = glowSprite(glows, 0xffffff, 0.9); flame.position.set(BRAZIER_X, BRAZIER_H, STELE_Z + 0.65); parent.add(flame);
  const face = new THREE.Vector3(0, ANVIL_H + 0.03, ANVIL_Z);
  const core = glowSprite(glows, 0xffffff, 0.4); core.position.copy(face).setY(face.y + 0.1); parent.add(core);
  const pillarMaterial = new THREE.MeshBasicMaterial({ map: glows, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 1.9, 20, 1, true), pillarMaterial);
  pillar.position.set(0, face.y + 0.95, ANVIL_Z); pillar.raycast = () => {}; parent.add(pillar);
  const sparks = particles(parent, glows, 44, THREE.AdditiveBlending);
  // The figure that forms on the anvil, loaded while the hammer falls.
  const stand = new THREE.Group(); stand.position.copy(face); stand.visible = false; parent.add(stand);
  let figure: THREE.Object3D | null = null;
  const clearFigure = () => { stand.visible = false; if (figure) { stand.remove(figure); releaseFinishes(figure); disposeFigurineObject(figure); figure = null; } };
  const formFigure = (output: Extract<MachineOutput, { kind: "figure" }>) => {
    void loadFigure?.(output.model).then((model) => {
      if (!run) { disposeFigurineObject(model); return; }
      restoreFigurineMaterials(model); model.rotation.y = -Math.PI / 2;
      model.scale.multiplyScalar(figurineScale(figurineBodyBounds(model), model.name) * 0.62);
      const body = figurineBodyBounds(model), centre = body.getCenter(new THREE.Vector3());
      model.position.x -= centre.x; model.position.z -= centre.z; model.position.y -= body.min.y;
      if (output.quality !== "standard") applyFinish(model, output.quality, envMap);
      stand.add(model); figure = model;
    }, () => {});
  };

  let camera: THREE.PerspectiveCamera | null = null;
  const accent = new THREE.Color();
  let run: { t: number; job: MachineRun; flight: ReturnType<typeof cardFlight> | null; firstStrike: number; strikes: number; formed: boolean } | null = null, linger = 0;
  // The hammer's angle `t` seconds from the first raise: up, down, and a beat on the anvil.
  const hammerAt = (t: number) => {
    const local = t % STRIKE_GAP;
    if (local < RAISE_SECONDS) return THREE.MathUtils.lerp(t < STRIKE_GAP ? RAISED : HIT, RAISED, 1 - (1 - local / RAISE_SECONDS) ** 2);
    const fall = (local - RAISE_SECONDS) / 0.1;
    return fall < 1 ? THREE.MathUtils.lerp(RAISED, HIT, fall ** 2) : HIT;
  };
  const restQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, REST_ANGLE));
  const swingQuaternion = new THREE.Quaternion(), swingEuler = new THREE.Euler();
  const pose = (lift: number, angle: number) => {
    swing.position.lerpVectors(REST_AT, GRIP, lift);
    swing.quaternion.slerpQuaternions(restQuaternion, swingQuaternion.setFromEuler(swingEuler.set(0, 0, angle)), lift);
  };
  pose(0, RAISED);
  return {
    ready: outlineMeshes(loads),
    get running() { return !!run; },
    run(job) {
      if (run) return;
      clearFigure();
      const flying = cardFlightSeconds(job.cards.length);
      run = { t: 0, job, flight: cardFlight(parent, camera, job, face.clone().setY(face.y + 0.12), 0.3), firstStrike: flying + RAISE_SECONDS + 0.1, strikes: 0, formed: false };
      accent.set(QUALITY_COLORS[job.output.kind === "figure" ? job.output.quality : "golden"]);
      if (job.output.kind === "figure") formFigure(job.output);
      job.cue("feed"); job.cue("charge");
    },
    present(next) { camera = next; },
    dismiss() {},
    update(delta, time) {
      let glow = 0, pillarGlow = 0, lift = 0, angle = RAISED, formScale = 1;
      if (run) {
        run.t += delta;
        const { t, job, firstStrike } = run, flying = cardFlightSeconds(job.cards.length);
        run.flight?.update(t);
        if (run.flight && t > flying) { run.flight.dispose(); run.flight = null; }
        glow = THREE.MathUtils.clamp((t - flying + 0.2) / 0.3, 0, 1) * 0.55;
        // The hammer lifts off the anvil's side while the cards land, then falls three times.
        const swingFrom = firstStrike - RAISE_SECONDS - 0.1, lastHit = firstStrike + (STRIKES - 1) * STRIKE_GAP;
        lift = THREE.MathUtils.smoothstep(t, swingFrom - 0.45, swingFrom) * (1 - THREE.MathUtils.smoothstep(t, lastHit + 0.15, lastHit + 0.7));
        if (t >= swingFrom && t < lastHit + 0.2) angle = hammerAt(t - swingFrom);
        else if (t >= lastHit + 0.2) angle = THREE.MathUtils.lerp(HIT, RAISED, THREE.MathUtils.smoothstep(t, lastHit + 0.2, lastHit + 0.5));
        const strikes = Math.min(STRIKES, Math.max(0, Math.floor((t - firstStrike) / STRIKE_GAP) + 1));
        if (strikes > run.strikes) {
          run.strikes = strikes; job.cue("strike");
          for (let i = 0; i < 16; i++) {
            const turn = Math.random() * Math.PI * 2, speed = 1.2 + Math.random() * 2.2;
            sparks.emit(face, new THREE.Vector3(Math.cos(turn) * speed, 1 + Math.random() * 2.4, Math.sin(turn) * speed * 0.6 + 0.4), { life: 0.5 + Math.random() * 0.4, size: 0.07, gravity: 7, color: Math.random() < 0.5 ? accent : 0xffd27a });
          }
        }
        if (run.strikes) glow += Math.max(0, 1 - (t - (firstStrike + (run.strikes - 1) * STRIKE_GAP)) / 0.25) * (0.4 + run.strikes * 0.2);
        // The last blow: a flash, and the figure grows out of the light.
        const formed = t - lastHit - 0.1;
        if (!run.formed && formed >= 0) { run.formed = true; job.cue("sparkle"); }
        if (run.formed) {
          glow += Math.max(0, 1.4 - formed * 2);
          pillarGlow = Math.min(1, formed * 4) * Math.max(0.25, 1 - Math.max(0, formed - FORM_SECONDS) / 0.6);
          formScale = 1 - (1 - Math.min(1, formed / FORM_SECONDS)) ** 3;
          stand.visible = true;
        }
        if (formed >= FORM_SECONDS + HOLD_SECONDS) { run = null; linger = LINGER_SECONDS; job.done(); }
      } else if (linger > 0) { linger -= delta; pillarGlow = 0.25; if (linger <= 0) clearFigure(); }
      pose(lift, angle);
      stand.scale.setScalar(Math.max(0.001, formScale)); stand.rotation.y = (1 - formScale) * Math.PI * 3 + time * 0.25;
      core.material.color.copy(accent); core.material.opacity = Math.min(1, glow); core.scale.setScalar(0.4 + glow * 0.6);
      pillarMaterial.color.copy(accent); pillarMaterial.opacity = pillarGlow * 0.55;
      flame.material.color.set(run ? accent : 0x9a7bff); flame.material.opacity = 0.3 + (run ? Math.min(1, glow) * 0.6 : 0.06 * Math.sin(time * 3));
      sparks.update(delta);
    },
    dispose() { run?.flight?.dispose(); run = null; clearFigure(); },
  };
}
