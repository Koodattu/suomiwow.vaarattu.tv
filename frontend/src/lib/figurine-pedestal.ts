import * as THREE from "three";

// Display pedestal: a turned, lacquered stone body with gold trim, a static centre emblem,
// and an outer rune ring (series name, one notch per character) whose gold inlay glows.
export const PEDESTAL_TOP = 0.16;
const RADIUS = 1.8, INNER = 0.86, TEXTURE = 1024;

function canvas() {
  const element = document.createElement("canvas");
  element.width = element.height = TEXTURE;
  return [element, element.getContext("2d")!] as const;
}
// Finish channels as in the packaging: G = roughness, B = metalness.
const STONE = "rgb(0,90,0)", GOLD = "rgb(0,70,255)";

function goldGradient(context: CanvasRenderingContext2D) {
  const gradient = context.createLinearGradient(0, 0, TEXTURE, TEXTURE);
  [[0, "#f5dfa0"], [0.35, "#b98a3f"], [0.6, "#f1d48a"], [1, "#a8772f"]].forEach(([at, color]) => gradient.addColorStop(at as number, color as string));
  return gradient;
}

// Draws the same inlay as gold on the print, metal on the finish map and light on the emissive map.
function inlay(contexts: { color: CanvasRenderingContext2D; finish: CanvasRenderingContext2D; glow: CanvasRenderingContext2D }, draw: (context: CanvasRenderingContext2D) => void) {
  for (const [context, style] of [[contexts.color, goldGradient(contexts.color)], [contexts.finish, GOLD], [contexts.glow, "#ffcf7a"]] as const) {
    context.save(); context.translate(TEXTURE / 2, TEXTURE / 2); context.fillStyle = context.strokeStyle = style; draw(context); context.restore();
  }
}

function layers(paintStone: (context: CanvasRenderingContext2D) => void, paintInlay: (paint: (draw: (context: CanvasRenderingContext2D) => void) => void) => void) {
  const [colorCanvas, color] = canvas(), [finishCanvas, finish] = canvas(), [glowCanvas, glow] = canvas();
  paintStone(color);
  finish.fillStyle = STONE; finish.fillRect(0, 0, TEXTURE, TEXTURE);
  glow.fillStyle = "#000"; glow.fillRect(0, 0, TEXTURE, TEXTURE);
  paintInlay((draw) => inlay({ color, finish, glow }, draw));
  const map = new THREE.CanvasTexture(colorCanvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const finishMap = new THREE.CanvasTexture(finishCanvas); finishMap.anisotropy = 8;
  const emissiveMap = new THREE.CanvasTexture(glowCanvas); emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, finishMap, emissiveMap };
}

function stone(context: CanvasRenderingContext2D) {
  const half = TEXTURE / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "#141c33"); gradient.addColorStop(0.7, "#0d1426"); gradient.addColorStop(1, "#080d1a");
  context.fillStyle = gradient; context.fillRect(0, 0, TEXTURE, TEXTURE);
  // Fine turned grooves catch the light like a lathe-finished surface.
  context.strokeStyle = "rgba(160,180,255,.035)"; context.lineWidth = 1;
  for (let r = 8; r < half; r += 5) { context.beginPath(); context.arc(half, half, r, 0, Math.PI * 2); context.stroke(); }
}

function emblem() {
  return layers(stone, (paint) => {
    const scale = TEXTURE / 2 / INNER;
    paint((context) => {
      context.lineWidth = 3; context.globalAlpha = 0.55;
      for (let i = 0; i < 8; i++) { context.rotate(Math.PI / 4); context.beginPath(); context.moveTo(0, -0.62 * scale); context.lineTo(0.17 * scale, -0.17 * scale); context.lineTo(0.62 * scale, 0); context.stroke(); }
      context.globalAlpha = 1; context.lineWidth = 4;
      context.beginPath(); context.arc(0, 0, 0.7 * scale, 0, Math.PI * 2); context.stroke();
      context.lineWidth = 2; context.beginPath(); context.arc(0, 0, 0.74 * scale, 0, Math.PI * 2); context.stroke();
    });
  });
}

