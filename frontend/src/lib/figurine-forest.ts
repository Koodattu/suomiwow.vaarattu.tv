import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { restoreFigurineMaterials } from "@/lib/figurine-materials";

// The clearing around the plaza: Elwynn Forest doodads exported with the local wow.export worker
// (provenance: /figurines/world/source-models.json), scattered from a fixed seed and drawn as one
// instanced mesh per model part. The camera side stays open so the hub shot is never blocked.
// Bump MODEL_VERSION when the files change: browsers keep the old ones otherwise.
const MODEL_VERSION = 2;
export const FOREST_MODELS = {
  tree: "/figurines/world/models/tree-canopy-02.glb",
  bareTree: "/figurines/world/models/tree-canopyless-01.glb",
  bush: "/figurines/world/models/bush-01.glb",
  bushSmall: "/figurines/world/models/bush-06.glb",
  rock: "/figurines/world/models/rock-1.glb",
  rockSmall: "/figurines/world/models/rock-2.glb",
  stump: "/figurines/world/models/stump-01.glb",
  haystack: "/figurines/world/models/haystack-01.glb",
  lamp: "/figurines/world/models/lamppost.glb",
  tent: "/figurines/world/models/tent.glb",
  wagon: "/figurines/world/models/wagon.glb",
  table: "/figurines/world/models/table.glb",
  crate: "/figurines/world/models/crate.glb",
  barrel: "/figurines/world/models/barrel.glb",
  signpost: "/figurines/world/models/signpost.glb",
  lantern: "/figurines/world/models/lantern.glb",
  cheese: "/figurines/world/models/cheese.glb",
  fruit: "/figurines/world/models/fruit.glb",
  bread: "/figurines/world/models/bread.glb",
} as const;
export type ForestModel = keyof typeof FOREST_MODELS;
// World-unit heights; a figure on the pedestal stands 2.5.
const HEIGHTS: Record<ForestModel, [number, number]> = {
  tree: [11, 16], bareTree: [10, 14], bush: [1.6, 2.6], bushSmall: [1, 1.7], rock: [0.3, 0.5], rockSmall: [0.2, 0.35],
  stump: [0.8, 1.1], haystack: [2.2, 2.6], lamp: [4.4, 4.4],
  tent: [4.6, 4.6], wagon: [4, 4], table: [1.05, 1.05], crate: [0.75, 0.95], barrel: [1, 1.15],
  signpost: [3, 3], lantern: [0.55, 0.55], cheese: [0.22, 0.26], fruit: [0.34, 0.34], bread: [0.16, 0.2],
};
// `y` lifts an item onto a table or a stack. Casters throw shadows from the sun.
export type Placement = { model: ForestModel; x: number; z: number; yaw: number; size: number; y?: number; secretSeries?: string };
const CASTERS = new Set<ForestModel>(["tree", "bareTree", "bush", "stump", "haystack", "lamp", "tent", "wagon", "table", "crate", "barrel", "signpost"]);
// WoW models face +x; this yaw turns one at (x, z) toward the plaza centre.
const facingCentre = (x: number, z: number) => Math.atan2(z, -x);

