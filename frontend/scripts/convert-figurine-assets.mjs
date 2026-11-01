// Convert texture payloads only. Geometry, skeletons, poses, materials and export metadata stay intact.
// node scripts/convert-figurine-assets.mjs <exporter-root> <toktx.exe> <backup-and-output-dir> [--apply]
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const [exporter, encoder, work, apply] = process.argv.slice(2);
if (!exporter || !encoder || !work) throw new Error("Expected exporter root, toktx executable and work directory");
const require = createRequire(path.resolve(exporter, "worker/optimizer/package.json"));
const sharp = require("sharp"), validator = require("gltf-validator");
const { NodeIO } = require("@gltf-transform/core"), { ALL_EXTENSIONS } = require("@gltf-transform/extensions"), { MeshoptDecoder } = require("meshoptimizer");
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const run = promisify(execFile), hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const frontend = path.resolve(import.meta.dirname, ".."), publicRoot = path.join(frontend, "public/figurines");
const originalRoot = path.join(work, "originals"), outputRoot = path.join(work, "converted");
await fs.mkdir(outputRoot, { recursive: true });
const parse = (bytes) => { const n = bytes.readUInt32LE(12); return { doc: JSON.parse(bytes.subarray(20, 20 + n)), bin: bytes.subarray(28 + n) }; };
const imageBytes = ({ doc, bin }, index) => { const view = doc.bufferViews[doc.images[index].bufferView]; return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength); };
const imageOf = (doc, index) => { const texture = doc.textures[index]; return texture.source ?? texture.extensions?.EXT_texture_webp?.source ?? texture.extensions?.KHR_texture_basisu?.source; };
const slots = (material) => ({ baseColor: material.pbrMetallicRoughness?.baseColorTexture, metallicRoughness: material.pbrMetallicRoughness?.metallicRoughnessTexture, normal: material.normalTexture, occlusion: material.occlusionTexture, emissive: material.emissiveTexture });
const catalogs = [];
for (const file of (await fs.readdir(path.join(frontend, "src/data/figurines"))).filter(file => /^(community-|prototype-series-)\d+\.json$/.test(file))) {
  const filename = path.join(frontend, "src/data/figurines", file);
  catalogs.push({ filename, doc: JSON.parse(await fs.readFile(filename)), original: await fs.readFile(filename) });
}
const jobs = (await fs.readdir(path.join(exporter, "worker/data/results"))).filter(job => /-models-\d+$/.test(job));
async function sourceFor(file, currentDoc) {
  const base = path.basename(file, ".glb");
  if (file.startsWith("world" + path.sep)) {
    const candidates = new Map();
    for (const job of jobs) {
      const source = path.join(exporter, "worker/data/results", job, `${base}.glb`);
      try {
        const bytes = await fs.readFile(source), raw = parse(bytes);
        // Different export jobs can reuse a filename for different WoW assets.
        if ((currentDoc.materials ?? []).every(material => raw.doc.materials?.some(candidate => candidate.name === material.name))) candidates.set(hash(bytes), { bytes, source });
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (candidates.size > 1) throw new Error(`Ambiguous original sources: ${file}`);
    if (candidates.size === 1) return [...candidates.values()][0];
  } else {
    const catalog = catalogs.find(c => c.doc.id === file.split(path.sep)[0])?.doc;
    const entry = catalog?.characters.find(c => c.id === base);
    const batches = [...new Set([entry?.authoringSeries, catalog?.authoringSeries, ...(catalog?.characters.map(c => c.authoringSeries) ?? [])].filter(Boolean))];
    for (const batch of batches) {
      const filename = path.join(exporter, "worker/data/series", batch, "sources", `${base}.json`);
      try {
        const record = JSON.parse(await fs.readFile(filename));
        const source = path.join(exporter, "worker/data/results", record.export.id, record.export.model), bytes = await fs.readFile(source);
        if (hash(bytes) !== record.export.sha256) throw new Error(`Source hash mismatch: ${source}`);
        return { bytes, source };
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  throw new Error(`Missing original source: ${file}`);
}
// Rebuild only image ranges in the BIN chunk; shift every offset that follows them.
function replaceImages(original, replacements) {
  const { doc, bin } = parse(original);
  const ranges = doc.images.map((image, index) => ({ index, view: image.bufferView, start: doc.bufferViews[image.bufferView].byteOffset ?? 0, length: doc.bufferViews[image.bufferView].byteLength })).sort((a,b) => a.start-b.start);
  const parts = [], shifts = []; let cursor = 0, length = 0;
  for (const range of ranges) {
    if (range.start < cursor) throw new Error("Overlapping image views");
    const prefix = bin.subarray(cursor, range.start); parts.push(prefix); length += prefix.length;
    const encoded = replacements[range.index], view = doc.bufferViews[range.view];
    view.byteOffset = length; view.byteLength = encoded.length;
    parts.push(encoded); length += encoded.length;
    // Keep the original alignment padding after this range; add a whole multiple of four bytes.
    const padding = (range.length - encoded.length) & 3;
    parts.push(Buffer.alloc(padding)); length += padding;
    cursor = range.start + range.length;
    shifts.push({ end: cursor, delta: encoded.length + padding - range.length });
    doc.images[range.index].mimeType = "image/ktx2";
  }
  const offset = (value = 0) => value + shifts.filter(s => s.end <= value).reduce((sum,s) => sum+s.delta,0);
  const imageViews = new Set(ranges.map(r=>r.view));
  doc.bufferViews.forEach((view,index) => {
    if (view.buffer === 0 && !imageViews.has(index)) view.byteOffset = offset(view.byteOffset);
    const compression = view.extensions?.EXT_meshopt_compression;
    if (compression?.buffer === 0) compression.byteOffset = offset(compression.byteOffset);
  });
  parts.push(bin.subarray(cursor));
  let binary = Buffer.concat(parts); doc.buffers[0].byteLength = binary.length;
  if (binary.length % 4) binary = Buffer.concat([binary, Buffer.alloc(4 - binary.length % 4)]);
  for (const texture of doc.textures ?? []) {
    const source = texture.source ?? texture.extensions?.EXT_texture_webp?.source ?? texture.extensions?.KHR_texture_basisu?.source;
    texture.extensions ??= {}; delete texture.extensions.EXT_texture_webp; delete texture.source;
    texture.extensions.KHR_texture_basisu = { source };
  }
  for (const field of ["extensionsUsed", "extensionsRequired"]) doc[field] = [...new Set([...(doc[field] ?? []).filter(x=>x!=="EXT_texture_webp"), "KHR_texture_basisu"])];
  let json = Buffer.from(JSON.stringify(doc)); json = Buffer.concat([json, Buffer.alloc((4-json.length%4)%4,32)]);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2,4); header.writeUInt32LE(28+json.length+binary.length,8); header.writeUInt32LE(json.length,12); header.writeUInt32LE(0x4e4f534a,16);
  const chunk = Buffer.alloc(8); chunk.writeUInt32LE(binary.length); chunk.writeUInt32LE(0x004e4942,4);
  const output = Buffer.concat([header,json,chunk,binary]);
  // Every geometry/animation/skin view and compressed geometry stream must be byte-identical.
  const before = parse(original), after = parse(output);
  before.doc.bufferViews.forEach((view,index) => {
    if (imageViews.has(index)) return;
    for (const [a,b] of [[view,after.doc.bufferViews[index]],[view.extensions?.EXT_meshopt_compression,after.doc.bufferViews[index].extensions?.EXT_meshopt_compression]]) {
      if (!a || a.buffer !== 0) continue;
      if (!before.bin.subarray(a.byteOffset??0,(a.byteOffset??0)+a.byteLength).equals(after.bin.subarray(b.byteOffset??0,(b.byteOffset??0)+b.byteLength))) throw new Error("Non-image buffer changed");
    }
  });
  return output;
}
const files = (await fs.readdir(publicRoot,{recursive:true})).filter(file=>file.endsWith(".glb")).sort();
const plans = [];
// Resolve every texture against original source material slots before writing any served file.
for (const file of files) {
  const original = await fs.readFile(path.join(publicRoot,file)), current = parse(original);
  const isEtc1s = (image, index) => {
    if (image.mimeType !== "image/ktx2") return false;
    const bytes = imageBytes(current,index);
    return bytes.readUInt32LE(44) === 1 && bytes[bytes.readUInt32LE(48) + 12] === 163;
  };
  if ((current.doc.images ?? []).every(isEtc1s)) continue;
  const backup = path.join(originalRoot,file);
  await fs.mkdir(path.dirname(backup),{recursive:true});
  try { await fs.writeFile(backup,original,{flag:"wx"}); }
  catch(error) {
    if(error.code!=="EEXIST")throw error;
    if(!(await fs.readFile(backup)).equals(original))throw new Error(`Backup differs; use a fresh work directory: ${file}`);
  }
  const source = await sourceFor(file,current.doc), raw = parse(source.bytes);
  const sources = current.doc.images.map(()=>new Map());
  for (const material of current.doc.materials ?? []) for (const [slot,reference] of Object.entries(slots(material))) {
    if (!reference) continue;
    const target = imageOf(current.doc,reference.index);
    for (const candidate of raw.doc.materials.filter(m=>m.name===material.name)) {
      const reference = slots(candidate)[slot]; if (!reference) continue;
      const bytes = imageBytes(raw,imageOf(raw.doc,reference.index)); sources[target].set(hash(bytes),bytes);
    }
  }
  const textures = await Promise.all(sources.map(async (candidates,index) => {
    if (isEtc1s(current.doc.images[index],index)) return { encoded: imageBytes(current,index) };
    if (candidates.size !== 1) throw new Error(`${file} image ${index}: ${candidates.size} original source candidates`);
    const bytes = imageBytes(current,index);
    const meta = current.doc.images[index].mimeType === "image/ktx2" ? { width:bytes.readUInt32LE(20), height:bytes.readUInt32LE(24) } : await sharp(bytes).metadata();
    if ((meta.width & (meta.width-1)) || (meta.height & (meta.height-1))) throw new Error(`Non-power-of-two runtime image: ${file} image ${index}`);
    return { source: [...candidates.values()][0], width:meta.width, height:meta.height, color: current.doc.materials.some(m=>[m.pbrMetallicRoughness?.baseColorTexture,m.emissiveTexture].some(t=>t&&imageOf(current.doc,t.index)===index)) };
  }));
  plans.push({ file, original, textures, source: source.source });
}
console.log(`Preflight: ${plans.length} models, ${plans.reduce((s,p)=>s+p.textures.length,0)} textures from original exports.`);
if (!plans.length) {
  console.log("All model textures already use ETC1S; no assets or catalogs changed.");
  process.exit(0);
}
const textureDir = path.join(work,"textures"); await fs.mkdir(textureDir,{recursive:true});
const report = { codec:"ETC1S",qlevel:255,clevel:2,mipmaps:true,models:[] };
for (const plan of plans) {
  const replacements=[];
  for (const texture of plan.textures) {
    if (texture.encoded) { replacements.push(texture.encoded); continue; }
    const png = await sharp(texture.source).resize(texture.width,texture.height,{fit:"fill"}).ensureAlpha().png().toBuffer();
    const key=hash(Buffer.concat([png,Buffer.from(texture.color?"srgb":"linear")])), pngFile=path.join(textureDir,`${key}.png`), ktxFile=path.join(textureDir,`${key}.ktx2`);
    try { replacements.push(await fs.readFile(ktxFile)); }
    catch(error) {
      if(error.code!=="ENOENT")throw error;
      await fs.writeFile(pngFile,png);
      await run(encoder,["--t2","--encode","etc1s","--qlevel","255","--clevel","2","--genmipmap","--assign_oetf",texture.color?"srgb":"linear","--threads","4",ktxFile,pngFile]);
      replacements.push(await fs.readFile(ktxFile));
    }
  }
  const output=replaceImages(plan.original,replacements), filename=path.join(outputRoot,plan.file);
  const decoded=await io.readBinary(output);
  for(const ext of decoded.getRoot().listExtensionsUsed())if(ext.extensionName==="EXT_meshopt_compression")ext.dispose();
  const check=await validator.validateBytes(await io.writeBinary(decoded),{maxIssues:1000});
  if(check.issues.numErrors||check.issues.truncated)throw new Error(`${plan.file}: ${JSON.stringify(check.issues)}`);
  await fs.mkdir(path.dirname(filename),{recursive:true}); await fs.writeFile(filename,output);
  report.models.push({file:plan.file,source:plan.source,originalHash:hash(plan.original),sha256:hash(output),beforeBytes:plan.original.length,bytes:output.length,textures:replacements.length,geometryUnchanged:true,validationErrors:check.issues.numErrors});
  await fs.writeFile(path.join(work,"conversion-report.json"),JSON.stringify(report,null,2));
  console.log(`${plan.file}: ${plan.original.length} -> ${output.length}; geometry unchanged`);
}
if(apply==="--apply") {
  // Reject concurrent edits before replacing any model or catalog.
  for(const model of report.models)if(hash(await fs.readFile(path.join(publicRoot,model.file)))!==model.originalHash)throw new Error(`Concurrent asset edit: ${model.file}`);
  for(const catalog of catalogs)if(!(await fs.readFile(catalog.filename)).equals(catalog.original))throw new Error(`Concurrent catalog edit: ${catalog.filename}`);
  const changedCatalogs = catalogs.filter(catalog=>catalog.doc.characters.some(entry=>report.models.some(m=>m.file.replaceAll(path.sep,"/")===entry.model.split("?")[0].replace("/figurines/",""))));
  for(const catalog of changedCatalogs) {
    await fs.mkdir(path.join(work,"catalogs"),{recursive:true});
    await fs.writeFile(path.join(work,"catalogs",path.basename(catalog.filename)),catalog.original,{flag:"wx"});
  }
  for(const model of report.models)await fs.copyFile(path.join(outputRoot,model.file),path.join(publicRoot,model.file));
  for(const catalog of changedCatalogs) {
    catalog.doc.compression = { geometry: "EXT_meshopt_compression", textures: "KHR_texture_basisu", codec: "ETC1S", maxTextureSize: 2048, qlevel: 255, clevel: 2, mipmaps: true };
    for(const entry of catalog.doc.characters) {
      const model=report.models.find(m=>m.file.replaceAll(path.sep,"/")===entry.model.split("?")[0].replace("/figurines/",""));
      if(!model)continue;
      entry.bytes=model.bytes; entry.sha256=model.sha256; entry.model=entry.model.split("?")[0]+`?v=${model.sha256.slice(0,12)}`;
    }
    await fs.writeFile(catalog.filename,JSON.stringify(catalog.doc,null,2)+"\n");
  }
  console.log("Applied converted assets and catalog hashes.");
}
