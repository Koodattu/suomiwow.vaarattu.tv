import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { restoreFigurineMaterials } from "@/lib/figurine-materials";

// Game props that dress the stations, exported with the local wow.export worker
// (provenance: the "stations" entry of /figurines/world/source-models.json).
const PROP_VERSION = 1;
export const STATION_PROPS = {
  gear: "/figurines/world/models/gnome-gear.glb",
  lamp: "/figurines/world/models/gnome-light.glb",
  bucket: "/figurines/world/models/gnome-bucket.glb",
  pipe: "/figurines/world/models/gnome-pipe.glb",
  pistons: "/figurines/world/models/gnome-pistons.glb",
  tool: "/figurines/world/models/gnome-tool.glb",
  postbox: "/figurines/world/models/postbox-gnome.glb",
  counter: "/figurines/world/models/shop-counter-b.glb",
  board: "/figurines/world/models/wanted-poster.glb",
  podium: "/figurines/world/models/podium.glb",
} as const;
export type StationProp = keyof typeof STATION_PROPS;
export type PlaceProp = ReturnType<typeof propPlacer>;
type Placement = { height: number; x?: number; y?: number; z?: number; yaw?: number; shadow?: boolean };

// One placer per scene: each prop file loads once and is shared by its copies, and is disposed
// with that scene (never reused by another, whose teardown would free it).
export function propPlacer() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const cache = new Map<StationProp, Promise<THREE.Object3D | null>>();
  // Places a prop scaled to `height`, standing at (x, y, z) and turned by `yaw` (game models face +x).
  // The group exists at once and fills in when the file arrives; a missing file leaves it empty.
  return (parent: THREE.Object3D, prop: StationProp, { height, x = 0, y = 0, z = 0, yaw = 0, shadow = true }: Placement) => {
    const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = yaw; parent.add(group);
    let source = cache.get(prop);
    if (!source) {
      source = loader.loadAsync(`${STATION_PROPS[prop]}?v=${PROP_VERSION}`).then((gltf) => { restoreFigurineMaterials(gltf.scene); return gltf.scene; }, () => null);
      cache.set(prop, source);
    }
    const ready = source.then((model) => {
      if (!model) return group;
      const copy = model.clone(true), bounds = new THREE.Box3().setFromObject(copy);
      const scale = height / Math.max(bounds.max.y - bounds.min.y, 1e-3), centre = bounds.getCenter(new THREE.Vector3());
      copy.scale.setScalar(scale); copy.position.set(-centre.x * scale, -bounds.min.y * scale, -centre.z * scale);
      copy.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = object.receiveShadow = shadow; });
      group.add(copy);
      return group;
    });
    return { group, ready };
  };
}
