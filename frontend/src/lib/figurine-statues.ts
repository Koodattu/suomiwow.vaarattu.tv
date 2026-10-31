import * as THREE from "three";
import { STATUE_SPOTS } from "@/lib/figurine-world";
import { figurineBodyBounds, figurineScale, figurineSupport, restoreFigurineMaterials, FIGURE_HEIGHT } from "@/lib/figurine-materials";
import { applyFinish, releaseFinishes } from "@/lib/figurine-finish";
import { disposeFigurineObject } from "@/lib/figurine-cache";
import type { FigurineQuality } from "@/lib/figurine-collection";

// The showcase's figures, standing about the world at their spots (one per showcase slot) like
// visitors to the village: on the ground, full size (the same body height as on the pedestal),
// idling if their model has an idle. Figures load one at a time, so a full showcase never stalls a frame.
export type StatueEntry = { url: string; quality: FigurineQuality } | null;
const STATUE_HEIGHT = FIGURE_HEIGHT;

export function buildStatues(parent: THREE.Object3D, { finishEnv, load }: { finishEnv: THREE.Texture; load: (url: string) => Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> }) {
  const spots = STATUE_SPOTS.map((spot) => {
    const group = new THREE.Group(); group.position.copy(spot.position); group.rotation.y = spot.rotation; parent.add(group);
    return { group, entry: null as StatueEntry, figure: null as THREE.Object3D | null, mixer: null as THREE.AnimationMixer | null };
  });
  let wanted: StatueEntry[] = [], busy = false, disposed = false;
  const place = (root: THREE.Object3D) => {
    restoreFigurineMaterials(root);
    root.rotation.y = -Math.PI / 2;
    const scale = figurineScale(figurineBodyBounds(root)) * STATUE_HEIGHT / FIGURE_HEIGHT;
    const support = figurineSupport(root, new THREE.Box3().setFromObject(root));
    root.scale.multiplyScalar(scale);
    root.position.set(-support.x * scale, -support.y * scale, -support.z * scale);
    root.traverse((object) => { if ((object as THREE.Mesh).isMesh) object.castShadow = true; });
    return root;
  };
  const clear = (spot: (typeof spots)[number]) => {
    spot.mixer?.stopAllAction(); spot.mixer = null;
    if (spot.figure) { releaseFinishes(spot.figure); spot.figure.removeFromParent(); disposeFigurineObject(spot.figure); spot.figure = null; }
    spot.entry = null;
  };
  // Works through the slots whose figure differs from the one wanted, one load at a time.
  const pump = async () => {
    if (busy || disposed) return;
    const index = spots.findIndex((spot, slot) => (spot.entry?.url ?? null) !== (wanted[slot]?.url ?? null) || (spot.entry && spot.entry.quality !== wanted[slot]?.quality));
    if (index < 0) return;
    const spot = spots[index], next = wanted[index] ?? null;
    if (spot.entry?.url === next?.url && spot.figure && next) {
      // Same figure, another finish.
      releaseFinishes(spot.figure); applyFinish(spot.figure, next.quality, finishEnv); spot.entry = next;
      return void pump();
    }
    clear(spot);
    if (!next) return void pump();
    busy = true;
    try {
      const gltf = await load(next.url), figure = place(gltf.scene);
      if (disposed) { disposeFigurineObject(figure); return; }
      applyFinish(figure, next.quality, finishEnv);
      spot.group.add(figure); spot.figure = figure; spot.entry = next;
      const idle = gltf.animations.find((clip) => /stand|idle/i.test(clip.name));
      // Each starts at its own point in the idle, so neighbours never move in step.
      if (idle) { spot.mixer = new THREE.AnimationMixer(figure); spot.mixer.clipAction(idle).play(); spot.mixer.update(Math.random() * idle.duration); }
    } catch { spot.entry = next; /* a missing model leaves the plinth empty */ }
    finally { busy = false; }
    void pump();
  };
  return {
    setShowcase(entries: StatueEntry[]) { wanted = entries; void pump(); },
    update(delta: number) { spots.forEach((spot) => spot.mixer?.update(delta)); },
    dispose() { disposed = true; spots.forEach(clear); },
  };
}
