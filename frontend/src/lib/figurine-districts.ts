import type * as THREE from "three";
import type { PlaceProp, StationProp } from "@/lib/figurine-props";

// The dressing that makes each district a place of its own, beyond the stations themselves: game
// props standing behind and between them, in world space. None of it takes taps.
type Dressing = { prop: StationProp; at: [number, number]; height: number; length?: number; yaw?: number; y?: number };
const piece = (prop: StationProp, x: number, z: number, height: number, yaw = 0, y = 0, length?: number): Dressing => ({ prop, at: [x, z], height, yaw, y, length });

export const DISTRICT_DRESSING: Record<"trading" | "fair" | "honours" | "yard", Dressing[]> = {
  // Stock stacked behind the stalls.
  trading: [piece("marketStack", -17.4, 4.4, 1.9, 0.6), piece("marketStack", -17.6, -5.2, 1.7, 2.2)],
  // Striped ticket booths at either end of the fair.
  fair: [piece("fairTicket", -7.2, -15.8, 4.2, 0.7), piece("fairTicket", 12, -13.4, 3.6, -0.7)],
  // Banners standing in the gaps along the terrace's back.
  honours: [piece("hallBanner", 17.8, 2.6, 3.6, 2.9), piece("hallBanner", 16, 8, 3.6, 3.5)],
  // Coal by the furnace, and the smith's grindstone and weapons behind the yard.
  yard: [piece("forgeCoalbin", -12.6, 14.6, 1.1, 0.5), piece("forgeWeaponrack", -7.3, 16.6, 1.8, 2.7), piece("forgeGrindstone", -1.4, 16.8, 1.3, -2.2)],
};

// Places every district's dressing under `parent`, resolving once it has all loaded.
export function buildDistricts(parent: THREE.Object3D, placeProp: PlaceProp) {
  return Promise.all(Object.values(DISTRICT_DRESSING).flat().map(({ prop, at: [x, z], height, length, yaw, y }) => placeProp(parent, prop, { height, length, x, z, yaw, y }).ready));
}
