import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { restoreFigurineMaterials } from "@/lib/figurine-materials";
import type { FishId } from "@/lib/figurine-collection";

// Game props that dress the stations, exported with the local wow.export worker
// (provenance: /figurines/world/source-models.json, including the districts exports).
const PROP_VERSION = 8;
export const STATION_PROPS = {
  board: "/figurines/world/models/wanted-poster.glb",
  podium: "/figurines/world/models/podium.glb",
  chest: "/figurines/world/models/chest-02.glb",
  coin: "/figurines/world/models/treasuregoblin-coinpile.glb",
  dailyChest: "/figurines/world/models/chest-uber.glb",
  goblinStatue: "/figurines/world/models/goblin-statue.glb",
  fireworks: "/figurines/world/models/fireworks-barrel.glb",
  gift: "/figurines/world/models/gift-01.glb",
  giftRed: "/figurines/world/models/gift-03.glb",
  giftWhite: "/figurines/world/models/gift-05.glb",
  crystalBall: "/figurines/world/models/crystal-ball.glb",
  museumPlaque: "/figurines/world/models/museum-plaque.glb",
  trophy: "/figurines/world/models/trophy-beer.glb",
  bookcase: "/figurines/world/models/bookcase.glb",
  book: "/figurines/world/models/book-large.glb",
  rowboat: "/figurines/world/models/rowboat.glb",
  reeds: "/figurines/world/models/reeds.glb",
  lilypad: "/figurines/world/models/lilypad.glb",
  fishRack: "/figurines/world/models/fish-rack.glb",
  fishingChair: "/figurines/world/models/fishing-chair.glb",
  fish: "/figurines/world/models/fish-red.glb",
  signTackle: "/figurines/world/models/sign-tackle.glb",
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
  // The districts. Trading: a merchant's wagon, a market stall with its wares, and the mail.
  marketWagon: "/figurines/world/models/market-wagon.glb",
  marketCanopy: "/figurines/world/models/market-canopy.glb",
  marketWares: "/figurines/world/models/market-wares.glb",
  marketWaresRed: "/figurines/world/models/market-wares-red.glb",
  marketWaresGold: "/figurines/world/models/market-wares-gold.glb",
  marketSign: "/figurines/world/models/market-sign.glb",
  marketCrates: "/figurines/world/models/market-crates.glb",
  marketStack: "/figurines/world/models/market-stack.glb",
  marketBarrel: "/figurines/world/models/market-barrel.glb",
  marketBag: "/figurines/world/models/market-bag.glb",
  marketTable: "/figurines/world/models/market-table.glb",
  marketTableRound: "/figurines/world/models/market-table-round.glb",
  mailBox: "/figurines/world/models/mail-box.glb",
  mailSatchel: "/figurines/world/models/mail-satchel.glb",
  // The daily fair: balloons, banners, a slot machine, heaped gold, and the quest board and table.
  fairBalloons: "/figurines/world/models/fair-balloons-a.glb",
  fairBalloonsBig: "/figurines/world/models/fair-balloons-b.glb",
  fairBanner: "/figurines/world/models/fair-banner.glb",
  fairBannerRope: "/figurines/world/models/fair-banner-rope.glb",
  fairSlot: "/figurines/world/models/fair-slot.glb",
  fairFireworks: "/figurines/world/models/fair-fireworks.glb",
  fairGold: "/figurines/world/models/fair-gold.glb",
  fairCoins: "/figurines/world/models/fair-coins.glb",
  fairGoldCart: "/figurines/world/models/fair-goldcart.glb",
  fairLights: "/figurines/world/models/fair-lights.glb",
  fairTicket: "/figurines/world/models/fair-ticket.glb",
  questBoard: "/figurines/world/models/quest-board.glb",
  questTable: "/figurines/world/models/quest-table.glb",
  questScrolls: "/figurines/world/models/quest-scrolls.glb",
  questPost: "/figurines/world/models/quest-post.glb",
  // The honours terrace: a memorial wall, garrison trophies, an orrery, standing banners.
  hallMemorial: "/figurines/world/models/hall-memorial.glb",
  hallMonument: "/figurines/world/models/hall-monument.glb",
  hallTrophyGold: "/figurines/world/models/hall-trophy-gold.glb",
  hallTrophyShield: "/figurines/world/models/hall-trophy-shield.glb",
  hallPedestal: "/figurines/world/models/hall-pedestal.glb",
  hallScryPedestal: "/figurines/world/models/hall-scry-pedestal.glb",
  hallOrrery: "/figurines/world/models/hall-orrery.glb",
  hallBanner: "/figurines/world/models/hall-banner.glb",
  hallBannerDark: "/figurines/world/models/hall-banner-dark.glb",
  hallBrazier: "/figurines/world/models/hall-brazier.glb",
  hallFlowers: "/figurines/world/models/hall-flowers.glb",
  hallPlanter: "/figurines/world/models/hall-planter.glb",
  villageLamp: "/figurines/world/models/village-lamp.glb",
  // The working yard: the furnace and its bellows, a crucible of molten metal, the anvil before
  // its carved stele, and the tools, coal and ingots of the trade.
  forgeFurnace: "/figurines/world/models/forge-furnace.glb",
  forgeBellows: "/figurines/world/models/forge-bellows.glb",
  forgeCrucible: "/figurines/world/models/forge-crucible.glb",
  forgeAnvil: "/figurines/world/models/forge-anvil.glb",
  forgeStele: "/figurines/world/models/forge-stele.glb",
  forgeBrazier: "/figurines/world/models/forge-brazier.glb",
  forgeBrazierVoid: "/figurines/world/models/forge-brazier-void.glb",
  forgeGrindstone: "/figurines/world/models/forge-grindstone.glb",
  forgeToolrack: "/figurines/world/models/forge-toolrack.glb",
  forgeWeaponrack: "/figurines/world/models/forge-weaponrack.glb",
  forgeToolbox: "/figurines/world/models/forge-toolbox.glb",
  forgeCoalbin: "/figurines/world/models/forge-coalbin.glb",
  forgeQuench: "/figurines/world/models/forge-quench.glb",
  forgeIngotsIron: "/figurines/world/models/forge-ingots-iron.glb",
  forgeIngotsSilver: "/figurines/world/models/forge-ingots-silver.glb",
  forgeIngotsCopper: "/figurines/world/models/forge-ingots-copper.glb",
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
