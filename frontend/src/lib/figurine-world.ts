import * as THREE from "three";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { loadFigurineImage } from "@/lib/figurine-image";
import { buildForest, forestLayout, marketLayout, POND, swayMaterial, type Keep } from "@/lib/figurine-forest";

// The collectibles world: a painted sky bubble over a forest clearing. A cobbled square holds the
// opening pedestal at its centre, and the destinations ring it in groups with open ground between
// them. Clockwise from the shop (north-west, fixed): the daily fair (chest, quests, wheel), the
// collection, the honours terrace (town bell, hall of fame, leaderboards), the pond (south-east,
// fixed, with nothing built near its banks), the working yard (forge, recycler), and the trading
// street (player trading, mail, deals) back round to the shop. Paths leave through the gaps; scenery
// gathers behind the districts, while showcase figures stand along both the plaza edge and the
// outer neighbourhoods.
// The overview is home; the centre holds the opening pedestal and the other destinations are stations.
export type Station = "shop" | "gallery" | "recycler" | "forge" | "crate" | "wheel" | "mail" | "quests" | "feed" | "fame" | "leaderboard" | "trading" | "merchant" | "pond";
// The stations that stand together, each group entered as a whole before one of them is chosen.
export const DISTRICTS = {
  fair: ["crate", "quests", "wheel"],
  yard: ["forge", "recycler"],
  market: ["trading", "mail", "merchant"],
  honours: ["feed", "fame", "leaderboard"],
} as const satisfies Record<string, readonly Station[]>;
export type District = keyof typeof DISTRICTS;
export type WorldView = Station | District | "overview" | "opening" | "viewer";
export const isDistrict = (view: WorldView): view is District => view in DISTRICTS;
export const isStation = (view: WorldView): view is Station => view !== "overview" && view !== "opening" && view !== "viewer" && !isDistrict(view);
// The views the camera is directed to, as opposed to the free views of the square.
export const isShot = (view: WorldView) => isStation(view) || isDistrict(view);
// Two views of one district: the camera only leans between them.
const homeDistrict = (view: WorldView) => isDistrict(view) ? view : isStation(view) ? districtOf(view) : null;
export const sameDistrict = (a: WorldView, b: WorldView) => !!homeDistrict(a) && homeDistrict(a) === homeDistrict(b);
export const districtOf = (station: Station) => (Object.keys(DISTRICTS) as District[]).find((name) => (DISTRICTS[name] as readonly Station[]).includes(station)) ?? null;
// Where a tap on a station leads: into its district first, then on to the station itself.
export function tapDestination(view: WorldView, station: Station): WorldView {
  const district = districtOf(station);
  return !district || view === district || (isStation(view) && districtOf(view) === district) ? station : district;
}
// The cobbled square, and the clearing round it that the woods leave open.
export const COBBLE_RADIUS = 11.2, PLAZA_RADIUS = 19.5;
// Each station: where it stands (\`at\`, x and z; +z is toward the home camera) and the point it
// faces (\`face\`, default the centre: most face their path or the square), its footprint (\`width\`
// along its front, `back`/`front` behind and before its origin, for the camera's occlusion
// test), and, standing alone, its shot: camera height and distance, target height, the width that
// must fit, and how far (times its distance) it may back off to fit it. A station of a district
// has no shot of its own: the camera stays on the district's and leans toward it.
type StationSpec = { at: [number, number]; face?: [number, number]; width: number; back: number; front: number; shot?: { height: number; distance: number; target: number; fit: number; reach?: number } };
export const STATION_SPECS: Record<Station, StationSpec> = {
  // The shop anchors the north-west.
  shop: { at: [-8.8, -8.2], face: [-4, -2.4], width: 6.6, back: -1.1, front: 1.8, shot: { height: 1.3, distance: 9.4, target: 2.45, fit: 6.6 } },
  // The daily fair, along the north edge.
  crate: { at: [-2.2, -13.5], width: 2.6, back: -0.8, front: 1 },
  quests: { at: [2.6, -14.1], width: 3.8, back: -0.6, front: 1.7 },
  wheel: { at: [7.6, -11.8], width: 3.2, back: -0.6, front: 0.9 },
  // The collection stands alone between the fair and the honours terrace.
  gallery: { at: [11.7, -5.9], width: 5.8, back: -0.7, front: 1.3, shot: { height: 1.2, distance: 8, target: 2.3, fit: 5.4, reach: 1.7 } },
  // The honours terrace: the town bell, the hall and the podium, spaced along the east edge.
  feed: { at: [15.6, 0.1], width: 4, back: -0.9, front: 0.9 },
  fame: { at: [15, 4.5], width: 2.8, back: -1.2, front: 0.9 },
  leaderboard: { at: [13.4, 8.5], width: 4.6, back: -1.1, front: 1 },
  // The working yard: the forge and the recycler side by side, past the pond.
  forge: { at: [-4.5, 14.4], face: [-2, 6], width: 3.6, back: -1.5, front: 1 },
  recycler: { at: [-9.2, 12.4], face: [-4.4, 6], width: 4.4, back: -1.6, front: 1.3 },
  // The trading street, running north up the west edge toward the shop.
  trading: { at: [-13.4, 5.9], width: 4.8, back: -1.65, front: 1.65 },
  mail: { at: [-14.8, 1.4], width: 2.4, back: -0.7, front: 0.8 },
  merchant: { at: [-14.2, -2.8], width: 4.4, back: -1.6, front: 1.6 },
  // The pond is seen from behind the foot of its dock, over the whole dock to the water beyond.
  pond: { at: [POND.x, POND.z], face: [4, 10], width: 6, back: -3, front: 3, shot: { height: 3.6, distance: 10, target: 0.1, fit: 6, reach: 1.75 } },
};
export const STATIONS = Object.fromEntries(Object.entries(STATION_SPECS).map(([name, spec]) => {
  const [fx, fz] = spec.face ?? [0, 0];
  return [name, { position: new THREE.Vector3(spec.at[0], 0, spec.at[1]), rotation: Math.atan2(fx - spec.at[0], fz - spec.at[1]) }];
})) as Record<Station, { position: THREE.Vector3; rotation: number }>;
// Each district's shot: from the square on a wide screen, the whole group side by side. A phone is
// too narrow for that, so it looks down from high along the row, stacking them up the screen.
export const DISTRICT_SHOTS: Record<District, Record<"wide" | "tall", { position: [number, number, number]; target: [number, number, number] }>> = {
  fair: { wide: { position: [2.8, 6.2, -2.6], target: [2.8, 0.9, -13.4] }, tall: { position: [-10.8, 21.5, -6.8], target: [2.7, 0.2, -13.1] } },
  yard: { wide: { position: [-3.6, 5.6, 3.8], target: [-7, 1, 13.4] }, tall: { position: [-15, 14.4, 5.2], target: [-6.8, -0.6, 13.4] } },
  market: { wide: { position: [-3.6, 6.2, 1.4], target: [-14.2, 0.9, 1.5] }, tall: { position: [-6.7, 19.2, 17.5], target: [-14.1, 0.2, 1.5] } },
  honours: { wide: { position: [4.2, 6.2, 2.6], target: [14.8, 0.9, 4.4] }, tall: { position: [4.8, 19.9, 16.2], target: [14.7, 0.2, 4.4] } },
};
// How far a station's view leans from its district's shot: the share of the way the aim turns to
// it, and the share of the distance the camera drifts in.
const LEAN = { turn: 0.3, drift: 0.07 };
function districtPose(district: District, aspect: number) {
  const { wide, tall } = DISTRICT_SHOTS[district], shot = aspect < 1 ? tall : wide;
  const target = new THREE.Vector3(...shot.target), position = new THREE.Vector3(...shot.position);
  // A screen narrower than the shot was composed for backs off along it to keep the whole group.
  return { target, position: position.sub(target).multiplyScalar(aspect < 1 ? 1 : Math.max(1, 1.6 / aspect)).add(target) };
}
// The worn paths off the square, as points along their middles.
export const PATHS: [number, number][][] = [
  [[-4.6, -9.2], [-4.9, -12.2], [-4.4, -17], [-1.4, -21], [0.3, -24], [2.4, -30], [3.6, -40]],
  [[9, -1.5], [13.4, -2], [17.4, -3.4], [23, -5.4], [30, -3]],
  [[-7.6, 6.2], [-11.2, 9.1], [-15.2, 12.2], [-19.5, 17.2], [-24, 22]],
  [[1.7, 10.2], [1.2, 13], [2.1, 16.5], [1.6, 22], [-0.5, 29]],
];
// An inner layer beside the facilities and an outer layer at their gardens and paths. Leave
// the opening pedestal's middle of the plaza empty. Each visitor looks roughly toward it.
export const STATUE_SPOTS = ([
  [-5, 10], [-11, 3], [-8.5, -3.5], [-3.5, -8.5], [4, -10], [10.5, -3.5], [8.5, 7.5], [0, 9.5],
  [-7.5, 18], [-18, 7.5], [-16.5, -7], [-6, -14.5], [6, -15.6], [14.5, -6], [18, 7.5], [-1, 13],
] as [number, number][]).map(([x, z], index) => ({ number: index + 1, position: new THREE.Vector3(x, 0, z), rotation: Math.atan2(-x, -z) + Math.sin(index * 2.4) * 0.5 }));
// Lamp posts along the paths.
export const LAMP_SPOTS: [number, number][] = [[-6.8, -17], [-1.7, -18.6], [15.2, -4], [19, -1.8], [-13.2, 12.6], [-17.6, 11.8], [-0.4, 15.4], [-1.2, 20.4]];
// Sample the entire path, not just its control points: vegetation must not close the gaps
// between them. Figure spots also need a clearing when the outer woods are generated.
export const FOREST_CLEARINGS: Keep[] = [
  ...Object.values(STATION_SPECS).map(({ at, width }): Keep => [at[0], at[1], width / 2 + 2.5]),
  ...STATUE_SPOTS.map(({ position }): Keep => [position.x, position.z, 1.8]),
  ...LAMP_SPOTS.map(([x, z]): Keep => [x, z, 1.2]),
  ...PATHS.flatMap((path) => path.slice(1).flatMap(([x, z], index) => {
    const [px, pz] = path[index], steps = Math.ceil(Math.hypot(x - px, z - pz) / 2);
    return Array.from({ length: steps + 1 }, (_, step): Keep => [px + (x - px) * step / steps, pz + (z - pz) * step / steps, 2.2]);
  })),
];
// Classic game textures (Elwynn cobbles and grass, sky layers) exported with the local wow.export
// worker; the painted fallbacks show until they load. Provenance: /figurines/world/source.json.
export const WORLD_TEXTURES = { cobble: "/figurines/world/floor-cobble.png", grass: "/figurines/world/grass.png", dirt: "/figurines/world/dirt.png", clouds: "/figurines/world/clouds.jpg" };
// Each district's paving, a texture from the game laid over the square's rim and out round its
// stations: the patches of ground it covers ([x, z, radius]), how much ground a tile covers, its
// turn, and the tint that keeps it in the family of the square's stones.
export const DISTRICT_FLOORS: { texture: string; blobs: [number, number, number][]; tile: number; turn: number; tint: [number, number, number] }[] = [
  { texture: "/figurines/world/floor-market.png", blobs: [[-14.5, 6, 3.7], [-15.2, 1.4, 3.6], [-14.9, -3, 3.7], [-17.4, 3.4, 2.7], [-17, -4.6, 2.3], [-10.8, 1.4, 2.8]], tile: 3.2, turn: 0.12, tint: [0.8, 0.74, 0.68] },
  { texture: "/figurines/world/floor-fair.png", blobs: [[-2.2, -13.6, 3], [-0.4, -16.2, 2.6], [2.6, -14.2, 3.2], [7.5, -12, 3.1], [5.2, -15, 2.2], [2.6, -10.6, 2.8], [11.6, -12.2, 2.5]], tile: 3, turn: 0, tint: [0.68, 0.62, 0.58] },
  { texture: "/figurines/world/floor-honours.png", blobs: [[15.8, 0.8, 3], [15.4, 4.5, 3.3], [13.8, 8.6, 3.5], [11.6, 3.4, 2.8], [17, 2.8, 2.3], [15.8, 6.6, 2.4]], tile: 3, turn: -0.12, tint: [0.4, 0.37, 0.33] },
  { texture: "/figurines/world/floor-yard.png", blobs: [[-9.7, 13, 3.7], [-4.6, 15, 3.5], [-6, 10.2, 2.8], [-7.2, 15.8, 2.8], [-2.4, 15.4, 2.2], [-12, 14.2, 2.2]], tile: 3.4, turn: -0.3, tint: [1.15, 1.04, 0.92] },
];
// Canvas x of the painted sun: the direction the stage's key light shines from (-x, +z).
const SUN_X = 277;
const LAMP_HEAD = 3.9, GROUND_RADIUS = 92;