function runeRing(title: string, series: string, count: number) {
  return layers(stone, (paint) => {
    const scale = TEXTURE / 2 / RADIUS;
    paint((context) => {
      context.lineWidth = 3;
      for (const r of [INNER + 0.02, RADIUS - 0.03]) { context.beginPath(); context.arc(0, 0, r * scale, 0, Math.PI * 2); context.stroke(); }
      context.lineWidth = 1.5;
      for (const r of [INNER + 0.05, RADIUS - 0.06]) { context.beginPath(); context.arc(0, 0, r * scale, 0, Math.PI * 2); context.stroke(); }
      // Engraved series name, set around the ring.
      const label = `${title}  ✦  ${series}  ✦  `.toUpperCase();
      const textRadius = (RADIUS - 0.2) * scale;
      context.font = `600 ${Math.round(0.11 * scale)}px Georgia, serif`; context.textAlign = "center"; context.textBaseline = "middle";
      const repeats = Math.max(1, Math.floor(Math.PI * 2 * textRadius / context.measureText(label).width));
      const text = label.repeat(repeats), step = Math.PI * 2 / [...text].length;
      [...text].forEach((character, index) => {
        context.save(); context.rotate(index * step); context.translate(0, -textRadius); context.fillText(character, 0, 0); context.restore();
      });
      // One diamond notch per character in the series.
      const notchRadius = (INNER + 0.2) * scale;
      for (let i = 0; i < count; i++) {
        context.save(); context.rotate(i / count * Math.PI * 2); context.translate(0, -notchRadius);
        context.beginPath(); context.moveTo(0, -11); context.lineTo(7, 0); context.lineTo(0, 11); context.lineTo(-7, 0); context.closePath(); context.fill();
        context.restore();
      }
    });
  });
}

function surface({ map, finishMap, emissiveMap }: ReturnType<typeof emblem>, envMap: THREE.Texture) {
  return new THREE.MeshPhysicalMaterial({
    map, roughnessMap: finishMap, metalnessMap: finishMap, roughness: 1, metalness: 1,
    emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.3, clearcoat: 0.3, clearcoatRoughness: 0.3, envMap, envMapIntensity: 0.45,
  });
}

export function buildPedestal(parent: THREE.Object3D, { envMap, title, series, count }: { envMap: THREE.Texture; title: string; series: string; count: number }) {
  const group = new THREE.Group(); parent.add(group);
  // Turned body profile (radius, height): flared foot, a step, a waist groove and a top lip.
  const profile = [
    [0, 0], [2.02, 0], [2.06, 0.015], [2.06, 0.05], [2.02, 0.062], [1.95, 0.066], [1.93, 0.085],
    [1.88, 0.092], [1.86, 0.11], [1.88, 0.128], [1.86, 0.145], [1.83, PEDESTAL_TOP - 0.004], [0, PEDESTAL_TOP - 0.004],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x0f1628, roughness: 0.4, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.18, envMap, envMapIntensity: 0.45 });
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 128), lacquer);
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a565, metalness: 1, roughness: 0.28, envMap, envMapIntensity: 1.2 });
  const bands = [[2.06, 0.033, 0.012], [1.94, 0.076, 0.008], [1.87, 0.11, 0.007]].map(([radius, y, tube]) => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 160), gold);
    band.rotation.x = Math.PI / 2; band.position.y = y; return band;
  });
  const emblemMaterial = surface(emblem(), envMap), ringMaterial = surface(runeRing(title, series, count), envMap);
  const centre = new THREE.Mesh(new THREE.CircleGeometry(INNER, 96), emblemMaterial);
  const ring = new THREE.Mesh(new THREE.RingGeometry(INNER, 1.83, 160, 1), ringMaterial);
  for (const top of [centre, ring]) { top.rotation.x = -Math.PI / 2; top.position.y = PEDESTAL_TOP - 0.002; }
  ring.position.y += 0.0005;
  const meshes = [body, ...bands, centre, ring];
  meshes.forEach((mesh) => { mesh.receiveShadow = true; group.add(mesh); });
  body.castShadow = true;
  return {
    group,
    // `glow` drives the inlay light; `spin` turns the rune ring (radians).
    update(glow: number, spin: number) {
      emblemMaterial.emissiveIntensity = ringMaterial.emissiveIntensity = glow;
      ring.rotation.z = spin;
    },
  };
}
