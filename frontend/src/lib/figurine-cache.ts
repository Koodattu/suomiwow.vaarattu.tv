import type * as THREE from "three";

/** Release owned resources once, without invalidating textures shared with the rest of the scene. */
export function disposeFigurineObject(root: THREE.Object3D, retainedTextures: ReadonlySet<THREE.Texture> = new Set()) {
  const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    const drawable = object as THREE.Mesh;
    const sprite = (object as THREE.Sprite).isSprite;
    if (!drawable.isMesh && !(object as THREE.Points).isPoints && !sprite) return;
    if (!sprite) geometries.add(drawable.geometry);
    for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture && !retainedTextures.has(value)) textures.add(value);
    }
  });
  textures.forEach((texture) => { texture.dispose(); if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close(); });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

/** Resident texture payload and geometry; excludes driver overhead and render targets. */
export function figurineResourceBytes(root: THREE.Object3D) {
  const textures = new Map<THREE.Texture["source"], THREE.Texture>(), buffers = new Set<ArrayBufferLike>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const attribute of [...Object.values(mesh.geometry.attributes), mesh.geometry.index]) {
      if (!attribute) continue;
      const array = "data" in attribute ? attribute.data.array : attribute.array;
      buffers.add(array.buffer);
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      for (const value of Object.values(material)) if (value?.isTexture) textures.set(value.source, value);
  });
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0)
    + [...textures.values()].reduce((sum, texture) => {
      // KTX2 has already been transcoded for this device. Count actual block payloads,
      // including all supplied mip levels, rather than treating them as RGBA pixels.
      if ((texture as THREE.CompressedTexture).isCompressedTexture) {
        return sum + texture.mipmaps.reduce((bytes, mip) => bytes + (mip as THREE.CompressedTexture["mipmaps"][number]).data.byteLength, 0);
      }
      const image = texture.source.data as { width?: number; height?: number; data?: ArrayBufferView } | null;
      const base = image?.data?.byteLength ?? (image?.width ?? 0) * (image?.height ?? 0) * 4;
      return sum + base * (texture.generateMipmaps ? 4 / 3 : 1);
    }, 0);
}

/** A page-owned download cache. Rejected requests can be retried; concurrent readers share one request. */
export function createFigurineFileCache() {
  const files = new Map<string, Promise<File>>();
  const controller = new AbortController();
  return {
    get(url: string, bytes: number): Promise<File> {
      const cached = files.get(url);
      if (cached) return cached;
      const pending = (async () => {
        const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
        if (!response.ok) throw new Error("Model unavailable");
        const blob = await response.blob();
        if (blob.size !== bytes) throw new Error("Incomplete model");
        return new File([blob], "collectible.glb");
      })();
      files.set(url, pending);
      void pending.catch(() => { if (files.get(url) === pending) files.delete(url); });
      return pending;
    },
    dispose() { controller.abort(); files.clear(); },
  };
}

/** GPU resources stay alive between selections, within a byte budget (the active model is never evicted). */
export function createFigurineResourceCache<T>(budget: number, dispose: (value: T) => void) {
  const entries = new Map<string, { value: T; bytes: number }>();
  return {
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key); entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T, bytes: number) {
      const previous = entries.get(key);
      if (previous && previous.value !== value) dispose(previous.value);
      entries.delete(key); entries.set(key, { value, bytes });
    },
    trim(active: string | null) {
      let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
      for (const [key, entry] of entries) {
        if (bytes <= budget) break;
        if (key === active) continue;
        entries.delete(key); bytes -= entry.bytes; dispose(entry.value);
      }
    },
    dispose() { entries.forEach(({ value }) => dispose(value)); entries.clear(); },
  };
}
