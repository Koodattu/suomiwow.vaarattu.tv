// node scripts/audit-figurine-assets.mjs [report.json]
// Static payload audit; does not claim to measure live driver/VRAM allocations.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const root = path.resolve(import.meta.dirname, "../public/figurines");
const files = (await fs.readdir(root, { recursive: true })).filter((file) => /\.(glb|png|jpe?g|webp)$/i.test(file));
const report = { assumptions: "RGBA8 textures with full mip chains; KTX2 assumes an 8-bpp 4x4-block GPU target with supplied mip levels (device-dependent, not file size). Includes GLB images and loose images separately; not all are simultaneously resident. Geometry counts include all GLB meshes.", assets: [] };
for (const file of files.sort()) {
  const buffer = await fs.readFile(path.join(root, file));
  if (!file.endsWith(".glb")) {
    const meta = await sharp(buffer).metadata();
    report.assets.push({ file, bytes: buffer.length, width: meta.width, height: meta.height, textureBytes: meta.width * meta.height * 16 / 3 });
    continue;
  }
  const length = buffer.readUInt32LE(12), doc = JSON.parse(buffer.subarray(20, 20 + length).toString()), binary = buffer.subarray(28 + length);
  const images = [];
  for (const image of doc.images ?? []) {
    const view = doc.bufferViews[image.bufferView], data = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    if (image.mimeType === "image/ktx2") {
      const width = data.readUInt32LE(20), height = data.readUInt32LE(24), levels = data.readUInt32LE(40);
      let textureBytes = 0;
      for (let level = 0; level < levels; level++) textureBytes += Math.ceil(Math.max(1, width >> level) / 4) * Math.ceil(Math.max(1, height >> level) / 4) * 16;
      images.push({ width, height, mimeType: image.mimeType, textureBytes });
    } else {
      const meta = await sharp(data).metadata();
      images.push({ width: meta.width, height: meta.height, mimeType: image.mimeType, textureBytes: meta.width * meta.height * 16 / 3 });
    }
  }
  const primitives = (doc.meshes ?? []).flatMap((mesh) => mesh.primitives);
  report.assets.push({ file, bytes: buffer.length, images, textureBytes: images.reduce((sum, image) => sum + image.textureBytes, 0), materials: doc.materials?.length ?? 0, primitives: primitives.length, triangles: primitives.filter((p) => (p.mode ?? 4) === 4).reduce((sum, p) => sum + doc.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0), extensions: doc.extensionsUsed ?? [] });
}
report.groups = Object.fromEntries(["community-000", "community-001", "community-002", "world"].map((group) => {
  const assets = report.assets.filter((asset) => asset.file.startsWith(group + path.sep));
  return [group, { count: assets.length, fileBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0), textureBytes: assets.reduce((sum, asset) => sum + asset.textureBytes, 0) }];
}));
if (process.argv[2]) await fs.writeFile(process.argv[2], JSON.stringify(report, null, 2));
console.log(JSON.stringify({ groups: report.groups, largest: [...report.assets].sort((a, b) => b.textureBytes - a.textureBytes).slice(0, 10).map(({ file, bytes, textureBytes, primitives }) => ({ file, bytes, textureMiB: textureBytes / 1048576, primitives })) }, null, 2));
