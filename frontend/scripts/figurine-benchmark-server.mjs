// Local-only, reproducible model benchmark. No production routes or dependencies.
// node scripts/figurine-benchmark-server.mjs <pilot-output-directory> [port]
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
const pilot = path.resolve(process.argv[2]);
const frontend = path.resolve(import.meta.dirname, "..");
const roots = { "/three/": path.join(frontend, "node_modules/three"), "/lib/": path.join(frontend, "src/lib"), "/figurines/": path.join(frontend, "public/figurines"), "/pilot/": pilot, "/bench/": import.meta.dirname };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const origins = [`http://localhost:${process.argv[3] ?? 3200}`, "http://localhost:3110", "http://localhost:3111"];
    if (origins.includes(req.headers.origin)) res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    if (req.method === "OPTIONS" && origins.includes(req.headers.origin)) {
      res.setHeader("Access-Control-Allow-Methods", "POST"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.end(); return;
    }
    if (req.method === "POST" && url.pathname === "/results") {
      if (!origins.includes(req.headers.origin)) { res.writeHead(403); res.end(); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 25_000_000) throw new Error("Report too large"); chunks.push(chunk); }
      const report = JSON.parse(Buffer.concat(chunks).toString());
      const name = `browser-${Date.now()}.json`;
      await fs.writeFile(path.join(pilot, name), JSON.stringify(report, null, 2), { flag: "wx" });
      res.end(name); return;
    }
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><title>Figurine asset benchmark</title><style>body{margin:0;background:#20252d;color:#fff;font:14px system-ui}canvas{display:block}pre{white-space:pre-wrap}</style><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script><div id="view"></div><pre id="status">Loading benchmark…</pre><script type="module" src="/bench/figurine-benchmark-browser.mjs"></script>`); return;
    }
    const mount = Object.keys(roots).find((prefix) => url.pathname.startsWith(prefix));
    if (!mount) { res.writeHead(404); res.end(); return; }
    const file = path.resolve(roots[mount], decodeURIComponent(url.pathname.slice(mount.length)));
    if (!file.startsWith(roots[mount] + path.sep)) { res.writeHead(403); res.end(); return; }
    let data = await fs.readFile(file);
    const ext = path.extname(file);
    if (ext === ".ts") data = ts.transpileModule(data.toString(), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "@\/lib\/([^\"]+)"/g, 'from "/lib/$1.ts"');
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".mjs": "text/javascript", ".ts": "text/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".json": "application/json", ".png": "image/png" })[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store"); res.end(data);
  } catch (error) { res.writeHead(500); res.end(String(error)); }
}).listen(Number(process.argv[3] ?? 3200), "127.0.0.1", () => console.log(`Benchmark: http://localhost:${process.argv[3] ?? 3200}`));