const random = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  return [element, element.getContext("2d")!] as const;
}

// Hand-painted cobbles: a tileable Voronoi of stones with mortar, per-stone tint and a soft top light.
function paintedCobbles() {
  const size = 512, [element, context] = canvas(size, size), next = random(3);
  const points = Array.from({ length: 70 }, () => [next() * size, next() * size, next()]);
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let first = Infinity, second = Infinity, tint = 0, cx = 0, cy = 0;
    for (const [px, py, shade] of points) {
      let dx = Math.abs(x - px), dy = Math.abs(y - py);
      dx = Math.min(dx, size - dx); dy = Math.min(dy, size - dy);
      const d = dx * dx + dy * dy;
      if (d < first) { second = first; first = d; tint = shade; cx = x - px; cy = y - py; } else if (d < second) second = d;
    }
    const edge = Math.sqrt(second) - Math.sqrt(first);
    const mortar = edge < 3 ? 0 : Math.min(1, (edge - 3) / 6);
    const light = 1 - Math.min(1, Math.hypot(cx + 6, cy + 6) / 70) * 0.35;
    const value = (0.42 + tint * 0.25) * light * (0.35 + mortar * 0.65);
    const i = (y * size + x) * 4;
    image.data[i] = 120 * value + 18; image.data[i + 1] = 118 * value + 20; image.data[i + 2] = 132 * value + 28; image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return element;
}

