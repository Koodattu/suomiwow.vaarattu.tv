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
