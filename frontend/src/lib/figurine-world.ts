import * as THREE from "three";

// The collectibles world: a painted sky bubble over a stone plaza, with the opening pedestal
// at the centre, the shop to the left and the collection case to the right.
export type WorldView = "menu" | "shop" | "opening" | "gallery" | "viewer";
export const STATIONS = {
  shop: { position: new THREE.Vector3(-6.2, 0, -4.4), rotation: 0.62 },
  gallery: { position: new THREE.Vector3(6.2, 0, -4.4), rotation: -0.62 },
};
// Classic game textures (Elwynn cobbles and grass, sky layers) exported with the local wow.export
// worker; the painted fallbacks show until they load. Provenance: /figurines/world/source.json.
export const WORLD_TEXTURES = { cobble: "/figurines/world/floor-cobble.png", grass: "/figurines/world/grass.png", clouds: "/figurines/world/clouds.jpg", nebula: "/figurines/world/nebula.png" };
const PLAZA_RADIUS = 14.5;
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

// Twilight sky: gradient, stars, a nebula, cloud banks, a moon and a distant mountain ridge.
// Game cloud and nebula textures are screened in when available.
function paintedSky(layers: { clouds?: HTMLImageElement | null; nebula?: HTMLImageElement | null } = {}, target?: HTMLCanvasElement) {
  const element = target ?? canvas(2048, 1024)[0], context = element.getContext("2d")!, next = random(9);
  const gradient = context.createLinearGradient(0, 0, 0, 1024);
  [[0, "#05060f"], [0.28, "#131a3a"], [0.44, "#2b2a5c"], [0.5, "#5a4170"], [0.53, "#2a2340"], [1, "#0b0d18"]].forEach(([at, color]) => gradient.addColorStop(at as number, color as string));
  context.fillStyle = gradient; context.fillRect(0, 0, 2048, 1024);
  for (let i = 0; i < 900; i++) {
    const y = next() ** 1.6 * 470;
    context.globalAlpha = (1 - y / 470) * (0.3 + next() * 0.7); context.fillStyle = "#fff";
    context.fillRect(next() * 2048, y, next() < 0.1 ? 2 : 1, next() < 0.1 ? 2 : 1);
  }
  context.globalAlpha = 1;
  if (layers.nebula) {
    context.save(); context.globalCompositeOperation = "screen"; context.globalAlpha = 0.85;
    context.drawImage(layers.nebula, 260, 40, 820, 410); context.restore();
  }
  if (layers.clouds) {
    context.save(); context.globalCompositeOperation = "screen";
    for (const [y, height, alpha] of [[250, 140, 0.12], [340, 150, 0.2], [420, 90, 0.26]] as [number, number, number][]) {
      context.globalAlpha = alpha;
      for (let x = 0; x < 2048; x += 512) context.drawImage(layers.clouds, x, y, 512, height);
    }
    context.restore();
  }
  const moon = context.createRadialGradient(1500, 250, 0, 1500, 250, 140);
  moon.addColorStop(0, "rgba(255,244,214,1)"); moon.addColorStop(0.25, "rgba(255,236,196,.95)"); moon.addColorStop(0.32, "rgba(200,190,255,.25)"); moon.addColorStop(1, "rgba(120,110,220,0)");
  context.fillStyle = moon; context.fillRect(1300, 50, 400, 400);
  for (let i = 0; i < 46; i++) {
    const x = next() * 2048, y = 300 + next() * 160, w = 140 + next() * 260, h = 18 + next() * 30;
    const cloud = context.createRadialGradient(x, y, 0, x, y, w / 2);
    cloud.addColorStop(0, `rgba(${150 + next() * 60},${120 + next() * 50},${190 + next() * 40},${0.08 + next() * 0.12})`); cloud.addColorStop(1, "rgba(0,0,0,0)");
    context.save(); context.translate(x, y); context.scale(1, h / (w / 2)); context.translate(-x, -y); context.fillStyle = cloud; context.fillRect(x - w / 2, y - w / 2, w, w); context.restore();
  }
  for (const [base, color, roughness] of [[505, "#1d1830", 60], [515, "#120f20", 34]] as [number, string, number][]) {
    context.fillStyle = color; context.beginPath(); context.moveTo(0, 1024);
    let y = base;
    for (let x = 0; x <= 2048; x += 16) { y = Math.max(base - 90, Math.min(base + 10, y + (next() - 0.52) * roughness)); context.lineTo(x, y); }
    context.lineTo(2048, base); context.lineTo(2048, 1024); context.closePath(); context.fill();
  }
  return element;
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

export function labelSprite(text: string, accent = "#e9cf94") {
  const [element, context] = canvas(512, 128);
  context.font = "600 54px Georgia, serif"; context.textAlign = "center"; context.textBaseline = "middle";
  context.shadowColor = "rgba(0,0,0,.85)"; context.shadowBlur = 18; context.fillStyle = accent;
  context.letterSpacing = "10px"; context.fillText(text.toUpperCase(), 256, 64, 480);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureFrom(element), transparent: true, depthWrite: false, opacity: 0 }));
  sprite.scale.set(3.2, 0.8, 1);
  return sprite;
}