// The haze at the horizon: the scene's fog is this colour, and the sky's far treeline fades into
// it, so the real trees, fogged with distance, meet the painted ones without a seam.
export const WORLD_FOG = { color: 0xb9c6b4, density: 0.0125 };
const HAZE = "#b9c6b4";
// Late-afternoon sky: blue overhead warming to a golden haze at the horizon, a low sun on the
// light's side, soft cloud banks (with the game cloud layer screened in) and layered far woods
// whose crowns pale into the haze. The horizon sits on the canvas midline; x runs around the
// sphere from -x through +z.
function paintedSky(layers: { clouds?: HTMLImageElement | null } = {}, target?: HTMLCanvasElement) {
  const element = target ?? canvas(2048, 1024)[0], context = element.getContext("2d")!, next = random(9);
  const gradient = context.createLinearGradient(0, 0, 0, 1024);
  [[0, "#2f63b0"], [0.28, "#5f93d4"], [0.43, "#a8c8e8"], [0.475, "#ecdcb6"], [0.5, HAZE], [1, HAZE]].forEach(([at, color]) => gradient.addColorStop(at as number, color as string));
  context.fillStyle = gradient; context.fillRect(0, 0, 2048, 1024);
  for (const [x, y, radius, stops] of [[SUN_X, 370, 300, [[0, "rgba(255,248,226,1)"], [0.07, "rgba(255,244,214,.95)"], [0.2, "rgba(255,228,180,.4)"], [1, "rgba(255,210,150,0)"]]]] as [number, number, number, [number, string][]][]) {
    const glow = context.createRadialGradient(x, y, 0, x, y, radius);
    stops.forEach(([at, color]) => glow.addColorStop(at, color));
    context.fillStyle = glow; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let i = 0; i < 60; i++) {
    const x = next() * 2048, y = 160 + next() * 330, w = 160 + next() * 340, h = 16 + next() * 38;
    const warm = y > 400 ? 1 : 0, cloud = context.createRadialGradient(x, y, 0, x, y, w / 2);
    cloud.addColorStop(0, `rgba(255,${246 - warm * 16},${236 - warm * 36},${0.18 + next() * 0.3})`); cloud.addColorStop(1, "rgba(255,255,255,0)");
    context.save(); context.translate(x, y); context.scale(1, h / (w / 2)); context.translate(-x, -y); context.fillStyle = cloud; context.fillRect(x - w / 2, y - w / 2, w, w); context.restore();
  }
  if (layers.clouds) {
    context.save(); context.globalCompositeOperation = "screen";
    for (const [y, height, alpha] of [[170, 160, 0.3], [290, 150, 0.35], [400, 90, 0.3]] as [number, number, number][]) {
      context.globalAlpha = alpha;
      for (let x = 0; x < 2048; x += 512) context.drawImage(layers.clouds, x, y, 512, height);
    }
    context.restore();
  }
  // Far woods: rows of rounded crowns, the farthest palest; each row ends in haze below.
  for (const [base, height, color] of [[500, 46, "#9fb2a2"], [508, 34, "#86a08a"], [516, 24, "#6f8c72"]] as [number, number, string][]) {
    context.fillStyle = color; context.beginPath(); context.moveTo(0, 1024); context.lineTo(0, base);
    for (let x = 0; x < 2048;) {
      const width = 14 + next() * 34, top = base - height * (0.45 + next() * 0.55);
      context.quadraticCurveTo(x + width / 2, top - height * 0.25, x + width, base - height * 0.25 * next());
      x += width;
    }
    context.lineTo(2048, 1024); context.closePath(); context.fill();
  }
  const mist = context.createLinearGradient(0, 470, 0, 540);
  mist.addColorStop(0, "rgba(185,198,180,0)"); mist.addColorStop(0.6, "rgba(185,198,180,.55)"); mist.addColorStop(1, HAZE);
  context.fillStyle = mist; context.fillRect(0, 470, 2048, 554);
  return element;
}

