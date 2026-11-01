// Interactive visual review, kept separate from the timed benchmark harness.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { restoreFigurineMaterials } from "/lib/figurine-materials.ts";
import { applyFinish, releaseFinishes } from "/lib/figurine-finish.ts";
import { figurineResourceBytes, disposeFigurineObject } from "/lib/figurine-cache.ts";
import { uploadFigurineTextures } from "/lib/figurine-warmup.ts";

const view = document.querySelector("#view"), status = document.querySelector("#status"), metrics = document.querySelector("#metrics");
const modelSelect = document.querySelector("#model"), finishSelect = document.querySelector("#finish");
const buttons = [...document.querySelectorAll("[data-variant]")];
const names = { webp: "Original · WebP", etc1s: "KTX2 · ETC1S", ktx2: "KTX2 · UASTC" };
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
view.append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x20252d);
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04); room.dispose(); pmrem.dispose();
scene.environment = environment.texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 2));
const light = new THREE.DirectionalLight(0xffefd5, 3); light.position.set(3, 6, 5); scene.add(light);
const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
camera.position.z = 5;
const controls = new OrbitControls(camera, renderer.domElement);
controls.minDistance = 0.15; controls.maxDistance = 30;
const render = () => renderer.render(scene, camera);
controls.addEventListener("change", render);
new ResizeObserver(() => {
  const { width, height } = view.getBoundingClientRect();
  renderer.setSize(width, height, false); camera.aspect = width / height;
  camera.updateProjectionMatrix(); render();
}).observe(view);
const ktx = new KTX2Loader().setTranscoderPath("/three/examples/jsm/libs/basis/").setWorkerLimit(2).detectSupport(renderer);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx);
const cache = new Map(), residents = new Set();
let epoch = 0, selection = 0, variant = "webp", current = null, framedModel = null;
let home = new THREE.Vector3(0, 0, 5);
function dispose(root) { root.removeFromParent(); releaseFinishes(root); disposeFigurineObject(root, new Set([environment.texture])); }
function clearModels() {
  epoch++; cache.clear(); residents.forEach(dispose); residents.clear(); current = null;
  metrics.textContent = "Preparing model…";
  renderer.renderLists.dispose(); render();
}
function resetCamera(back = false) {
  controls.target.set(0, 0, 0); camera.position.copy(home);
  if (back) camera.position.z *= -1;
  controls.update(); render();
}
async function prepare(id, format, finish, generation) {
  const url = format === "webp" ? `/pilot/webp/${id}.glb` : `/pilot/${format === "etc1s" ? "etc1s/" : ""}${id}.glb`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model request failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  if (generation !== epoch) return null;
  const gltf = await loader.parseAsync(bytes, "");
  const root = new THREE.Group(); gltf.scene.rotation.y = -Math.PI / 2; root.add(gltf.scene);
  try {
    if (generation !== epoch) { dispose(root); return null; }
    restoreFigurineMaterials(root); applyFinish(root, finish, environment.texture);
    const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3());
    gltf.scene.position.sub(bounds.getCenter(new THREE.Vector3()));
    if (!await uploadFigurineTextures(renderer, root, () => generation === epoch)) { dispose(root); return null; }
    await renderer.compileAsync(root, camera, scene);
    if (generation !== epoch) { dispose(root); return null; }
    root.visible = false; scene.add(root); residents.add(root);
    return { root, size, bytes: bytes.byteLength, resourceBytes: figurineResourceBytes(root) };
  } catch (error) { dispose(root); throw error; }
}
async function show() {
  const request = ++selection, id = modelSelect.value, finish = finishSelect.value, format = variant;
  const generation = epoch;
  status.textContent = `Loading ${names[format]}…${current ? " Previous version remains visible." : ""}`;
  view.setAttribute("aria-busy", "true");
  try {
    if (!cache.has(format)) cache.set(format, prepare(id, format, finish, generation));
    const result = await cache.get(format);
    if (request !== selection || !result) return;
    if (current) current.visible = false;
    current = result.root; current.visible = true;
    if (framedModel !== id) {
      framedModel = id;
      home.set(0, result.size.y * 0.04, Math.max(result.size.y, result.size.x / camera.aspect) * 1.85);
      resetCamera();
    }
    render();
    buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.variant === format)));
    status.textContent = `${modelSelect.selectedOptions[0].textContent} · ${names[format]} · ${finishSelect.selectedOptions[0].textContent}`;
    metrics.textContent = `GLB file: ${(result.bytes / 1048576).toFixed(2)} MiB · Geometry + material textures: ${(result.resourceBytes / 1048576).toFixed(1)} MiB on this device (estimated payload, not total GPU memory).`;
  } catch (error) {
    if (generation === epoch) cache.delete(format);
    if (request === selection) status.textContent = `${names[format]} could not load. ${error.message} Select a format to retry.`;
  } finally { if (request === selection) view.setAttribute("aria-busy", "false"); }
}
buttons.forEach(button => button.addEventListener("click", () => { variant = button.dataset.variant; void show(); }));
for (const select of [modelSelect, finishSelect]) select.addEventListener("change", () => { clearModels(); void show(); });
document.querySelector("#front").addEventListener("click", () => resetCamera());
document.querySelector("#back").addEventListener("click", () => resetCamera(true));
for (const [id, scale] of [["closer", 0.8], ["farther", 1.25]]) document.querySelector(`#${id}`).addEventListener("click", () => {
  const offset = camera.position.clone().sub(controls.target);
  offset.setLength(THREE.MathUtils.clamp(offset.length() * scale, controls.minDistance, controls.maxDistance));
  camera.position.copy(controls.target).add(offset); controls.update(); render();
});
void show();
