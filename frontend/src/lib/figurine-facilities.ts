import * as THREE from "three";
import { hoverOutline } from "@/lib/figurine-glow";
import { woodTexture } from "@/lib/figurine-shop";
import { FISH_PROP, FISH_DISPLAY_CORRECTION, orientCoinModel, type PlaceProp } from "@/lib/figurine-props";
import { WHEEL, type FigurineQuality, type FishId } from "@/lib/figurine-collection";
import { applyFinish, releaseFinishes } from "@/lib/figurine-finish";
import { WORLD_TEXTURES } from "@/lib/figurine-world";
import { figurineBodyBounds, figurineScale, restoreFigurineMaterials } from "@/lib/figurine-materials";
import { disposeFigurineObject } from "@/lib/figurine-cache";
import { dailyChestAnimation, chestRewardPresentation } from "@/lib/figurine-chest";
import { coinCollectionFlight } from "@/lib/figurine-coin-flight";

// The plaza's facilities other than the shop and the two machines. Each is a small scene of game
// props, some round a hand-built centrepiece, standing in the world unsigned: a mailbox is just a
// mailbox until you tap it. Every one is a station: tap it and the camera goes there, and its panel
// opens in the page. Local space: the station faces +z (toward the plaza), x runs along its front.
export type Facility = "gallery" | "crate" | "wheel" | "mail" | "quests" | "feed" | "fame" | "leaderboard" | "trading" | "merchant" | "pond";
// What a facility can act out when its panel asks: the wheel spins to a segment, the crate bursts
// open, the pond casts a line with `catch` on the end of it. Cues mark moments worth a sound (and,
// at the pond, what the line is doing); `done` ends the action, the pond's with how it went.
export type FacilityAction = { kind: "spin"; segment: number } | { kind: "cast"; catch: CatchVisual } | { kind: "open" };
export type ActionCue = "tick" | "splash" | "nibble" | "bite" | "escape" | "catch" | "burst" | "chestOpen" | "chestLift" | "chestReward" | "coinCollected";
export type CastResult = "caught" | "missed" | "spooked";
// What comes up when a line is hooked: a prize (a coin or the awarded figure),
// or a fish (or boot) of the given length, at its finish.
export type CatchVisual = { kind: "coin" } | { kind: "figure"; model: string; quality: FigurineQuality } | { kind: "fish"; fish: FishId; length: number; quality: FigurineQuality };
// How each wheel prize is painted: its label and colour.
const PRIZE_PAINT = (prize: (typeof WHEEL)[number]["prize"]) => "boost" in prize
  ? prize.boost === "galaxy" ? { label: "✦", color: "#6b45c8", ink: "#f1e9ff" } : { label: "★", color: "#e8c165", ink: "#3a2506" }
  : "figure" in prize ? { label: "?", color: "#1f8a86", ink: "#e9fffd" }
  : { label: `+${prize.coins}`, color: ["#2f6fae", "#3e8f52", "#c2412e"][prize.coins - 1], ink: "#fff4dc" };

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  return [element, element.getContext("2d")!] as const;
}
const srgb = (element: HTMLCanvasElement) => { const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map; };
const seeded = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
// A tiling normal map of soft, crossing ripples, for still water.
function rippleNormals() {
  const size = 128, [element, paint] = canvas(size, size), image = paint.createImageData(size, size);
  const height = (x: number, y: number) => {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    return Math.sin(u * 3 + Math.sin(v * 2) * 1.5) + 0.6 * Math.sin(v * 4 + u) + 0.3 * Math.sin((u - v) * 5) + 0.2 * Math.sin(u * 7 + v * 3);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (height(x + 1, y) - height(x - 1, y)) * 2, dy = (height(x, y + 1) - height(x, y - 1)) * 2, length = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    image.data[i] = (-dx / length * 0.5 + 0.5) * 255; image.data[i + 1] = (-dy / length * 0.5 + 0.5) * 255; image.data[i + 2] = (1 / length * 0.5 + 0.5) * 255; image.data[i + 3] = 255;
  }
  paint.putImageData(image, 0, 0);
  const map = new THREE.CanvasTexture(element); map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}
