// Offline pilot. Uses the existing exporter toolchain; never rewrites served assets.
// node scripts/figurine-ktx-pilot.mjs <exporter-root> <toktx.exe> <output-directory> [uastc|etc1s]
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

const [exporter, encoder, destination, codec = "uastc"] = process.argv.slice(2);
if (!exporter || !encoder || !destination) throw new Error("Expected exporter root, toktx executable, and new output directory");
if (!["uastc", "etc1s"].includes(codec)) throw new Error("Unknown texture codec");
const require = createRequire(path.resolve(exporter, "worker/optimizer/package.json"));
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS, KHRTextureBasisu } = require("@gltf-transform/extensions");
const { dedup, prune, weld, meshopt, getTextureColorSpace } = require("@gltf-transform/functions");
const { MeshoptEncoder, MeshoptDecoder } = require("meshoptimizer");
const sharp = require("sharp");
const validator = require("gltf-validator");
const run = promisify(execFile);
const frontend = path.resolve(import.meta.dirname, "..");
await fs.mkdir(destination); // Preserve earlier measurements on reruns.
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const catalog = JSON.parse(await fs.readFile(path.join(frontend, "src/data/figurines/community-001.json")));
const encodeOptions = codec === "uastc" ? ["--uastc_quality", "4", "--zcmp", "18"] : ["--qlevel", "255", "--clevel", "2"];
const report = { encoder: (await run(encoder, ["--version"])).stdout.trim(), settings: { codec, encodeOptions, maxDimension: 2048, mipmaps: true }, models: [] };
for (const id of ["rmp", "kahvishock", "roidy"]) {
  const entry = catalog.characters.find((item) => item.id === id);
  const batch = entry.authoringSeries ?? catalog.authoringSeries;
  const source = JSON.parse(await fs.readFile(path.join(exporter, "worker/data/series", batch, "sources", `${id}.json`)));
  const raw = await fs.readFile(path.join(exporter, "worker/data/results", source.export.id, source.export.model));
  if (createHash("sha256").update(raw).digest("hex") !== source.export.sha256) throw new Error(`Source hash mismatch: ${id}`);
  const doc = await io.readBinary(raw);
  await doc.transform(dedup(), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const textureReport = [];
  const folder = path.join(destination, id);
  await fs.mkdir(folder);
  for (const [index, texture] of doc.getRoot().listTextures().entries()) {
    const png = path.join(folder, `${index}.png`), ktx = path.join(folder, `${index}.ktx2`);
    const colorSpace = getTextureColorSpace(texture) === "srgb" ? "srgb" : "linear";
    const info = await sharp(texture.getImage()).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).ensureAlpha().png().toFile(png);
    const started = performance.now();
    await run(encoder, ["--t2", "--encode", codec, ...encodeOptions, "--genmipmap", "--assign_oetf", colorSpace, "--threads", "4", ktx, png]);
    const bytes = await fs.readFile(ktx);
    texture.setImage(bytes).setMimeType("image/ktx2");
    textureReport.push({ index, name: texture.getName(), width: info.width, height: info.height, colorSpace, bytes: bytes.length, encodeMs: performance.now() - started });
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const bytes = await io.writeBinary(doc);
  await fs.writeFile(path.join(destination, `${id}.glb`), bytes, { flag: "wx" });
  const decoded = await io.readBinary(bytes);
  for (const ext of decoded.getRoot().listExtensionsUsed()) if (ext.extensionName === "EXT_meshopt_compression") ext.dispose();
  const validation = await validator.validateBytes(await io.writeBinary(decoded), { maxIssues: 1000 });
  if (validation.issues.numErrors || validation.issues.truncated) throw new Error(`Invalid pilot ${id}: ${JSON.stringify(validation.issues)}`);
  report.models.push({ id, batch, originalBytes: entry.bytes, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), textures: textureReport, validation: validation.issues });
  await fs.writeFile(path.join(destination, "report.json"), JSON.stringify(report, null, 2));
  console.log(`${id}: ${entry.bytes} -> ${bytes.length} bytes; ${textureReport.length} textures; ${validation.issues.numErrors} validation errors`);
}
