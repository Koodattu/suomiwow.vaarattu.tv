import type * as THREE from "three";
import type { PlaceProp, StationProp } from "@/lib/figurine-props";

// The dressing that makes each district a place of its own, beyond the stations themselves: game
// props standing behind and between them, in world space. None of it takes taps.
type Dressing = { prop: StationProp; at: [number, number]; height: number; length?: number; yaw?: number; y?: number };
const piece = (prop: StationProp, x: number, z: number, height: number, yaw = 0, y = 0, length?: number): Dressing => ({ prop, at: [x, z], height, yaw, y, length });

export const DISTRICT_DRESSING: Record<"trading" | "fair" | "honours" | "yard", Dressing[]> = {
  // Stock stacked behind the stalls, bags left along the street, lamps at the road out.
  trading: [
    piece("marketStack", -16.2, -4.8, 1.9, 0.6), piece("marketCrates", -16.4, 3.4, 1.4, -0.5), piece("marketStack", -15, 10.1, 1.7, 2.2),
    piece("marketBarrel", -15.9, 5.4, 0.8, 1), piece("marketBarrel", -16.6, 6.1, 0.72, 2.4), piece("marketBag", -15.1, 1.2, 0.46, 0.7),
    piece("marketWaresRed", -14.8, 4.4, 0.6, 0.4), piece("marketWaresGold", -15, 7.5, 0.6, 1.1),
    piece("villageLamp", -15.4, -1.2, 3.5, 0.2), piece("villageLamp", -15.5, 0.9, 3.5, 2.8),
  ],
  // Banners flank the north road like a gate; balloons, a slot machine and a ticket booth behind.
  fair: [
    piece("fairBanner", -3.3, -16.2, 3.6, 0), piece("fairBanner", -0.2, -16.3, 3.6, 0), piece("fairLights", -1.75, -16.25, 0.3, 0, 3.1, 3),
    piece("fairBannerRope", 1.4, -16.4, 3.2, Math.PI / 2), piece("fairTicket", -6.6, -14.4, 4.2, 0.7), piece("fairTicket", 9.8, -14.4, 3.6, -0.7),
    piece("fairSlot", 8.6, -11.9, 2.2, -2.1), piece("fairFireworks", 8.2, -9.9, 0.8, 0.6), piece("fairFireworks", -7.2, -11.3, 0.7, 1.3),
    piece("fairBalloonsBig", 4.1, -15.4, 3.6, 0.8), piece("fairBalloons", -3.6, -14.2, 3.1, 2),
  ],
  // Banners and braziers along the terrace's back, with planted urns at each end.
  honours: [
    piece("hallBrazier", 15.3, -2.1, 0.62, 0.4), piece("hallBrazier", 13.6, 10.3, 0.62, 2.2), piece("hallBrazier", 17.2, 2.2, 0.62, 1.4),
    piece("hallBanner", 16, 0.6, 3.6, 2.9), piece("hallBannerDark", 17.1, 4.3, 3.6, 3.2), piece("hallBanner", 16.2, 6.5, 3.6, 3.5), piece("hallBannerDark", 14.8, 9.2, 3.6, 3.8),
    piece("hallPlanter", 11.2, 1.2, 0.42, 0.4), piece("hallPlanter", 10.4, 5.5, 0.42, 2.6), piece("hallFlowers", 15.2, -3.2, 0.9, 1),
  ],
  // Coal, ingots and tools about the yard, with a grindstone and racks by the path.
  yard: [
    piece("forgeCoalbin", -12.7, 9.8, 1.1, 0.5), piece("forgeCoalbin", -13.3, 11.2, 0.9, 1.9), piece("forgeWeaponrack", -9.8, 16.6, 1.8, 2.7), piece("forgeToolrack", -12.2, 14, 1.5, 2.2),
    piece("forgeGrindstone", -2.2, 17.1, 1.3, -2.2), piece("forgeQuench", -0.9, 13.8, 0.52, 1.1), piece("forgeToolbox", -4.2, 17, 0.7, 2.6),
    piece("forgeIngotsIron", -4.3, 11.3, 0.32, 0.5), piece("forgeIngotsCopper", -8.4, 9, 0.3, 1.4), piece("forgeIngotsSilver", -4.8, 10.4, 0.3, 2.3),
  ],
};

// Places every district's dressing under `parent`, resolving once it has all loaded.
export function buildDistricts(parent: THREE.Object3D, placeProp: PlaceProp) {
  return Promise.all(Object.values(DISTRICT_DRESSING).flat().map(({ prop, at: [x, z], height, length, yaw, y }) => placeProp(parent, prop, { height, length, x, z, yaw, y }).ready));
}
