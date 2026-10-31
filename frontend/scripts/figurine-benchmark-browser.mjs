/* Browser-only harness served by figurine-benchmark-server.mjs. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { restoreFigurineMaterials } from "/lib/figurine-materials.ts";
import { applyFinish, releaseFinishes } from "/lib/figurine-finish.ts";
import { figurineResourceBytes, disposeFigurineObject } from "/lib/figurine-cache.ts";
import { uploadFigurineTextures } from "/lib/figurine-warmup.ts";
import { createBoxPrints, PACKAGING_THEMES, PACKAGING_FALLBACK, BOX_SIZE } from "/lib/figurine-packaging.ts";

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(960, 720); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
document.querySelector("#view").append(renderer.domElement);
const gl = renderer.getContext();
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
const env = pmrem.fromScene(room, 0.04); room.dispose(); pmrem.dispose();
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x20252d); scene.environment = env.texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x556677, 2));
const light = new THREE.DirectionalLight(0xffefd5, 3); light.position.set(3, 6, 5); scene.add(light);
const camera = new THREE.PerspectiveCamera(36, 960 / 720, 0.01, 100);
const ktx = new KTX2Loader().setTranscoderPath("/three/examples/jsm/libs/basis/").setWorkerLimit(2).detectSupport(renderer);
const { useWorkers: startMeshoptWorkers } = MeshoptDecoder;
startMeshoptWorkers?.(2);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx);
const nextFrame = () => new Promise(requestAnimationFrame);
const tasks = []; const observer = new PerformanceObserver((list) => tasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration }))));
observer.observe({ type: "longtask" });
let current;
const bytes = new Map();
function textures(root) { const found = new Set(); root.traverse((object) => { for (const material of object.material ? [object.material].flat() : []) for (const value of Object.values(material)) if (value?.isTexture) found.add(value); }); return [...found]; }
function dispose() { if (current) { scene.remove(current); releaseFinishes(current); disposeFigurineObject(current, new Set([env.texture])); current = null; renderer.renderLists.dispose(); } }
async function load(id, variant, finish = "standard") {
  window.loadPhase = `${id}/${variant}/${finish}: fetch`;
  dispose();
  const url = variant === "webp" ? `/pilot/webp/${id}.glb` : `/pilot/${variant === "etc1s" ? "etc1s/" : ""}${id}.glb`;
  if (!bytes.has(url)) { const response = await fetch(url); if (!response.ok) throw new Error(url); bytes.set(url, await response.arrayBuffer()); }
  const data = bytes.get(url).slice(0);
  await nextFrame(); const start = performance.now();
  const intervals = []; let last = start, running = true;
  const sample = (time) => { intervals.push(time - last); last = time; if (running) requestAnimationFrame(sample); }; requestAnimationFrame(sample);
  window.loadPhase = `${id}/${variant}/${finish}: parse`;
  const parsed = await loader.parseAsync(data, ""); const parseMs = performance.now() - start;
  window.loadPhase = `${id}/${variant}/${finish}: upload`;
  current = new THREE.Group(); parsed.scene.rotation.y = -Math.PI / 2; current.add(parsed.scene);
  restoreFigurineMaterials(current); applyFinish(current, finish, env.texture);
  const bounds = new THREE.Box3().setFromObject(current), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  parsed.scene.position.sub(center); scene.add(current);
  camera.position.set(0, size.y * 0.04, Math.max(size.y, size.x) * 1.85); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  const uploads = [];
  await uploadFigurineTextures({ initTexture(texture) { const t = performance.now(); renderer.initTexture(texture); uploads.push(performance.now() - t); } }, current, () => true);
  window.loadPhase = `${id}/${variant}/${finish}: compile`;
  const compileStart = performance.now(); await renderer.compileAsync(current, camera, scene); const compileMs = performance.now() - compileStart;
  window.loadPhase = `${id}/${variant}/${finish}: draw`;
  const drawStart = performance.now(); renderer.render(scene, camera); gl.finish(); const drawAndWaitMs = performance.now() - drawStart;
  const readyMs = performance.now() - start;
  running = false; await nextFrame(); await new Promise((resolve) => setTimeout(resolve, 0));
  const maps = textures(current);
  window.loadPhase = `${id}/${variant}/${finish}: ready`;
  return { id, variant, finish, parseMs, uploadCpuMs: uploads.reduce((a, b) => a + b, 0), maxUploadCpuMs: Math.max(...uploads), compileMs, drawAndWaitMs, readyMs, maxFrameGapMs: Math.max(...intervals), longTasks: tasks.filter((task) => task.startTime >= start && task.startTime < start + readyMs), resourceBytes: figurineResourceBytes(current), textures: maps.length, compressedTextures: maps.filter((map) => map.isCompressedTexture).length, formats: [...new Set(maps.map((map) => map.format))], drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, rendererTextures: renderer.info.memory.textures };
}
async function run(rounds = 5, condition = "native CPU") {
  const report = { condition, userAgent: navigator.userAgent, viewport: [960, 720], dpr: 1, gpu: gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), note: "Network excluded: GLBs fetched once into memory. Each trial reparses a fresh copy. Uploads use the application's 4 ms CPU slices. First draw includes gl.finish diagnostic wait. Trial 0 includes cold decoder/shader costs; subsequent trials reuse workers and benefit from driver/browser warmup.", results: [] };
  for (let trial = 0; trial < rounds; trial++) for (const id of ["rmp", "kahvishock", "roidy"]) for (const variant of trial % 2 ? ["etc1s", "ktx2", "webp"] : ["webp", "ktx2", "etc1s"]) {
    document.querySelector("#status").textContent = `Trial ${trial + 1}/${rounds}: ${id} ${variant}`;
    const result = await load(id, variant); report.results.push({ trial, ...result });
    await nextFrame();
  }
  dispose(); renderer.render(scene, camera);
  report.afterDispose = { textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
  window.benchmarkReport = report;
  const response = await fetch("/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
  document.querySelector("#status").textContent = `Saved ${await response.text()}\n${JSON.stringify(report, null, 2)}`;
  return report;
}
async function boxes(densities = [500, 350, 250, 150]) {
  const results = [];
  for (const density of densities) {
    dispose(); const started = performance.now();
    const prints = createBoxPrints({ labels: { ...PACKAGING_FALLBACK, title: "SUOMIWOW", subtitle: "COMMUNITY SERIES" }, lineup: Array.from({ length: 16 }, (_, i) => `Figure ${i + 1}`), theme: PACKAGING_THEMES.amethyst }, env.texture, density);
    await prints.ready;
    current = new THREE.Mesh(new THREE.BoxGeometry(BOX_SIZE.width, BOX_SIZE.height, BOX_SIZE.depth), [prints.right, prints.left, prints.lid, prints.inside, prints.front, prints.back]);
    scene.add(current); camera.position.set(3.4, 2, 6.5); camera.lookAt(0, 0, 0);
    const buildMs = performance.now() - started, maps = textures(current).filter((map) => map !== env.texture), uploads = [];
    for (const map of maps) { const t = performance.now(); renderer.initTexture(map); uploads.push(performance.now() - t); await nextFrame(); }
    await renderer.compileAsync(current, camera, scene); renderer.render(scene, camera); gl.finish();
    results.push({ density, buildMs, resourceBytesIncludingSharedEnvironment: figurineResourceBytes(current), mapBytes: maps.reduce((sum, map) => sum + map.image.width * map.image.height * 16 / 3, 0), uploadCpuMs: uploads.reduce((a, b) => a + b, 0), maps: maps.map((map) => ({ width: map.image.width, height: map.image.height })) });
    prints.stop(); prints.edge.dispose();
  }
  await fetch("/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boxes: results }) });
  return results;
}
async function capture(id, variants = ["webp", "ktx2", "etc1s"]) {
  const captures = [];
  for (const variant of variants) for (const finish of ["standard", "golden", "galaxy"]) {
    await load(id, variant, finish);
    for (const angle of [0, Math.PI]) {
      current.rotation.y = angle; renderer.render(scene, camera); gl.finish();
      captures.push({ id, variant, finish, angle, png: renderer.domElement.toDataURL("image/png") });
    }
  }
  const response = await fetch("/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ captures }) });
  return response.text();
}
window.figurineBenchmark = { run, load, boxes, capture, rotate: async (angle) => { current.rotation.y = angle; renderer.render(scene, camera); await nextFrame(); }, screenshot: () => renderer.domElement.toDataURL("image/png") };
document.querySelector("#status").textContent = "Ready. Run figurineBenchmark.run() in DevTools. Trial 0 is cold; later trials alternate formats.";
