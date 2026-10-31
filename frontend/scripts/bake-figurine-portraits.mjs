// Bakes a colour portrait sheet per series (public/figurines/<series>/portraits.webp) for the
// collection UI, in the silhouette sheet's layout: one cell per character in catalog order.
// The models are rendered by a browser, so this serves a bake page and saves what it posts back.
// Usage: node scripts/bake-figurine-portraits.mjs [port], then open http://localhost:<port>/
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import ts from "typescript";

const port = Number(process.argv[2] ?? 3210);
const frontend = path.resolve(import.meta.dirname, "..");
const roots = { "/three/": path.join(frontend, "node_modules/three"), "/lib/": path.join(frontend, "src/lib"), "/figurines/": path.join(frontend, "public/figurines"), "/data/": path.join(frontend, "src/data/figurines"), "/bake/": import.meta.dirname };
const SERIES = ["community-000", "community-001", "community-002"];
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".ts": "text/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".ktx2": "image/ktx2" };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/portraits") {
      // Same-origin only: the page this server served.
      if (req.headers.origin !== `http://localhost:${port}`) { res.writeHead(403); res.end(); return; }
      const series = url.searchParams.get("series");
      if (!SERIES.includes(series)) { res.writeHead(400); res.end("Unknown series"); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 40_000_000) throw new Error("Sheet too large"); chunks.push(chunk); }
      const out = path.join(frontend, "public/figurines", series, "portraits.webp");
      const info = await sharp(Buffer.concat(chunks)).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(out);
      console.log(`${series}: ${info.width}×${info.height}, ${info.size} bytes`);
      res.end(JSON.stringify({ series, bytes: info.size })); return;
    }
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><title>Bake figurine portraits</title><style>body{margin:0;background:#20252d;color:#fff;font:14px system-ui}canvas{max-width:100%;display:block;background:#333 repeating-conic-gradient(#3a3a3a 0 25%,#444 0 50%) 0 0/24px 24px}</style><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script><pre id="status">Loading…</pre><div id="sheets"></div><script>window.SERIES=${JSON.stringify(SERIES)}</script><script type="module" src="/bake/bake-figurine-portraits-browser.mjs"></script>`);
      return;
    }
    const mount = Object.keys(roots).find((prefix) => url.pathname.startsWith(prefix));
    if (!mount) { res.writeHead(404); res.end(); return; }
    const file = path.resolve(roots[mount], decodeURIComponent(url.pathname.slice(mount.length)));
    if (!file.startsWith(roots[mount] + path.sep)) { res.writeHead(403); res.end(); return; }
    let data = await fs.readFile(file);
    const ext = path.extname(file);
    if (ext === ".ts") data = ts.transpileModule(data.toString(), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "@\/lib\/([^"]+)"/g, 'from "/lib/$1.ts"');
    res.setHeader("Content-Type", types[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store"); res.end(data);
  } catch (error) { res.writeHead(500); res.end(String(error)); }
}).listen(port, "127.0.0.1", () => console.log(`Portrait bake: http://localhost:${port}/`));
