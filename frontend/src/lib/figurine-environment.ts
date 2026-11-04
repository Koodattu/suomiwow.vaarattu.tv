import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import studio from "@/data/figurines/environment.json";

/** Fixed studio reflections, baked once instead of convolving the room on every visit. */
export function loadFigurineEnvironment(renderer: THREE.WebGLRenderer) {
  const controller = new AbortController();
  const texture = new THREE.DataTexture(null, studio.width, studio.height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.CubeUVReflectionMapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  const ready = (async () => {
    let pixels: Uint16Array;
    try {
      if (studio.version !== THREE.REVISION) throw new Error("Studio bake needs updating");
      const response = await fetch(studio.url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
      if (!response.ok || !response.body) throw new Error("Studio bake unavailable");
      const data = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      if (data.byteLength !== studio.width * studio.height * 8) throw new Error("Incomplete studio bake");
      pixels = new Uint16Array(data);
    } catch {
      if (controller.signal.aborted) return;
      // A missing/stale asset must still produce the same lighting, with no permanent loading gate.
      const room = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
      const target = generator.fromScene(room, 0.04);
      pixels = new Uint16Array(target.width * target.height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
      texture.image.width = target.width; texture.image.height = target.height;
      target.dispose(); generator.dispose(); room.dispose();
    }
    if (controller.signal.aborted) return;
    texture.image.data = pixels; texture.needsUpdate = true;
  })();
  return { texture, ready, dispose() { controller.abort(); texture.dispose(); } };
}
