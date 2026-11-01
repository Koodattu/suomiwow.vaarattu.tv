import * as THREE from "three";

/** Restore source-tagged glow surfaces; never infer transparency from dark pixels. */
export function restoreFigurineMaterials(root: THREE.Object3D) {
  const replacements = new Map<THREE.Material, THREE.Material>();
  const replace = (source: THREE.Material) => {
    const metadata = source.userData.wowM2;
    if (!(source instanceof THREE.MeshStandardMaterial) || metadata?.version !== 1 || ![3, 4].includes(metadata.blendingMode)) return source;
    const cached = replacements.get(source);
    if (cached) return cached;
    const effect = new THREE.MeshBasicMaterial({
      name: source.name, map: source.map, color: source.color,
      opacity: source.opacity, side: source.side, transparent: true,
      depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending,
      blendSrc: metadata.blendingMode === 3 ? THREE.OneFactor : THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    effect.userData = { ...source.userData };
    replacements.set(source, effect);
    return effect;
  };
  root.traverse((object) => {
    if (object instanceof THREE.Mesh)
      object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
  });
  // Textures are reused and are released with the model, not with these old materials.
  replacements.forEach((_, source) => source.dispose());
}

export function figurineGround(metadata: unknown, fallback: number): number {
  if (typeof metadata !== "object" || metadata === null) return fallback;
  const value = metadata as { version?: unknown; groundY?: unknown };
  return value.version === 1 && typeof value.groundY === "number" && Number.isFinite(value.groundY) ? value.groundY : fallback;
}

/** Resolve exported support coordinates before applying the viewer's model rotation. */
export function figurineSupport(root: THREE.Object3D, bounds: THREE.Box3): THREE.Vector3 {
  const metadata = root.userData.wowCharacter;
  if (metadata?.version === 1 && [metadata.centerX, metadata.groundY, metadata.centerZ].every(value => typeof value === "number" && Number.isFinite(value))) {
    return root.localToWorld(new THREE.Vector3(metadata.centerX, metadata.groundY, metadata.centerZ));
  }
  // Older or imported models retain their original bounds-based placement.
  const support = bounds.getCenter(new THREE.Vector3());
  support.y = figurineGround(metadata, bounds.min.y);
  return support;
}

/**
 * Bounds of the character's own body: skin, hair and worn geosets, without attached items.
 * Exports name item parts after their slot (`Head_Item…`, `Main-hand_Item…`, `Back_Item…`), and
 * staffs, wings, plumes and their effects stick out by very different amounts, so sizing figures
 * by their whole bounds made their bodies differ in size. Falls back to the whole model.
 */
export function figurineBodyBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const body = new THREE.Box3(), part = new THREE.Box3();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    for (let node: THREE.Object3D | null = mesh; node && node !== root; node = node.parent) if (/_Item/.test(node.name)) return;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) { (mesh as THREE.SkinnedMesh).computeBoundingBox(); part.copy((mesh as THREE.SkinnedMesh).boundingBox!); }
    else { mesh.geometry.computeBoundingBox(); part.copy(mesh.geometry.boundingBox!); }
    body.union(part.applyMatrix4(mesh.matrixWorld));
  });
  return body.isEmpty() ? new THREE.Box3().setFromObject(root) : body;
}

// The tallest standard body and the shared footprint limit (the box is 2.75 tall).
export const FIGURE_HEIGHT = 2.3, FIGURE_WIDTH = 3.1;
// Art-directed display heights, not canonical measurements in metres. Keys are the exporter's
// body model names, so visage/cat forms are sized by their visible body, not the owner's race.
// Keep the largest races within the existing camera/box envelope; items may extend past it.
// All 26 playable races have targets, including races not yet in the catalog.
// Male and female variants share a target. Scourge = Undead; Harronir = Haranir.
export const FIGURE_BODY_HEIGHTS: Readonly<Record<string, number>> = {
  human: 1.85, kultiran: 2.15, scourge: 1.8, worgen: 2.1,
  dwarf: 1.3, darkirondwarf: 1.3, earthen: 1.45,
  gnome: 0.95, mechagnome: 0.95, goblin: 1.05, vulpera: 1.1,
  bloodelf: 1.85, voidelf: 1.85, nightelf: 2.1, nightborne: 2.1,
  draenei: 2.15, lightforgeddraenei: 2.15,
  orc: 2, magharorc: 2, troll: 2.15, zandalaritroll: 2.2, pandaren: 1.95,
  tauren: FIGURE_HEIGHT, highmountaintauren: FIGURE_HEIGHT,
  harronir: 2.1, dracthyr: 1.85, dracthyrdragon: 2.2, cat: 1.1,
};

export function figurineHeight(modelName = ""): number {
  // Known WoW exports: dwarffemale_hd_Scene, highmountaintaurenmale_Scene, cat_Scene.
  // Custom imports without this naming convention retain the previous neutral fitting.
  const body = /^([a-z]+?)(?:female|male)?(?:_hd)?_scene$/i.exec(modelName)?.[1].toLowerCase();
  return body && Object.hasOwn(FIGURE_BODY_HEIGHTS, body) ? FIGURE_BODY_HEIGHTS[body] : FIGURE_HEIGHT;
}

export const figurineScale = (body: THREE.Box3, modelName?: string) => {
  const size = body.getSize(new THREE.Vector3());
  return Math.min(figurineHeight(modelName) / Math.max(size.y, 1e-3), FIGURE_WIDTH / Math.max(size.x, size.z, 1e-3));
};
