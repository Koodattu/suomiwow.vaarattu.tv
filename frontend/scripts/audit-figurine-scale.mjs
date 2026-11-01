// Geometry-only audit: no image decoding or GPU needed.
// node scripts/audit-figurine-scale.mjs [output.json]
import fs from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { figurineBodyBounds, figurineHeight, figurineScale } from "../src/lib/figurine-materials.ts";
const frontend=path.resolve(import.meta.dirname,".."), results=[];
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
for(const file of (await fs.readdir(path.join(frontend,"src/data/figurines"))).filter(f=>/^community-\d+\.json$/.test(f))) {
  const catalog=JSON.parse(await fs.readFile(path.join(frontend,"src/data/figurines",file)));
  for(const figure of catalog.characters) {
    const data=await fs.readFile(path.join(frontend,"public",figure.model.split("?")[0]));
    const n=data.readUInt32LE(12), doc=JSON.parse(data.subarray(20,20+n));
    for(const material of doc.materials??[]) {delete material.pbrMetallicRoughness?.baseColorTexture;delete material.pbrMetallicRoughness?.metallicRoughnessTexture;delete material.normalTexture;delete material.occlusionTexture;delete material.emissiveTexture;}
    doc.images=[];doc.textures=[];doc.samplers=[];
    const bin=data.subarray(20+n);let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
    const header=Buffer.from(data.subarray(0,20));header.writeUInt32LE(20+json.length+bin.length,8);header.writeUInt32LE(json.length,12);
    const bytes=Buffer.concat([header,json,bin]);const {scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),"");
    scene.rotation.y=-Math.PI/2;
    const full=new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()), body=figurineBodyBounds(scene), size=body.getSize(new THREE.Vector3());
    const previous=figurineScale(body), targetHeight=figurineHeight(scene.name), current=figurineScale(body,scene.name);
    results.push({id:figure.id,series:catalog.id,name:figure.name,race:figure.raceKey,modelName:scene.name,targetHeight,bodyHeight:size.y,fullHeight:full.y,beforeBodyHeight:size.y*previous,afterBodyHeight:size.y*current,widthLimited:current<targetHeight/size.y-1e-6});
    scene.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const material of [o.material].flat())material.dispose();}});
  }
}
const summary={count:results.length,beforeRange:[Math.min(...results.map(r=>r.beforeBodyHeight)),Math.max(...results.map(r=>r.beforeBodyHeight))],afterRange:[Math.min(...results.map(r=>r.afterBodyHeight)),Math.max(...results.map(r=>r.afterBodyHeight))],widthLimited:results.filter(r=>r.widthLimited).map(r=>r.id)};
if(process.argv[2])await fs.writeFile(process.argv[2],JSON.stringify({summary,results},null,2));console.log(JSON.stringify(summary,null,2));
