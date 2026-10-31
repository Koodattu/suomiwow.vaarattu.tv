import * as THREE from "three";
import { woodTexture } from "@/lib/figurine-shop";
import type { PlaceProp } from "@/lib/figurine-props";
import { WHEEL } from "@/lib/figurine-collection";

// The plaza's facilities other than the shop and the two machines. Each is a small scene of game
// props, some round a hand-built centrepiece, standing in the world unsigned: a mailbox is just a
// mailbox until you tap it. Every one is a station: tap it and the camera goes there, and its panel
// opens in the page. Local space: the station faces +z (toward the plaza), x runs along its front.
export type Facility = "gallery" | "crate" | "wheel" | "mail" | "quests" | "feed" | "fame" | "leaderboard" | "trading" | "pond";
// What a facility can act out when its panel asks: the wheel spins to a segment, the pond plays a
// cast and a catch, the crate bursts open. `tick` marks moments worth a sound; `done` ends it.
export type FacilityAction = { kind: "spin"; segment: number } | { kind: "cast" } | { kind: "open" };
export type ActionCue = "tick" | "splash" | "bite" | "catch" | "burst";
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
  const actions: Partial<Record<FacilityAction["kind"], (action: FacilityAction, cue: (cue: ActionCue) => void, done: () => void) => void>> = {};
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
  if (kind === "gallery") {
    // The collection: a bookcase of albums and the collector's book open on a pedestal.
    prop("bookcase", 2.7, 0, -0.45);
    prop("pedestal", 1.05, 0, 0.45, -Math.PI / 2);
    prop("book", 0.32, 0, 0.45, -Math.PI / 2 + 0.25, 1.05);
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
    // The fishing chair waits on the bank, out of the angler's way.
    prop("fishingChair", 1.5, 3.4, 4.6, Math.PI / 2 + 0.7);
    // The rod pivots at its butt by the chair; the line runs from its tip to the bobber.
    const rod = new THREE.Group(); rod.position.set(1.55, 0.62, 2.35); rod.rotation.x = -0.75; parent.add(rod);
    add(new THREE.CylinderGeometry(0.012, 0.024, 2.4, 6), wood, 0, 1.2, 0, rod);
    const line = add(new THREE.CylinderGeometry(0.004, 0.004, 1, 3), new THREE.MeshBasicMaterial({ color: 0xeeeeee }), 0, 0, 0);
    line.castShadow = false;
    const bobber = add(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd8382c, roughness: 0.4 }), 1.55, 0.05, 0.48);
    const tip = new THREE.Vector3(), towards = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const stringLine = () => {
      rod.updateMatrix(); tip.set(0, 2.4, 0).applyMatrix4(rod.matrix);
      towards.subVectors(bobber.position, tip);
      line.position.copy(tip).addScaledVector(towards, 0.5); line.scale.set(1, towards.length(), 1);
      line.quaternion.setFromUnitVectors(up, towards.normalize());
    };
    const ripple = add(new THREE.RingGeometry(0.08, 0.12, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }), 0, 0.03, 0);
    ripple.castShadow = false;
    let rippleAge = 9;
    const splash = (at: THREE.Vector3) => { ripple.position.set(at.x, 0.03, at.z); rippleAge = 0; };
    animate.push((delta) => {
      rippleAge += delta; ripple.scale.setScalar(1 + rippleAge * 6); (ripple.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.6 - rippleAge * 0.5);
      stringLine();
    });
    prop("fishRack", 1.6, -2.4, 4.4, -Math.PI / 2 + 0.6);
    prop("fishingBox", 0.45, 2.5, 5.2, 0.4);
    // A fish leaps in a short arc every few seconds, somewhere on the water.
    const fish = placeProp(parent, "fish", { height: 0.32, x: 0, y: -1, z: 0, yaw: 0 }).group;
    let leap = { at: 3, x: 0, z: 0, heading: 0 }, clock = 0, fishing = false;
    const rest = new THREE.Vector3(1.55, 0.05, 0.48);
    // A cast: lift, flick, the bobber arcs out and plops; it bobs, dips twice at the bite, the rod
    // jerks back and the catch leaps from the water toward the dock.
    actions.cast = (_, cue, done) => {
      fishing = true;
      const from = rest.clone(), out = new THREE.Vector3(1.2 + (Math.random() - 0.5) * 1.4, 0.05, -0.8 - Math.random() * 1.2);
      const cues = new Set<string>();
      const once = (name: ActionCue, at: number, t: number) => { if (t >= at && !cues.has(name)) { cues.add(name); cue(name); return true; } return false; };
      play((t) => {
        rod.rotation.x = t < 0.4 ? -0.75 - t / 0.4 * 0.5 : t < 0.6 ? -1.25 + (t - 0.4) / 0.2 * 0.85 : t < 2.6 ? -0.4 - Math.sin(t * 3) * 0.02 : t < 2.85 ? -0.4 - (t - 2.6) / 0.25 * 0.8 : -1.2 + Math.min(1, (t - 2.85) / 0.6) * 0.45;
        if (t >= 0.6 && t < 1.3) { const k = (t - 0.6) / 0.7; bobber.position.lerpVectors(from, out, k); bobber.position.y = 0.05 + Math.sin(Math.PI * k) * 1.4; }
        else if (t >= 1.3 && t < 2.85) { bobber.position.set(out.x, 0.05 + Math.sin(t * 6) * 0.015 - (t > 2.25 ? Math.abs(Math.sin((t - 2.25) * 16)) * 0.07 : 0), out.z); }
        if (once("splash", 1.3, t)) splash(out);
        if (once("bite", 2.3, t)) splash(out);
        if (once("catch", 2.85, t)) { leap = { at: clock, x: out.x, z: out.z, heading: Math.atan2(rest.z - out.z, rest.x - out.x) }; splash(out); burst(new THREE.Vector3(out.x, 0.6, out.z), 0xbfe8ff); }
        if (t >= 2.85) bobber.position.lerp(rest, Math.min(1, (t - 2.85) / 0.5));
        if (t > 3.9) { fishing = false; done(); return false; }
        return true;
      });
    };
    animate.push((delta, time) => {
      clock = time;
      if (!fishing) bobber.position.y = 0.05 + Math.sin(time * 2.4) * 0.015;
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
    frame, ready,
    // Shows the daily crate's streak: days opened, and today's day if it is still to open.
    setStreak(opened: number, today: number | null) { paintStreak?.(opened, today); },
    // Acts out an action this facility has (the wheel spins, the pond casts, the crate opens).
    act(action: FacilityAction, cue: (cue: ActionCue) => void, done: () => void) {
      const run = actions[action.kind];
      if (run) run(action, cue, done); else done();
    },
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
