import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// Hover glow for solid props: a back-facing shell pushed out along smoothed normals, drawn
// additively and brightest at the silhouette. Shells exist only while something is hovered.
const SHELL_VERTEX = `uniform float width; varying float vRim;
void main() {
  vec3 n = normalize(normal);
  vec4 view = modelViewMatrix * vec4(position + n * width, 1.0);
  vRim = 1.0 - abs(dot(normalize(normalMatrix * n), normalize(-view.xyz)));
  gl_Position = projectionMatrix * view;
}`;
const SHELL_FRAGMENT = `uniform vec3 color; uniform float strength; varying float vRim;
void main() { gl_FragColor = vec4(color * strength * (0.35 + 0.9 * vRim * vRim), 1.0); }`;

// Split-face geometry (boxes) would open gaps at the corners; welded copies keep the shell closed.
const welded = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function shellGeometry(source: THREE.BufferGeometry) {
  let shell = welded.get(source);
  if (!shell) {
    const bare = new THREE.BufferGeometry();
    bare.setAttribute("position", source.getAttribute("position").clone());
    if (source.index) bare.setIndex(source.index.clone());
    shell = mergeVertices(bare, 1e-4); shell.computeVertexNormals(); bare.dispose();
    welded.set(source, shell);
  }
  return shell;
}

export function hoverOutline(meshes: THREE.Mesh[], color: THREE.ColorRepresentation, width = 0.03) {
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: 0 }, width: { value: width } },
    vertexShader: SHELL_VERTEX, fragmentShader: SHELL_FRAGMENT,
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const shells = meshes.map((mesh) => {
    const shell = new THREE.Mesh(shellGeometry(mesh.geometry), material);
    shell.visible = false; shell.raycast = () => {}; shell.renderOrder = 1; shell.userData.outline = true;
    mesh.add(shell);
    return shell;
  });
  let level = 0, shown = false;
  return {
    update(target: number, delta: number) {
      level = THREE.MathUtils.damp(level, target, 12, delta);
      material.uniforms.strength.value = level;
      if (shown !== level > 0.01) { shown = !shown; shells.forEach((shell) => { shell.visible = shown; }); }
    },
    dispose() { shells.forEach((shell) => shell.removeFromParent()); material.dispose(); },
  };
}

// Hover glow for a flat figure card: a larger plane behind it that blurs the card's alpha outward,
// so the halo follows the figure's outline.
export function cardGlow(width: number, height: number, color: THREE.ColorRepresentation, spread = 1.3) {
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: null as THREE.Texture | null }, uvRepeat: { value: new THREE.Vector2(1, 1) }, uvOffset: { value: new THREE.Vector2() }, color: { value: new THREE.Color(color) }, strength: { value: 0 }, aspect: { value: height / width } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform sampler2D map; uniform vec2 uvRepeat; uniform vec2 uvOffset; uniform vec3 color; uniform float strength; uniform float aspect; varying vec2 vUv;
float alphaAt(vec2 uv) { return uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ? 0.0 : texture2D(map, uv * uvRepeat + uvOffset).a; }
void main() {
  vec2 uv = (vUv - 0.5) * ${spread.toFixed(3)} + 0.5;
  float sum = 0.0;
  for (int ring = 1; ring <= 3; ring++) for (int i = 0; i < 12; i++) {
    float angle = float(i) * 0.5236 + float(ring) * 0.26;
    sum += alphaAt(uv + vec2(cos(angle) * aspect, sin(angle)) * float(ring) * 0.022);
  }
  gl_FragColor = vec4(color * strength * (sum / 36.0) * (1.0 - alphaAt(uv)) * 0.8, 1.0);
}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  // Bottom-pivoted like the cards, so it can copy a card's position and scale.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width * spread, height * spread).translate(0, height / 2, 0), material);
  mesh.visible = false; mesh.raycast = () => {};
  let level = 0;
  return {
    mesh,
    // Follows `card` (its map, placement and scale) while `target` is 1.
    update(card: THREE.Mesh | null, target: number, delta: number) {
      level = THREE.MathUtils.damp(level, card ? target : 0, 12, delta);
      material.uniforms.strength.value = level;
      mesh.visible = level > 0.01;
      const map = (card?.material as THREE.MeshBasicMaterial | undefined)?.map;
      if (card && map) {
        material.uniforms.map.value = map; material.uniforms.uvRepeat.value.copy(map.repeat); material.uniforms.uvOffset.value.copy(map.offset);
        mesh.position.set(card.position.x, card.position.y, card.position.z - 0.006);
        mesh.scale.copy(card.scale);
      }
    },
  };
}
