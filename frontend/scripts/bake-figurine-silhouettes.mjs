// Bakes a sprite sheet of solid black character silhouettes for the blind-box print.
// Usage: node scripts/bake-figurine-silhouettes.mjs [catalog.json]
// Each cell is one catalog character, in catalog order, seen as the reveal camera
// sees it (the stage turns models -90° about Y), feet on the cell's bottom edge.
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { Matrix4, Quaternion, Vector3 } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// Cells are wide enough that almost every pose is fitted by height, so figures share one height.
const CELL_W = 280, CELL_H = 360, PAD = 6, SUPERSAMPLE = 3, COLUMNS = 8;
const catalogPath = new URL(process.argv[2] ?? "../src/data/figurines/community-001.json", import.meta.url);
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const publicDir = new URL("../public", import.meta.url);
await MeshoptDecoder.ready;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPES = { 5120: [Int8Array, 127], 5121: [Uint8Array, 255], 5122: [Int16Array, 32767], 5123: [Uint16Array, 65535], 5125: [Uint32Array, 1], 5126: [Float32Array, 1] };

function parseGlb(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const binStart = 20 + jsonLength + 8;
  const bin = bytes.subarray(binStart, binStart + bytes.readUInt32LE(20 + jsonLength));
  const views = new Map();
  const view = (index) => {
    if (views.has(index)) return views.get(index);
    const definition = json.bufferViews[index];
    const meshopt = definition.extensions?.EXT_meshopt_compression;
    let data;
    if (meshopt) {
      data = new Uint8Array(meshopt.count * meshopt.byteStride);
      const source = bin.subarray(meshopt.byteOffset ?? 0, (meshopt.byteOffset ?? 0) + meshopt.byteLength);
      MeshoptDecoder.decodeGltfBuffer(data, meshopt.count, meshopt.byteStride, source, meshopt.mode, meshopt.filter);
    } else data = bin.subarray(definition.byteOffset ?? 0, (definition.byteOffset ?? 0) + definition.byteLength);
    views.set(index, data);
    return data;
  };
  const accessor = (index) => {
    const definition = json.accessors[index];
    const [Type, scale] = TYPES[definition.componentType];
    const components = COMPONENTS[definition.type];
    const data = view(definition.bufferView);
    const stride = json.bufferViews[definition.bufferView].byteStride ?? components * Type.BYTES_PER_ELEMENT;
    const out = new Float64Array(definition.count * components);
    const reader = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const getter = { 5120: "getInt8", 5121: "getUint8", 5122: "getInt16", 5123: "getUint16", 5125: "getUint32", 5126: "getFloat32" }[definition.componentType];
    for (let i = 0; i < definition.count; i++) for (let c = 0; c < components; c++) {
      const value = reader[getter]((definition.byteOffset ?? 0) + i * stride + c * Type.BYTES_PER_ELEMENT, true);
      out[i * components + c] = definition.normalized ? Math.max(value / scale, -1) : value;
    }
    return out;
  };
  return { json, accessor };
}

// Projected triangles of every solid surface; additive M2 glows (modes 3 and 4) are skipped.
function triangles({ json, accessor }) {
  const result = [];
  const visit = (index, parent) => {
    const node = json.nodes[index];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? [1, 1, 1])));
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) for (const primitive of json.meshes[node.mesh].primitives) {
      if ((primitive.mode ?? 4) !== 4) continue;
      if ([3, 4].includes(json.materials?.[primitive.material]?.extras?.wowM2?.blendingMode)) continue;
      const positions = accessor(primitive.attributes.POSITION);
      const indices = primitive.indices === undefined ? Array.from({ length: positions.length / 3 }, (_, i) => i) : accessor(primitive.indices);
      const point = new Vector3();
      const projected = new Float64Array(positions.length / 3 * 2);
      for (let i = 0; i < positions.length / 3; i++) {
        point.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]).applyMatrix4(world);
        projected[i * 2] = -point.z; projected[i * 2 + 1] = point.y; // the stage's -90° Y turn faces +X toward the camera
      }
      for (let i = 0; i < indices.length; i += 3) result.push([indices[i], indices[i + 1], indices[i + 2]].flatMap((v) => [projected[v * 2], projected[v * 2 + 1]]));
    }
    (node.children ?? []).forEach((child) => visit(child, world));
  };
  json.scenes[json.scene ?? 0].nodes.forEach((index) => visit(index, new Matrix4()));
  return result;
}

function rasterize(tris, groundY) {
  let minU = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (const t of tris) for (let i = 0; i < 6; i += 2) { minU = Math.min(minU, t[i]); maxU = Math.max(maxU, t[i]); maxV = Math.max(maxV, t[i + 1]); }
  const w = CELL_W * SUPERSAMPLE, h = CELL_H * SUPERSAMPLE, pad = PAD * SUPERSAMPLE;
  const scale = Math.min((h - pad) / (maxV - groundY), (w - 2 * pad) / (maxU - minU));
  const offsetU = (w - (maxU - minU) * scale) / 2;
  const mask = new Uint8Array(w * h);
  for (const t of tris) {
    const xs = [0, 2, 4].map((i) => offsetU + (t[i] - minU) * scale), ys = [1, 3, 5].map((i) => h - (t[i] - groundY) * scale);
    const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const a = ((xs[1] - xs[0]) * (py - ys[0]) - (px - xs[0]) * (ys[1] - ys[0])) / area;
      const b = ((xs[2] - xs[1]) * (py - ys[1]) - (px - xs[1]) * (ys[2] - ys[1])) / area;
      const c = ((xs[0] - xs[2]) * (py - ys[2]) - (px - xs[2]) * (ys[0] - ys[2])) / area;
      if (a >= 0 && b >= 0 && c >= 0) mask[y * w + x] = 1;
    }
  }
  const alpha = new Uint8Array(CELL_W * CELL_H);
  for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) {
    let sum = 0;
    for (let sy = 0; sy < SUPERSAMPLE; sy++) for (let sx = 0; sx < SUPERSAMPLE; sx++) sum += mask[(y * SUPERSAMPLE + sy) * w + x * SUPERSAMPLE + sx];
    alpha[y * CELL_W + x] = Math.round(sum / SUPERSAMPLE ** 2 * 255);
  }
  return alpha;
}

function png(width, height, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buffer) => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); out.write(type, 4, "ascii"); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const rows = Math.ceil(catalog.characters.length / COLUMNS);
const sheetW = COLUMNS * CELL_W, sheetH = rows * CELL_H;
const sheet = new Uint8Array(sheetW * sheetH * 4);
for (const [index, character] of catalog.characters.entries()) {
  const glb = parseGlb(await readFile(new URL(`.${character.model}`, `${publicDir.href}/`)));
  const groundY = glb.json.scenes[0].extras?.wowCharacter?.groundY;
  const tris = triangles(glb);
  const alpha = rasterize(tris, Number.isFinite(groundY) ? groundY : Math.min(...tris.flatMap((t) => [t[1], t[3], t[5]])));
  const cx = (index % COLUMNS) * CELL_W, cy = Math.floor(index / COLUMNS) * CELL_H;
  for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) sheet[((cy + y) * sheetW + cx + x) * 4 + 3] = alpha[y * CELL_W + x];
  console.log(`${character.id}: ${tris.length} triangles`);
}
const output = new URL(`./figurines/${catalog.id}/silhouettes.png`, `${publicDir.href}/`);
await writeFile(output, png(sheetW, sheetH, sheet));
console.log(`Wrote ${output.pathname} (${COLUMNS}×${rows} cells of ${CELL_W}×${CELL_H})`);