export function buildWorld(scene: THREE.Scene) {
  const group = new THREE.Group(); scene.add(group);
  const skyCanvas = paintedSky();
  const skyMaterial = new THREE.MeshBasicMaterial({ map: textureFrom(skyCanvas), side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(48, 48, 24), skyMaterial); sky.renderOrder = -1; group.add(sky);
  void Promise.all([loadImage(WORLD_TEXTURES.clouds), loadImage(WORLD_TEXTURES.nebula)]).then(([clouds, nebula]) => {
    if (!clouds && !nebula) return;
    paintedSky({ clouds, nebula }, skyCanvas); if (skyMaterial.map) skyMaterial.map.needsUpdate = true;
  });
  // Elwynn grass to the horizon, with a cobbled plaza whose edge fades into it.
  // The grass is drawn first and writes no depth, so the plaza above it can never z-fight with it,
  // however far away or shaky the camera is. Nothing in the world sits below the ground.
  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3a1c, roughness: 1, depthWrite: false });
  const grass = new THREE.Mesh(new THREE.CircleGeometry(46, 96), grassMaterial);
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.03; grass.receiveShadow = true; grass.renderOrder = -0.5; group.add(grass);
  upgrade(grassMaterial, WORLD_TEXTURES.grass, 70, true);
  const [fadeCanvas, fade] = canvas(256, 256);
  const edge = fade.createRadialGradient(128, 128, 0, 128, 128, 128);
  edge.addColorStop(0, "#fff"); edge.addColorStop(0.86, "#fff"); edge.addColorStop(1, "#000");
  fade.fillStyle = edge; fade.fillRect(0, 0, 256, 256);
  const plazaMaterial = new THREE.MeshStandardMaterial({ map: textureFrom(paintedCobbles(), 11), alphaMap: new THREE.CanvasTexture(fadeCanvas), transparent: true, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA_RADIUS, 96), plazaMaterial);
  // Transparent for its soft edge, so it must draw before every other transparent object
  // (fading box walls, glows); otherwise they clip it and the grass shows through.
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = -0.015; plaza.receiveShadow = true; plaza.renderOrder = -0.4; group.add(plaza);
  upgrade(plazaMaterial, WORLD_TEXTURES.cobble, 16);
  // A ring of lamp posts: cheap geometry, an emissive bulb and an additive glow each.
  const glowCanvas = canvas(64, 64);
  const halo = glowCanvas[1].createRadialGradient(32, 32, 0, 32, 32, 32);
  halo.addColorStop(0, "rgba(255,214,150,1)"); halo.addColorStop(0.3, "rgba(255,190,110,.4)"); halo.addColorStop(1, "rgba(255,170,90,0)");
  glowCanvas[1].fillStyle = halo; glowCanvas[1].fillRect(0, 0, 64, 64);
  const glowMap = textureFrom(glowCanvas[0]);
  const iron = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.6, metalness: 0.6 });
  const bulb = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const post = new THREE.CylinderGeometry(0.06, 0.09, 3.2, 8), lantern = new THREE.OctahedronGeometry(0.18, 0);
  for (let i = 0; i < 10; i++) {
    const angle = (i + 0.5) / 10 * Math.PI * 2, radius = PLAZA_RADIUS - 0.8;
    const lamp = new THREE.Group(); lamp.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius); group.add(lamp);
    const pole = new THREE.Mesh(post, iron); pole.position.y = 1.6; pole.castShadow = false; lamp.add(pole);
    const light = new THREE.Mesh(lantern, bulb); light.position.y = 3.3; lamp.add(light);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.y = 3.3; glow.scale.setScalar(1.6); lamp.add(glow);
  }
  return { group };
}

// Places a station group in the world.
export function placeStation(scene: THREE.Scene, station: keyof typeof STATIONS) {
  const group = new THREE.Group();
  group.position.copy(STATIONS[station].position); group.rotation.y = STATIONS[station].rotation;
  scene.add(group);
  return group;
}

// Camera pose for each view. `framing` (>= 1) backs off on portrait screens; `pan` (-1..1)
// slides the menu shot toward the shop or the case.
export function viewPose(view: WorldView, framing: number, home: { offset: THREE.Vector3; target: THREE.Vector3 }, pan = 0) {
  const pose = (target: THREE.Vector3, offset: THREE.Vector3, scale = framing) => ({ target, position: offset.multiplyScalar(scale).add(target) });
  const station = (name: keyof typeof STATIONS, offset: THREE.Vector3, height: number) => {
    const { position, rotation } = STATIONS[name];
    const target = new THREE.Vector3(0, height, 0).add(position);
    return pose(target, offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation));
  };
  switch (view) {
    case "menu": return pose(new THREE.Vector3(pan * 5.8, 1.6, -2.6), new THREE.Vector3(0, 7.6, 20.5), Math.min(2, framing ** 1.2));
    case "shop": return station("shop", new THREE.Vector3(0, 1.6, 8.8), 1.9);
    case "gallery": return station("gallery", new THREE.Vector3(0, 1.1, 10.4), 2.45);
    case "viewer": return pose(home.target.clone(), new THREE.Vector3(2.4, 0.8, 6.2));
    default: return pose(home.target.clone(), home.offset.clone());
  }
}
