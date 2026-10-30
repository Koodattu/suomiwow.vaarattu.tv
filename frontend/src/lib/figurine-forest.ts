import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { restoreFigurineMaterials } from "@/lib/figurine-materials";

// The clearing around the plaza: Elwynn Forest doodads exported with the local wow.export worker
// (provenance: /figurines/world/source-models.json), scattered from a fixed seed and drawn as one
// instanced mesh per model part. The camera side stays open so the hub shot is never blocked.
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
} as const;
export type ForestModel = keyof typeof FOREST_MODELS;
// World-unit heights; a figure on the pedestal stands 2.5.
const HEIGHTS: Record<ForestModel, [number, number]> = {
  tree: [11, 16], bareTree: [10, 14], bush: [1.6, 2.6], bushSmall: [1, 1.7], rock: [0.3, 0.5], rockSmall: [0.2, 0.35],
  stump: [0.8, 1.1], haystack: [2.2, 2.6], lamp: [4.4, 4.4],
};
export type Placement = { model: ForestModel; x: number; z: number; yaw: number; size: number };

const seeded = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// Angle 0 points at the hub camera (+z); the forest path leaves the plaza at angle π.
const OPEN_FRONT = 0.78, PATH_ANGLE = Math.PI, PATH_HALF = 0.13;
const angularGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export function forestLayout(plazaRadius: number, seed = 11): Placement[] {
  const next = seeded(seed), placements: Placement[] = [];
  const ring = (count: number, inner: number, outer: number, models: ForestModel[], open: number, path = PATH_HALF) => {
    for (let i = 0; i < count; i++) {
      // Even spread around the ring with jitter, so there are no bald patches.
      const angle = (i + next() * 0.8) / count * Math.PI * 2, radius = inner + next() * (outer - inner);
      if (angularGap(angle, 0) < open || angularGap(angle, PATH_ANGLE) < path * (20 / radius)) continue;
      placements.push({ model: models[Math.floor(next() * models.length)], x: Math.sin(angle) * radius, z: Math.cos(angle) * radius, yaw: next() * Math.PI * 2, size: next() });
    }
  };
  ring(24, plazaRadius + 8, plazaRadius + 13, ["tree", "tree", "tree", "bareTree"], OPEN_FRONT);
  ring(32, plazaRadius + 15, plazaRadius + 24, ["tree", "tree", "bareTree"], OPEN_FRONT * 0.7);
  ring(30, plazaRadius + 0.8, plazaRadius + 5, ["bush", "bush", "bushSmall", "rock", "rockSmall"], OPEN_FRONT * 0.75, PATH_HALF * 1.6);
  ring(8, plazaRadius + 2, plazaRadius + 6, ["stump", "rock"], OPEN_FRONT, PATH_HALF * 2);
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
      const gltf = await loader.loadAsync(FOREST_MODELS[model]);
      restoreFigurineMaterials(gltf.scene);
      gltf.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(gltf.scene), [low, high] = HEIGHTS[model];
      const unit = 1 / Math.max(bounds.max.y - bounds.min.y, 1e-3);
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const instances = new THREE.InstancedMesh(object.geometry, object.material, spots.length);
        spots.forEach((spot, index) => {
          const scale = (low + (high - low) * spot.size) * unit;
          place.compose(new THREE.Vector3(spot.x, -bounds.min.y * scale - 0.02, spot.z), quaternion.setFromAxisAngle(up, spot.yaw), new THREE.Vector3(scale, scale, scale));
          instances.setMatrixAt(index, matrix.multiplyMatrices(place, object.matrixWorld));
        });
        instances.computeBoundingSphere();
        instances.receiveShadow = model === "lamp" || model === "haystack";
        if (model === "tree" || model === "bareTree" || model === "bush") (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => onSway?.(material));
        group.add(instances);
      });
      return { model, top: bounds.max.y, unit };
    } catch { return null; }
  });
  return { group, ready: Promise.all(loads) };
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