const SQUARE_EDGE = (angle: number) => 1 + 0.07 * Math.sin(angle * 3 + 0.6) + 0.05 * Math.sin(angle * 7 + 2.1) + 0.03 * Math.sin(angle * 13);
// The ground is one surface, blended in the shader the way the game's own terrain is: every layer
// has a soft mask, and the texture's own relief decides what gives way first, so stones thin out
// one by one into trodden earth and the earth into the grass. The masks cover the middle of the
// world, GROUND_MAP wide; canvas top is -z.
const GROUND_MAP = 64, MAP_SIZE = 1024;
function groundMaps() {
  const scale = MAP_SIZE / GROUND_MAP, at = (x: number, z: number) => [(x / GROUND_MAP + 0.5) * MAP_SIZE, (z / GROUND_MAP + 0.5) * MAP_SIZE] as const;
  const layer = (blur: number, paint: (context: CanvasRenderingContext2D) => void) => {
    const [, context] = canvas(MAP_SIZE, MAP_SIZE);
    context.fillStyle = "#000"; context.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    context.filter = `blur(${blur * scale}px)`; context.fillStyle = context.strokeStyle = "#fff"; context.lineCap = context.lineJoin = "round";
    paint(context);
    return context.getImageData(0, 0, MAP_SIZE, MAP_SIZE).data;
  };
  const disc = (context: CanvasRenderingContext2D, x: number, z: number, radius: number) => { const [cx, cy] = at(x, z); context.beginPath(); context.arc(cx, cy, radius * scale, 0, Math.PI * 2); context.fill(); };
  const square = (context: CanvasRenderingContext2D, grow: number) => {
    context.beginPath();
    for (let step = 0; step <= 128; step++) {
      const angle = step / 128 * Math.PI * 2, radius = COBBLE_RADIUS * SQUARE_EDGE(angle) + grow, [x, y] = at(Math.sin(angle) * radius, Math.cos(angle) * radius);
      context[step ? "lineTo" : "moveTo"](x, y);
    }
    context.fill();
  };
  const paths = (context: CanvasRenderingContext2D, width: number) => {
    context.lineWidth = width * scale;
    for (const path of PATHS) { context.beginPath(); path.forEach(([x, z], index) => context[index ? "lineTo" : "moveTo"](...at(x, z))); context.stroke(); }
  };
  const cobbles = layer(1.3, (context) => square(context, -0.5));
  const floors = DISTRICT_FLOORS.map(({ blobs }) => layer(1.5, (context) => blobs.forEach(([x, z, radius]) => disc(context, x, z, radius))));
  // The trodden earth runs a little beyond all the paving, and out along the paths.
  const earth = layer(1.7, (context) => {
    square(context, 1.4); paths(context, 2);
    for (const { blobs } of DISTRICT_FLOORS) for (const [x, z, radius] of blobs) disc(context, x, z, radius + 1.3);
  });
  // Three masks to a map: a canvas premultiplies, so alpha can't hold a fourth.
  const pack = (channels: Uint8ClampedArray[]) => {
    const [element, context] = canvas(MAP_SIZE, MAP_SIZE), image = context.createImageData(MAP_SIZE, MAP_SIZE);
    for (let i = 0; i < image.data.length; i += 4) { channels.forEach((source, channel) => { image.data[i + channel] = source[i]; }); image.data[i + 3] = 255; }
    context.putImageData(image, 0, 0);
    const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.NoColorSpace; map.generateMipmaps = false; map.minFilter = THREE.LinearFilter;
    return map;
  };
  return [pack([cobbles, floors[0], floors[1]]), pack([floors[2], floors[3], earth])];
}
// A tiling field of soft noise: what breaks up each layer's edge.
function groundNoise() {
  const size = 256, [element, context] = canvas(size, size), next = random(21), image = context.createImageData(size, size);
  const lattices = [[8, 0.45], [16, 0.3], [32, 0.15], [64, 0.1]].map(([cells, weight]) => ({ cells, weight, values: Array.from({ length: cells * cells }, () => next()) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let value = 0;
    for (const { cells, weight, values } of lattices) {
      const u = x / size * cells, v = y / size * cells, x0 = Math.floor(u), y0 = Math.floor(v), fx = smooth(u - x0), fy = smooth(v - y0), get = (i: number, j: number) => values[(j % cells) * cells + (i % cells)];
      value += weight * ((get(x0, y0) * (1 - fx) + get(x0 + 1, y0) * fx) * (1 - fy) + (get(x0, y0 + 1) * (1 - fx) + get(x0 + 1, y0 + 1) * fx) * fy);
    }
    const i = (y * size + x) * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value * 255; image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.NoColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}
// The whole ground in one shader: grass, then earth, the square's cobbles and each district's
// paving, each laid over the last where its mask, its relief and the noise allow.
function blendGround(material: THREE.MeshStandardMaterial) {
  const [first, second] = groundMaps(), blank = new THREE.DataTexture(new Uint8Array([120, 112, 100, 255]), 1, 1); blank.colorSpace = THREE.SRGBColorSpace; blank.needsUpdate = true;
  const uniforms = {
    groundFirst: { value: first }, groundSecond: { value: second }, groundNoise: { value: groundNoise() },
    earthMap: { value: blank as THREE.Texture }, cobbleMap: { value: blank as THREE.Texture },
    floorMaps: { value: DISTRICT_FLOORS.map(() => blank as THREE.Texture) },
    floorTints: { value: DISTRICT_FLOORS.map(({ tint }) => new THREE.Vector3(...tint)) },
    floorFrames: { value: DISTRICT_FLOORS.map(({ tile, turn }) => new THREE.Vector2(Math.cos(turn) / tile, Math.sin(turn) / tile)) },
  };
  const masks = ["first.g", "first.b", "second.r", "second.g"];
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec2 vGround;\n${shader.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\n  vGround = vec2(position.x, -position.y);");
    shader.fragmentShader = `varying vec2 vGround;
      uniform sampler2D groundFirst, groundSecond, groundNoise, earthMap, cobbleMap, floorMaps[${DISTRICT_FLOORS.length}];
      uniform vec3 floorTints[${DISTRICT_FLOORS.length}];
      uniform vec2 floorFrames[${DISTRICT_FLOORS.length}];
      float brightness(vec3 colour) { return dot(colour, vec3(0.3, 0.55, 0.15)); }
      // How much of a layer shows: its mask, pushed about by the noise and by its own relief, so
      // the mortar goes first and the stones thin out one by one.
      float laid(float mask, vec3 colour, float noise, float softness) {
        float edge = mask * 1.5 - 0.25 + (noise - 0.5) * 0.7 + (sqrt(brightness(colour)) - 0.45) * 1.3;
        return smoothstep(0.5 - softness, 0.5 + softness, edge) * smoothstep(0.0, 0.1, mask);
      }
      // Toward its edge a layer takes on the colour of the ground it is sinking into, like stones
      // under a skin of dust, so no two layers ever meet at full strength.
      vec3 dusted(vec3 colour, vec3 under, float mask) { return mix(under * (0.75 + 0.5 * brightness(colour) / max(brightness(under), 0.02)), colour, smoothstep(0.3, 0.95, mask)); }
      ${shader.fragmentShader}`.replace("#include <map_fragment>", `#include <map_fragment>
      vec2 maskUv = vGround / ${GROUND_MAP.toFixed(1)} + 0.5; maskUv.y = 1.0 - maskUv.y;
      vec4 first = texture2D(groundFirst, maskUv), second = texture2D(groundSecond, maskUv);
      float noise = texture2D(groundNoise, vGround * 0.045).r * 0.65 + texture2D(groundNoise, vGround * 0.21).r * 0.35;
      // The earth: desaturated, so it sits with the stone instead of glowing against it. It also
      // shows in loose worn patches out in the far grass.
      vec3 earth = texture2D(earthMap, vGround * 0.28).rgb;
      earth = mix(vec3(brightness(earth)), earth, 0.7) * vec3(0.66, 0.6, 0.53);
      float wear = smoothstep(0.6, 0.72, texture2D(groundNoise, vGround * 0.011).r) * 0.6 * smoothstep(20.0, 28.0, length(vGround));
      diffuseColor.rgb = mix(diffuseColor.rgb, earth, max(laid(second.b, diffuseColor.rgb, noise, 0.2), wear));
      vec3 stone = texture2D(cobbleMap, vGround / 1.79).rgb * vec3(0.69, 0.63, 0.54);
      diffuseColor.rgb = mix(diffuseColor.rgb, dusted(stone, diffuseColor.rgb, first.r), laid(first.r, stone, noise, 0.14));
      // Each district's paving, pulled toward the square's stone so neighbours stay in one family.
      vec3 paved; vec2 frame;
      ${masks.map((mask, index) => `frame = floorFrames[${index}];
      paved = texture2D(floorMaps[${index}], vec2(frame.x * vGround.x - frame.y * vGround.y, frame.y * vGround.x + frame.x * vGround.y)).rgb;
      paved = mix(paved, vec3(brightness(paved)) * vec3(1.0, 0.96, 0.9), 0.45) * floorTints[${index}];
      diffuseColor.rgb = mix(diffuseColor.rgb, dusted(paved, diffuseColor.rgb, ${mask}), laid(${mask}, paved, noise, 0.14));`).join("\n")}`);
  };
  material.customProgramCacheKey = () => "figurine-ground";
  return (layer: "earth" | "cobble" | number, texture: THREE.Texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.needsUpdate = true;
    if (layer === "earth") uniforms.earthMap.value = texture; else if (layer === "cobble") uniforms.cobbleMap.value = texture; else uniforms.floorMaps.value[layer] = texture;
  };
}

function textureFrom(source: HTMLCanvasElement, repeat?: number) {
  const texture = new THREE.CanvasTexture(source); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  if (repeat) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeat, repeat); }
  return texture;
}
// Swaps a painted texture for a real one if the file exists; keeps wrapping and repeat.
async function upgrade(material: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial, url: string, signal: AbortSignal, repeat?: number, neutral = false, fallback?: () => THREE.Texture) {
  const image = await loadFigurineImage(url, signal);
  if (signal.aborted) return;
  if (image) {
    const texture = new THREE.Texture(image); texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
    if (repeat) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeat, repeat); }
    if (neutral) material.color.set(0x8c9a80);
    material.map?.dispose(); material.map = texture; material.needsUpdate = true;
  } else {
    if (fallback) { material.map = fallback(); material.needsUpdate = true; }
  }
}

