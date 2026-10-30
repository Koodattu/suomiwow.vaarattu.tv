import type * as THREE from "three";

/** Exercise the first draw (including geometry and shadow programs) before a reveal is ready. */
export async function warmFigurineScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget,
  current: () => boolean,
): Promise<boolean> {
  // Restore synchronously: animation frames can run while compileAsync is pending.
  const revealed = <T>(renderTarget: THREE.WebGLRenderTarget | null, run: () => T): T => {
    const previousTarget = renderer.getRenderTarget();
    const objects: [THREE.Object3D, boolean, boolean][] = [];
    scene.traverse((object) => {
      objects.push([object, object.visible, object.frustumCulled]);
      object.visible = true;
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
  await revealed(target, () => renderer.compileAsync(scene, camera));
  if (!current()) return false;
  revealed(target, () => renderer.render(scene, camera));
  // The canvas uses different tone-mapping/color-space variants than an offscreen target.
  await revealed(null, () => renderer.compileAsync(scene, camera));
  return current();
}
