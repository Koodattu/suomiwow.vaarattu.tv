// Renders every catch of the fishing pond as a card picture and posts each back to the bake server.
// Fish doodads lie on their sides: each is stood on its belly, its flank to the camera and its head
// to the left, turned a little toward the light. Each is framed by what it draws (a first render
// finds its outline), since some models' bounds include parts that never show.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { restoreFigurineMaterials } from "/lib/figurine-materials.ts";
import { FISH } from "/lib/figurine-collection.ts";
import { FISH_PROP, STATION_PROPS } from "/lib/figurine-props.ts";

const CARD_W = 400, CARD_H = 250, SUPERSAMPLE = 2, MARGIN = 0.86;
// Models whose head points another way than the rule makes it, turned to match the rest.
const TURN = { catfish: Math.PI, yellowtail: Math.PI, salmon: Math.PI, mightfish: Math.PI };
const status = document.querySelector("#status"), cards = document.querySelector("#cards");
const log = (line) => { status.textContent += `\n${line}`; };
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(CARD_W * SUPERSAMPLE, CARD_H * SUPERSAMPLE, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xe0efff, 0x333048, 3));
const key = new THREE.DirectionalLight(0xffe2b0, 4); key.position.set(-3, 6, 6); scene.add(key);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const ktx2 = new KTX2Loader().setTranscoderPath("/figurines/basis/r186/").detectSupport(renderer);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);

function pose(model, turn = 0) {
  restoreFigurineMaterials(model);
  const holder = new THREE.Group(), size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  holder.add(model);
  // Lying flat (thinnest upright): roll it onto its belly so the flank faces the camera.
  if (size.y < size.x && size.y < size.z) model.rotation.x = -Math.PI / 2;
  // Longest along x, head (+x in game models) to the left, then turned a little toward the light.
  if (size.z > size.x) model.rotation.y = Math.PI / 2;
  holder.rotation.y = Math.PI - 0.22 + turn;
  holder.updateMatrixWorld(true);
  return holder;
}
const look = (left, right, bottom, top, z) => { Object.assign(camera, { left, right, bottom, top }); camera.position.set(0, 0, z); camera.updateProjectionMatrix(); };
const scratch = Object.assign(document.createElement("canvas"), { width: CARD_W * SUPERSAMPLE, height: CARD_H * SUPERSAMPLE }).getContext("2d", { willReadFrequently: true });
function frame(root) {
  // A wide first look, then the drawn pixels' extent, refitted to the card with a margin.
  const bounds = new THREE.Box3().setFromObject(root), centre = bounds.getCenter(new THREE.Vector3()), reach = bounds.getSize(new THREE.Vector3()).length() * 1.5, z = bounds.max.z + 20;
  const wide = { left: centre.x - reach * CARD_W / CARD_H, right: centre.x + reach * CARD_W / CARD_H, bottom: centre.y - reach, top: centre.y + reach };
  look(wide.left, wide.right, wide.bottom, wide.top, z);
  renderer.clear(); renderer.render(scene, camera);
  const { width: w, height: h } = scratch.canvas; scratch.clearRect(0, 0, w, h); scratch.drawImage(renderer.domElement, 0, 0);
  const pixels = scratch.getImageData(0, 0, w, h).data;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pixels[(y * w + x) * 4 + 3] > 8) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const toX = (x) => wide.left + (x / w) * (wide.right - wide.left), toY = (y) => wide.top - (y / h) * (wide.top - wide.bottom);
  const left = toX(minX), right = toX(maxX + 1), top = toY(minY), bottom = toY(maxY + 1), middleX = (left + right) / 2, middleY = (top + bottom) / 2;
  let height = (top - bottom) / MARGIN, width = height * CARD_W / CARD_H;
  if ((right - left) / MARGIN > width) { width = (right - left) / MARGIN; height = width * CARD_H / CARD_W; }
  look(middleX - width / 2, middleX + width / 2, middleY - height / 2, middleY + height / 2, z);
}

for (const fish of FISH) {
  const gltf = await loader.loadAsync(STATION_PROPS[FISH_PROP[fish.id]]);
  const root = pose(gltf.scene, TURN[fish.id]);
  scene.add(root); frame(root);
  renderer.clear(); renderer.render(scene, camera);
  const card = document.createElement("canvas"); card.width = CARD_W; card.height = CARD_H;
  const context = card.getContext("2d"); context.imageSmoothingQuality = "high";
  context.drawImage(renderer.domElement, 0, 0, CARD_W, CARD_H);
  cards.append(card);
  scene.remove(root);
  const png = await new Promise((resolve) => card.toBlob(resolve, "image/png"));
  log(`${fish.id} saved ${await (await fetch(`/fish?id=${fish.id}`, { method: "POST", body: png })).text()}`);
}
log("DONE");
