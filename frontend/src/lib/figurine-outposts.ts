import * as THREE from "three";
import { signTexture, woodTexture } from "@/lib/figurine-shop";
import type { PlaceProp } from "@/lib/figurine-props";

// Stations that are not open yet, already standing round the plaza: a trading post (a counter and
// a gnomish postbox) and a hall of fame (a notice board and a podium). Each has its name sign
// and a "coming soon" plank nailed across it.
export type Outpost = "trading" | "fame";

function plank(text: string) {
  const element = document.createElement("canvas");
  element.width = 512; element.height = 96;
  const context = element.getContext("2d")!;
  context.fillStyle = "#e7d3a8"; context.fillRect(0, 0, 512, 96);
  for (let i = 0; i < 14; i++) { context.fillStyle = `rgba(110,72,36,${0.06 + (i % 3) * 0.04})`; context.fillRect(0, i * 7, 512, 2); }
  context.strokeStyle = "#7a1e1e"; context.lineWidth = 5; context.strokeRect(10, 10, 492, 76);
  context.fillStyle = "#8c2219"; context.font = "700 46px Georgia, serif"; context.letterSpacing = "6px"; context.textAlign = "center"; context.textBaseline = "middle";
  context.fillText(text.toUpperCase(), 256, 52, 470);
  const map = new THREE.CanvasTexture(element); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  return map;
}

export function buildOutpost(parent: THREE.Group, kind: Outpost, { placeProp, title, soon }: { placeProp: PlaceProp; title: string; soon: string }) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture(kind === "trading" ? 41 : 43, [78, 50, 30]), roughness: 0.7 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  // A name board on two posts, behind whatever the station shows.
  const frame = [-1.5, 1.5].map((x) => add(new THREE.CylinderGeometry(0.07, 0.08, 3.4, 8), wood, x, 1.7, -0.9));
  const signFace = new THREE.MeshStandardMaterial({ map: signTexture(title), roughness: 0.6 });
  frame.push(add(new THREE.BoxGeometry(3.3, 0.8, 0.07), [wood, wood, wood, wood, signFace, wood], 0, 3.05, -0.86));
  // Across the counter's backdrop, or straight across the notice board.
  const banner = add(new THREE.PlaneGeometry(2.1, 0.4), new THREE.MeshStandardMaterial({ map: plank(soon), roughness: 0.8 }), 0, kind === "trading" ? 2.35 : 1.55, kind === "trading" ? -0.8 : 0.14);
  banner.rotation.z = -0.08;
  if (kind === "trading") {
    placeProp(parent, "counter", { height: 1.05, x: 0, z: 0.1, yaw: -Math.PI / 2 });
    placeProp(parent, "postbox", { height: 1.5, x: 2.2, z: 0.3, yaw: -Math.PI / 2 });
  } else {
    placeProp(parent, "board", { height: 2.3, x: 0, z: -0.3, yaw: -Math.PI / 2 });
    placeProp(parent, "podium", { height: 1.15, x: 1.6, z: 0.7, yaw: -Math.PI / 2 - 0.4 });
  }
  return { frame };
}
