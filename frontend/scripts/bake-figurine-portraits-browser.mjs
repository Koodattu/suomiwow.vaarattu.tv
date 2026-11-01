// Renders every character of each series into a portrait sheet and posts it back to the bake server.
// Figures are sized like on the pedestal (by the body, without items) and framed by the body too:
// orthographic, feet on the cell's bottom edge, a sixth of headroom for hats, so every figure fills
// its cell the same way. Staffs and wings that reach further are cropped by the cell.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { figurineBodyBounds, figurineScale, figurineSupport, restoreFigurineMaterials } from "/lib/figurine-materials.ts";

const CELL_W = 280, CELL_H = 360, COLUMNS = 8, SUPERSAMPLE = 2, PEDESTAL_TOP = 0.16;
const status = document.querySelector("#status"), sheets = document.querySelector("#sheets");
const log = (line) => { status.textContent += `\n${line}`; };
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(CELL_W * SUPERSAMPLE, CELL_H * SUPERSAMPLE, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xe0efff, 0x333048, 3));
const key = new THREE.DirectionalLight(0xffe2b0, 4); key.position.set(4, 6, 5); scene.add(key);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
const ktx2 = new KTX2Loader().setTranscoderPath("/figurines/basis/r186/").detectSupport(renderer);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);

function prepare(root) {
  restoreFigurineMaterials(root);
  root.rotation.y = -Math.PI / 2;
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const scale = figurineScale(figurineBodyBounds(root));
  const support = figurineSupport(root, bounds);
  root.scale.multiplyScalar(scale);
  root.position.set(-support.x * scale, PEDESTAL_TOP - support.y * scale, -support.z * scale);
  root.updateMatrixWorld(true);
  return root;
}
function frame(root) {
  const body = figurineBodyBounds(root);
  let frameH = (body.max.y - PEDESTAL_TOP) * 7 / 6, frameW = frameH * CELL_W / CELL_H;
  if (body.max.x - body.min.x > frameW * 0.92) { frameW = (body.max.x - body.min.x) / 0.92; frameH = frameW * CELL_H / CELL_W; }
  const centreX = (body.min.x + body.max.x) / 2;
  Object.assign(camera, { left: centreX - frameW / 2, right: centreX + frameW / 2, bottom: PEDESTAL_TOP, top: PEDESTAL_TOP + frameH });
  camera.position.set(0, 0, 20); camera.updateProjectionMatrix();
}
const dispose = (root) => root.traverse((mesh) => {
  if (!mesh.isMesh) return;
  mesh.geometry.dispose();
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
    material.dispose();
  }
});

for (const series of window.SERIES) {
  const catalog = await (await fetch(`/data/${series}.json`)).json();
  const rows = Math.ceil(catalog.characters.length / COLUMNS);
  const sheet = document.createElement("canvas"); sheet.width = CELL_W * COLUMNS; sheet.height = CELL_H * rows;
  const context = sheet.getContext("2d"); context.imageSmoothingQuality = "high";
  sheets.append(sheet);
  for (const [index, character] of catalog.characters.entries()) {
    const gltf = await loader.loadAsync(character.model);
    const root = prepare(gltf.scene);
    scene.add(root); frame(root);
    renderer.clear(); renderer.render(scene, camera);
    context.drawImage(renderer.domElement, (index % COLUMNS) * CELL_W, Math.floor(index / COLUMNS) * CELL_H, CELL_W, CELL_H);
    scene.remove(root); dispose(root);
    log(`${series} ${index + 1}/${catalog.characters.length} ${character.name}`);
  }
  const png = await new Promise((resolve) => sheet.toBlob(resolve, "image/png"));
  const saved = await (await fetch(`/portraits?series=${series}`, { method: "POST", body: png })).text();
  log(`${series} saved ${saved}`);
}
log("DONE");
