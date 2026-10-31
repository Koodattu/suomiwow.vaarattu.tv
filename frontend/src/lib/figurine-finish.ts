import * as THREE from "three";
import type { FigurineQuality } from "@/lib/figurine-collection";

// Finishes for the rarer qualities, swapped onto a figure's own meshes:
// golden is polished metal that keeps the paint's light and shade as engraving; galaxy is a window
// into a drifting nebula with twinkling stars, fixed to the view, and a violet rim.
// Source-tagged additive effects use matching light colours without changing their transparency.
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
  // Advect the clouds together, with a gentle curl rather than just sliding a flat image.
  // Keep the existing noise layers and palette; these offsets add no texture samples.
  vec2 flow = p + vec2( 0.055, -0.022 ) * t;
  flow += 0.14 * vec2( sin( p.y * 1.6 + t * 0.3 ), cos( p.x * 1.3 - t * 0.24 ) );
  float n = finishFbm( flow * 1.4 );
  float m = finishFbm( flow * 2.6 + vec2( -0.015, 0.035 ) * t + n * 1.5 );
  vec3 color = mix( vec3( 0.015, 0.01, 0.06 ), vec3( 0.42, 0.1, 0.72 ), smoothstep( 0.38, 0.85, n ) );
  color = mix( color, vec3( 0.06, 0.42, 0.9 ), smoothstep( 0.5, 0.92, m ) * 0.75 );
  color += vec3( 0.95, 0.35, 0.6 ) * smoothstep( 0.72, 1.0, n * m * 1.9 ) * 0.5;
  // Distant stars drift more slowly than the clouds, adding a little depth.
  vec2 grid = ( p + vec2( 0.008, -0.003 ) * t ) * 16.0, cell = floor( grid ), offset = vec2( finishHash( cell + 1.7 ), finishHash( cell + 3.1 ) ) - 0.5;
  float seed = finishHash( cell );
  float star = step( 0.82, seed ) * smoothstep( 0.11, 0.0, length( fract( grid ) - 0.5 - offset * 0.7 ) ) * ( 0.55 + 0.45 * sin( t * 2.4 + seed * 40.0 ) );
  return color + star * vec3( 1.0, 0.95, 0.88 ) * 2.2;
}
`;

function finishMaterial(source: THREE.Material, quality: Exclude<FigurineQuality, "standard">, envMap: THREE.Texture | null): THREE.Material {
  const effect = source.userData.wowM2;
  if (source instanceof THREE.MeshBasicMaterial && effect?.version === 1 && [3, 4].includes(effect.blendingMode)) {
    // Keep the exporter's additive blend, alpha and depth settings. These are light cards,
    // not solid armour: replacing them with metal would expose their rectangular geometry.
    const glow = source.clone();
    glow.onBeforeCompile = (shader) => {
      shader.uniforms.finishTime = FINISH_TIME;
      shader.vertexShader = `varying vec3 vFinishViewPosition;\n${shader.vertexShader}`
        .replace("#include <project_vertex>", "#include <project_vertex>\nvFinishViewPosition = -mvPosition.xyz;");
      shader.fragmentShader = `varying vec3 vFinishViewPosition;\n${quality === "galaxy" ? GALAXY : ""}\n${shader.fragmentShader}`
        .replace("#include <map_fragment>", `
          #include <map_fragment>
          // Preserve the light mask, including true black, without retaining its old hue.
          float glowStrength = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
          ${quality === "golden" ? `
            vec3 glowTint = mix( vec3( 1.0, 0.42, 0.07 ), vec3( 1.0, 0.88, 0.5 ), smoothstep( 0.3, 1.0, glowStrength ) );
          ` : `
            vec2 sky = isOrthographic ? vFinishViewPosition.xy * 1.1 : vFinishViewPosition.xy / max( vFinishViewPosition.z, 0.1 ) * 7.0;
            vec3 glowTint = vec3( 0.12, 0.08, 0.3 ) + finishGalaxy( sky * 1.35, finishTime ) * 1.8;
          `}
          diffuseColor.rgb = glowTint * glowStrength;`);
    };
    glow.customProgramCacheKey = () => `figurine-glow-${quality}`;
    return glow;
  }
  if (source.blending !== THREE.NormalBlending) return source;
  const map = (source as THREE.MeshStandardMaterial).map ?? null;
  const shared = { map, envMap, transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest, side: source.side, depthWrite: source.depthWrite };
  const golden = quality === "golden";
  const material = new THREE.MeshStandardMaterial({ ...shared,
    color: golden ? 0xffbe35 : 0xffffff,
    metalness: golden ? 0.95 : 0.15, roughness: golden ? 0.2 : 0.38,
    envMapIntensity: golden ? 1.1 : 0.25, emissive: golden ? 0x000000 : 0xffffff,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `${DETAIL}
      // Recolour the texture's grayscale detail, never its original armour hues.
      float armorShade = 0.06 + 0.94 * pow( detail, 1.6 );
      ${golden ? `
        diffuseColor.rgb *= armorShade;
      ` : `
        vec2 sky = isOrthographic ? vViewPosition.xy * 1.1 : vViewPosition.xy / max( vViewPosition.z, 0.1 ) * 7.0;
        // More cloud structure across the figure; its colour comes from the moving sky.
        vec3 galaxyColor = finishGalaxy( sky * 1.35, finishTime );
        diffuseColor.rgb = ( vec3( 0.015, 0.02, 0.045 ) + galaxyColor * 0.22 ) * armorShade;
      `}`);
    if (golden) {
      // Polish the raised highlights while keeping dark painted seams relatively matte.
      shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `
        #include <roughnessmap_fragment>
        roughnessFactor = mix( 0.55, 0.18, smoothstep( 0.15, 0.85, detail ) );`);
    } else {
      shader.uniforms.finishTime = FINISH_TIME;
      shader.fragmentShader = `${GALAXY}\n${shader.fragmentShader}`
        .replace("#include <emissivemap_fragment>", `
          float rim = pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
          // Let the nebula and stars remain visible in dark armour without losing its contrast.
          totalEmissiveRadiance = galaxyColor * 1.8 * ( 0.18 + 0.82 * armorShade )
            + rim * vec3( 0.55, 0.45, 1.0 ) * 0.3 * armorShade;`);
    }
  };
  material.customProgramCacheKey = () => `figurine-polished-armor-${quality}`;
  return material;
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
