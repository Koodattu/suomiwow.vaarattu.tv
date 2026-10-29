import * as THREE from "three";
import { BOX_SIZE, createBoxPrints, type BoxDesign } from "@/lib/figurine-packaging";

// Market stall with a stack of boxes per series on the counter and more on the shelves.
function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = width; element.height = height;
  return [element, element.getContext("2d")!] as const;
}
const texture = (element: HTMLCanvasElement) => { const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map; };

export function woodTexture(seed = 1, tone: [number, number, number] = [92, 58, 34]) {
  const [element, context] = canvas(256, 512);
  let state = seed;
  const next = () => (state = (state * 16807) % 2147483647) / 2147483647;
  for (let plank = 0; plank < 4; plank++) {
    const shade = 0.8 + next() * 0.35;
    context.fillStyle = `rgb(${tone[0] * shade},${tone[1] * shade},${tone[2] * shade})`; context.fillRect(plank * 64, 0, 64, 512);
    for (let line = 0; line < 22; line++) {
      context.strokeStyle = `rgba(30,16,8,${0.08 + next() * 0.18})`; context.lineWidth = 1 + next() * 1.5;
      const x = plank * 64 + next() * 64;
      context.beginPath(); context.moveTo(x, 0); context.bezierCurveTo(x + next() * 8 - 4, 170, x + next() * 8 - 4, 340, x + next() * 6 - 3, 512); context.stroke();
    }
    context.fillStyle = "rgba(20,10,4,.6)"; context.fillRect(plank * 64, 0, 2, 512);
  }
  const map = texture(element); map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

function stripes() {
  const [element, context] = canvas(256, 64);
  for (let i = 0; i < 8; i++) { context.fillStyle = i % 2 ? "#d8b46a" : "#6a1d2c"; context.fillRect(i * 32, 0, 32, 64); }
  context.fillStyle = "rgba(0,0,0,.25)"; context.fillRect(0, 52, 256, 12);
  for (let i = 0; i < 8; i++) { context.fillStyle = i % 2 ? "#d8b46a" : "#6a1d2c"; context.beginPath(); context.moveTo(i * 32, 52); context.lineTo(i * 32 + 32, 52); context.lineTo(i * 32 + 16, 64); context.fill(); }
  const map = texture(element); map.wrapS = THREE.RepeatWrapping; map.repeat.set(3, 1);
  return map;
}

function signTexture(title: string, line: string) {
  const [element, context] = canvas(1024, 256);
  context.fillStyle = "#2a1a10"; context.fillRect(0, 0, 1024, 256);
  context.strokeStyle = "#c9a565"; context.lineWidth = 10; context.strokeRect(14, 14, 996, 228);
  context.fillStyle = "#f1d48a"; context.textAlign = "center"; context.textBaseline = "middle";
  context.font = "700 110px Georgia, serif"; context.letterSpacing = "18px"; context.fillText(title.toUpperCase(), 512, 112, 940);
  context.font = "600 34px system-ui, sans-serif"; context.letterSpacing = "6px"; context.fillStyle = "#d9c49a"; context.fillText(line.toUpperCase(), 512, 200, 900);
  return texture(element);
}

export type ShopSeries = { id: string; design: BoxDesign; count: number; accent: string };
export type ShopLabels = { sign: string; free: string; series: (number: string) => string; figures: (count: number) => string; collected: (got: number, total: number) => string };

export function buildShop(parent: THREE.Group, { series, envMap, labels }: { series: ShopSeries[]; envMap: THREE.Texture; labels: ShopLabels }) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(7), roughness: 0.75 });
  const darkWood = new THREE.MeshStandardMaterial({ map: woodTexture(11, [58, 34, 22]), roughness: 0.6 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number, shadow = true) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = shadow; parent.add(mesh); return mesh;
  };
  add(new THREE.BoxGeometry(5.6, 1.05, 1.1), wood, 0, 0.525, 0.9);
  add(new THREE.BoxGeometry(5.9, 0.08, 1.3), darkWood, 0, 1.09, 0.9);
  add(new THREE.BoxGeometry(6, 3.5, 0.15), wood, 0, 1.75, -0.95);
  for (const y of [1.75, 2.65]) add(new THREE.BoxGeometry(5.8, 0.07, 0.55), darkWood, 0, y, -0.62);
  const post = new THREE.CylinderGeometry(0.07, 0.08, 3.9, 8);
  for (const x of [-2.95, 2.95]) for (const z of [1.5, -0.85]) add(post, darkWood, x, 1.95, z);
  const canopy = add(new THREE.PlaneGeometry(6.4, 2.7), new THREE.MeshStandardMaterial({ map: stripes(), roughness: 0.9, side: THREE.DoubleSide }), 0, 3.95, 0.35);
  canopy.rotation.x = -Math.PI / 2 + 0.32;
  const sign = add(new THREE.BoxGeometry(2.8, 0.7, 0.07), [darkWood, darkWood, darkWood, darkWood, new THREE.MeshStandardMaterial({ map: signTexture(labels.sign, labels.free), roughness: 0.6 }), darkWood], 0, 4.5, 1.55);
  sign.castShadow = false;

  const picks: THREE.Mesh[] = [];
  const stacks = series.map((entry, index) => {
    const prints = createBoxPrints(entry.design, envMap, 150);
    const s = 0.24, w = BOX_SIZE.width * s, h = BOX_SIZE.height * s, d = BOX_SIZE.depth * s;
    const geometry = new THREE.BoxGeometry(w, h, d);
    // BoxGeometry faces: +x, -x, +y, -y, +z, -z.
    const faces = [prints.right, prints.left, prints.lid, prints.edge, prints.front, prints.back];
    const stack = new THREE.Group(); stack.position.set(index === 0 ? -1.45 : 1.45, 0, 0); parent.add(stack);
    const lift = new THREE.Group(); stack.add(lift);
    const place = (group: THREE.Group, x: number, y: number, z: number, yaw: number) => {
      const boxMesh = new THREE.Mesh(geometry, faces); boxMesh.position.set(x, y + h / 2, z); boxMesh.rotation.y = yaw; boxMesh.castShadow = true; group.add(boxMesh);
    };
    [[-0.52, 0], [0, 0], [0.52, 0], [-0.26, 1], [0.26, 1], [0, 2]].forEach(([x, row], i) => place(lift, x, 1.13 + row * h, 0.9, (i % 3 - 1) * 0.06));
    for (const y of [1.785, 2.685]) [-0.75, -0.25, 0.25, 0.75].forEach((x, i) => place(stack, x, y, -0.6, (i % 2 ? 1 : -1) * 0.08));
    const [plaqueCanvas, plaque] = canvas(768, 224);
    const plaqueMap = texture(plaqueCanvas);
    const paint = (got: number) => {
      plaque.fillStyle = "#1b120c"; plaque.fillRect(0, 0, 768, 224);
      plaque.strokeStyle = entry.accent; plaque.lineWidth = 8; plaque.strokeRect(10, 10, 748, 204);
      plaque.textAlign = "center"; plaque.textBaseline = "middle";
      plaque.fillStyle = "#f1d48a"; plaque.font = "700 64px Georgia, serif"; plaque.letterSpacing = "8px"; plaque.fillText(labels.series(entry.design.theme.number), 384, 70, 700);
      plaque.fillStyle = "#e6d6b5"; plaque.font = "600 30px system-ui, sans-serif"; plaque.letterSpacing = "3px";
      plaque.fillText(`${labels.figures(entry.count)} · ${labels.free}`.toUpperCase(), 384, 134, 700);
      plaque.fillStyle = entry.accent; plaque.fillText(labels.collected(got, entry.count).toUpperCase(), 384, 182, 700);
      plaqueMap.needsUpdate = true;
    };
    paint(0);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.55), new THREE.MeshStandardMaterial({ map: plaqueMap, roughness: 0.7 }));
    sign.position.set(0, 0.62, 1.46); stack.add(sign);
    const glowCanvas = canvas(64, 64);
    const gradient = glowCanvas[1].createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, entry.accent); gradient.addColorStop(1, "rgba(0,0,0,0)");
    glowCanvas[1].fillStyle = gradient; glowCanvas[1].fillRect(0, 0, 64, 64);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(glowCanvas[0]), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.set(0, 1.7, 0.9); glow.scale.set(2.6, 2.2, 1); stack.add(glow);
    const pick = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.4, 2.6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    pick.position.set(0, 1.7, 0.3); pick.userData.series = entry.id; stack.add(pick); picks.push(pick);
    return { id: entry.id, lift, glow, paint, hover: 0, stop: prints.stop };
  });

  return {
    picks,
    setCollected(id: string, got: number) { stacks.find((stack) => stack.id === id)?.paint(got); },
    update(hovered: string | null, delta: number, time: number) {
      for (const stack of stacks) {
        stack.hover = THREE.MathUtils.damp(stack.hover, stack.id === hovered ? 1 : 0, 10, delta);
        stack.lift.position.y = stack.hover * 0.08 + Math.sin(time * 2 + stack.lift.id) * 0.01 * stack.hover;
        stack.glow.material.opacity = 0.15 + stack.hover * 0.45;
      }
    },
    stop() { stacks.forEach((stack) => stack.stop()); },
  };
}
