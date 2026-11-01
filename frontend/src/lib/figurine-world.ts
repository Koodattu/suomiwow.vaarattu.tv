import * as THREE from "three";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { buildForest, forestLayout, marketLayout, swayMaterial, type Keep } from "@/lib/figurine-forest";

// The collectibles world: a painted sky bubble over a forest clearing. A cobbled square holds the
// opening pedestal at its centre, and what a player uses every day stands round its edge, a few
// steps away: the shop and the collection's display cabinet at the back, the quest board and the
// daily crate to the left, the lucky wheel to the right. Worn dirt paths lead on between them to
// the rest, further out among the trees: the market lane behind (the trading post and the
// mailbox), a tinkers' yard to the west (the recycler and the forge), the scrying ball behind the
// cabinet, the hall of fame and the leaderboards to the east, and the fishing pond down its own
// path to the south-east. Nothing is signposted: each facility is its props, there to be found and
// tapped. The showcase's figures stand about the world at sixteen spots of their own.
// The centre (the pedestal, with a box or an inspected figure) is home; the others are stations.
export type Station = "shop" | "gallery" | "recycler" | "forge" | "crate" | "wheel" | "mail" | "quests" | "feed" | "fame" | "leaderboard" | "trading" | "pond";
export type WorldView = Station | "opening" | "viewer";
// The views that are stations (everything but the two at the centre).
export const isStation = (view: WorldView): view is Station => view !== "opening" && view !== "viewer";
// The cobbled square, and the clearing round it that the woods leave open.
export const COBBLE_RADIUS = 11.2, PLAZA_RADIUS = 21;
// Each station: where it stands (\`at\`, x and z; +z is toward the home camera) and the point it
// faces (\`face\`, default the centre: most face their path or the square), its footprint (\`width\`
// along its front, \`back\`/\`front\` behind and before its origin, for the camera's occlusion
// test), and its shot: camera height and distance, target height, the width that must fit, and
// how far (times its distance) it may back off to fit it.
type StationSpec = { at: [number, number]; face?: [number, number]; width: number; back: number; front: number; shot: { height: number; distance: number; target: number; fit: number; reach?: number } };
const big = (fit: number) => ({ height: 1.2, distance: 6.8, target: 1.6, fit });
const small = (fit: number, target = 1.3) => ({ height: 1.1, distance: 6.6, target, fit });
export const STATION_SPECS: Record<Station, StationSpec> = {
  // Round the square's edge: the everyday things.
  shop: { at: [-6.8, -12.2], face: [0, -6], width: 6.6, back: -1.1, front: 1.8, shot: { height: 1.3, distance: 9.4, target: 2.45, fit: 6.6 } },
  gallery: { at: [7, -11.8], face: [0, -5.5], width: 5.8, back: -0.7, front: 1.3, shot: { height: 1.2, distance: 8, target: 2.3, fit: 5.4, reach: 1.7 } },
  quests: { at: [-12.8, -3.6], face: [0, -1.5], width: 3, back: -0.6, front: 0.9, shot: small(4, 1.5) },
  crate: { at: [-11.8, 5], face: [0, 1.5], width: 2.4, back: -0.8, front: 0.9, shot: small(3.2, 1) },
  wheel: { at: [12.8, -3.4], face: [0, -1.5], width: 3, back: -0.6, front: 0.8, shot: small(3.8, 1.6) },
  // Further out. The market lane behind the shop and the cabinet.
  trading: { at: [-2.6, -21.4], face: [0, -12], width: 4, back: -0.6, front: 0.9, shot: big(4.6) },
  mail: { at: [4.6, -21], face: [1.2, -15], width: 2.4, back: -0.7, front: 0.8, shot: small(3.4) },
  // The scrying ball, behind the cabinet among the trees.
  feed: { at: [16.6, -13.2], face: [8, -6], width: 2.6, back: -0.6, front: 0.8, shot: small(3.4, 1.4) },
  // The tinkers' yard, down the west path.
  recycler: { at: [-20.6, -2.6], face: [-11, -0.6], width: 3.8, back: -1.2, front: 1.4, shot: big(4.6) },
  forge: { at: [-19.8, 4.2], face: [-11, 1.8], width: 3.6, back: -1.2, front: 1.4, shot: big(4.4) },
  // The hall of fame and the leaderboards, down the east path.
  fame: { at: [20.4, 2.6], face: [11, 1.4], width: 3.4, back: -0.8, front: 0.9, shot: small(4.2, 1.4) },
  leaderboard: { at: [18.6, 9.6], face: [10, 4.6], width: 3, back: -0.8, front: 0.9, shot: small(4, 1.5) },
  // Down its own path to the south-east, where the trees open onto the water.
  pond: { at: [13.6, 19.4], face: [7, 10], width: 6, back: -3, front: 3, shot: { height: 2.4, distance: 8.5, target: 0.6, fit: 8.5 } },
};
export const STATIONS = Object.fromEntries(Object.entries(STATION_SPECS).map(([name, spec]) => {
  const [fx, fz] = spec.face ?? [0, 0];
  return [name, { position: new THREE.Vector3(spec.at[0], 0, spec.at[1]), rotation: Math.atan2(fx - spec.at[0], fz - spec.at[1]) }];
})) as Record<Station, { position: THREE.Vector3; rotation: number }>;
// The worn paths off the square, as points along their middles.
export const PATHS: [number, number][][] = [
  [[0, -10.4], [0.6, -14.5], [0.2, -18.5], [1, -23.5], [2.4, -30], [3.6, -40]],
  [[-11, 0.6], [-14.2, 0.4], [-17.2, 0.8], [-21.4, 0.9], [-26, 1.6]],
  [[11, 1.2], [14.2, 2.4], [17.4, 3.6], [19.6, 6]],
  [[10.2, -8.2], [12.8, -10.4], [15.2, -11.6]],
  [[7.6, 8], [9.6, 11.4], [11, 14.6]],
];
// Trodden ground round each neighbourhood out among the trees.
export const PATCHES: [number, number, number][] = [[1, -21, 5.4], [-19.6, 0.8, 4.6], [19, 5.6, 4.8], [16, -12.6, 3], [12.4, 17.6, 3.6]];
// Where the showcase's figures stand, by slot (1-16): about the square between the stalls, down
// the paths, at the market, in the yard, by the hall and on the pond's bank. Each looks roughly
// toward the square.
export const STATUE_SPOTS = ([
  [-2.4, -11.2], [3.2, -10.8], [-10.6, -8.6], [14.2, -8.6], [-8.2, -5.6], [8.8, 7.2], [-5.2, 0.2], [5, 0.8],
  [-2.2, -24.6], [6.8, -25.4], [-17.4, -8.6], [-15.6, 6.8], [15.6, -0.6], [14.6, 4.2], [8.2, 17.2], [-11.4, -15.6],
] as [number, number][]).map(([x, z], index) => ({ number: index + 1, position: new THREE.Vector3(x, 0, z), rotation: Math.atan2(-x, -z) + Math.sin(index * 2.4) * 0.5 }));
// Lamp posts along the paths.
export const LAMP_SPOTS: [number, number][] = [[-1.4, -9.8], [-4.2, -16.8], [-14.6, 4.6], [12.6, 0], [9.2, 9.8], [-16.8, -5.8], [10.4, -6.6], [-9.4, 9.4]];
// Classic game textures (Elwynn cobbles and grass, sky layers) exported with the local wow.export
// worker; the painted fallbacks show until they load. Provenance: /figurines/world/source.json.
export const WORLD_TEXTURES = { cobble: "/figurines/world/floor-cobble.png", grass: "/figurines/world/grass.png", dirt: "/figurines/world/dirt.png", clouds: "/figurines/world/clouds.jpg" };
// Canvas x of the painted sun: the direction the stage's key light shines from (-x, +z).
const SUN_X = 277;
const LAMP_HEAD = 3.9, GROUND_RADIUS = 92;
const loadImage = (url: string) => new Promise<HTMLImageElement | null>((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = url; });

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

