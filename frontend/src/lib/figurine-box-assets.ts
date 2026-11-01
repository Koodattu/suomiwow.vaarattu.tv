import * as THREE from "three";
import type { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import manifest from "@/data/figurines/packaging.json";
import { boxPrintKey, type BoxDesign, type BakedBoxTextures } from "@/lib/figurine-packaging";

type PrintManifest = Record<string, Record<string, Record<string, string>>>;
// KTX2Loader.load returns nothing: the texture exists only once its worker has transcoded it.
type Entry = { texture?: THREE.Texture; ready: Promise<THREE.Texture>; users: number };
/** Scene-owned, reference-counted textures shared by matching boxes. Materials remain per box. */
export function boxTextureCache(loader: Pick<KTX2Loader, "load">, retained: Set<THREE.Texture>, designs: PrintManifest = manifest.designs) {
  const entries = new Map<string, Entry>();
  const acquire = (files: Record<string, string>): BakedBoxTextures => {
    const leases: [string, string, Entry][] = [], maps: Record<string, THREE.Texture> = {};
    for (const [name, file] of Object.entries(files)) {
      const key = `${file}|${name === "inside" ? "repeat" : "plain"}`;
      let entry = entries.get(key);
      if (!entry) {
        const created: Entry = { ready: new Promise<THREE.Texture>((resolve, reject) => loader.load(`/figurines/packaging/${file}`, (texture) => {
          texture.anisotropy = 8;
          if (name === "inside") { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2.2, 2.2); }
          // A box can be evicted while its worker is still transcoding.
          if (entries.get(key) === created) { created.texture = texture; retained.add(texture); } else texture.dispose();
          resolve(texture);
        }, undefined, reject)), users: 0 };
        entry = created; entries.set(key, entry);
      }
      entry.users++; leases.push([key, name, entry]);
    }
    let stopped = false;
    // Maps fill in once every lease has loaded; callers attach them after `ready`.
    return { maps, ready: Promise.all(leases.map(([, name, entry]) => entry.ready.then((texture) => { maps[name] = texture; }))).then(() => undefined), stop() {
      if (stopped) return; stopped = true;
      for (const [key, , entry] of leases) if (--entry.users === 0) release(key, entry);
    } };
  };
  const release = (key: string, entry: Entry) => {
    entries.delete(key);
    if (entry.texture) { retained.delete(entry.texture); entry.texture.dispose(); }
  };
  return { design(design: BoxDesign): BoxDesign {
    const prints = designs[boxPrintKey(design)];
    // The import lab can supply arbitrary artwork. Only matching baked designs use this path.
    return prints?.[150] && prints?.[500] ? { ...design, baked: (density) => acquire(prints[density <= 150 ? 150 : 500]) } : design;
  }, dispose() { entries.forEach((entry, key) => release(key, entry)); } };
}
