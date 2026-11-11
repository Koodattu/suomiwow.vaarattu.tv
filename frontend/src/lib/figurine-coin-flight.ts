import * as THREE from "three";

// Choose once per collection, so each flight varies without jittering between frames.
// Call after the base pose is interpolated; both endpoints retain their exact pose.
export function coinCollectionFlight(facing: THREE.Quaternion, random = Math.random) {
  const bend = new THREE.Vector3((random() - 0.5) * 0.8, 0.2 + random() * 0.35, 0).applyQuaternion(facing);
  const axis = new THREE.Vector3((random() - 0.5) * 0.5, (random() - 0.5) * 0.5, 1).normalize();
  const turn = (random() < 0.5 ? -1 : 1) * Math.PI * 2;
  const spin = new THREE.Quaternion();
  return (position: THREE.Vector3, rotation: THREE.Quaternion, progress: number) => {
    position.addScaledVector(bend, 4 * progress * (1 - progress));
    rotation.multiply(spin.setFromAxisAngle(axis, turn * progress));
  };
}