// Where worn earth shows through, in ground-disc UV space (canvas top is the far side). On the
// square: its ragged rim, scuffs, and where the paths leave it. On the grass: a trodden ring round
// the square, the paths, the ground round each neighbourhood, and loose patches.
const SQUARE_EDGE = (angle: number) => 1 + 0.07 * Math.sin(angle * 3 + 0.6) + 0.05 * Math.sin(angle * 7 + 2.1) + 0.03 * Math.sin(angle * 13);
function dirtMask(groundRadius: number, plaza = false) {
  const size = 1024, [element, context] = canvas(size, size), next = random(plaza ? 8 : 5);
  const at = (x: number, z: number) => [(x / groundRadius + 1) / 2 * size, (z / groundRadius + 1) / 2 * size] as const;
  const scale = size / 2 / groundRadius;
  context.fillStyle = "#000"; context.fillRect(0, 0, size, size);
  const blot = (x: number, z: number, radius: number, strength: number) => {
    const [cx, cy] = at(x, z), r = radius * scale, gradient = context.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, `rgba(255,255,255,${strength})`); gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient; context.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  // Blots along each path, wobbling a little either side of its line.
  const paths = (width: number, strength: number) => PATHS.forEach((path) => path.slice(1).forEach(([x, z], index) => {
    const [px, pz] = path[index], length = Math.hypot(x - px, z - pz);
    for (let d = 0; d < length; d += 0.45) { const t = d / length, wobble = (next() - 0.5) * 0.6; blot(px + (x - px) * t + wobble, pz + (z - pz) * t + wobble, width * (0.8 + next() * 0.4), strength); }
  }));
  if (plaza) {
    for (let i = 0; i < 180; i++) { const angle = next() * Math.PI * 2, radius = COBBLE_RADIUS * SQUARE_EDGE(angle) - 2.2 + next() * 2.4; blot(Math.sin(angle) * radius, Math.cos(angle) * radius, 0.5 + next() * 1.2, 0.25 + next() * 0.45); }
    for (let i = 0; i < 30; i++) { const angle = next() * Math.PI * 2, radius = 3.4 + next() * (COBBLE_RADIUS - 5); blot(Math.sin(angle) * radius, Math.cos(angle) * radius, 0.4 + next() * 1.1, 0.12 + next() * 0.3); }
    paths(1.1, 0.35);
  } else {
    for (let i = 0; i < 110; i++) { const angle = next() * Math.PI * 2, radius = COBBLE_RADIUS * SQUARE_EDGE(angle) - 0.2 + next() * 1.8; blot(Math.sin(angle) * radius, Math.cos(angle) * radius, 0.6 + next() * 1.2, 0.15 + next() * 0.3); }
    paths(1.5, 0.6);
    for (const [x, z, radius] of PATCHES) for (let i = 0; i < 26; i++) { const angle = next() * Math.PI * 2, d = Math.sqrt(next()) * radius; blot(x + Math.sin(angle) * d, z + Math.cos(angle) * d, 0.8 + next() * 1.6, 0.18 + next() * 0.3); }
    for (let i = 0; i < 90; i++) { const angle = next() * Math.PI * 2, radius = COBBLE_RADIUS + 4 + next() * (groundRadius - COBBLE_RADIUS - 4); blot(Math.sin(angle) * radius, Math.cos(angle) * radius, 1 + next() * 3, 0.12 + next() * 0.3); }
  }
  const texture = new THREE.CanvasTexture(element); texture.colorSpace = THREE.NoColorSpace;
  return texture;
}
// Blends a second ground texture into a material through a mask in the mesh's base UVs.
function blendGround(material: THREE.MeshStandardMaterial, mask: THREE.Texture, repeat: number) {
  const uniforms = { dirtMap: { value: null as THREE.Texture | null }, dirtMask: { value: mask }, dirtRepeat: { value: repeat } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = `uniform sampler2D dirtMap; uniform sampler2D dirtMask; uniform float dirtRepeat;\n${shader.fragmentShader}`.replace("#include <map_fragment>", `#include <map_fragment>
      #ifdef USE_MAP
        vec2 groundUv = vMapUv / dirtRepeat;
        float worn = smoothstep(0.08, 0.75, texture2D(dirtMask, groundUv).r);
        diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(dirtMap, vMapUv * 0.8).rgb * vec3(0.62, 0.56, 0.48), worn);
      #endif`);
  };
  material.customProgramCacheKey = () => `figurine-ground-${repeat}`;
  return (texture: THREE.Texture) => { uniforms.dirtMap.value = texture; material.needsUpdate = true; };
}