// Bake lighting once the final sky is painted (also when the optional cloud image fails).
export function buildWorld(scene: THREE.Scene, { onSky, ktx2Loader }: { onSky?: () => void; ktx2Loader?: KTX2Loader } = {}) {
  const controller = new AbortController(), { signal } = controller;
  const group = new THREE.Group(); scene.add(group);
  const skyCanvas = paintedSky();
  const skyMaterial = new THREE.MeshBasicMaterial({ map: textureFrom(skyCanvas), side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(GROUND_RADIUS + 4, 48, 24), skyMaterial); sky.renderOrder = -1; group.add(sky);
  const skyReady = loadFigurineImage(WORLD_TEXTURES.clouds, signal).then((clouds) => {
    if (signal.aborted) return;
    if (clouds) { paintedSky({ clouds }, skyCanvas); if (skyMaterial.map) skyMaterial.map.needsUpdate = true; }
    onSky?.();
  });
  // Elwynn grass to the horizon, with the worn earth, the square and the districts blended into it.
  // It is drawn first and writes no depth, so nothing can ever z-fight with it, however far away or
  // shaky the camera is. Nothing in the world sits below the ground.
  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3a1c, roughness: 0.96, depthWrite: false });
  const grass = new THREE.Mesh(new THREE.CircleGeometry(GROUND_RADIUS, 128), grassMaterial);
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.03; grass.receiveShadow = true; grass.renderOrder = -0.5; group.add(grass);
  const grassReady = upgrade(grassMaterial, WORLD_TEXTURES.grass, signal, 140, true);
  const setGround = blendGround(grassMaterial);
  const groundTexture = async (url: string) => {
    const image = await loadFigurineImage(url, signal);
    if (!image || signal.aborted) return null;
    const texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
    return texture;
  };
  const dirtReady = groundTexture(WORLD_TEXTURES.dirt).then((texture) => { if (texture) setGround("earth", texture); });
  // Painting the fallback costs millions of distance checks. Only do it if the real asset fails.
  const plazaReady = groundTexture(WORLD_TEXTURES.cobble).then((texture) => { if (!signal.aborted) setGround("cobble", texture ?? textureFrom(paintedCobbles())); });
  const floorReady = Promise.all(DISTRICT_FLOORS.map(({ texture }, index) => groundTexture(texture).then((map) => { if (map) setGround(index, map); })));
  // The forest clearing and its lamp posts, each lamp with an additive glow.
  const wind = { value: 0 };
  const forest = buildForest(group, forestLayout(PLAZA_RADIUS, 11, marketLayout(), LAMP_SPOTS, FOREST_CLEARINGS), (material) => swayMaterial(material, wind), ktx2Loader);
  const glowCanvas = canvas(64, 64);
  const halo = glowCanvas[1].createRadialGradient(32, 32, 0, 32, 32, 32);
  halo.addColorStop(0, "rgba(255,214,150,1)"); halo.addColorStop(0.3, "rgba(255,190,110,.4)"); halo.addColorStop(1, "rgba(255,170,90,0)");
  glowCanvas[1].fillStyle = halo; glowCanvas[1].fillRect(0, 0, 64, 64);
  const glowMap = textureFrom(glowCanvas[0]);
  for (const [x, z] of LAMP_SPOTS) {
    // Lit lanterns read faintly in daylight.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.set(x, LAMP_HEAD, z); glow.scale.setScalar(1.8); group.add(glow);
  }
  return { group, sky, ready: Promise.all([forest.ready, skyReady, grassReady, plazaReady, dirtReady, floorReady]), dispose() { controller.abort(); }, pickSecret: forest.pickSecret, mountSecretBox: forest.mountSecretBox, update(time: number) { wind.value = time; } };
}

