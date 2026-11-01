import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile, access } from "node:fs/promises";
import * as THREE from "three";
registerHooks({
  resolve(specifier,context,next) { return next(specifier.startsWith("@/") ? new URL(`../src/${specifier.slice(2)}${specifier.endsWith(".json")?"":".ts"}`,import.meta.url).href : specifier,context); },
  load(url,context,next) { return next(url,url.endsWith(".json")?{...context,importAttributes:{type:"json"}}:context); },
});
const { boxTextureCache } = await import("../src/lib/figurine-box-assets.ts");
const { boxPrintKey, unreleasedBoxDesign, createBoxPrints, buildBlindBox, PACKAGING_FALLBACK } = await import("../src/lib/figurine-packaging.ts");
const design=unreleasedBoxDesign({...PACKAGING_FALLBACK,title:"Archive",subtitle:"Soon"});
function fixture() {
  const pending=[],retained=new Set();
  // Match the real KTX2Loader contract: load returns undefined, callback supplies the texture.
  const loader={load(url,done,progress,fail){const texture=new THREE.CompressedTexture([{data:new Uint8Array(16),width:4,height:4}],4,4,THREE.RGBA_BPTC_Format);pending.push({url,texture,done:()=>done(texture),fail});}};
  const files={"front-color":"shared.ktx2","front-finish":"mask.ktx2",inside:"inside.ktx2"};
  const cache=boxTextureCache(loader,retained,{[boxPrintKey(design)]:{150:files,500:files}});
  return {cache,pending,retained};
}
test("matching boxes share textures until the last borrower releases them",async()=>{
  const {cache,pending,retained}=fixture(),baked=cache.design(design).baked;
  const first=baked(150),second=baked(150);
  assert.equal(pending.length,3);assert.deepEqual(first.maps,{});assert.equal(retained.size,0);
  pending.forEach(p=>p.done());
  await Promise.all([first.ready,second.ready]);
  assert.equal(first.maps["front-color"],second.maps["front-color"]);
  let disposals=0;new Set(Object.values(first.maps)).forEach(texture=>texture.addEventListener("dispose",()=>disposals++));
  assert.deepEqual(first.maps.inside.repeat.toArray(),[2.2,2.2]);
  assert.equal(first.maps["front-color"].isCompressedTexture,true);
  assert.equal(first.maps["front-color"].image.width,4);
  assert.equal(first.maps["front-color"].mipmaps[0].data.byteLength,16);
  assert.equal(first.maps["front-color"].format,THREE.RGBA_BPTC_Format);
  first.stop();first.stop();assert.equal(disposals,0);assert.equal(retained.size,3);
  second.stop();assert.equal(disposals,3);assert.equal(retained.size,0);
  assert.equal(cache.design({...design,lineup:["Changed roster"]}).baked,undefined);
});
test("evicting a loading box releases its late-arriving texture payloads",async()=>{
  const {cache,pending,retained}=fixture(),lease=cache.design(design).baked(500);
  let disposals=0;pending.forEach(p=>p.texture.addEventListener("dispose",()=>disposals++));
  lease.stop();assert.equal(retained.size,0);assert.equal(disposals,0);
  pending.forEach(p=>p.done());await lease.ready;assert.equal(disposals,3);assert.equal(retained.size,0);
});

test("baked materials attach callback textures only after loading completes",async()=>{
  const {cache,pending}=fixture();
  const prints=createBoxPrints(cache.design(design),new THREE.Texture());
  assert.equal(prints.front.map,null);
  pending.forEach(p=>p.done());await prints.ready;
  assert.equal(prints.front.map,pending[0].texture);
  assert.equal(prints.front.bumpMap,pending[1].texture);
  assert.equal(prints.inside.map,pending[2].texture);
  prints.stop();cache.dispose();
});

test("stopped prints do not attach textures from a late callback",async()=>{
  const {cache,pending,retained}=fixture();
  const prints=createBoxPrints(cache.design(design),new THREE.Texture());
  prints.stop();pending.forEach(p=>p.done());await prints.ready;
  assert.equal(prints.front.map,null);assert.equal(retained.size,0);
});
test("baked prints construct without painting canvases and share one finish map per face",async()=>{
  const maps={inside:new THREE.Texture(),seal:new THREE.Texture()};
  for(const face of ["front","back","left","right","lid"]){maps[`${face}-color`]=new THREE.Texture();maps[`${face}-finish`]=new THREE.Texture();}
  const prints=createBoxPrints({...design,baked:()=>({maps,ready:Promise.resolve(),stop(){}})},new THREE.Texture());
  await prints.ready;assert.equal(prints.front.map,maps["front-color"]);assert.equal(prints.front.bumpMap,prints.front.roughnessMap);assert.equal(prints.front.metalnessMap,prints.front.roughnessMap);assert.equal(prints.seal,maps.seal);
});

test("the asynchronously loaded seal also supplies its hover glow map",async()=>{
  const seal=new THREE.Texture(),maps={seal};let finish;
  const ready=new Promise(resolve=>{finish=resolve;});
  const box=buildBlindBox(new THREE.Group(),{bottom:0,envMap:new THREE.Texture(),design:{...design,baked:()=>({maps,ready,stop(){}})}});
  assert.equal(box.tape.material.map,null);assert.equal(box.tape.material.emissiveMap,null);
  finish();await box.ready;
  assert.equal(box.tape.material.map,seal);assert.equal(box.tape.material.emissiveMap,seal);box.stop();
});
test("the bake contains only three released designs and one placeholder in each maintained locale",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../src/data/figurines/packaging.json",import.meta.url)));
  assert.equal(Object.keys(manifest.designs).length,8);
  for(const locale of ["en","fi"]) {
    const t=JSON.parse(await readFile(new URL(`../messages/${locale}.json`,import.meta.url))).figurineLab;
    const placeholder=unreleasedBoxDesign({title:t.boxTitle,subtitle:t.boxSubtitle,blind:t.boxBlind,collect:t.boxCollect.replace("{count}","16"),contents:t.boxContents,openHere:t.boxOpenHere});
    assert.ok(manifest.designs[boxPrintKey(placeholder)],locale);
  }
  for(const sizes of Object.values(manifest.designs))for(const density of [150,500]) {
    assert.equal(Object.keys(sizes[density]).length,12);
    for(const [name,file] of Object.entries(sizes[density])){
      const url=new URL(`../public/figurines/packaging/${file}`,import.meta.url);await access(url);
      if(name.endsWith("-color")||name.endsWith("-finish")){
        const data=await readFile(url),width=data.readUInt32LE(20),height=data.readUInt32LE(24);
        if(density===500){const expected=name.endsWith("-color")?2048:1024;assert.equal(width,expected);assert.equal(height,expected);}
        else assert.ok(width<=512&&height<=512,"shelf artwork stays small");
      }
    }
  }
});