function textureFrom(source: HTMLCanvasElement, repeat?: number) {
  const texture = new THREE.CanvasTexture(source); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  if (repeat) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeat, repeat); }
  return texture;
}
// Swaps a painted texture for a real one if the file exists; keeps wrapping and repeat.
function upgrade(material: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial, url: string, repeat?: number, neutral = false) {
  new THREE.TextureLoader().load(url, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
    if (repeat) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeat, repeat); }
    if (neutral) material.color.set(0x8c9a80);
    material.map?.dispose(); material.map = texture; material.needsUpdate = true;
  }, undefined, () => undefined);
}

// `onSky` runs whenever the sky texture is repainted, so lighting baked from it can follow.
export function buildWorld(scene: THREE.Scene, { onSky, ktx2Loader }: { onSky?: () => void; ktx2Loader?: KTX2Loader } = {}) {
  const group = new THREE.Group(); scene.add(group);
  const skyCanvas = paintedSky();
  const skyMaterial = new THREE.MeshBasicMaterial({ map: textureFrom(skyCanvas), side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(GROUND_RADIUS + 4, 48, 24), skyMaterial); sky.renderOrder = -1; group.add(sky);
  void loadImage(WORLD_TEXTURES.clouds).then((clouds) => {
    if (!clouds) return;
    paintedSky({ clouds }, skyCanvas); if (skyMaterial.map) skyMaterial.map.needsUpdate = true;
    onSky?.();
  });
  // Elwynn grass to the horizon, with a cobbled plaza whose edge fades into it.
  // The grass is drawn first and writes no depth, so the plaza above it can never z-fight with it,
  // however far away or shaky the camera is. Nothing in the world sits below the ground.
  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3a1c, roughness: 1, depthWrite: false });
  const grass = new THREE.Mesh(new THREE.CircleGeometry(GROUND_RADIUS, 128), grassMaterial);
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.03; grass.receiveShadow = true; grass.renderOrder = -0.5; group.add(grass);
  upgrade(grassMaterial, WORLD_TEXTURES.grass, 140, true);
  // Worn dirt only blends in once both textures exist; until then the grass is plain.
  const setDirt = blendGround(grassMaterial, dirtMask(GROUND_RADIUS), 140);
  new THREE.TextureLoader().load(WORLD_TEXTURES.dirt, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 8;
    setDirt(texture); setPlazaDirt(texture);
  }, undefined, () => undefined);
  // The square's ragged edge: an irregular outline, softened, as the cobbles' alpha.
  const [fadeCanvas, fade] = canvas(256, 256), PLAZA_MESH = COBBLE_RADIUS * 1.2;
  fade.fillStyle = "#000"; fade.fillRect(0, 0, 256, 256);
  fade.filter = "blur(5px)"; fade.fillStyle = "#fff"; fade.beginPath();
  for (let step = 0; step <= 96; step++) {
    const angle = step / 96 * Math.PI * 2, radius = 128 * COBBLE_RADIUS * SQUARE_EDGE(angle) / PLAZA_MESH;
    // Canvas y runs toward +z in the world (the disc is laid flat, its top edge the far side).
    fade[step ? "lineTo" : "moveTo"](128 + Math.sin(angle) * radius, 128 + Math.cos(angle) * radius);
  }
  fade.fill(); fade.filter = "none";
  const plazaMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d0c2, map: textureFrom(paintedCobbles(), 10), alphaMap: new THREE.CanvasTexture(fadeCanvas), transparent: true, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA_MESH, 96), plazaMaterial);
  // Transparent for its soft edge, so it must draw before every other transparent object
  // (fading box walls, glows); otherwise they clip it and the grass shows through.
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = -0.015; plaza.receiveShadow = true; plaza.renderOrder = -0.4; group.add(plaza);
  upgrade(plazaMaterial, WORLD_TEXTURES.cobble, 15);
  const setPlazaDirt = blendGround(plazaMaterial, dirtMask(PLAZA_MESH, true), 15);
  // The forest clearing and its lamp posts, each lamp with an additive glow.
  const wind = { value: 0 };
  const forest = buildForest(group, forestLayout(PLAZA_RADIUS, 11, marketLayout(), LAMP_SPOTS, [
    ...Object.values(STATION_SPECS).map(({ at, width }): Keep => [at[0], at[1], width / 2 + 2.5]),
    ...PATHS.flatMap((path) => path.map(([x, z]): Keep => [x, z, 2.2])),
  ]), (material) => swayMaterial(material, wind), ktx2Loader);
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
  return { group, sky, ready: forest.ready, pickSecret: forest.pickSecret, mountSecretBox: forest.mountSecretBox, update(time: number) { wind.value = time; } };
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
export function viewPose(view: WorldView, framing: number, home: { offset: THREE.Vector3; target: THREE.Vector3 }, aspect = 16 / 9) {
  if (!isStation(view)) return { target: home.target.clone(), position: home.offset.clone().multiplyScalar(framing).add(home.target) };
  const { position, rotation } = STATIONS[view], { shot } = STATION_SPECS[view];
  const offset = new THREE.Vector3(0, shot.height, shot.distance), target = new THREE.Vector3(0, shot.target, 0).add(position);
  const fit = THREE.MathUtils.clamp(shot.fit / 2 / (Math.tan(THREE.MathUtils.degToRad(18)) * aspect) / offset.length(), framing, Math.max(framing, shot.reach ?? 2.9));
  return { target, position: offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation).multiplyScalar(fit).add(target) };
}
