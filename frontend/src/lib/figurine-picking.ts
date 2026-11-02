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
