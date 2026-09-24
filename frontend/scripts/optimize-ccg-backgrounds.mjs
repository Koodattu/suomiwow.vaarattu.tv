import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const config = await readFile(path.join(frontend, "../backend/src/config/ccg.ts"), "utf8");
const sources = new Set([
  ...Array.from(config.matchAll(/backgroundPath: "(\/ccg\/[^\"]+)"/g), ([, source]) => source),
  "/ccg/general_tall.webp",
  "/ccg/general_alt_tall.png",
]);
const output = path.join(frontend, "public/ccg/optimized");
await mkdir(output, { recursive: true });
const manifest = {};
let originalBytes = 0;
let optimizedBytes = 0;

for (const source of sources) {
  const input = path.join(frontend, "public", source);
  const metadata = await sharp(input).metadata();
  const portrait = metadata.height > metadata.width;
  const name = path.parse(source).name;
  manifest[source] = {};
  originalBytes += (await stat(input)).size;
  for (const [variant, width, quality] of [["tile", 640, 82], ["display", portrait ? 768 : 1600, 85]]) {
    const filename = `${name}-${variant}.webp`;
    const result = await sharp(input)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 6 })
      .toFile(path.join(output, filename));
    manifest[source][variant] = `/ccg/optimized/${filename}`;
    optimizedBytes += result.size;
  }
}

await writeFile(path.join(frontend, "src/lib/ccg-backgrounds.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ sources: sources.size, originalBytes, optimizedBytes }, null, 2));