// A small Elwynn market where the path leaves the plaza: a tent and a wagon flanking it, a
// signpost at the entrance (no faction banners: the market takes no side), stock piled by the stall and the case, and two tables
// of produce at the front corners.
export function marketLayout(): Placement[] {
  const at = (model: ForestModel, x: number, z: number, extra: Partial<Placement> = {}): Placement => ({ model, x, z, yaw: facingCentre(x, z), size: 0.5, ...extra });
  const table = (x: number, z: number) => {
    const top = 1.03, yaw = facingCentre(x, z), c = Math.cos(yaw), s = Math.sin(yaw);
    // Items in the table's own frame (along its facing, across it), rotated into the world.
    const on = (model: ForestModel, along: number, across: number, size = 0.5) => at(model, x + along * c + across * s, z - along * s + across * c, { y: top, yaw: yaw + across * 2, size });
    return [at("table", x, z), on("cheese", 0.35, -0.9), on("cheese", 0.1, -0.55, 0.9), on("bread", -0.3, 0.1), on("bread", -0.2, 0.4, 0.2), on("fruit", 0.2, 0.75), on("lantern", -0.4, -1.3)];
  };
  return [
    at("tent", -5.6, -18.2), at("wagon", 6.4, -18.4),
    at("signpost", 2.6, -15.6, { yaw: 2.2 }), at("crate", -5.2, -14.2, { yaw: 0.5 }), at("barrel", 5.4, -14.5),
    at("crate", -11, -2.2, { yaw: 0.3 }), at("crate", -11.7, -1.3, { yaw: -0.2, size: 0.2 }), at("crate", -11.1, -2.1, { y: 0.86, yaw: 0.9, size: 0.1 }), at("barrel", -10.6, -0.6),
    // The broken opening faces local -z; turn it outward from the plaza.
    at("barrel", 11.3, -2.1, { yaw: Math.atan2(-11.3, 2.1), secretSeries: "community-000" }), at("barrel", 11.9, -1), at("crate", 11.1, -0.2, { yaw: 1.1 }),
    ...table(-10.6, 4.6), ...table(10.9, 4.2),
  ];
}
// True if (x, z) is clear of the market's footprints.
const clearOf = (spots: Placement[], x: number, z: number) => spots.every((spot) => Math.hypot(spot.x - x, spot.z - z) > (spot.model === "tent" || spot.model === "wagon" ? 6 : 2));

const seeded = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// Angle 0 points at the hub camera (+z); the forest path leaves the plaza at angle π.
const OPEN_FRONT = 0.78, PATH_ANGLE = Math.PI, PATH_HALF = 0.13;
const angularGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export function forestLayout(plazaRadius: number, seed = 11, market: Placement[] = []): Placement[] {
  const next = seeded(seed), placements: Placement[] = [];
  const ring = (count: number, inner: number, outer: number, models: ForestModel[], open: number, path = PATH_HALF) => {
    for (let i = 0; i < count; i++) {
      // Even spread around the ring with jitter, so there are no bald patches.
      const angle = (i + next() * 0.8) / count * Math.PI * 2, radius = inner + next() * (outer - inner);
      const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius, model = models[Math.floor(next() * models.length)], yaw = next() * Math.PI * 2, size = next();
      if (angularGap(angle, 0) < open || angularGap(angle, PATH_ANGLE) < path * (20 / radius) || !clearOf(market, x, z)) continue;
      placements.push({ model, x, z, yaw, size });
    }
  };
  ring(24, plazaRadius + 8, plazaRadius + 13, ["tree", "tree", "tree", "bareTree"], OPEN_FRONT);
  ring(32, plazaRadius + 15, plazaRadius + 24, ["tree", "tree", "bareTree"], OPEN_FRONT * 0.7);
  ring(30, plazaRadius + 0.8, plazaRadius + 5, ["bush", "bush", "bushSmall", "rock", "rockSmall"], OPEN_FRONT * 0.75, PATH_HALF * 1.6);
  ring(8, plazaRadius + 2, plazaRadius + 6, ["stump", "rock"], OPEN_FRONT, PATH_HALF * 2);
  placements.push(...market);
  // Hay by the shop side of the clearing.
  for (const [angle, radius] of [[-1.15, plazaRadius + 1.6], [-1.32, plazaRadius + 2.4]]) placements.push({ model: "haystack", x: Math.sin(angle) * radius, z: Math.cos(angle) * radius, yaw: next() * 6.28, size: next() });
  // Lamp posts around the plaza rim.
  for (let i = 0; i < 10; i++) {
    const angle = (i + 0.5) / 10 * Math.PI * 2, radius = plazaRadius - 0.8;
    placements.push({ model: "lamp", x: Math.sin(angle) * radius, z: Math.cos(angle) * radius, yaw: -angle + Math.PI, size: 0.5 });
  }
  return placements;
}

