import type * as THREE from "three";

/** Exercise the first draw (including geometry and shadow programs) before a reveal is ready. */
export async function warmFigurineScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget,
  current: () => boolean,
  root: THREE.Object3D = scene,
): Promise<boolean> {
  // Restore synchronously: animation frames can run while compileAsync is pending.
  const revealed = <T>(renderTarget: THREE.WebGLRenderTarget | null, run: () => T): T => {
    const previousTarget = renderer.getRenderTarget();
    const objects: [THREE.Object3D, boolean, boolean][] = [];
    const members = new Set<THREE.Object3D>();
    root.traverse((object) => members.add(object));
    scene.traverse((object) => {
      objects.push([object, object.visible, object.frustumCulled]);
      // Keep the world's lights and grouping hierarchy, but do not redraw its geometry
      // every time a figure arrives. compileAsync uses the same target scene's lighting.
      object.visible = members.has(object) || !("isMesh" in object || "isPoints" in object || "isSprite" in object);
      object.frustumCulled = false;
    });
    try {
      renderer.setRenderTarget(renderTarget);
      return run();
    } finally {
      renderer.setRenderTarget(previousTarget);
      objects.forEach(([object, visible, culled]) => { object.visible = visible; object.frustumCulled = culled; });
    }
  };

  if (!current()) return false;
  await revealed(target, () => renderer.compileAsync(root, camera, scene));
  if (!current()) return false;
  revealed(target, () => renderer.render(scene, camera));
  // The canvas uses different tone-mapping/color-space variants than an offscreen target.
  await revealed(null, () => renderer.compileAsync(root, camera, scene));
  return current();
}