// Places a station group in the world.
export function placeStation(scene: THREE.Scene, station: Station) {
  const group = new THREE.Group();
  group.position.copy(STATIONS[station].position); group.rotation.y = STATIONS[station].rotation;
  scene.add(group);
  return group;
}

// Camera pose for each view. `framing` (>= 1) backs off on portrait screens; both centre views
// share the home shot. Station shots back off until the station's width fits the screen (36°
// vertical field of view); a shot backed off past the centre looks over the pedestal, whose box
// steps aside.
// Fixed world distances keep every viewport's orbit inside the clearing.
export const OVERVIEW_DISTANCE = { min: 13, initial: 17, max: 19 } as const;
export function viewPose(view: WorldView, framing: number, home: { offset: THREE.Vector3; target: THREE.Vector3 }, aspect = 16 / 9) {
  if (isDistrict(view)) return districtPose(view, aspect);
  if (view === "overview") {
    return { target: home.target.clone(), position: home.offset.clone().setLength(OVERVIEW_DISTANCE.initial).add(home.target) };
  }
  if (!isStation(view)) return { target: home.target.clone(), position: home.offset.clone().multiplyScalar(framing).add(home.target) };
  const { position, rotation } = STATIONS[view], { shot } = STATION_SPECS[view], district = districtOf(view);
  if (district) {
    const pose = districtPose(district, aspect), focus = position.clone().setY(pose.target.y);
    return { target: pose.target.clone().lerp(focus, LEAN.turn), position: pose.position.clone().lerp(focus, LEAN.drift) };
  }
  const offset = new THREE.Vector3(0, shot!.height, shot!.distance), target = new THREE.Vector3(0, shot!.target, 0).add(position);
  const fit = THREE.MathUtils.clamp(shot!.fit / 2 / (Math.tan(THREE.MathUtils.degToRad(18)) * aspect) / offset.length(), framing, Math.max(framing, shot!.reach ?? 2.9));
  return { target, position: offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation).multiplyScalar(fit).add(target) };
}
