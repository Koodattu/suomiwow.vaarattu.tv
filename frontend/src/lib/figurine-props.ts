import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { restoreFigurineMaterials } from "@/lib/figurine-materials";
import type { FishId } from "@/lib/figurine-collection";

// Game props that dress the stations, exported with the local wow.export worker
// (provenance: /figurines/world/source-models.json, including the tradingFacilities exports).
const PROP_VERSION = 7;
export const STATION_PROPS = {
  gear: "/figurines/world/models/gnome-gear.glb",
  lamp: "/figurines/world/models/gnome-light.glb",
  bucket: "/figurines/world/models/gnome-bucket.glb",
  pipe: "/figurines/world/models/gnome-pipe.glb",
  pistons: "/figurines/world/models/gnome-pistons.glb",
  tool: "/figurines/world/models/gnome-tool.glb",
  postbox: "/figurines/world/models/postbox-gnome.glb",
  counter: "/figurines/world/models/shop-counter-b.glb",
  tradingStall: "/figurines/world/models/market-stall-kultiras.glb",
  dealsBooth: "/figurines/world/models/merchant-carnival.glb",
  board: "/figurines/world/models/wanted-poster.glb",
  podium: "/figurines/world/models/podium.glb",
  chest: "/figurines/world/models/chest-02.glb",
  coin: "/figurines/world/models/treasuregoblin-coinpile.glb",
  dailyChest: "/figurines/world/models/treasurechest01.glb",
  goldPile: "/figurines/world/models/gold-pile.glb",
  goldPileSmall: "/figurines/world/models/gold-pile-small.glb",
  goblinStatue: "/figurines/world/models/goblin-statue.glb",
  fireworks: "/figurines/world/models/fireworks-barrel.glb",
  postboxHuman: "/figurines/world/models/postbox-human.glb",
  gift: "/figurines/world/models/gift-01.glb",
  giftRed: "/figurines/world/models/gift-03.glb",
  giftWhite: "/figurines/world/models/gift-05.glb",
  wanted: "/figurines/world/models/wanted-01.glb",
  wantedWood: "/figurines/world/models/wanted-wood.glb",
  scrollMap: "/figurines/world/models/scroll-map.glb",
  crystalBall: "/figurines/world/models/crystal-ball.glb",
  pedestal: "/figurines/world/models/pedestal-kz.glb",
  lion: "/figurines/world/models/lion-statue.glb",
  museumPlaque: "/figurines/world/models/museum-plaque.glb",
  trophy: "/figurines/world/models/trophy-beer.glb",
  obelisk: "/figurines/world/models/obelisk.glb",
  plaqueBronze: "/figurines/world/models/plaque-bronze.glb",
  plaqueSilver: "/figurines/world/models/plaque-silver.glb",
  bookcase: "/figurines/world/models/bookcase.glb",
  book: "/figurines/world/models/book-large.glb",
  rowboat: "/figurines/world/models/rowboat.glb",
  reeds: "/figurines/world/models/reeds.glb",
  lilypad: "/figurines/world/models/lilypad.glb",
  fishRack: "/figurines/world/models/fish-rack.glb",
  fishingChair: "/figurines/world/models/fishing-chair.glb",
  fish: "/figurines/world/models/fish-red.glb",
  signTackle: "/figurines/world/models/sign-tackle.glb",
  fishingBox: "/figurines/world/models/fishing-box.glb",
  // The pond's tackle and what it gives up: a rod (its butt and reel at +z), a feathered bobber,
  // and the catches, lying on their sides as dockside doodads do.
  fishingRod: "/figurines/world/models/fishing-pole.glb",
  bobber: "/figurines/world/models/fishing-bobber.glb",
  boot: "/figurines/world/models/boot-junk.glb",
  // The pond's dock and dressing: Elwynn's small dock with a lantern, the worgen tackle box, the
  // bucket of the catch (the fish log), a barrel, net and creel of fish, cattails, flowering lily
  // pads, and the forest's rocks for its bank.
  dock: "/figurines/world/models/dock-small.glb",
  dockLantern: "/figurines/world/models/lantern-garrison.glb",
  tacklebox: "/figurines/world/models/tacklebox.glb",
  fishBucket: "/figurines/world/models/fishing-bucket-2.glb",
  fishBarrel: "/figurines/world/models/fishing-barrel.glb",
  fishNet: "/figurines/world/models/fishing-net-1.glb",
  creel: "/figurines/world/models/fishing-basket.glb",
  cattails: "/figurines/world/models/cattails-gilneas.glb",
  lilyFlowers: "/figurines/world/models/lilypads-gilneas.glb",
  rock: "/figurines/world/models/rock-1.glb",
  rockSmall: "/figurines/world/models/rock-2.glb",
  fishGreen: "/figurines/world/models/fish-dead-green.glb",
  fishOrange: "/figurines/world/models/fish-dead-orange.glb",
  fishBlue: "/figurines/world/models/fish-dead-blue.glb",
  fishPurple: "/figurines/world/models/fish-dead-purple.glb",
  fishGold: "/figurines/world/models/fish-uldum-1.glb",
  fishPale: "/figurines/world/models/fish-uldum-2.glb",
  fishPink: "/figurines/world/models/fish-uldum-3.glb",
  fishBig: "/figurines/world/models/fish-uldum-4.glb",
  fishEel: "/figurines/world/models/fish-draenor-1.glb",
  fishSpiny: "/figurines/world/models/fish-draenor-3.glb",
} as const;
export type StationProp = keyof typeof STATION_PROPS;
// The game model each catch shows as (in the world, and baked for the fish log by
// scripts/bake-fish-cards.mjs).
export const FISH_PROP: Record<FishId, StationProp> = {
  smallfish: "fishGreen", mudsnapper: "fishOrange", catfish: "fishPale", blackmouth: "fishBlue", firefin: "fishSpiny",
  deviate: "fishPurple", yellowtail: "fishGold", eel: "fishEel", salmon: "fishPink", mightfish: "fishBig", boot: "boot",
};
// Corrections in display space, in degrees, measured from the meshes' longitudinal
// and dorsal axes. These dead-fish doodads lean on their sides even after the
// quarter-turn that stands them up; spinning that uncorrected pose makes them wobble.
export const FISH_DISPLAY_CORRECTION: Record<FishId, readonly [number, number, number]> = {
  smallfish: [-18.489, -2.929, 5.464], mudsnapper: [-15.787, -2.987, -0.855],
  blackmouth: [-15.787, -2.987, -0.855], deviate: [-17.474, -2.929, 2.215],
  yellowtail: [0, 0, -4.307], catfish: [0, 0, -4.307], mightfish: [0, 0, -4.307],
  salmon: [0, 0, -1.106], eel: [-19.647, 0.659, 3.228], firefin: [1.227, 2.476, 0.774],
  boot: [0, 0, 0],
};
export type PlaceProp = ReturnType<typeof propPlacer>;
// Face the camera, with the coin's authored lower-right rim resting flat at the
// bottom. Apply the 54° clockwise face rotation after standing the coin upright.
export function orientCoinModel(root: THREE.Object3D) {
  root.rotation.set(Math.PI / 2, 0, -Math.PI * 0.3, "ZXY");
}
// This spell includes fade/dissolve overlays for its disappearance. Keep the solid
// coin for the wallet and rewards, where those overlays would wash out its face.
export function prepareCoinModel(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every((material) => ["fade", "dissolvemattea"].includes(material.name))) object.visible = false;
  });
}
// `height` sizes a prop by its height; `length`, if given, by its longest level extent instead.
type Placement = { height: number; length?: number; x?: number; y?: number; z?: number; yaw?: number; shadow?: boolean };

