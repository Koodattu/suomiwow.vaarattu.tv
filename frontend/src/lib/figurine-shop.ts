import * as THREE from "three";
import { BOX_SIZE, createBoxPrints, type BoxDesign } from "@/lib/figurine-packaging";

// Market stall: a stepped riser of blind boxes on the counter, one box per series.
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

export function signTexture(title: string) {
  const [element, context] = canvas(1024, 256);
  context.fillStyle = "#2a1a10"; context.fillRect(0, 0, 1024, 256);
  context.strokeStyle = "#c9a565"; context.lineWidth = 10; context.strokeRect(14, 14, 996, 228);
  context.fillStyle = "#f1d48a"; context.textAlign = "center"; context.textBaseline = "middle";
  context.font = "700 120px Georgia, serif"; context.letterSpacing = "18px"; context.fillText(title.toUpperCase(), 512, 134, 940);
  return texture(element);
}

// Series not yet released: the print mostly drained of colour and dimmed; its hue still shows.
export function greyedPrint(material: THREE.Material) {
  const copy = material.clone();
  copy.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
      diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) ), diffuseColor.rgb, 0.4 ) * 0.7;`);
  };
  copy.customProgramCacheKey = () => "figurine-greyed";
  return copy;
}

export type ShopSeries = { id: string; number: string; design: BoxDesign; count: number; accent: string; released: boolean };
export type ShopLabels = { sign: string; series: (number: string) => string; collected: (got: number, total: number) => string; comingSoon: string };
// The stall's display: a stepped riser on the counter with one box per series, five to a step,
// first series front left. Each step is taller than a box, so every step's price tag shows over
// the boxes in front of it.
const COLUMNS = 5, SCALE = 0.19, SPACING = 1.04, RISE = 0.6, RUN = 0.5, COUNTER_TOP = 1.13, PLINTH = 0.14, FRONT = 1.36;
const BOX = { w: BOX_SIZE.width * SCALE, h: BOX_SIZE.height * SCALE, d: BOX_SIZE.depth * SCALE };

export function buildShop(parent: THREE.Group, { series, envMap, labels }: { series: ShopSeries[]; envMap: THREE.Texture; labels: ShopLabels }) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(7), roughness: 0.75 });
  const darkWood = new THREE.MeshStandardMaterial({ map: woodTexture(11, [58, 34, 22]), roughness: 0.6 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a565, metalness: 1, roughness: 0.3, envMap });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number, shadow = true) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = shadow; parent.add(mesh); return mesh;
  };
  // The stall's solid frame, which glows when the shop is hovered.
  const frame = [
    add(new THREE.BoxGeometry(5.6, 1.05, 1.1), wood, 0, 0.525, 0.9), add(new THREE.BoxGeometry(5.9, 0.08, 1.3), darkWood, 0, 1.09, 0.9),
    add(new THREE.BoxGeometry(6, 4, 0.15), wood, 0, 2, -0.95),
  ];
  const post = new THREE.CylinderGeometry(0.07, 0.08, 3.9, 8);
  for (const x of [-2.95, 2.95]) for (const z of [1.5, -0.85]) frame.push(add(post, darkWood, x, 1.95, z));
  const canopy = add(new THREE.PlaneGeometry(6.4, 2.7), new THREE.MeshStandardMaterial({ map: stripes(), roughness: 0.9, side: THREE.DoubleSide }), 0, 4.15, 0.35);
  canopy.rotation.x = -Math.PI / 2 + 0.32;
  const sign = add(new THREE.BoxGeometry(2.8, 0.7, 0.07), [darkWood, darkWood, darkWood, darkWood, new THREE.MeshStandardMaterial({ map: signTexture(labels.sign), roughness: 0.6 }), darkWood], 0, 4.7, 1.55);
  sign.castShadow = false;
  const rows = Math.ceil(series.length / COLUMNS), width = COLUMNS * SPACING + 0.3;
  const stepTop = (row: number) => COUNTER_TOP + PLINTH + row * RISE, stepFront = (row: number) => FRONT - row * RUN;
  for (let row = 0; row < rows; row++) {
    const top = stepTop(row), front = stepFront(row);
    frame.push(add(new THREE.BoxGeometry(width, top, RUN), darkWood, 0, top / 2, front - RUN / 2));
    add(new THREE.BoxGeometry(width, 0.018, 0.018), gold, 0, top - 0.009, front + 0.004, false);
  }

  const picks: THREE.Mesh[] = [];
  const hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const geometry = new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d);
  const tagGeometry = new THREE.PlaneGeometry(0.66, 0.12), pickGeometry = new THREE.BoxGeometry(0.8, BOX.h + 0.3, RUN);
  const stacks = series.map((entry, index) => {
    const row = Math.floor(index / COLUMNS), column = index % COLUMNS;
    const prints = createBoxPrints(entry.design, envMap, 150);
    // BoxGeometry faces: +x, -x, +y, -y, +z, -z.
    const printed = [prints.right, prints.left, prints.lid, prints.edge, prints.front, prints.back];
    const faces = entry.released ? printed : printed.map(greyedPrint);
    const stack = new THREE.Group(); stack.position.set((column - (COLUMNS - 1) / 2) * SPACING, stepTop(row), stepFront(row) - RUN / 2); parent.add(stack);
    const lift = new THREE.Group(); stack.add(lift);
    const boxMesh = new THREE.Mesh(geometry, faces); boxMesh.position.y = BOX.h / 2; boxMesh.rotation.y = (column - 2) * -0.05; boxMesh.castShadow = true; lift.add(boxMesh);
    // The price tag on the step's edge: series number, and how many are collected (or "soon").
    const [tagCanvas, tag] = canvas(352, 64);
    const tagMap = texture(tagCanvas);
    const paint = (got: number) => {
      tag.fillStyle = "#1b120c"; tag.fillRect(0, 0, 352, 64);
      tag.fillStyle = entry.released ? entry.accent : "#5d554c"; tag.fillRect(0, 0, 8, 64);
      tag.textBaseline = "middle"; tag.textAlign = "left";
      tag.fillStyle = entry.released ? "#f1d48a" : "#9b907e"; tag.font = "700 34px Georgia, serif"; tag.letterSpacing = "3px"; tag.fillText(entry.number, 22, 34);
      tag.textAlign = "right"; tag.font = "600 24px system-ui, sans-serif"; tag.letterSpacing = "2px";
      tag.fillStyle = entry.released ? entry.accent : "#8a8072"; tag.fillText((entry.released ? labels.collected(got, entry.count) : labels.comingSoon).toUpperCase(), 336, 34, 220);
      tagMap.needsUpdate = true;
    };
    paint(0);
    const label = new THREE.Mesh(tagGeometry, new THREE.MeshStandardMaterial({ map: tagMap, roughness: 0.7 }));
    label.position.set(0, -0.075, RUN / 2 + 0.003); stack.add(label);
    const glowCanvas = canvas(64, 64);
    const gradient = glowCanvas[1].createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, entry.released ? entry.accent : "#9a9284"); gradient.addColorStop(1, "rgba(0,0,0,0)");
    glowCanvas[1].fillStyle = gradient; glowCanvas[1].fillRect(0, 0, 64, 64);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(glowCanvas[0]), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.set(0, BOX.h / 2, 0.1); glow.scale.set(1.1, 1.1, 1); stack.add(glow);
    const pick = new THREE.Mesh(pickGeometry, hidden); pick.position.y = BOX.h / 2 - 0.1; pick.userData.series = entry.id; stack.add(pick); picks.push(pick);
    return { id: entry.id, lift, glow, paint, hover: 0, boxes: [boxMesh], faces, released: entry.released, ready: prints.ready, stop: prints.stop };
  });

  return {
    picks, frame,
    ready: Promise.all(stacks.map((stack) => stack.ready)),
    boxes: new Map(stacks.map((stack) => [stack.id, stack.boxes])),
    // A copy of a series' shop box, for the case's shelf ends and the recycler's chute.
    boxCopy(id: string) {
      const stack = stacks.find((entry) => entry.id === id);
      if (!stack) return null;
      const copy = new THREE.Mesh(geometry, stack.faces); copy.castShadow = true;
      return copy;
    },
    boxSize: BOX,
    setCollected(id: string, got: number) { stacks.find((stack) => stack.id === id)?.paint(got); },
    update(hovered: string | null, delta: number, time: number) {
      for (const stack of stacks) {
        stack.hover = THREE.MathUtils.damp(stack.hover, stack.id === hovered ? 1 : 0, 10, delta);
        stack.lift.position.y = stack.hover * 0.07 + Math.sin(time * 2 + stack.lift.id) * 0.008 * stack.hover;
        stack.glow.material.opacity = (stack.released ? 0.12 : 0) + stack.hover * 0.4;
      }
    },
    stop() { stacks.forEach((stack) => stack.stop()); },
  };
}
