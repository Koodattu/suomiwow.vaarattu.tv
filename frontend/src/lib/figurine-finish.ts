import * as THREE from "three";
import type { FigurineQuality } from "@/lib/figurine-collection";

// Finishes for the rarer qualities, swapped onto a figure's own meshes:
// golden is polished metal that keeps the paint's light and shade as engraving; galaxy is a window
// into a drifting nebula with twinkling stars, fixed to the view, and a violet rim.
// Glows and other blended effect surfaces keep their own look.
export const FINISH_TIME = { value: 0 };
type FinishRecord = { original: THREE.Material | THREE.Material[]; finishes: Map<FigurineQuality, THREE.Material | THREE.Material[]> };
const records = new WeakMap<THREE.Mesh, FinishRecord>();

const DETAIL = `
  #ifdef USE_MAP
    vec4 sampledDiffuseColor = texture2D( map, vMapUv );
    float detail = sqrt( dot( sampledDiffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) );
    diffuseColor.a *= sampledDiffuseColor.a;
  #else
    float detail = 0.7;
  #endif`;

const GALAXY = `
uniform float finishTime;
float finishHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float finishNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( finishHash( i ), finishHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( finishHash( i + vec2( 0.0, 1.0 ) ), finishHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float finishFbm( vec2 p ) { float v = 0.0, a = 0.5; for ( int i = 0; i < 4; i++ ) { v += a * finishNoise( p ); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
vec3 finishGalaxy( vec2 p, float t ) {
  float n = finishFbm( p * 1.4 + vec2( t * 0.03, 0.0 ) );
  float m = finishFbm( p * 2.6 - vec2( 0.0, t * 0.02 ) + n * 1.5 );
  vec3 color = mix( vec3( 0.015, 0.01, 0.06 ), vec3( 0.42, 0.1, 0.72 ), smoothstep( 0.38, 0.85, n ) );
  color = mix( color, vec3( 0.06, 0.42, 0.9 ), smoothstep( 0.5, 0.92, m ) * 0.75 );
  color += vec3( 0.95, 0.35, 0.6 ) * smoothstep( 0.72, 1.0, n * m * 1.9 ) * 0.5;
  vec2 grid = p * 16.0, cell = floor( grid ), offset = vec2( finishHash( cell + 1.7 ), finishHash( cell + 3.1 ) ) - 0.5;
  float seed = finishHash( cell );
  float star = step( 0.82, seed ) * smoothstep( 0.11, 0.0, length( fract( grid ) - 0.5 - offset * 0.7 ) ) * ( 0.55 + 0.45 * sin( t * 2.4 + seed * 40.0 ) );
  return color + star * vec3( 1.0, 0.95, 0.88 ) * 2.2;
}
`;

function finishMaterial(source: THREE.Material, quality: Exclude<FigurineQuality, "standard">, envMap: THREE.Texture | null): THREE.Material {
  if (source.blending !== THREE.NormalBlending) return source;
  const map = (source as THREE.MeshStandardMaterial).map ?? null;
  const shared = { map, envMap, transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest, side: source.side, depthWrite: source.depthWrite };
  if (quality === "golden") {
    const gold = new THREE.MeshStandardMaterial({ ...shared, color: 0xffcc66, metalness: 1, roughness: 0.24, envMapIntensity: 1.6 });
    gold.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `${DETAIL}
        diffuseColor.rgb *= 0.45 + 0.8 * detail;`);
    };
    gold.customProgramCacheKey = () => "figurine-finish-golden";
    return gold;
  }
  const galaxy = new THREE.MeshStandardMaterial({ ...shared, color: 0xffffff, metalness: 0, roughness: 0.4, envMapIntensity: 0.35, emissive: 0xffffff });
  galaxy.onBeforeCompile = (shader) => {
    shader.uniforms.finishTime = FINISH_TIME;
    shader.fragmentShader = `${GALAXY}\n${shader.fragmentShader}`
      .replace("#include <map_fragment>", `${DETAIL}
        // Screen-fixed: the pattern stays put as the figure turns, like a window into space.
        vec2 sky = isOrthographic ? vViewPosition.xy * 1.1 : vViewPosition.xy / max( vViewPosition.z, 0.1 ) * 7.0;
        vec3 galaxyColor = finishGalaxy( sky, finishTime ) * ( 0.75 + 0.5 * detail );
        diffuseColor.rgb = galaxyColor * 0.15;`)
      .replace("#include <emissivemap_fragment>", `
        float rim = pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
        totalEmissiveRadiance = galaxyColor * 1.05 + rim * vec3( 0.55, 0.45, 1.0 ) * 0.8;`);
  };
  galaxy.customProgramCacheKey = () => "figurine-finish-galaxy";
  return galaxy;
}

// Puts `quality`'s finish on every mesh under `root` (standard restores the originals). Finishes
// are made once per mesh and kept until releaseFinishes. `envMap` gives the metal neutral studio
// reflections instead of the scene's sky, which would tint it.
export function applyFinish(root: THREE.Object3D, quality: FigurineQuality, envMap: THREE.Texture | null = null) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    let record = records.get(object);
    if (!record) { if (quality === "standard") return; record = { original: object.material, finishes: new Map() }; records.set(object, record); }
    if (quality === "standard") { object.material = record.original; return; }
    let finish = record.finishes.get(quality);
    if (!finish) {
      finish = Array.isArray(record.original) ? record.original.map((material) => finishMaterial(material, quality, envMap)) : finishMaterial(record.original, quality, envMap);
      record.finishes.set(quality, finish);
    }
    object.material = finish;
  });
}

// Restores the original materials and disposes every finish made for `root`.
export function releaseFinishes(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const record = records.get(object);
    if (!record) return;
    object.material = record.original;
    const originals = new Set(Array.isArray(record.original) ? record.original : [record.original]);
    record.finishes.forEach((finish) => (Array.isArray(finish) ? finish : [finish]).forEach((material) => { if (!originals.has(material)) material.dispose(); }));
    records.delete(object);
  });
}