// One placer per scene: each prop file loads once and is shared by its copies, and is disposed
// with that scene (never reused by another, whose teardown would free it).
export function propPlacer(ktx2Loader?: KTX2Loader) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  if (ktx2Loader) loader.setKTX2Loader(ktx2Loader);
  const cache = new Map<StationProp, Promise<THREE.Object3D | null>>();
  // Places a prop scaled to `height`, standing at (x, y, z) and turned by `yaw` (game models face +x).
  // The group exists at once and fills in when the file arrives; a missing file leaves it empty.
  return (parent: THREE.Object3D, prop: StationProp, { height, length, x = 0, y = 0, z = 0, yaw = 0, shadow = true }: Placement) => {
    const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = yaw; parent.add(group);
    let source = cache.get(prop);
    if (!source) {
      source = loader.loadAsync(`${STATION_PROPS[prop]}?v=${PROP_VERSION}`).then((gltf) => {
        restoreFigurineMaterials(gltf.scene);
        if (prop === "coin") prepareCoinModel(gltf.scene);
        gltf.scene.animations = gltf.animations;
        return gltf.scene;
      }, () => null);
      cache.set(prop, source);
    }
    const ready = source.then((model) => {
      if (!model) return group;
      // Some spell props (including the coin) have skinning but no animation clips.
      // Their bones still need to follow this instance's position and rotation.
      const copy = cloneSkeleton(model);
      const bounds = new THREE.Box3().setFromObject(copy);
      const size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
      const scale = length ? length / Math.max(size.x, size.z, 1e-3) : height / Math.max(size.y, 1e-3);
      copy.scale.setScalar(scale); copy.position.set(-centre.x * scale, -bounds.min.y * scale, -centre.z * scale);
      copy.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = object.receiveShadow = shadow; });
      group.add(copy);
      group.animations = model.animations;
      return group;
    });
    return { group, ready };
  };
}