// Loads each model once and draws all its placements as instances. Resolves with the lamp
// heads in world space, for the glow sprites.
export function buildForest(parent: THREE.Object3D, placements: Placement[], onSway?: (material: THREE.Material) => void) {
  const group = new THREE.Group(); parent.add(group);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const matrix = new THREE.Matrix4(), place = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const byModel = new Map<ForestModel, Placement[]>();
  placements.forEach((placement) => byModel.set(placement.model, [...(byModel.get(placement.model) ?? []), placement]));
  const loads = [...byModel].map(async ([model, spots]) => {
    try {
      const gltf = await loader.loadAsync(`${FOREST_MODELS[model]}?v=${MODEL_VERSION}`);
      restoreFigurineMaterials(gltf.scene);
      gltf.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(gltf.scene), [low, high] = HEIGHTS[model];
      const unit = 1 / Math.max(bounds.max.y - bounds.min.y, 1e-3);
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const instances = new THREE.InstancedMesh(object.geometry, object.material, spots.length);
        spots.forEach((spot, index) => {
          const scale = (low + (high - low) * spot.size) * unit;
          place.compose(new THREE.Vector3(spot.x, (spot.y ?? 0) - bounds.min.y * scale - 0.02, spot.z), quaternion.setFromAxisAngle(up, spot.yaw), new THREE.Vector3(scale, scale, scale));
          instances.setMatrixAt(index, matrix.multiplyMatrices(place, object.matrixWorld));
        });
        instances.userData.secretSeries = spots.map((spot) => spot.secretSeries ?? null);
        instances.computeBoundingSphere();
        instances.castShadow = CASTERS.has(model); instances.receiveShadow = model !== "tree" && model !== "bareTree";
        if (model === "tree" || model === "bareTree" || model === "bush") (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => onSway?.(material));
        group.add(instances);
      });
      return { model, top: bounds.max.y, unit, bounds };
    } catch { return null; }
  });
  const ready = Promise.all(loads);
  return { group, ready, async mountSecretBox(id: string, box: THREE.Object3D) {
    const spot = placements.find((entry) => entry.secretSeries === id);
    if (!spot) return;
    const asset = (await ready).find((entry) => entry?.model === spot.model);
    if (!asset) return;
    // Measured inside barrel.glb's upright cavity, not its whole-mesh bounds:
    // the fallen staves extend well outside the barrel and skew that centre.
    // This smaller box clears the inward broken staves as well as the outer walls.
    const [low, high] = HEIGHTS[spot.model];
    const scale = (low + (high - low) * spot.size) * asset.unit;
    const centre = new THREE.Vector3(-0.022, 0.296, -0.088).multiplyScalar(scale);
    centre.y -= asset.bounds.min.y * scale + 0.02;
    centre.applyAxisAngle(up, spot.yaw);
    box.position.copy(centre).add(new THREE.Vector3(spot.x, spot.y ?? 0, spot.z));
    box.rotation.y = spot.yaw + Math.PI;
    box.scale.setScalar(0.65);
    box.traverse((object) => { object.userData.secretSeriesId = id; });
    group.add(box);
  }, pickSecret(raycaster: THREE.Raycaster) {
    // Only the nearest scenery surface can reveal a secret; other props occlude it.
    const hit = raycaster.intersectObject(group, true)[0];
    const id = hit?.instanceId !== undefined ? hit.object.userData.secretSeries?.[hit.instanceId] : hit?.object.userData.secretSeriesId;
    return typeof id === "string" ? { id, distance: hit!.distance } : null;
  } };
}

// A gentle wind sway for foliage: tops move, bases stay planted.
export function swayMaterial(material: THREE.Material, time: { value: number }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = time;
    shader.vertexShader = `uniform float windTime;\n${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 rooted = instanceMatrix[3].xyz;
        float reach = max(position.y, 0.0);
        float gust = sin(windTime * 0.9 + rooted.x * 0.13 + rooted.z * 0.11) + 0.4 * sin(windTime * 2.3 + rooted.z * 0.3);
        transformed.x += gust * 0.0016 * reach * reach;
        transformed.z += gust * 0.0011 * reach * reach;
      #endif`);
  };
  material.customProgramCacheKey = () => "figurine-sway";
}