export function buildFacility(parent: THREE.Group, kind: Facility, { placeProp, envMap, loadFigure }: { placeProp: PlaceProp; envMap: THREE.Texture; loadFigure?: (url: string) => Promise<THREE.Group> }) {
  // What the hover outline wraps: built parts now, game props once they have loaded.
  const frame: THREE.Mesh[] = [], props: Promise<THREE.Group>[] = [];
  // The action playing now, stepped each frame; null when idle.
  let acting: { step: (t: number) => boolean; t: number } | null = null;
  const actions: Partial<Record<FacilityAction["kind"], (action: FacilityAction, cue: (cue: ActionCue) => void, done: (result?: CastResult) => void) => void>> = {};
  // Taps on a facility's parts while it acts (the pond: hooking the bite).
  const pokes: Partial<Record<"hook" | "dismiss", () => void>> = {};
  const play = (step: (t: number) => boolean) => { acting = { step, t: 0 }; };
  // The crate's streak board, repainted when the streak changes.
  let paintStreak: ((opened: number, today: number | null) => void) | null = null;
  let chestAnimation: ReturnType<typeof dailyChestAnimation> = null;
  // The pond's glint (while prize catches remain), and the tackle under the pointer.
  let setPrizes: ((left: number) => void) | null = null, hover: ((part: string | null) => void) | null = null;
  let presentCatch: ((camera: THREE.PerspectiveCamera | null, reducedMotion: boolean, coinTarget: { x: number; y: number; width?: number } | null) => void) | null = null;
  let clearCatch: (() => void) | null = null;
  let coinCollected: (() => void) | null = null;
  const partOutlines = new Map<string, ReturnType<typeof hoverOutline>>();
  let hoveredPart: string | null = null, disposed = false;
  // Sparks of gold for rewards: additive sprites flung up and falling back.
  const [sparkCanvas, sparkPaint] = canvas(32, 32), sparkGradient = sparkPaint.createRadialGradient(16, 16, 0, 16, 16, 16);
  sparkGradient.addColorStop(0, "rgba(255,255,255,1)"); sparkGradient.addColorStop(1, "rgba(255,255,255,0)"); sparkPaint.fillStyle = sparkGradient; sparkPaint.fillRect(0, 0, 32, 32);
  const sparkMap = srgb(sparkCanvas);
  const sparks = Array.from({ length: 28 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkMap, color: 0xffd27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.visible = false; parent.add(sprite);
    return { sprite, velocity: new THREE.Vector3(), age: 9 };
  });
  const burst = (at: THREE.Vector3, color: THREE.ColorRepresentation = 0xffd27a) => sparks.forEach((spark) => {
    const angle = Math.random() * Math.PI * 2, speed = 0.8 + Math.random() * 1.8;
    spark.age = 0; spark.sprite.position.copy(at); spark.sprite.material.color.set(color);
    spark.velocity.set(Math.cos(angle) * speed, 2 + Math.random() * 2.4, Math.sin(angle) * speed);
  });
  const animate: ((delta: number, time: number) => void)[] = [];
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(50 + kind.length, [78, 50, 30]), roughness: 0.75 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a63c, metalness: 1, roughness: 0.3, envMap });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number, target: THREE.Object3D = parent) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; target.add(mesh); return mesh;
  };
  const prop = (name: Parameters<PlaceProp>[1], height: number, x: number, z: number, yaw = -Math.PI / 2, y = 0) => { const placed = placeProp(parent, name, { height, x, y, z, yaw }); props.push(placed.ready); return placed; };
  // As `prop`, sized by the prop's longest level extent.
  const long = (name: Parameters<PlaceProp>[1], length: number, x: number, z: number, yaw = -Math.PI / 2, y = 0) => { const placed = placeProp(parent, name, { height: 1, length, x, y, z, yaw }); props.push(placed.ready); return placed; };
  // The display cabinet's sixteen cubbies, in slot order (top row first), for the favourites.
  const cubbies: THREE.Group[] = [];
  if (kind === "gallery") {
    // The collection: a tall glass-fronted display cabinet, four by four lit cubbies, each with a
    // round stand and a brass number plate, under a gilded crown. The first sixteen favourites
    // stand in it as small copies of themselves.
    const COLUMNS = 4, ROWS = 4, CELL_W = 1.16, CELL_H = 0.84, POST = 0.07, SHELF = 0.05, DEPTH = 0.72, PLINTH = 0.42;
    const inner = COLUMNS * CELL_W + (COLUMNS + 1) * POST, height = PLINTH + ROWS * CELL_H + (ROWS + 1) * SHELF;
    const lacquer = new THREE.MeshStandardMaterial({ map: woodTexture(23, [64, 36, 22]), roughness: 0.5 });
    frame.push(add(new THREE.BoxGeometry(inner + 0.16, PLINTH, DEPTH + 0.14), lacquer, 0, PLINTH / 2, 0));
    add(new THREE.BoxGeometry(inner + 0.18, 0.025, 0.025), gold, 0, PLINTH - 0.06, DEPTH / 2 + 0.08);
    frame.push(add(new THREE.BoxGeometry(inner + 0.24, 0.16, DEPTH + 0.2), lacquer, 0, height + 0.08, 0));
    add(new THREE.BoxGeometry(inner + 0.26, 0.03, 0.03), gold, 0, height + 0.02, DEPTH / 2 + 0.11);
    // A carved crest on the crown, with a gilded star at its peak.
    const crest = new THREE.Shape();
    crest.moveTo(-1.3, 0); crest.quadraticCurveTo(-0.6, 0.05, -0.3, 0.32); crest.quadraticCurveTo(0, 0.5, 0.3, 0.32); crest.quadraticCurveTo(0.6, 0.05, 1.3, 0); crest.lineTo(-1.3, 0);
    frame.push(add(new THREE.ExtrudeGeometry(crest, { depth: 0.08, bevelEnabled: false }), lacquer, 0, height + 0.16, DEPTH / 2 - 0.04));
    const star = add(new THREE.OctahedronGeometry(0.11), gold, 0, height + 0.75, DEPTH / 2);
    animate.push((_, time) => { star.rotation.y = time * 0.8; });
    for (const side of [-1, 1]) {
      frame.push(add(new THREE.BoxGeometry(0.14, height - PLINTH + 0.16, DEPTH + 0.1), lacquer, side * (inner / 2 + 0.05), (height + PLINTH) / 2, 0));
      add(new THREE.SphereGeometry(0.08, 14, 10), gold, side * (inner / 2 + 0.05), height + 0.24, DEPTH / 2);
    }
    // The back of each cubby glows warm, brightest at the top, as if lit from above.
    const [backCanvas, backPaint] = canvas(64, 128), wash = backPaint.createLinearGradient(0, 0, 0, 128);
    wash.addColorStop(0, "#f6dcaa"); wash.addColorStop(0.35, "#9a6a3e"); wash.addColorStop(1, "#3a2416");
    backPaint.fillStyle = wash; backPaint.fillRect(0, 0, 64, 128);
    const glow = new THREE.MeshBasicMaterial({ map: srgb(backCanvas) });
    add(new THREE.PlaneGeometry(inner, height - PLINTH), glow, 0, (height + PLINTH) / 2, -DEPTH / 2 + 0.01).castShadow = false;
    // Number plates: one atlas of sixteen brass tags.
    const [plateCanvas, plate] = canvas(512, 256);
    for (let n = 0; n < 16; n++) {
      const x = (n % 4) * 128, y = Math.floor(n / 4) * 64, shine = plate.createLinearGradient(0, y, 0, y + 64);
      shine.addColorStop(0, "#f3d58e"); shine.addColorStop(1, "#9c7430");
      plate.fillStyle = shine; plate.fillRect(x, y, 128, 64);
      plate.fillStyle = "#2c1d08"; plate.font = "700 40px Georgia, serif"; plate.textAlign = "center"; plate.textBaseline = "middle"; plate.fillText(String(n + 1), x + 64, y + 34);
    }
    const plateMap = srgb(plateCanvas);
    const standMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1712, metalness: 0.4, roughness: 0.35, envMap });
    for (let row = 0; row < ROWS; row++) {
      const floor = PLINTH + SHELF + (ROWS - 1 - row) * (CELL_H + SHELF);
      add(new THREE.BoxGeometry(inner, SHELF, DEPTH), lacquer, 0, floor - SHELF / 2, 0);
      for (let column = 0; column < COLUMNS; column++) {
        const x = -inner / 2 + POST + CELL_W / 2 + column * (CELL_W + POST), slot = row * COLUMNS + column;
        add(new THREE.CylinderGeometry(0.3, 0.32, 0.04, 28), standMaterial, x, floor + 0.02, 0.02);
        const tag = new THREE.MeshStandardMaterial({ map: plateMap.clone(), roughness: 0.35, metalness: 0.6, envMap });
        tag.map!.repeat.set(1 / 4, 1 / 4); tag.map!.offset.set((slot % 4) / 4, 1 - (Math.floor(slot / 4) + 1) / 4);
        add(new THREE.PlaneGeometry(0.24, 0.12), tag, x, floor - SHELF / 2, DEPTH / 2 + 0.005).castShadow = false;
        const cubby = new THREE.Group(); cubby.position.set(x, floor + 0.04, 0.02); parent.add(cubby); cubbies.push(cubby);
      }
    }
    add(new THREE.BoxGeometry(inner, SHELF, DEPTH), lacquer, 0, height - SHELF / 2, 0);
    for (let column = 1; column < COLUMNS; column++) add(new THREE.BoxGeometry(POST, height - PLINTH, DEPTH - 0.04), lacquer, -inner / 2 + column * (CELL_W + POST) + POST / 2, (height + PLINTH) / 2, -0.02);
    // The glass front: reflections only, never a tap target.
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(inner, height - PLINTH), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, roughness: 0.04, envMap, envMapIntensity: 2, depthWrite: false }));
    glass.position.set(0, (height + PLINTH) / 2, DEPTH / 2 + 0.02); glass.renderOrder = 2; glass.raycast = () => {}; parent.add(glass);
  } else if (kind === "crate") {
    // Daily chest: a gold-banded chest on a heap of coins, with a barrow of gold at its side and a
    // seven-day streak board hung between two lantern posts behind it.
    const chest = prop("dailyChest", 1.05, 0, 0.12, -Math.PI / 2, 0.16);
    chest.group.userData.part = "chest";
    hover = (part) => { hoveredPart = part; };
    const coin = placeProp(parent, "coin", { height: 0.5, length: 0.75 });
    const reward = chestRewardPresentation(parent, coin.group, sparkMap, burst, () => coinCollected?.());
    presentCatch = (camera, reducedMotion, target) => reward.present(camera, reducedMotion, target);
    clearCatch = reward.reset;
    pokes.dismiss = reward.dismiss;
    props.push(coin.ready.then((group) => {
      if (disposed) return group;
      const holder = group.parent!;
      holder.remove(group); orientCoinModel(group);
      group.position.sub(new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()));
      holder.add(group);
      group.traverse((object) => { object.raycast = () => {}; });
      return group;
    }));
    let claimed = false, opening = false;
    const chestReady = chest.ready.then((group) => {
      if (disposed) return;
      chestAnimation = dailyChestAnimation(group);
      chestAnimation?.setClaimed(claimed);
    });
    animate.push((delta) => {
      chestAnimation?.update(delta);
      reward.update(delta);
    });
    actions.open = (_, cue, done) => {
      if (opening) return;
      opening = true;
      coinCollected = () => cue("coinCollected");
      void Promise.all([chestReady, coin.ready]).then(() => {
        if (disposed) return;
        reward.reset();
        cue("chestOpen");
        const reveal = () => {
          cue("chestLift");
          reward.begin(() => { opening = false; cue("chestReward"); done(); });
        };
        if (chestAnimation) chestAnimation.open(reveal, () => {});
        else reveal(); // A failed model download must not block the reward.
      });
    };
    long("fairGold", 3, 0, 0.2, 0.5);
    prop("fairCoins", 0.34, -1.12, 0.78, 0.3);
    prop("fairCoins", 0.25, 1.1, 0.7, 1.4);
    prop("fairGoldCart", 0.95, 1.55, -0.05, -Math.PI / 2 - 0.5);
    // The streak board: a coin per day, gilded once that day's crate is opened; today's is ringed.
    const [streakCanvas, streak] = canvas(512, 96), streakMap = srgb(streakCanvas);
    paintStreak = (opened: number, today: number | null) => {
      claimed = today === null;
      chestAnimation?.setClaimed(claimed);
      if (!claimed && !opening) reward.reset();
      streak.fillStyle = "#2a1a10"; streak.fillRect(0, 0, 512, 96);
      for (let day = 1; day <= 7; day++) {
        const x = 40 + (day - 1) * 72, lit = day <= opened;
        streak.fillStyle = lit ? "#e8c165" : day === 7 ? "#6b5326" : "#4a3a28"; streak.beginPath(); streak.arc(x, 42, 24, 0, Math.PI * 2); streak.fill();
        if (day === today) { streak.strokeStyle = "#fff3da"; streak.lineWidth = 4; streak.stroke(); }
        streak.fillStyle = lit ? "#3a2506" : "#a89070"; streak.font = "700 22px Georgia, serif"; streak.textAlign = "center"; streak.textBaseline = "middle"; streak.fillText(String(day), x, 43);
      }
      streakMap.needsUpdate = true;
    };
    paintStreak(0, 1);
    frame.push(add(new THREE.BoxGeometry(1.9, 0.36, 0.05), [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: streakMap, roughness: 0.6 }), wood], 0, 1.86, -0.62));
    add(new THREE.BoxGeometry(2.3, 0.07, 0.07), wood, 0, 2.08, -0.62);
    for (const side of [-1, 1]) prop("questPost", 2.5, side * 1.18, -0.66, side * Math.PI / 2);
  } else if (kind === "wheel") {
    // Lucky wheel: a painted wheel of prizes on an A-frame, a pointer at the top; a goblin statue
    // and a barrel of fireworks beside it, under bunches of balloons. It idles with a slow sway.
    // Segment i spans canvas angles i·45° to (i+1)·45° clockwise from +x; on the wheel's face that is
    // the same sweep counter-clockwise from +x, so segment i's centre sits at −(i + ½)·45°.
    const [wheelCanvas, paint] = canvas(512, 512);
    paint.translate(256, 256);
    WHEEL.forEach(({ prize }, index) => {
      const { label, color, ink } = PRIZE_PAINT(prize);
      paint.fillStyle = color; paint.beginPath(); paint.moveTo(0, 0); paint.arc(0, 0, 250, index / 8 * Math.PI * 2, (index + 1) / 8 * Math.PI * 2); paint.closePath(); paint.fill();
      paint.strokeStyle = "#f6e2b0"; paint.lineWidth = 4; paint.stroke();
      paint.save(); paint.rotate((index + 0.5) / 8 * Math.PI * 2); paint.fillStyle = ink; paint.font = "700 58px Georgia, serif"; paint.textAlign = "center"; paint.textBaseline = "middle"; paint.fillText(label, 168, 0); paint.restore();
    });
    paint.lineWidth = 12; paint.strokeStyle = "#c89a4a"; paint.beginPath(); paint.arc(0, 0, 250, 0, Math.PI * 2); paint.stroke();
    const wheel = new THREE.Group(); wheel.position.set(0, 1.65, 0.05); parent.add(wheel);
    frame.push(add(new THREE.CylinderGeometry(1.02, 1.02, 0.08, 48).rotateX(Math.PI / 2), gold, 0, 0, 0, wheel));
    add(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ map: srgb(wheelCanvas), roughness: 0.5 }), 0, 0, 0.042, wheel).castShadow = false;
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 20).rotateX(Math.PI / 2), gold, 0, 0, 0.06, wheel);
    // Pegs round the rim tick against the pointer as it turns.
    for (let peg = 0; peg < 8; peg++) { const angle = peg / 8 * Math.PI * 2; add(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8).rotateX(Math.PI / 2), gold, Math.cos(angle) * 0.96, Math.sin(angle) * 0.96, 0.08, wheel); }
    for (const side of [-1, 1]) { const leg = add(new THREE.BoxGeometry(0.1, 1.9, 0.1), wood, side * 0.45, 0.95, -0.12); leg.rotation.z = side * 0.24; }
    add(new THREE.ConeGeometry(0.1, 0.24, 4).rotateZ(Math.PI), gold, 0, 2.75, 0.12);
    prop("goblinStatue", 1.1, -1.45, 0.35, -Math.PI / 2 + 0.5);
    prop("fireworks", 0.95, 1.1, 0.25, 0);
    prop("fairBalloons", 3.4, -2.1, -0.45, 0.6);
    prop("fairBalloonsBig", 3.7, 2.15, -0.5, 2.4);
    // Idle, it rocks a little; a spin turns it five times over and settles the segment at the top.
    let rest = 0, spun = false;
    animate.push((_, time) => { if (!spun) wheel.rotation.z = rest + Math.sin(time * 0.6) * 0.06; });
    actions.spin = (action, cue, done) => {
      if (action.kind !== "spin") return;
      spun = true;
      const from = wheel.rotation.z, aim = Math.PI / 2 + (action.segment + 0.5) * Math.PI / 4 + (Math.random() - 0.5) * 0.5;
      const to = from + Math.PI * 10 + THREE.MathUtils.euclideanModulo(aim - from, Math.PI * 2), seconds = 4.6;
      let lastPeg = Math.floor(from / (Math.PI / 4));
      play((t) => {
        const k = Math.min(1, t / seconds), ease = 1 - (1 - k) ** 4;
        wheel.rotation.z = from + (to - from) * ease;
        const peg = Math.floor(wheel.rotation.z / (Math.PI / 4));
        if (peg !== lastPeg) { lastPeg = peg; cue("tick"); }
        if (k >= 1) { rest = wheel.rotation.z; spun = false; burst(new THREE.Vector3(0, 2.75, 0.2)); done(); return false; }
        return true;
      });
    };
  } else if (kind === "mail") {
    // Gifting post: a post-box, a round table of wrapped gifts, and satchels waiting for the round.
    prop("mailBox", 2.25, -0.62, -0.05, -Math.PI / 2);
    prop("marketTableRound", 0.72, 0.62, 0.08, 0.4);
    prop("gift", 0.25, 0.32, 0.18, 0.3, 0.72);
    prop("giftRed", 0.2, 0.9, 0.2, -0.4, 0.72);
    prop("giftWhite", 0.16, 0.62, -0.14, 0.9, 0.72);
    prop("mailSatchel", 0.62, 1.32, 0.42, 0.7);
    prop("marketBag", 0.42, -1.3, 0.42, 2);
  } else if (kind === "quests") {
    // Quest giver: the mission board hung by its chains from a beam, under a floating golden "!";
    // the campaign table with its maps before it, and a barrel of rolled scrolls.
    for (const side of [-1, 1]) frame.push(add(new THREE.BoxGeometry(0.2, 3.2, 0.2), wood, side * 1.5, 1.6, -0.34));
    frame.push(add(new THREE.BoxGeometry(3.4, 0.2, 0.22), wood, 0, 3.14, -0.34));
    prop("questBoard", 2.75, 0, -0.26, -Math.PI / 2, 0.42);
    prop("questTable", 0.92, 1.42, 0.62, -Math.PI / 2 - 0.3);
    prop("questScrolls", 1, -1.72, 0.2, -0.4);
    const mark = new THREE.Group(); mark.position.set(0, 3.75, -0.15); parent.add(mark);
    const glow = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffb81c, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.35 });
    add(new THREE.BoxGeometry(0.13, 0.42, 0.13), glow, 0, 0.12, 0, mark);
    add(new THREE.SphereGeometry(0.085, 14, 10), glow, 0, -0.25, 0, mark);
    animate.push((_, time) => { mark.position.y = 3.75 + Math.sin(time * 2) * 0.06; mark.rotation.y = time * 1.2; });
  } else if (kind === "feed") {
    // Pull feed: a scrying ball on a runed pedestal that glimmers with the latest golden and galaxy
    // pulls, with an orrery turning its planets behind it.
    prop("hallScryPedestal", 2.3, 0, 0.05, -Math.PI / 2);
    prop("crystalBall", 0.72, 0, 0.05, -Math.PI / 2, 1.18);
    prop("hallOrrery", 2.9, -0.2, -1.25, -Math.PI / 2 + 0.15);
    const shine = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xb28cff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    const [glowCanvas, glowPaint] = canvas(64, 64), gradient = glowPaint.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(1, "rgba(255,255,255,0)"); glowPaint.fillStyle = gradient; glowPaint.fillRect(0, 0, 64, 64);
    shine.material.map = srgb(glowCanvas); shine.position.set(0, 1.55, 0.05); shine.scale.setScalar(1.1); parent.add(shine);
    animate.push((_, time) => { shine.material.opacity = 0.3 + 0.2 * Math.sin(time * 1.7); shine.material.color.setHSL(0.72 + 0.08 * Math.sin(time * 0.4), 0.8, 0.65); });
  } else if (kind === "fame") {
    // Hall of fame: a curved memorial wall of carved names round the trophy of the firsts, with a
    // pedestal either side for the lesser cups.
    long("hallMemorial", 4.8, 0, -0.45, -Math.PI / 2);
    prop("hallTrophyGold", 2.3, 0, 0.12, -Math.PI / 2);
    prop("hallPedestal", 0.72, -1.45, 0.3, -Math.PI / 2 + 0.3);
    prop("trophy", 0.62, -1.45, 0.3, -Math.PI / 2 + 0.3, 0.72);
    prop("hallPedestal", 0.72, 1.45, 0.3, -Math.PI / 2 - 0.3);
    prop("museumPlaque", 0.4, 1.45, 0.3, -Math.PI / 2 - 0.3, 0.72);
  } else if (kind === "leaderboard") {
    // Leaderboards: a winners' podium (1 in the middle) with the champion's shield on its top step,
    // a carved monument behind, and banners either side.
    const marble = new THREE.MeshStandardMaterial({ color: 0xcfc8ba, roughness: 0.7 });
    const step = (place: number, height: number, x: number, color: string) => {
      const [numberCanvas, paint] = canvas(128, 128);
      paint.fillStyle = color; paint.fillRect(0, 0, 128, 128);
      paint.fillStyle = "#1c1612"; paint.font = "700 84px Georgia, serif"; paint.textAlign = "center"; paint.textBaseline = "middle"; paint.fillText(String(place), 64, 70);
      const face = new THREE.MeshStandardMaterial({ map: srgb(numberCanvas), roughness: 0.5 });
      frame.push(add(new THREE.BoxGeometry(0.7, height, 0.7), [marble, marble, marble, marble, face, marble], x, height / 2, 0.15));
      add(new THREE.BoxGeometry(0.74, 0.03, 0.74), gold, x, height, 0.15);
    };
    step(2, 0.55, -0.72, "#c9ccd4"); step(1, 0.8, 0, "#e8c165"); step(3, 0.4, 0.72, "#c08a5a");
    prop("hallMonument", 3.2, 0, -0.85, -Math.PI / 2);
    prop("hallTrophyShield", 1.55, 0, 0.15, -Math.PI / 2, 0.81);
    for (const side of [-1, 1]) prop("hallBanner", 3.3, side * 1.55, -0.7, -Math.PI / 2);
    prop("trophy", 0.5, -0.72, 0.15, -Math.PI / 2 + 0.3, 0.56);
    prop("trophy", 0.42, 0.72, 0.15, -Math.PI / 2 - 0.3, 0.41);
  } else if (kind === "merchant") {
    // The daily merchant trades from a travelling wagon under a purple canopy.
    long("marketWagon", 4.8, -0.1, -0.2, -Math.PI / 2 + 0.75);
    prop("marketBarrel", 0.72, 1.9, 0.8, 0.6);
  } else if (kind === "trading") {
    // Player exchanges happen under a merchant's canopy: wares laid out for swapping on a long
    // table, a bag-sign at the street and crates of stock at its side.
    prop("marketCanopy", 3.5, 0, -0.5, -Math.PI / 2);
    long("marketTable", 2.9, 0, 0.1, -Math.PI / 2);
    prop("marketWares", 0.7, 0, 0.1, -Math.PI / 2, 0.68);
    prop("marketSign", 2.35, 2.35, 0.45, -Math.PI / 2 - 0.2);
    prop("marketCrates", 1.3, -2.2, 0.1, 0.5);
  } else if (kind === "pond") {
    // Fishing pond: a woodland pool with a ragged, muddy shore, cattails, rocks and flowering lily
    // pads, and a short plank dock out from the plaza side (+z). The camera stands at the dock's
    // foot, so the pond is seen as an angler sees it: the dock and its tackle below, open water
    // ahead, the far bank (a net rack, a beached rowboat, a chair) beyond. Only a few things take
    // taps: the rod in its holder casts (and strikes while the line is out), the bobber strikes,
    // the bucket of the catch holds the fish log and the anglers' board on the bank the rankings.
    // While the day's prize catches remain, something glints under the water. The station's
    // origin is the pond's centre.
    const random = seeded(17);
    // The shore's radius at each angle (0 is +z, toward the dock), between about 3.5 and 4.6.
    const shore = (angle: number) => 4 + 0.32 * Math.sin(3 * angle + 0.7) + 0.18 * Math.sin(5 * angle + 2.1) + 0.08 * Math.sin(9 * angle + 0.3);
    const around = (angle: number, beyond: number) => { const radius = shore(angle) + beyond; return [Math.sin(angle) * radius, Math.cos(angle) * radius] as const; };
    // A band following the shore: each ring a radius (from the shore's), a height and a colour.
    const SEGMENTS = 120;
    const band = (rings: { radius: (shoreline: number) => number; y: number; color: string; alpha?: number }[], centre?: { y: number; color: string }) => {
      const positions: number[] = [], colors: number[] = [], uvs: number[] = [], index: number[] = [], tint = new THREE.Color();
      const vertex = (x: number, y: number, z: number, color: string, alpha = 1) => { positions.push(x, y, z); tint.set(color); colors.push(tint.r, tint.g, tint.b, alpha); uvs.push(x / 1.3, z / 1.3); };
      for (const ring of rings) for (let i = 0; i < SEGMENTS; i++) {
        const angle = i / SEGMENTS * Math.PI * 2, radius = ring.radius(shore(angle));
        vertex(Math.sin(angle) * radius, ring.y, Math.cos(angle) * radius, ring.color, ring.alpha);
      }
      for (let k = 0; k + 1 < rings.length; k++) for (let i = 0; i < SEGMENTS; i++) {
        const a = k * SEGMENTS + i, b = k * SEGMENTS + (i + 1) % SEGMENTS, c = a + SEGMENTS, d = b + SEGMENTS;
        index.push(a, c, b, b, c, d);
      }
      if (centre) {
        const middle = positions.length / 3; vertex(0, centre.y, 0, centre.color);
        for (let i = 0; i < SEGMENTS; i++) index.push(middle, i, (i + 1) % SEGMENTS);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(index); geometry.computeVertexNormals();
      return geometry;
    };
    // The water: dark in the middle, clearing to murky green shallows, with a slow shimmer of
    // ripples sliding across it and the sky's light on top.
    const shimmer = rippleNormals();
    // A soft specular keeps the low sun from blowing the surface out to white.
    const water = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0, specularIntensity: 0.25, envMap, envMapIntensity: 0.3, normalMap: shimmer, normalScale: new THREE.Vector2(0.1, 0.1), side: THREE.DoubleSide });
    const pond = new THREE.Mesh(band([
      { radius: (r) => r * 0.3, y: 0.025, color: "#163a43" }, { radius: (r) => r * 0.62, y: 0.025, color: "#1d4d55" },
      { radius: (r) => r * 0.86, y: 0.025, color: "#2d6363" }, { radius: (r) => r + 0.08, y: 0.025, color: "#4a6143" },
    ], { y: 0.025, color: "#12333c" }), water);
    pond.receiveShadow = true; pond.userData.part = "water"; parent.add(pond); frame.push(pond);
    animate.push((_, time) => { shimmer.offset.set(time * 0.012, time * 0.02); });
    // The bank: a low lip of wet mud at the water's edge drying to dirt, fading into the grass.
    const mud = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    new THREE.TextureLoader().load(WORLD_TEXTURES.dirt, (texture) => { texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; mud.map = texture; mud.needsUpdate = true; });
    const bank = new THREE.Mesh(band([
      { radius: (r) => r - 0.05, y: 0.03, color: "#3a3122" }, { radius: (r) => r + 0.18, y: 0.06, color: "#5a4a33" },
      { radius: (r) => r + 0.55, y: 0.045, color: "#8a7450" }, { radius: (r) => r + 1.05, y: 0.025, color: "#8a7a58", alpha: 0.75 },
      { radius: (r) => r + 1.6, y: 0.015, color: "#7d7a55", alpha: 0 },
    ]), mud);
    bank.receiveShadow = true; bank.renderOrder = 1; bank.raycast = () => {}; parent.add(bank);
    // Rocks half sunk along the bank, cattail beds and reed clumps; the dock's landing stays clear.
    const clear = (angle: number) => Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) > 0.55;
    for (let i = 0; i < 16; i++) {
      const angle = i / 16 * Math.PI * 2 + random() * 0.3;
      if (!clear(angle)) continue;
      const [x, z] = around(angle, 0.1 + random() * 0.45);
      prop(i % 3 ? "rockSmall" : "rock", (i % 3 ? 0.18 : 0.32) + random() * 0.14, x, z, random() * 6, -0.06);
    }
    for (const angle of [1.25, 1.9, 2.55, 2.95, 3.55, 4.05, 4.6, 5.1]) for (let stem = 0; stem < 4; stem++) {
      const [x, z] = around(angle + (random() - 0.5) * 0.22, -0.15 + random() * 0.45);
      prop("cattails", 1 + random() * 0.6, x, z, random() * 6);
    }
    for (const angle of [1.55, 2.2, 3.25, 3.85, 4.35, 4.85]) { const [x, z] = around(angle, 0.05); prop("reeds", 0.6 + random() * 0.3, x, z, random() * 6); }
    // Lily pads drift clear of the dock and the casting water; some are in flower.
    for (const [x, z, yaw] of [[-2.8, -0.4, 0.8], [2.7, -2.1, 1.9], [-1.9, -3, 2.4], [3, 0.8, 0.2]]) props.push(placeProp(parent, "lilyFlowers", { height: 0.3, length: 1.1, x, z, y: 0.02, yaw }).ready);
    for (const [x, z, yaw] of [[-2.4, 1.6, 2.9], [1.9, -3, 0.8], [3.3, -0.6, 1.1]]) prop("lilypad", 0.08, x, z, yaw, 0.02);
    // The far bank: a net hung to dry with the day's fish, a barrel of the catch, the chair, the
    // old fish rack, and the rowboat pulled up on the mud.
    const onBank = (angle: number, beyond: number, model: Parameters<PlaceProp>[1], height: number, turn = 0) => { const [x, z] = around(angle, beyond); return prop(model, height, x, z, Math.atan2(-x, -z) - Math.PI / 2 + turn); };
    onBank(4.0, 0.9, "fishNet", 1.35, 0.2);
    onBank(2.55, 0.7, "fishBarrel", 0.85);
    onBank(4.55, 0.7, "fishingChair", 1.35, Math.PI);
    onBank(3.35, 1, "fishRack", 1.5, 0.3);
    const [boatX, boatZ] = around(2.05, -0.2);
    props.push(placeProp(parent, "rowboat", { height: 0.7, length: 2.6, x: boatX, z: boatZ, y: 0.01, yaw: 0.35 }).ready);
    // The dock: Elwynn's small dock, a plank platform on four pilings with steps down to the bank,
    // reaching only a little way over the water so a cast carries well out beyond it. The model
    // runs along x with its steps at -x; turned a quarter, they come ashore toward the camera.
    // Places on it are measured in the model's own units (`along` toward the water from the
    // model's middle, `across` to the right seen from the shore) and scaled by DOCK.scale: its deck
    // stands 23.29 above its lowest point (the pilings' feet, far under the pond), its pilings
    // stand 1.21 above the deck, and its platform ends 7.97 along.
    const DOCK = { x: 0.43, z: 4.34, deck: 0.36, scale: 0.2 };
    const PILINGS = { near: -1.1, far: 5.07, left: -3.5, right: 3.6, top: 1.21 * DOCK.scale };
    const onDock = (along: number, across: number) => [DOCK.x + across * DOCK.scale, DOCK.z - along * DOCK.scale] as const;
    const dock = placeProp(parent, "dock", { height: 1, length: 15.95 * DOCK.scale, x: DOCK.x, y: DOCK.deck - 23.29 * DOCK.scale, z: DOCK.z, yaw: Math.PI / 2 });
    // Without the little roadsign it carries at its steps (the anglers' board stands on the bank),
    // and with its pilings cut off just under the water: driven deep into the game's lake bed,
    // they would show through the bank from above.
    props.push(dock.ready.then((group) => {
      const sign: THREE.Object3D[] = [], toPond = new THREE.Matrix4(), point = new THREE.Vector3();
      parent.updateWorldMatrix(true, true);
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (/sign/i.test((object.material as THREE.Material).name)) { sign.push(object); return; }
        object.geometry = object.geometry.clone();
        toPond.copy(parent.matrixWorld).invert().multiply(object.matrixWorld);
        const back = toPond.clone().invert(), source = object.geometry.attributes.position;
        // Decode the quantized/interleaved positions before reshaping the pilings. Keep their
        // feet just beneath the ground, and rebuild both the rendered and raycast bounds.
        const positions = new THREE.Float32BufferAttribute(source.count * 3, 3);
        for (let i = 0; i < source.count; i++) {
          point.fromBufferAttribute(source, i).applyMatrix4(toPond);
          point.y = Math.max(-0.005, point.y);
          point.applyMatrix4(back); positions.setXYZ(i, point.x, point.y, point.z);
        }
        object.geometry.setAttribute("position", positions);
        object.geometry.computeBoundingBox(); object.geometry.computeBoundingSphere();
      });
      sign.forEach((object) => object.removeFromParent());
      return group;
    }));
    // A lantern on the piling at the head of the steps.
    const [lanternX, lanternZ] = onDock(PILINGS.near, PILINGS.left);
    prop("dockLantern", 0.36, lanternX, lanternZ, 0.4, DOCK.deck + PILINGS.top - 0.02);
    const lanternGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkMap, color: 0xffc46a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    lanternGlow.position.set(lanternX, DOCK.deck + PILINGS.top + 0.24, lanternZ); lanternGlow.scale.setScalar(0.7); parent.add(lanternGlow);
    animate.push((_, time) => { lanternGlow.material.opacity = 0.45 + Math.sin(time * 3.1) * 0.05 + Math.sin(time * 7.3) * 0.03; });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    // The catch bucket replaces the tackle box on the left of the dock, clear of the rod.
    // It also opens the fish log; a creel sits on the bank by the steps.
    const [bucketX, bucketZ] = onDock(2.4, -1.6);
    const bucket = new THREE.Group(); bucket.position.set(bucketX, DOCK.deck, bucketZ); bucket.rotation.y = -0.6; bucket.userData.part = "bucket"; parent.add(bucket);
    props.push(placeProp(bucket, "fishBucket", { height: 0.32 }).ready);
    add(new THREE.BoxGeometry(0.6, 0.6, 0.6), hidden, 0, 0.22, 0, bucket).castShadow = false;
    prop("creel", 0.3, DOCK.x + 1.75, 4.3, 0.9, 0.02);
    // The rod stands in a holder just inside the far right piling, angled out over the water and
    // pivoting at its butt; tap it to cast. Its model is 2.64 long with the butt and reel at +z,
    // butt and tip level with each other and the reel hanging 0.36 below them: it is set so its
    // butt is at the holder and its tip at -ROD. The bobber hangs from the tip until the line goes out.
    const ROD = 2.5, REST = 0.35, AIM = 0.12;
    const [postX, postZ] = onDock(PILINGS.far, PILINGS.right);
    const PIVOT = new THREE.Vector3(postX - 0.22, DOCK.deck + 0.13, postZ + 0.48);
    const rod = new THREE.Group(); rod.position.copy(PIVOT); rod.rotation.order = "YXZ"; rod.rotation.set(REST, AIM, 0); rod.userData.part = "rod"; parent.add(rod);
    props.push(placeProp(rod, "fishingRod", { height: 1, length: ROD, y: -0.36 * ROD / 2.64, z: -ROD / 2 }).ready);
    add(new THREE.BoxGeometry(0.6, 0.6, ROD + 0.3), hidden, 0, 0.1, -ROD / 2, rod).castShadow = false;
    // The holder: a short iron-banded tube round the rod's handle, bolted onto the deck.
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.6, roughness: 0.5, envMap });
    add(new THREE.CylinderGeometry(0.038, 0.034, 0.3, 10, 1, true).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: wood.map, roughness: 0.7, side: THREE.DoubleSide }), 0, 0, -0.1, rod);
    for (const along of [-0.03, -0.22]) add(new THREE.TorusGeometry(0.04, 0.008, 6, 16), iron, 0, 0, along, rod);
    add(new THREE.CylinderGeometry(0.035, 0.045, 0.13, 8), iron, PIVOT.x, DOCK.deck + 0.065, PIVOT.z);
    add(new THREE.BoxGeometry(0.18, 0.025, 0.24), iron, PIVOT.x, DOCK.deck + 0.0125, PIVOT.z);
    // The anglers' board on the bank left of the dock: a notice board of pinned records under a
    // gilded trophy fish, turned toward the dock's foot. Tap it for the rankings.
    const [boardX, boardZ] = around(-0.55, 0.55);
    const board = new THREE.Group(); board.position.set(boardX, 0, boardZ); board.rotation.y = Math.atan2(DOCK.x - boardX, 7.5 - boardZ); board.userData.part = "board"; parent.add(board);
    for (const side of [-1, 1]) add(new THREE.CylinderGeometry(0.04, 0.05, 1.5, 8), wood, side * 0.52, 0.75, 0, board);
    const [notesCanvas, notes] = canvas(256, 160);
    notes.fillStyle = "#4a3020"; notes.fillRect(0, 0, 256, 160);
    notes.strokeStyle = "rgba(0,0,0,.35)"; notes.lineWidth = 2;
    for (let y = 40; y < 160; y += 40) { notes.beginPath(); notes.moveTo(0, y); notes.lineTo(256, y); notes.stroke(); }
    // Pinned notes: a ranking with its podium marks, and catches written up beside it.
    const note = (x: number, y: number, width: number, height: number, tilt: number, rows: number, marks = false) => {
      notes.save(); notes.translate(x + width / 2, y + height / 2); notes.rotate(tilt);
      notes.fillStyle = "#e9dcb8"; notes.shadowColor = "rgba(0,0,0,.45)"; notes.shadowBlur = 5; notes.fillRect(-width / 2, -height / 2, width, height); notes.shadowBlur = 0;
      for (let row = 0; row < rows; row++) {
        const lineY = -height / 2 + 16 + row * 13;
        if (marks) { notes.fillStyle = ["#c9a227", "#9ea3ab", "#a8693a"][row] ?? "#6b5a44"; notes.beginPath(); notes.arc(-width / 2 + 12, lineY, 4.5, 0, Math.PI * 2); notes.fill(); }
        notes.fillStyle = "#5d4c3a"; notes.fillRect(-width / 2 + (marks ? 22 : 9), lineY - 1.5, (width - (marks ? 32 : 18)) * (0.55 + 0.4 * ((row * 37) % 10) / 10), 3);
      }
      notes.fillStyle = "#b8322a"; notes.beginPath(); notes.arc(0, -height / 2 + 6, 3.5, 0, Math.PI * 2); notes.fill();
      notes.restore();
    };
    note(18, 14, 104, 92, -0.04, 5, true); note(136, 10, 96, 60, 0.06, 3); note(140, 82, 86, 64, -0.05, 3); note(40, 112, 70, 40, 0.08, 2);
    const noteboard = new THREE.MeshStandardMaterial({ map: srgb(notesCanvas), roughness: 0.8 });
    add(new THREE.BoxGeometry(1.12, 0.7, 0.05), [wood, wood, wood, wood, noteboard, wood], 0, 1.02, 0.03, board);
    add(new THREE.BoxGeometry(1.26, 0.05, 0.16), wood, 0, 1.4, 0.03, board);
    // The trophy: the pond's biggest fish, gilded, mounted on a wooden plaque atop the board.
    const trophy = new THREE.Group(); trophy.position.set(0, 1.62, 0.05); board.add(trophy);
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 28).rotateX(Math.PI / 2).scale(1.7, 1, 1), wood, 0, 0, -0.02, trophy);
    const mounted = placeProp(trophy, FISH_PROP.mightfish, { height: 1, length: 0.62, yaw: Math.PI / 2 });
    mounted.group.rotation.z = -Math.PI / 2; mounted.group.position.set(0, 0, 0.18);
    props.push(mounted.ready.then((group) => { applyFinish(group, "golden", envMap); return group; }));
    add(new THREE.BoxGeometry(1.4, 1.9, 0.5), hidden, 0, 0.95, 0, board).castShadow = false;
    // The line: a few points sagging between the rod's tip and the bobber, slack until a fish pulls.
    const LINE_POINTS = 14, lineGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(LINE_POINTS * 3), 3));
    const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: 0xf4efe0, transparent: true, opacity: 0.85 }));
    line.frustumCulled = false; line.raycast = () => {}; parent.add(line);
    const bobber = new THREE.Group(); bobber.userData.part = "bobber"; parent.add(bobber);
    props.push(placeProp(bobber, "bobber", { height: 0.3, y: -0.08, yaw: Math.PI / 2 }).ready);
    add(new THREE.SphereGeometry(0.55, 12, 8), hidden, 0, 0.1, 0, bobber).castShadow = false;
    const tip = new THREE.Vector3(), point = new THREE.Vector3();
    let sag = 0.25;
    const stringLine = () => {
      rod.updateMatrix(); tip.set(0, 0, -ROD).applyMatrix4(rod.matrix);
      const positions = lineGeometry.attributes.position as THREE.BufferAttribute, top = bobber.position.clone().setY(bobber.position.y + 0.14), length = tip.distanceTo(top);
      for (let i = 0; i < LINE_POINTS; i++) {
        const k = i / (LINE_POINTS - 1);
        point.lerpVectors(tip, top, k); point.y -= Math.sin(Math.PI * k) * sag * length * 0.12;
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      positions.needsUpdate = true;
    };
    // Rings on the water: a few at once, for nibbles, plops and the bite's churn.
    const ripples = Array.from({ length: 4 }, () => {
      const mesh = add(new THREE.RingGeometry(0.08, 0.12, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }), 0, 0.035, 0);
      mesh.castShadow = false; mesh.visible = false; mesh.raycast = () => {};
      return { mesh, age: 0, strength: 1 };
    });
    let nextRipple = 0;
    const splash = (at: THREE.Vector3, strength = 1) => {
      const ring = ripples[nextRipple++ % ripples.length];
      ring.mesh.position.set(at.x, 0.035, at.z); ring.mesh.scale.setScalar(1); ring.mesh.visible = true;
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.3 * strength;
      ring.age = 0; ring.strength = strength;
    };
    animate.push((delta) => {
      for (const ring of ripples) {
        if (!ring.mesh.visible) continue;
        const opacity = 0.35 + 0.3 * ring.strength, lifetime = opacity * 2;
        ring.age = Math.min(lifetime, ring.age + delta);
        ring.mesh.scale.setScalar(1 + ring.age * 6 * ring.strength);
        (ring.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, opacity - ring.age * 0.5);
        ring.mesh.visible = ring.age < lifetime;
      }
      stringLine();
    });
    // The glint: while prize catches remain, something golden shines up through the water, motes
    // rising from it. A prize cast lands the bobber on it.
    const GLINT = new THREE.Vector3(-1.75, 0, -0.9);
    // A gold wash on the water with a bright heart, both outside tone mapping so gold stays gold.
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: sparkMap, color: 0xffc23c, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    glint.position.set(GLINT.x, 0.04, GLINT.z); glint.scale.setScalar(2); glint.raycast = () => {}; parent.add(glint);
    const heart = new THREE.Mesh(glint.geometry, new THREE.MeshBasicMaterial({ map: sparkMap, color: 0xfff0b0, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    heart.position.set(GLINT.x, 0.045, GLINT.z); heart.scale.setScalar(0.75); heart.raycast = () => {}; parent.add(heart);
    const motes = Array.from({ length: 7 }, (_, index) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkMap, color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      sprite.scale.setScalar(0.09); parent.add(sprite);
      return { sprite, phase: index / 7, x: 0, z: 0 };
    });
    let glintLevel = 0, glintWanted = 0;
    animate.push((delta, time) => {
      glintLevel = THREE.MathUtils.damp(glintLevel, glintWanted, 2.5, delta);
      glint.visible = heart.visible = glintLevel > 0.01;
      const pulse = 0.8 + 0.14 * Math.sin(time * 1.7) + 0.06 * Math.sin(time * 4.3);
      glint.material.opacity = glintLevel * 0.55 * pulse; heart.material.opacity = glintLevel * 0.8 * pulse;
      for (const mote of motes) {
        const k = (time * 0.45 + mote.phase) % 1;
        if (k < 0.02) { const angle = Math.random() * Math.PI * 2, radius = Math.random() * 0.45; mote.x = GLINT.x + Math.cos(angle) * radius; mote.z = GLINT.z + Math.sin(angle) * radius; }
        mote.sprite.visible = glint.visible;
        mote.sprite.position.set(mote.x, 0.05 + k * 0.7, mote.z);
        mote.sprite.material.opacity = glintLevel * Math.sin(Math.PI * k) * 0.9;
      }
    });
    // The bite: a "!" springs up over the bobber, and a ring closes in on it as the moment passes.
    const [markCanvas, markPaint] = canvas(64, 128);
    markPaint.font = "900 112px Georgia, serif"; markPaint.textAlign = "center"; markPaint.textBaseline = "middle";
    markPaint.lineWidth = 10; markPaint.strokeStyle = "#2a1606"; markPaint.strokeText("!", 32, 68); markPaint.fillStyle = "#ffd257"; markPaint.fillText("!", 32, 68);
    const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: srgb(markCanvas), transparent: true, depthTest: false }));
    mark.visible = false; mark.renderOrder = 5; parent.add(mark);
    const closing = add(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0, depthWrite: false }), 0, 0.04, 0);
    closing.castShadow = false; closing.visible = false; closing.raycast = () => {};
    // The catch on show: it leaps from the water to hang before the camera, finished
    // like its quality, until dismissal or the next cast collects it.
    const SHOW = new THREE.Vector3(), WALLET = new THREE.Vector3(), FIGURE_EXIT = new THREE.Vector3(), BUCKET = new THREE.Vector3(bucketX, DOCK.deck + 0.2, bucketZ);
    const REVEAL_SECONDS = 1.1, STOW_SECONDS = 0.7;
    const smooth = (k: number) => k * k * (3 - 2 * k);
    const arc = (k: number) => 16 * k * k * (1 - k) * (1 - k);
    const presentation = new THREE.Group(); parent.add(presentation);
    const show = new THREE.Group(); show.visible = false; presentation.add(show);
    // A soft oval behind the catch fades to transparent at its edges, leaving the banks clear.
    const catchBackdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: sparkMap, color: 0x000000, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    catchBackdrop.name = "pond-catch-backdrop";
    catchBackdrop.visible = false; catchBackdrop.raycast = () => {}; presentation.add(catchBackdrop);
    let walletScale = 0.05, displayScale = 0.5, stowScale = 0.5, stowSpin = 0, revealProgress = 0, displayTime = 0, reducedCatchMotion = false;
    const launchRotation = new THREE.Quaternion(), stowRotation = new THREE.Quaternion(), stowFrom = new THREE.Vector3();
    const coinFlip = new THREE.Quaternion(), flipAxis = new THREE.Vector3(1, 0, 0);
    let coinFlight: ReturnType<typeof coinCollectionFlight> | null = null;
    const bucketRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, bucket.rotation.y, Math.PI / 3));
    // Anchor the landed model to the viewport, including while the player looks around.
    const screenCatch = new THREE.Vector3(), viewRotation = new THREE.Quaternion();
    presentCatch = (camera, reducedMotion, coinTarget) => {
      presentation.visible = !!camera;
      if (!camera) return;
      reducedCatchMotion = reducedMotion;
      displayScale = (shown?.kind === "coin" ? 0.35 : shown?.kind === "figure" ? 0.32 : 0.5) * Math.min(1, camera.aspect / 0.8);
      camera.updateWorldMatrix(true, false);
      // Close enough to stay in front of the dock even at the nearest allowed camera zoom.
      screenCatch.set(0, 0.04, -3).applyMatrix4(camera.matrixWorld);
      SHOW.copy(parent.worldToLocal(screenCatch));
      const halfHeight = 3 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const target = coinTarget ?? { x: 0.9, y: 0.8 };
      walletScale = (coinTarget?.width ?? 0.08) * halfHeight * camera.aspect / 1.4;
      WALLET.copy(parent.worldToLocal(screenCatch.set(target.x * halfHeight * camera.aspect, target.y * halfHeight, -3).applyMatrix4(camera.matrixWorld)));
      FIGURE_EXIT.copy(parent.worldToLocal(screenCatch.set(-1.5 * halfHeight * camera.aspect, 1.5 * halfHeight, -3).applyMatrix4(camera.matrixWorld)));
      parent.getWorldQuaternion(viewRotation).invert().multiply(camera.quaternion);
      // One pose calculation owns the whole flight and the resting display. At k=1 the
      // position, scale and rotation already equal the display pose, so nothing snaps.
      if (show.visible && stowing < 0) {
        const k = smooth(revealProgress);
        if (current?.phase === "hooked") {
          show.position.lerpVectors(current.out, SHOW, k);
          if (!reducedMotion) show.position.y += arc(revealProgress) * 1.1;
          show.quaternion.slerpQuaternions(launchRotation, viewRotation, k);
          if (shown?.kind === "coin" && !reducedMotion) show.quaternion.multiply(coinFlip.setFromAxisAngle(flipAxis, Math.PI * 2 * k));
        } else { show.position.copy(SHOW); show.quaternion.copy(viewRotation); }
        show.scale.setScalar(THREE.MathUtils.lerp(0.22, displayScale, k));
      }
      catchBackdrop.position.copy(parent.worldToLocal(screenCatch.set(0, -0.22, -4).applyMatrix4(camera.matrixWorld)));
      catchBackdrop.quaternion.copy(viewRotation);
      const height = 8 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      catchBackdrop.scale.set(Math.min(height * 1.15, height * camera.aspect * 0.95), height * 0.72, 1);
    };
    const holder = new THREE.Group(); show.add(holder);
    let catchFigure: THREE.Group | null = null, catchReady = true;
    let shown: CatchVisual | null = null, queued: CatchVisual | null = null, stowing = -1;
    const clearShow = () => { show.visible = catchBackdrop.visible = false; catchBackdrop.material.opacity = 0; show.scale.setScalar(1); holder.children.forEach((child) => releaseFinishes(child)); holder.clear(); if (catchFigure) { disposeFigurineObject(catchFigure); catchFigure = null; } holder.rotation.set(0, 0, 0); shown = null; stowing = -1; revealProgress = displayTime = 0; };
    clearCatch = clearShow;
    const placeFigure = (visual: Extract<CatchVisual, { kind: "figure" }>) => {
      const group = new THREE.Group(); holder.add(group);
      const ready = (loadFigure ? loadFigure(visual.model) : Promise.reject(new Error("No figure loader"))).then((model) => {
        if (disposed || group.parent !== holder) { disposeFigurineObject(model); return group; }
        restoreFigurineMaterials(model); model.rotation.y = -Math.PI / 2;
        model.scale.multiplyScalar(figurineScale(figurineBodyBounds(model), model.name) * 0.8);
        // Measure the body before parenting so the base sits at the feet, not a dangling weapon.
        const body = figurineBodyBounds(model), centre = body.getCenter(new THREE.Vector3()), size = body.getSize(new THREE.Vector3());
        const radius = THREE.MathUtils.clamp(Math.max(size.x, size.z) * 0.42, 0.35, 0.65);
        const pedestal = new THREE.Group(); pedestal.name = "pond-figure-pedestal";
        const stone = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, 0.1, 32), new THREE.MeshStandardMaterial({ color: 0x202635, roughness: 0.48, metalness: 0.25 }));
        stone.position.y = -0.065;
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.03, 32), new THREE.MeshStandardMaterial({ color: 0xc69b48, roughness: 0.3, metalness: 0.75 }));
        rim.position.y = -0.015;
        pedestal.add(stone, rim); pedestal.position.set(centre.x, body.min.y, centre.z);
        // Keep tall equipment and the base inside the space above the catch details.
        const bounds = new THREE.Box3().setFromObject(model);
        const height = bounds.max.y - Math.min(bounds.min.y, body.min.y - 0.115);
        group.scale.setScalar(Math.min(1, 1.8 / height));
        group.add(model, pedestal); catchFigure = group;
        if (visual.quality !== "standard") applyFinish(model, visual.quality, envMap);
        return group;
      }, () => group);
      return { group, ready };
    };
    const showCatch = (visual: CatchVisual) => {
      clearShow(); shown = visual; catchReady = false;
      const placed = visual.kind === "coin" ? placeProp(holder, "coin", { height: 0.5, length: 1.4 })
        : visual.kind === "figure" ? placeFigure(visual)
        : placeProp(holder, FISH_PROP[visual.fish], { height: 1, length: THREE.MathUtils.clamp(visual.length * 2, 1.4, 1.9) });
      void placed.ready.then((group) => {
        if (group.parent !== holder) return;
        // Measure and centre in the model's own space, independent of the camera or the last
        // catch's rotation. Correct the authored lean before the holder's upright spin.
        holder.remove(group);
        if (visual.kind === "coin") orientCoinModel(group);
        if (visual.kind === "fish" && visual.fish !== "boot") {
          group.rotation.set(-Math.PI / 2, visual.fish === "firefin" ? 0 : Math.PI / 2, 0);
          const [x, y, z] = FISH_DISPLAY_CORRECTION[visual.fish].map(THREE.MathUtils.degToRad);
          group.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
        }
        if (visual.kind === "fish" && visual.quality !== "standard") applyFinish(group, visual.quality, envMap);
        const centre = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
        group.position.sub(centre);
        holder.add(group); catchReady = true;
        group.traverse((object) => { object.raycast = () => {}; });
      });
    };
    // Fish and boots go into the bucket; coins fly to the HUD; figures fly off-screen.
    const stow = () => {
      if (!show.visible || !shown || stowing >= 0) return;
      stowing = 0; stowScale = show.scale.x; stowSpin = holder.rotation.y;
      stowFrom.copy(show.position); stowRotation.copy(show.quaternion);
      if (shown.kind === "coin") coinFlight = coinCollectionFlight(viewRotation);
    };
    animate.push((delta) => {
      const shade = show.visible && stowing < 0 ? THREE.MathUtils.smoothstep(revealProgress, 0.35, 1) * 0.65 : 0;
      catchBackdrop.material.opacity = THREE.MathUtils.damp(catchBackdrop.material.opacity, shade, 10, delta);
      catchBackdrop.visible = catchBackdrop.material.opacity > 0.001;
      // Arrive broadside and upright, then ease into a turn around screen-up only.
      if (show.visible && revealProgress >= 1 && stowing < 0 && !reducedCatchMotion) {
        displayTime += delta;
        holder.rotation.y += delta * 0.9 * Math.min(1, displayTime / 0.35);
      }
      if (stowing < 0) return;
      stowing += delta;
      const k = Math.min(1, stowing / STOW_SECONDS), eased = smooth(k);
      if (shown?.kind === "coin") {
        show.position.lerpVectors(stowFrom, WALLET, eased);
        show.quaternion.slerpQuaternions(stowRotation, viewRotation, eased);
        holder.rotation.y = Math.atan2(Math.sin(stowSpin), Math.cos(stowSpin)) * (1 - eased);
        if (!reducedCatchMotion) coinFlight?.(show.position, show.quaternion, eased);
      } else if (shown?.kind === "fish") {
        show.position.lerpVectors(stowFrom, BUCKET, eased);
        if (!reducedCatchMotion) show.position.y += arc(k) * 0.35;
        show.quaternion.slerpQuaternions(stowRotation, bucketRotation, eased);
        if (!reducedCatchMotion) holder.rotation.y = stowSpin + 0.9 * STOW_SECONDS * (k - k * k / 2);
      } else if (shown?.kind === "figure" && !reducedCatchMotion) {
        show.position.lerpVectors(stowFrom, FIGURE_EXIT, eased);
        holder.rotation.y = stowSpin + 0.9 * stowing;
      }
      const endScale = shown?.kind === "coin" ? walletScale : shown?.kind === "figure" && !reducedCatchMotion ? stowScale * 0.85 : 0.015;
      show.scale.setScalar(THREE.MathUtils.lerp(stowScale, endScale, eased));
      if (k >= 1) {
        if (shown?.kind !== "fish") burst(show.position.clone(), 0xffe6a0);
        if (shown?.kind === "coin") coinCollected?.();
        const next = queued; queued = null; clearShow();
        if (next) showCatch(next);
      }
    });
    // A fish leaps in a short arc every few seconds, somewhere on the water.
    const fish = placeProp(parent, "fish", { height: 0.32, x: 0, y: -1, z: 0, yaw: 0 }).group;
    let leap = { at: 3, x: 0, z: 0, heading: 0 }, fishing = false;
    // At rest the bobber hangs a little under the rod's tip, swaying.
    const restOf = (time: number, into: THREE.Vector3) => { rod.updateMatrix(); return into.set(0, 0, -ROD).applyMatrix4(rod.matrix).add(new THREE.Vector3(Math.sin(time * 1.1) * 0.03, -0.55, Math.cos(time * 0.9) * 0.02)); };
    let clock = 0;
    const rest = restOf(0, new THREE.Vector3());
    bobber.position.copy(rest);
    // A cast: the rod swings back and flicks, the bobber arcs out and plops. It bobs, a fish may
    // nibble (small dips: leave them), then it bites: the bobber plunges, and a tap within the
    // second hooks it. Too soon spooks the fish; too late and it is gone.
    const BITE_WINDOW = 1.05;
    type Line = { phase: "cast" | "wait" | "bite" | "hooked" | "lost"; at: number; out: THREE.Vector3; biteAt: number; nibbles: number[]; heard: number; result: CastResult };
    let current: Line | null = null;
    actions.cast = (action, cue, done) => {
      if (action.kind !== "cast") return;
      coinCollected = () => cue("coinCollected");
      stow(); fishing = true;
      const prize = action.catch.kind !== "fish";
      const out = prize ? GLINT.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3))
        : new THREE.Vector3(-1.6 + Math.random() * 2.8, 0, -2.9 + Math.random() * 2.4);
      const from = bobber.position.clone();
      const biteAt = 2.8 + Math.random() * 3.2, nibbles = Array.from({ length: Math.floor(Math.random() * 3) }, () => 2 + Math.random() * (biteAt - 2.7)).sort((a, b) => a - b);
      const state: Line = { phase: "cast", at: 0, out, biteAt, nibbles, heard: 0, result: "missed" };
      current = state;
      let finished = false;
      const finish = (result: CastResult) => { if (!finished) { finished = true; done(result); } };
      play((t) => {
        const since = t - state.at;
        mark.visible = state.phase === "bite";
        closing.visible = state.phase === "bite";
        if (state.phase === "cast") {
          rod.rotation.x = t < 0.4 ? REST + t / 0.4 * 0.75 : t < 0.6 ? REST + 0.75 - (t - 0.4) / 0.2 * 1.05 : REST - 0.3;
          sag = 0.05;
          if (t >= 0.6) { const k = Math.min(1, (t - 0.6) / 0.7); bobber.position.lerpVectors(from, out, k); bobber.position.y = from.y * (1 - k) + Math.sin(Math.PI * k) * 1.5; }
          if (t >= 1.3) { state.phase = "wait"; state.at = t; splash(out, 1.2); cue("splash"); }
        } else if (state.phase === "wait") {
          rod.rotation.x = REST - 0.3 + Math.sin(t * 1.3) * 0.015;
          sag = Math.min(1, since * 2);
          let dip = 0;
          for (const at of state.nibbles) if (t >= at && t < at + 0.28) dip = Math.sin((t - at) / 0.28 * Math.PI) * 0.06;
          if (state.heard < state.nibbles.length && t >= state.nibbles[state.heard]) { state.heard++; splash(out, 0.4); cue("nibble"); }
          bobber.position.set(out.x, Math.sin(t * 5) * 0.012 - dip, out.z);
          if (t >= state.biteAt) { state.phase = "bite"; state.at = t; splash(out, 1.6); cue("bite"); }
        } else if (state.phase === "bite") {
          rod.rotation.x = REST - 0.36 - Math.abs(Math.sin(t * 18)) * 0.05;
          sag = 0;
          bobber.position.set(out.x + Math.sin(t * 31) * 0.03, -0.13 - Math.abs(Math.sin(t * 22)) * 0.05, out.z + Math.cos(t * 27) * 0.03);
          const k = Math.min(1, since / BITE_WINDOW), pop = Math.min(1, since / 0.12);
          mark.position.set(out.x, 0.85 + Math.sin(t * 14) * 0.03, out.z); mark.scale.set(0.34, 0.68, 1).multiplyScalar(pop * (1 + 0.25 * Math.sin(Math.min(1, since / 0.25) * Math.PI)));
          closing.position.set(out.x, 0.04, out.z); closing.scale.setScalar(0.9 - k * 0.68); (closing.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.5 * k;
          if (since > 0.45 && since - 1 / 60 <= 0.45) splash(out, 1);
          if (since >= BITE_WINDOW) { state.phase = "lost"; state.at = t; state.result = "missed"; cue("escape"); }
        } else if (state.phase === "hooked") {
          if (!catchReady) { state.at = t; return true; }
          // The rod jerks up; the catch leaps from the water to its place before the camera.
          rod.rotation.x = REST - 0.36 + Math.min(1, since / 0.18) * 0.9 - Math.max(0, Math.min(1, (since - 0.6) / 0.8)) * 0.6;
          sag = 0;
          const k = Math.min(1, since / REVEAL_SECONDS);
          revealProgress = k;
          show.visible = true;
          bobber.position.lerp(restOf(clock, rest), Math.min(1, since / 0.7));
          if (k >= 1 && !finished) { burst(SHOW.clone(), 0xffe6a0); cue("burst"); finish("caught"); }
          if (k >= 1) { fishing = false; current = null; return false; }
        } else {
          // Lost: the bobber pops up empty and is reeled back to the rod.
          rod.rotation.x = THREE.MathUtils.lerp(rod.rotation.x, REST, Math.min(1, since * 4));
          sag = 0.3;
          const k = Math.min(1, since / 0.7);
          bobber.position.lerpVectors(out, restOf(clock, rest), k); bobber.position.y += Math.sin(Math.PI * k) * 0.5;
          if (k >= 1) { finish(state.result); fishing = false; current = null; return false; }
        }
        return true;
      });
      // The catch is placed now, hidden, so it is loaded by the time it leaps.
      if (stowing >= 0) queued = action.catch; else showCatch(action.catch);
    };
    pokes.hook = () => {
      const state = current;
      if (!state || !acting) return;
      if (state.phase === "bite") {
        state.phase = "hooked"; state.at = acting.t; revealProgress = 0;
        launchRotation.setFromEuler(new THREE.Euler(0.2, Math.atan2(SHOW.x - state.out.x, SHOW.z - state.out.z), -0.4));
        mark.visible = closing.visible = false; splash(state.out, 1.8); burst(state.out.clone().setY(0.4), 0xbfe8ff);
      }
      // A tap before the bite scares the fish off (taps while the bobber is still flying are ignored).
      else if (state.phase === "wait") { state.phase = "lost"; state.at = acting.t; state.result = "spooked"; splash(state.out, 0.8); }
    };
    pokes.dismiss = () => {
      if (!shown || revealProgress < 1 || stowing >= 0) return;
      stow();
    };
    setPrizes = (left) => { glintWanted = left > 0 ? 1 : 0; };
    // Use the same gold silhouette as the other world controls, without moving the tackle.
    hover = (part) => { hoveredPart = part === "water" ? "rod" : part; };
    // Back at rest: the rod settles in its holder, the bobber hangs from its tip.
    animate.push((delta, time) => {
      clock = time;
      if (fishing) return;
      rod.rotation.x = THREE.MathUtils.damp(rod.rotation.x, REST, 8, delta);
      sag = 0.05;
      if (stowing < 0 || shown?.kind !== "fish" || stowing > 0.2) bobber.position.lerp(restOf(time, rest), Math.min(1, delta * 8));
    });
    animate.push((_, time) => {
      const t = time - leap.at;
      if (t > 1.1) { const angle = Math.random() * Math.PI * 2, radius = 1.2 + Math.random() * 2; leap = { at: time + 2 + Math.random() * 4, x: Math.sin(angle) * radius, z: Math.cos(angle) * radius * 0.7 - 0.8, heading: Math.random() * Math.PI * 2 }; }
      const k = t / 0.9;
      // Not by the line while it is out: the fish there are on the hook's business.
      fish.visible = k >= 0 && k <= 1 && !(fishing && current && Math.hypot(leap.x - current.out.x, leap.z - current.out.z) < 1.5);
      if (!fish.visible) return;
      fish.position.set(leap.x + Math.cos(leap.heading) * (k - 0.5) * 0.9, Math.sin(Math.PI * k) * 0.7 - 0.08, leap.z + Math.sin(leap.heading) * (k - 0.5) * 0.9);
      fish.rotation.set(0, -leap.heading, (0.5 - k) * 2.2);
    });
  }
  const ready = Promise.all(props).then((groups) => {
    if ((kind === "pond" || kind === "crate") && !disposed) {
      const parts: THREE.Object3D[] = [];
      parent.traverse((object) => { if (object.userData.part && object.userData.part !== "water") parts.push(object); });
      for (const part of parts) {
        const meshes: THREE.Mesh[] = [];
        part.traverse((object) => { if (object instanceof THREE.Mesh && !object.userData.outline && (Array.isArray(object.material) ? object.material : [object.material]).some((material) => material.visible)) meshes.push(object); });
        partOutlines.set(part.userData.part, hoverOutline(meshes, 0xffcf7a, 0.03));
      }
    }
    const meshes = [...frame];
    groups.forEach((group) => group.traverse((object) => { if ((object as THREE.Mesh).isMesh && !object.userData.outline) meshes.push(object as THREE.Mesh); }));
    return meshes;
  });
  return {
    frame, ready, cubbies,
    // Shows the daily crate's streak: days opened, and today's day if it is still to open.
    setStreak(opened: number, today: number | null) { paintStreak?.(opened, today); },
    // The pond: how many prize catches remain today (they glint under the water).
    setPrizes(left: number) { setPrizes?.(left); },
    // The working part under the pointer.
    hover(part: string | null) { hover?.(part); },
    present(camera: THREE.PerspectiveCamera | null, reducedMotion = false, coinTarget: { x: number; y: number; width?: number } | null = null) { presentCatch?.(camera, reducedMotion, coinTarget); },
    dispose() { disposed = true; clearCatch?.(); chestAnimation?.dispose(); partOutlines.forEach((outline) => outline.dispose()); },
    // Acts out an action this facility has (the wheel spins, the pond casts, the crate opens).
    act(action: FacilityAction, cue: (cue: ActionCue) => void, done: (result?: CastResult) => void) {
      const run = actions[action.kind];
      if (run) run(action, cue, done); else done();
    },
    // A tap on the facility while it acts: at the pond, a strike at the bite.
    poke(kind: "hook" | "dismiss") { pokes[kind]?.(); },
    update(delta: number, time: number) {
      partOutlines.forEach((outline, part) => outline.update(hoveredPart === part ? 1 : 0, delta));
      animate.forEach((step) => step(delta, time));
      if (acting) { acting.t += Math.min(delta, 0.1); if (!acting.step(acting.t)) acting = null; }
      sparks.forEach((spark) => {
        spark.age += delta; spark.sprite.visible = spark.age < 1.2;
        if (!spark.sprite.visible) return;
        spark.velocity.y -= 6 * delta; spark.sprite.position.addScaledVector(spark.velocity, delta);
        spark.sprite.scale.setScalar(0.12); spark.sprite.material.opacity = 1 - spark.age / 1.2;
      });
    },
  };
}
