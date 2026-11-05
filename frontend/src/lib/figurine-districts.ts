import type * as THREE from "three";
import type { PlaceProp, StationProp } from "@/lib/figurine-props";

// The dressing that makes each district a place of its own, beyond the stations themselves: game
// props standing behind and between them, in world space. None of it takes taps.
type Dressing = { prop: StationProp; at: [number, number]; height: number; length?: number; yaw?: number; y?: number };
const piece = (prop: StationProp, x: number, z: number, height: number, yaw = 0, y = 0, length?: number): Dressing => ({ prop, at: [x, z], height, yaw, y, length });

export const DISTRICT_DRESSING: Record<"trading" | "fair" | "honours" | "yard", Dressing[]> = {
  // Stock stacked behind the stalls.
  trading: [piece("marketStack", -16.9, 3.7, 1.9, 0.6), piece("marketStack", -17, -5, 1.7, 2.2)],
  // Striped ticket booths at either end of the fair: one between the chest and quests, one past the wheel.
  fair: [piece("fairTicket", -0.1, -16.7, 3.8, 0.2), piece("fairTicket", 12.4, -12, 3.6, -0.7)],
  // Banners standing in the gaps along the terrace's back.
  honours: [piece("hallBanner", 16.8, 2.6, 3.6, 2.9), piece("hallBanner", 15.7, 6.7, 3.6, 3.5)],
  // Coal by the furnace, and the smith's grindstone and weapons behind the yard.
  yard: [piece("forgeCoalbin", -12, 14.2, 1.1, 0.5), piece("forgeWeaponrack", -7.2, 15.8, 1.8, 2.7), piece("forgeGrindstone", -2.1, 15.6, 1.3, -2.2)],
};

// Places every district's dressing under `parent`, resolving once it has all loaded.
export function buildDistricts(parent: THREE.Object3D, placeProp: PlaceProp) {
  return Promise.all(Object.values(DISTRICT_DRESSING).flat().map(({ prop, at: [x, z], height, length, yaw, y }) => placeProp(parent, prop, { height, length, x, z, yaw, y }).ready));
}
