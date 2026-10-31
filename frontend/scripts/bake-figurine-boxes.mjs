// Bake localized artwork in Chrome: ETC1S for shelves, UASTC for close-up print detail.
// node scripts/bake-figurine-boxes.mjs <toktx.exe> <work-directory> [port]
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import ts from "typescript";
import sharp from "sharp";
const [encoder, work, portArg] = process.argv.slice(2), port = Number(portArg ?? 3220);
if (!encoder || !work) throw new Error("Expected toktx executable and work directory");
const frontend = path.resolve(import.meta.dirname, ".."), output = path.join(frontend,"public/figurines/packaging"), manifestFile = path.join(frontend,"src/data/figurines/packaging.json");
await fs.mkdir(output,{recursive:true}); await fs.mkdir(work,{recursive:true});
registerHooks({
  resolve(specifier,context,next) { return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}${path.extname(specifier)?"":".ts"}`,import.meta.url).href : specifier,context); },
  load(url,context,next) {
    if(url.endsWith(".png"))return {format:"module",source:`export default { src: ${JSON.stringify(`/figurines/${url.split("/").slice(-2).join("/")}`)} };`,shortCircuit:true};
    if(url.endsWith(".json"))return next(url,{...context,importAttributes:{type:"json"}});
    return next(url,context);
  },
});
const { FIGURINE_SERIES, SECRET_SERIES } = await import("../src/lib/figurine-series.ts");
const series=[...FIGURINE_SERIES,{...SECRET_SERIES,theme:undefined},{id:"unreleased",size:16}];
const designs=[];
for(const locale of ["en","fi"]) {
  const text=JSON.parse(await fs.readFile(path.join(frontend,`messages/${locale}.json`))).figurineLab;
  for(const entry of series) designs.push({locale,id:entry.id,number:entry.number,theme:entry.theme,hue:entry.hue,lineup:entry.characters?.map(c=>c.name)??Array(entry.size).fill("?"),silhouettes:entry.silhouettes,labels:{title:text.boxTitle,subtitle:text.boxSubtitle,blind:text.boxBlind,collect:text.boxCollect.replace("{count}",String(entry.characters?.length??entry.size)),contents:text.boxContents,openHere:text.boxOpenHere}});
}
const manifest={version:2,codecs:{150:"ETC1S",500:"UASTC"},designs:{}};
const run=promisify(execFile), encoding=new Map();
async function encode(png,color,codec) {
  // BC-compressed mip chains need valid block dimensions at every level in WebGL.
  // Canvas sizes follow world units and are often odd (e.g. 1025 × 1375).
  const {width,height}=await sharp(png).metadata();
  const powerOfTwo=value=>2**Math.round(Math.log2(value));
  png=await sharp(png).resize(powerOfTwo(width),powerOfTwo(height),{fit:"fill"}).png().toBuffer();
  const key=createHash("sha256").update(png).update(color?"srgb":"linear").update(codec==="uastc"?"uastc-q2-z9":"").digest("hex");
  const name=`${key.slice(0,20)}.ktx2`, filename=path.join(output,name);
  if(!encoding.has(key))encoding.set(key,(async()=>{
    try {await fs.access(filename);}catch(error){
      if(error.code!=="ENOENT")throw error;
      const source=path.join(work,`${key}.png`);await fs.writeFile(source,png);
      const quality=codec==="uastc"?["--uastc_quality","2","--zcmp","9"]:["--qlevel","255","--clevel","2"];
      await run(encoder,["--t2","--encode",codec,...quality,"--genmipmap","--lower_left_maps_to_s0t0","--assign_oetf",color?"srgb":"linear","--threads","4",filename,source]);
    }
    return name;
  })());
  return encoding.get(key);
}
const roots={"/three/":path.join(frontend,"node_modules/three"),"/lib/":path.join(frontend,"src/lib"),"/figurines/":path.join(frontend,"public/figurines"),"/bake/":import.meta.dirname};
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,"http://localhost");
    if(req.method==="POST"&&url.pathname==="/prints") {
      if(req.headers.origin!==`http://localhost:${port}`){res.writeHead(403);res.end();return;}
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>35_000_000)throw new Error("Bake too large");chunks.push(chunk);}
      const {key,density,maps}=JSON.parse(Buffer.concat(chunks).toString());
      if(![150,500].includes(density)||typeof key!=="string")throw new Error("Invalid bake");
      const encoded={};
      for(const [name,data] of Object.entries(maps))encoded[name]=await encode(Buffer.from(data.split(",")[1],"base64"),!name.endsWith("-finish"),density===500?"uastc":"etc1s");
      (manifest.designs[key]??={})[density]=encoded;
      // Publish the manifest only when the whole bake is ready; development HMR must not
      // briefly lose existing designs and fall back to painting them at runtime.
      if(Object.keys(manifest.designs).length===designs.length&&Object.values(manifest.designs).every(sizes=>sizes[150]&&sizes[500]))await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+"\n");
      console.log(`Baked ${Object.keys(manifest.designs).length}/${designs.length} designs, density ${density}`);
      res.end(JSON.stringify({maps:Object.keys(encoded).length}));return;
    }
    if(url.pathname==="/designs"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify(designs));return;}
    if(url.pathname==="/"){res.setHeader("Content-Type","text/html; charset=utf-8");res.end(`<!doctype html><title>Bake box textures</title><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script><pre id="status">Starting…</pre><script type="module" src="/bake/bake-figurine-boxes-browser.mjs"></script>`);return;}
    const mount=Object.keys(roots).find(p=>url.pathname.startsWith(p));if(!mount){res.writeHead(404);res.end();return;}
    const filename=path.resolve(roots[mount],decodeURIComponent(url.pathname.slice(mount.length)));
    if(!filename.startsWith(roots[mount]+path.sep)){res.writeHead(403);res.end();return;}
    let data=await fs.readFile(filename);const ext=path.extname(filename);
    if(ext===".ts")data=ts.transpileModule(data.toString(),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
    res.setHeader("Content-Type",({".ts":"text/javascript",".js":"text/javascript",".mjs":"text/javascript",".png":"image/png",".wasm":"application/wasm"})[ext]??"application/octet-stream");res.setHeader("Cache-Control","no-store");res.end(data);
  }catch(error){res.writeHead(500);res.end(String(error));}
}).listen(port,"127.0.0.1",()=>console.log(`Box bake: http://localhost:${port}/`));
