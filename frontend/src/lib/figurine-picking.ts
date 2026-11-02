import * as THREE from "three";

// Raycasting ignores Object3D visibility, including hidden ancestors. Material visibility is
// deliberately separate: small controls use invisible meshes as generous click targets.
export function isVisibleHit({ object }: THREE.Intersection) {
  if (object instanceof THREE.Sprite || object instanceof THREE.Points) return false;
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

// Close-up controls have generous invisible targets. Decorative scenery in front of them
// must not swallow a tap, and water or empty ground must never turn into a cast.
export function pickFacilityPart(raycaster: THREE.Raycaster, root: THREE.Object3D) {
  for (const hit of raycaster.intersectObject(root, true)) {
    if (!isVisibleHit(hit)) continue;
    for (let object: THREE.Object3D | null = hit.object; object && object !== root; object = object.parent) {
      if (typeof object.userData.part === "string") return object.userData.part;
    }
  }
  return null;
}
