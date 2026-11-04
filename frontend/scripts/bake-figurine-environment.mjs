// Serve bake-figurine-environment.html with figurine-benchmark-server.mjs, then:
// node scripts/bake-figurine-environment.mjs <work-directory/browser-*.json>
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {REVISION} from 'three';
const report=JSON.parse(await fs.readFile(process.argv[2])),pixels=Buffer.from(report.pixels,'base64');
assert.equal(report.version,REVISION);
assert.equal(report.width,768);assert.equal(report.height,1024);
assert.equal(pixels.length,report.width*report.height*8);
const data=gzipSync(pixels,{level:9}),hash=createHash('sha256').update(data).digest('hex').slice(0,20);
const filename=`studio-${hash}.bin.gz`;
await fs.writeFile(new URL(`../public/figurines/world/${filename}`,import.meta.url),data);
await fs.writeFile(new URL('../src/data/figurines/environment.json',import.meta.url),JSON.stringify({version:report.version,width:report.width,height:report.height,url:`/figurines/world/${filename}`},null,2)+'\n');
console.log(`${filename}: ${data.length} bytes; lossless half-float PMREM`);
