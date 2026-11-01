import * as THREE from "three";
import { woodTexture } from "@/lib/figurine-shop";
import type { PlaceProp } from "@/lib/figurine-props";
import { WHEEL, type FigurineQuality, type FishId } from "@/lib/figurine-collection";
import { applyFinish, releaseFinishes } from "@/lib/figurine-finish";

// The plaza's facilities other than the shop and the two machines. Each is a small scene of game
// props, some round a hand-built centrepiece, standing in the world unsigned: a mailbox is just a
// mailbox until you tap it. Every one is a station: tap it and the camera goes there, and its panel
// opens in the page. Local space: the station faces +z (toward the plaza), x runs along its front.
export type Facility = "gallery" | "crate" | "wheel" | "mail" | "quests" | "feed" | "fame" | "leaderboard" | "trading" | "pond";
// What a facility can act out when its panel asks: the wheel spins to a segment, the crate bursts
// open, the pond casts a line with `catch` on the end of it. Cues mark moments worth a sound (and,
// at the pond, what the line is doing); `done` ends the action, the pond's with how it went.
export type FacilityAction = { kind: "spin"; segment: number } | { kind: "cast"; catch: CatchVisual } | { kind: "open" };
export type ActionCue = "tick" | "splash" | "nibble" | "bite" | "escape" | "catch" | "burst";
export type CastResult = "caught" | "missed" | "spooked";
// What comes up when a line is hooked: a prize (a wrapped box, a little chest holding a figure),
// or a fish (or boot) of the given length, at its finish.
export type CatchVisual = { kind: "box" } | { kind: "figure" } | { kind: "fish"; fish: FishId; length: number; quality: FigurineQuality };
// The game model each catch shows as.
const FISH_PROP: Record<FishId, Parameters<PlaceProp>[1]> = {
  smallfish: "fishGreen", mudsnapper: "fishOrange", catfish: "fishPale", blackmouth: "fishBlue", firefin: "fishSpiny",
  deviate: "fishPurple", yellowtail: "fishGold", eel: "fishEel", salmon: "fishPink", mightfish: "fishBig", boot: "boot",
};
// How each wheel prize is painted: its label and colour.
const PRIZE_PAINT = (prize: (typeof WHEEL)[number]["prize"]) => "boost" in prize
  ? prize.boost === "galaxy" ? { label: "✦", color: "#6b45c8", ink: "#f1e9ff" } : { label: "★", color: "#e8c165", ink: "#3a2506" }
  : "figure" in prize ? { label: "?", color: "#1f8a86", ink: "#e9fffd" }
  : { label: `+${prize.boxes}`, color: ["#2f6fae", "#3e8f52", "#c2412e"][prize.boxes - 1], ink: "#fff4dc" };

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  return [element, element.getContext("2d")!] as const;
}
const srgb = (element: HTMLCanvasElement) => { const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map; };
export function buildFacility(parent: THREE.Group, kind: Facility, { placeProp, envMap }: { placeProp: PlaceProp; envMap: THREE.Texture }) {
  // What the hover outline wraps: built parts now, game props once they have loaded.
  const frame: THREE.Mesh[] = [], props: Promise<THREE.Group>[] = [];
  // The action playing now, stepped each frame; null when idle.
  let acting: { step: (t: number) => boolean; t: number } | null = null;
  const actions: Partial<Record<FacilityAction["kind"], (action: FacilityAction, cue: (cue: ActionCue) => void, done: (result?: CastResult) => void) => void>> = {};
  // Taps on a facility's parts while it acts (the pond: hooking the bite).
  const pokes: Partial<Record<"hook", () => void>> = {};
  const play = (step: (t: number) => boolean) => { acting = { step, t: 0 }; };
  // The crate's streak board, repainted when the streak changes.
  let paintStreak: ((opened: number, today: number | null) => void) | null = null;
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
  const stone = new THREE.MeshStandardMaterial({ color: 0x8d877c, roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a63c, metalness: 1, roughness: 0.3, envMap });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number, target: THREE.Object3D = parent) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; target.add(mesh); return mesh;
  };
  const prop = (name: Parameters<PlaceProp>[1], height: number, x: number, z: number, yaw = -Math.PI / 2, y = 0) => { const placed = placeProp(parent, name, { height, x, y, z, yaw }); props.push(placed.ready); return placed; };
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
    // Daily crate: a chest with gold spilling beside it, and a seven-day streak board on two posts.
    const chest = prop("chest", 0.95, 0, 0.1, -Math.PI / 2).group;
    actions.open = (_, cue, done) => play((t) => {
      const hop = t < 0.9 ? Math.abs(Math.sin(t * Math.PI * 3.3)) * (1 - t / 0.9) * 0.18 : 0;
      chest.position.y = hop; chest.rotation.z = Math.sin(t * 40) * 0.04 * Math.max(0, 1 - t / 0.9);
      chest.scale.setScalar(t > 0.9 && t < 1.15 ? 1 + Math.sin((t - 0.9) / 0.25 * Math.PI) * 0.12 : 1);
      if (t >= 0.9 && t - 1 / 60 < 0.9) { burst(new THREE.Vector3(0, 0.9, 0.1)); cue("burst"); }
      if (t > 2.2) { done(); return false; }
      return true;
    });
    prop("goldPile", 0.26, -0.85, 0.45, 0.3);
    prop("goldPileSmall", 0.18, 0.85, 0.55, 1.4);
    // The streak board: a coin per day, gilded once that day's crate is opened; today's is ringed.
    const [streakCanvas, streak] = canvas(512, 96), streakMap = srgb(streakCanvas);
    paintStreak = (opened: number, today: number | null) => {
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
    frame.push(add(new THREE.BoxGeometry(1.6, 0.3, 0.05), [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: streakMap, roughness: 0.6 }), wood], 0, 1.75, -0.55));
    for (const x of [-0.75, 0.75]) add(new THREE.CylinderGeometry(0.035, 0.04, 1.9, 8), wood, x, 0.95, -0.6);
  } else if (kind === "wheel") {
    // Lucky wheel: a painted wheel of prizes on an A-frame, a pointer at the top; a goblin statue
    // and a barrel of fireworks beside it. It idles with a slow sway.
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
    prop("goblinStatue", 1.45, -1.15, 0.2, -Math.PI / 2 + 0.5);
    prop("fireworks", 0.95, 1.1, 0.25, 0);
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
    // Gifting post: a mailbox, and a table of wrapped gifts.
    prop("postboxHuman", 1.9, -0.6, -0.05, -Math.PI / 2);
    frame.push(add(new THREE.BoxGeometry(1, 0.08, 0.7), wood, 0.55, 0.68, 0.05));
    for (const [x, z] of [[0.2, -0.2], [0.9, -0.2], [0.2, 0.3], [0.9, 0.3]]) add(new THREE.CylinderGeometry(0.035, 0.035, 0.68, 6), wood, x, 0.34, z);
    prop("gift", 0.36, 0.35, 0.05, 0.3, 0.72);
    prop("giftRed", 0.26, 0.78, 0.15, -0.4, 0.72);
    prop("giftWhite", 0.3, 0.6, -0.15, 0.9, 0.72);
  } else if (kind === "quests") {
    // Quest giver: a board of postings under a floating golden "!", scrolls on a crate beside it.
    prop("wanted", 2.5, 0, -0.2, -Math.PI / 2);
    prop("wantedWood", 1.5, 1.2, 0.05, -Math.PI / 2 - 0.35);
    frame.push(add(new THREE.BoxGeometry(0.6, 0.5, 0.5), wood, -1.15, 0.25, 0.15));
    prop("scrollMap", 0.12, -1.15, 0.15, 0.4, 0.5);
    const mark = new THREE.Group(); mark.position.set(0, 3.15, -0.15); parent.add(mark);
    const glow = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffb81c, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.35 });
    add(new THREE.BoxGeometry(0.13, 0.42, 0.13), glow, 0, 0.12, 0, mark);
    add(new THREE.SphereGeometry(0.085, 14, 10), glow, 0, -0.25, 0, mark);
    animate.push((_, time) => { mark.position.y = 3.15 + Math.sin(time * 2) * 0.06; mark.rotation.y = time * 1.2; });
  } else if (kind === "feed") {
    // Pull feed: a scrying ball on a pedestal that glimmers with the latest golden and galaxy
    // pulls, and a crier's bell on a post to ring them in.
    prop("pedestal", 1, 0, 0.05, -Math.PI / 2);
    prop("crystalBall", 0.8, 0, 0.05, -Math.PI / 2, 0.98);
    const shine = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xb28cff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    const [glowCanvas, glowPaint] = canvas(64, 64), gradient = glowPaint.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(1, "rgba(255,255,255,0)"); glowPaint.fillStyle = gradient; glowPaint.fillRect(0, 0, 64, 64);
    shine.material.map = srgb(glowCanvas); shine.position.set(0, 1.5, 0.05); shine.scale.setScalar(1.1); parent.add(shine);
    animate.push((_, time) => { shine.material.opacity = 0.3 + 0.2 * Math.sin(time * 1.7); shine.material.color.setHSL(0.72 + 0.08 * Math.sin(time * 0.4), 0.8, 0.65); });
    frame.push(add(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 8), wood, 1, 1.1, -0.2));
    add(new THREE.BoxGeometry(0.5, 0.06, 0.06), wood, 0.85, 2.1, -0.2);
    const bell = add(new THREE.CylinderGeometry(0.07, 0.17, 0.26, 18, 1, true), gold, 0.68, 1.92, -0.2);
    (bell.material as THREE.Material).side = THREE.DoubleSide;
    animate.push((_, time) => { bell.rotation.z = Math.sin(time * 1.3) * 0.12; });
  } else if (kind === "fame") {
    // Hall of fame: the Elwynn lion on its plinth, a trophy and a museum plaque for the firsts.
    prop("lion", 2.2, -0.95, -0.15, -Math.PI / 2);
    frame.push(add(new THREE.BoxGeometry(0.8, 0.85, 0.6), stone, 0.45, 0.425, -0.1));
    prop("trophy", 0.8, 0.45, -0.1, -Math.PI / 2, 0.85);
    prop("museumPlaque", 0.55, 1.25, 0.25, -Math.PI / 2 - 0.3);
  } else if (kind === "leaderboard") {
    // Leaderboards: a winners' podium (1 in the middle), an obelisk behind, plaques for the boards.
    const step = (place: number, height: number, x: number, color: string) => {
      const [numberCanvas, paint] = canvas(128, 128);
      paint.fillStyle = color; paint.fillRect(0, 0, 128, 128);
      paint.fillStyle = "#1c1612"; paint.font = "700 84px Georgia, serif"; paint.textAlign = "center"; paint.textBaseline = "middle"; paint.fillText(String(place), 64, 70);
      const face = new THREE.MeshStandardMaterial({ map: srgb(numberCanvas), roughness: 0.5 });
      frame.push(add(new THREE.BoxGeometry(0.7, height, 0.7), [stone, stone, stone, stone, face, stone], x, height / 2, 0.15));
    };
    step(2, 0.55, -0.72, "#c9ccd4"); step(1, 0.8, 0, "#e8c165"); step(3, 0.4, 0.72, "#c08a5a");
    prop("obelisk", 3.1, 0, -0.55, -Math.PI / 2);
    prop("plaqueSilver", 0.5, -1.15, 0.45, -Math.PI / 2 + 0.3);
    prop("plaqueBronze", 0.45, 1.15, 0.45, -Math.PI / 2 - 0.3);
  } else if (kind === "trading") {
    // Trading post: a shop counter with a gnomish postbox beside it for the parcels.
    prop("counter", 1.05, 0, 0.1);
    prop("postbox", 1.5, 1.8, -0.1, -Math.PI / 2 - 0.4);
  } else if (kind === "pond") {
    // Fishing pond: still water ringed with reeds and lily pads, a rowboat, a little dock with a
    // fishing chair and rod, and a fish now and then leaping. The station's origin is the pond's
    // centre; the dock runs in from the plaza side (+z).
    const water = new THREE.MeshStandardMaterial({ color: 0x2f6a72, roughness: 0.12, metalness: 0.2, envMap, envMapIntensity: 0.9, transparent: true, opacity: 0.92 });
    const pond = add(new THREE.CircleGeometry(4.2, 64).rotateX(-Math.PI / 2), water, 0, 0.02, 0);
    pond.castShadow = false; frame.push(pond);
    const bank = add(new THREE.RingGeometry(4.1, 4.7, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5b4a33, roughness: 1 }), 0, 0.015, 0);
    bank.castShadow = false;
    for (let i = 0; i < 11; i++) { const angle = i / 11 * Math.PI * 2 + 0.3; if (Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) < 0.5) continue; prop("reeds", 0.8 + (i % 3) * 0.25, Math.sin(angle) * 4.3, Math.cos(angle) * 4.3, angle * 2); }
    for (const [x, z, yaw] of [[-1.8, -1.2, 0.4], [2.2, -1.9, 1.7], [-2.6, 1, 2.9], [0.9, -2.8, 0.8]]) prop("lilypad", 0.08, x, z, yaw, 0.02);
    prop("rowboat", 0.7, -1.6, -2.1, 0.9, 0.02);
    // The dock: planks on posts from the shore out over the water.
    for (let i = 0; i < 9; i++) add(new THREE.BoxGeometry(1.3, 0.06, 0.38), wood, 1.3, 0.32, 5.1 - i * 0.42);
    for (const [x, z] of [[0.7, 1.9], [1.9, 1.9], [0.7, 3.6], [1.9, 3.6]]) add(new THREE.CylinderGeometry(0.06, 0.07, 0.7, 8), wood, x, 0.1, z);
    // The fishing chair waits on the far bank, facing the water, out of the shot's way.
    prop("fishingChair", 1.5, -4.4, -2.8, -0.56);
    // The rod rests on a forked stand at the dock's end, pivoting at its butt; tap it to cast.
    // Its model lies along z with the butt and reel at +z, so it is shifted out by half its length.
    const ROD = 2.5, REST = 0.32;
    const rod = new THREE.Group(); rod.position.set(1.3, 0.46, 2.6); rod.rotation.x = REST; rod.userData.part = "rod"; parent.add(rod);
    props.push(placeProp(rod, "fishingRod", { height: 1, length: ROD, z: -ROD / 2 + 0.1 }).ready);
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    add(new THREE.BoxGeometry(0.7, 0.7, ROD + 0.4), hidden, 0, 0.1, -ROD / 2, rod).castShadow = false;
    for (const side of [-1, 1]) { const stick = add(new THREE.CylinderGeometry(0.025, 0.03, 0.62, 6), wood, 1.3 + side * 0.08, 0.6, 1.6); stick.rotation.z = side * 0.32; }
    const line = add(new THREE.CylinderGeometry(0.005, 0.005, 1, 3), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }), 0, 0, 0);
    line.castShadow = false;
    // The bobber, with a generous invisible float round it so a quick tap finds it.
    const bobber = new THREE.Group(); bobber.userData.part = "bobber"; parent.add(bobber);
    props.push(placeProp(bobber, "bobber", { height: 0.3, y: -0.08, yaw: Math.PI / 2 }).ready);
    add(new THREE.SphereGeometry(0.6, 12, 8), hidden, 0, 0.1, 0, bobber).castShadow = false;
    const tip = new THREE.Vector3(), towards = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const stringLine = () => {
      rod.updateMatrix(); tip.set(0, 0.1, -ROD + 0.1).applyMatrix4(rod.matrix);
      towards.subVectors(bobber.position, tip).y += 0.12;
      line.position.copy(tip).addScaledVector(towards, 0.5); line.scale.set(1, towards.length(), 1);
      line.quaternion.setFromUnitVectors(up, towards.normalize());
    };
    // Rings on the water: a few at once, for nibbles, plops and the bite's churn.
    const ripples = Array.from({ length: 4 }, () => {
      const mesh = add(new THREE.RingGeometry(0.08, 0.12, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }), 0, 0.03, 0);
      mesh.castShadow = false;
      return { mesh, age: 9, strength: 1 };
    });
    let nextRipple = 0;
    const splash = (at: THREE.Vector3, strength = 1) => { const ring = ripples[nextRipple++ % ripples.length]; ring.mesh.position.set(at.x, 0.03, at.z); ring.age = 0; ring.strength = strength; };
    animate.push((delta) => {
      for (const ring of ripples) { ring.age += delta; ring.mesh.scale.setScalar(1 + ring.age * 6 * ring.strength); (ring.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (0.35 + 0.3 * ring.strength) - ring.age * 0.5); }
      stringLine();
    });
    prop("fishRack", 1.6, -2.4, 4.4, -Math.PI / 2 + 0.6);
    prop("fishingBox", 0.45, 2.5, 5.2, 0.4);
    // The catch on show: it leaps from the water to hang over the dock, turning, finished like its
    // quality, until the next cast.
    const SHOW = new THREE.Vector3(0.1, 1.55, 2.2);
    const show = new THREE.Group(); show.visible = false; parent.add(show);
    const holder = new THREE.Group(); show.add(holder);
    const clearShow = () => { show.visible = false; holder.children.forEach((child) => releaseFinishes(child)); holder.clear(); };
    const showCatch = (visual: CatchVisual) => {
      clearShow();
      const placed = visual.kind === "box" ? placeProp(holder, "gift", { height: 0.7, yaw: 0.4 })
        : visual.kind === "figure" ? placeProp(holder, "chest", { height: 0.75, yaw: -Math.PI / 2 })
        // Fish lie on their sides: stood up, they show their flank to the dock.
        : placeProp(holder, FISH_PROP[visual.fish], { height: 1, length: THREE.MathUtils.clamp(visual.length * 1.7, 0.7, 2.2), yaw: Math.PI / 2 });
      if (visual.kind === "fish") { placed.group.rotation.z = Math.PI / 2; if (visual.quality !== "standard") void placed.ready.then((group) => applyFinish(group, visual.quality, envMap)); }
    };
    // A fish leaps in a short arc every few seconds, somewhere on the water.
    const fish = placeProp(parent, "fish", { height: 0.32, x: 0, y: -1, z: 0, yaw: 0 }).group;
    let leap = { at: 3, x: 0, z: 0, heading: 0 }, fishing = false;
    const rest = new THREE.Vector3(1.75, 0.38, 2.15);
    bobber.position.copy(rest);
    // A cast: the rod swings back and flicks, the bobber arcs out and plops. It bobs, a fish may
    // nibble (small dips: leave them), then it bites: the bobber plunges, and a tap within the
    // second hooks it. Too soon spooks the fish; too late and it is gone.
    const BITE_WINDOW = 1.05;
    type Line = { phase: "cast" | "wait" | "bite" | "hooked" | "lost"; at: number; out: THREE.Vector3; biteAt: number; nibbles: number[]; heard: number; result: CastResult };
    let current: Line | null = null;
    actions.cast = (action, cue, done) => {
      if (action.kind !== "cast") return;
      clearShow(); fishing = true;
      const out = new THREE.Vector3(0.5 + (Math.random() - 0.5) * 1.8, 0, -0.5 - Math.random() * 1.6), from = rest.clone();
      const biteAt = 2.8 + Math.random() * 3.2, nibbles = Array.from({ length: Math.floor(Math.random() * 3) }, () => 2 + Math.random() * (biteAt - 2.7)).sort((a, b) => a - b);
      const state: Line = { phase: "cast", at: 0, out, biteAt, nibbles, heard: 0, result: "missed" };
      current = state;
      let finished = false;
      const finish = (result: CastResult) => { if (!finished) { finished = true; done(result); } };
      play((t) => {
        const since = t - state.at;
        if (state.phase === "cast") {
          rod.rotation.x = t < 0.4 ? REST + t / 0.4 * 0.75 : t < 0.6 ? REST + 0.75 - (t - 0.4) / 0.2 * 1.05 : REST - 0.3;
          if (t >= 0.6) { const k = Math.min(1, (t - 0.6) / 0.7); bobber.position.lerpVectors(from, out, k); bobber.position.y = from.y * (1 - k) + Math.sin(Math.PI * k) * 1.5; }
          if (t >= 1.3) { state.phase = "wait"; state.at = t; splash(out, 1.2); cue("splash"); }
        } else if (state.phase === "wait") {
          rod.rotation.x = REST - 0.3 + Math.sin(t * 1.3) * 0.015;
          let dip = 0;
          for (const at of state.nibbles) if (t >= at && t < at + 0.28) dip = Math.sin((t - at) / 0.28 * Math.PI) * 0.06;
          if (state.heard < state.nibbles.length && t >= state.nibbles[state.heard]) { state.heard++; splash(out, 0.4); cue("nibble"); }
          bobber.position.set(out.x, Math.sin(t * 5) * 0.012 - dip, out.z);
          if (t >= state.biteAt) { state.phase = "bite"; state.at = t; splash(out, 1.6); cue("bite"); }
        } else if (state.phase === "bite") {
          rod.rotation.x = REST - 0.36 - Math.abs(Math.sin(t * 18)) * 0.05;
          bobber.position.set(out.x + Math.sin(t * 31) * 0.03, -0.13 - Math.abs(Math.sin(t * 22)) * 0.05, out.z + Math.cos(t * 27) * 0.03);
          if (since > 0.45 && since - 1 / 60 <= 0.45) splash(out, 1);
          if (since >= BITE_WINDOW) { state.phase = "lost"; state.at = t; state.result = "missed"; cue("escape"); }
        } else if (state.phase === "hooked") {
          // The rod jerks up; the catch leaps from the water to its place over the dock.
          rod.rotation.x = REST - 0.36 + Math.min(1, since / 0.18) * 0.9 - Math.max(0, Math.min(1, (since - 0.6) / 0.8)) * 0.6;
          const k = Math.min(1, since / 0.8);
          show.visible = true;
          show.position.lerpVectors(out, SHOW, k); show.position.y = SHOW.y * k + Math.sin(Math.PI * k) * 1.1;
          show.rotation.set(0, since * 2.2, (1 - k) * 2.5);
          bobber.position.lerp(rest, Math.min(1, since / 0.7));
          if (k >= 1 && !finished) { burst(SHOW.clone(), 0xffe6a0); cue("burst"); finish("caught"); }
          if (since > 0.8) show.position.y = SHOW.y + Math.sin(since * 2) * 0.05;
          if (since > 1.6) { fishing = false; current = null; return false; }
        } else {
          // Lost: the bobber pops up empty and is reeled back to the dock.
          rod.rotation.x = THREE.MathUtils.lerp(rod.rotation.x, REST, Math.min(1, since * 4));
          const k = Math.min(1, since / 0.7);
          bobber.position.lerpVectors(out, rest, k); bobber.position.y += Math.sin(Math.PI * k) * 0.5;
          if (k >= 1) { finish(state.result); fishing = false; current = null; return false; }
        }
        return true;
      });
      // The catch is placed now, hidden, so it is loaded by the time it leaps.
      showCatch(action.catch);
    };
    pokes.hook = () => {
      const state = current;
      if (!state || !acting) return;
      if (state.phase === "bite") { state.phase = "hooked"; state.at = acting.t; splash(state.out, 1.8); burst(state.out.clone().setY(0.4), 0xbfe8ff); }
      // A tap before the bite scares the fish off (taps while the bobber is still flying are ignored).
      else if (state.phase === "wait") { state.phase = "lost"; state.at = acting.t; state.result = "spooked"; splash(state.out, 0.8); }
    };
    // Back at rest: the rod settles on its stand, the bobber waits on the dock.
    animate.push(() => { if (!fishing) { rod.rotation.x = THREE.MathUtils.lerp(rod.rotation.x, REST, 0.1); if (!show.visible) bobber.position.copy(rest); } });
    animate.push((_, time) => { if (show.visible && !current) { show.rotation.y = time * 0.9; show.position.y = SHOW.y + Math.sin(time * 2) * 0.05; } });
    animate.push((delta, time) => {
      const t = time - leap.at;
      if (t > 1.1 && !fishing) { const angle = Math.random() * Math.PI * 2, radius = 1 + Math.random() * 2.2; leap = { at: time + 2 + Math.random() * 4, x: Math.sin(angle) * radius, z: Math.cos(angle) * radius * 0.7 - 0.6, heading: Math.random() * Math.PI * 2 }; }
      const k = t / 0.9;
      fish.visible = k >= 0 && k <= 1;
      if (!fish.visible) return;
      fish.position.set(leap.x + Math.cos(leap.heading) * (k - 0.5) * 0.9, Math.sin(Math.PI * k) * 0.7 - 0.08, leap.z + Math.sin(leap.heading) * (k - 0.5) * 0.9);
      fish.rotation.set(0, -leap.heading, (0.5 - k) * 2.2);
    });
  }
  const ready = Promise.all(props).then((groups) => {
    const meshes = [...frame];
    groups.forEach((group) => group.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); }));
    return meshes;
  });
  return {
    frame, ready, cubbies,
    // Shows the daily crate's streak: days opened, and today's day if it is still to open.
    setStreak(opened: number, today: number | null) { paintStreak?.(opened, today); },
    // Acts out an action this facility has (the wheel spins, the pond casts, the crate opens).
    act(action: FacilityAction, cue: (cue: ActionCue) => void, done: (result?: CastResult) => void) {
      const run = actions[action.kind];
      if (run) run(action, cue, done); else done();
    },
    // A tap on the facility while it acts: at the pond, a strike at the bite.
    poke(kind: "hook") { pokes[kind]?.(); },
    update(delta: number, time: number) {
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
