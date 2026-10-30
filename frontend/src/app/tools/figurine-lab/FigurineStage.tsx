"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { resolveModelResource } from "@/lib/figurine-lab";
import { CHARGE_CUES, CHARGE_SECONDS, ENTRANCE_CUES, HITSTOP_SECONDS, LAND_AT, REVEAL_CUES, cuesBetween, figurineCharge, figurineEntrance, figurineReveal, type FigurineCue } from "@/lib/figurine-reveal";
import { playFigurineCue, startFigurineLoop, unlockFigurineAudio } from "@/lib/figurine-audio";
import { figurineSupport, restoreFigurineMaterials } from "@/lib/figurine-materials";
import { PACKAGING_FALLBACK, PACKAGING_THEMES, SILHOUETTE, buildBlindBox, type BlindBoxParts, type BoxDesign, type PackagingLabels } from "@/lib/figurine-packaging";
import { buildWorld, placeStation, viewPose, type WorldView } from "@/lib/figurine-world";
import { buildShop, type ShopLabels } from "@/lib/figurine-shop";
import { buildCase, type CaseLabels } from "@/lib/figurine-case";
import { buildPedestal, PEDESTAL_TOP } from "@/lib/figurine-pedestal";
import { hoverOutline } from "@/lib/figurine-glow";
import styles from "./figurine-lab.module.css";

export type { WorldView };
// One series as the world shows it: its box, its shelf in the shop and its section in the case.
export type StageSeries = { id: string; number: string; theme: keyof typeof PACKAGING_THEMES; silhouettes: string; keys: string[]; names: string[]; models: string[] };
export type StageWorld = {
  series: StageSeries[]; collection: Readonly<Record<string, number>>;
  labels: ShopLabels & CaseLabels;
};
type StageLabels = { loading: string; ready: string; empty: string; error: string; webgl: string; box: string; boxTitle: string; boxSubtitle: string; series?: string; packaging?: Omit<PackagingLabels, "title" | "subtitle"> };

function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points) && !(object instanceof THREE.Sprite)) return;
    if (!(object instanceof THREE.Sprite)) object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => { texture.dispose(); if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close(); });
  materials.forEach((material) => material.dispose());
}

// Small procedural textures for the light effects. Glow maps are painted light-on-black, then
// their brightness becomes alpha: the canvas is transparent above the floor, and opaque black
// texels there would cover the page behind with dark boxes.
function canvasTexture(width: number, height: number, paint: (context: CanvasRenderingContext2D) => void, glow = true) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: glow })!;
  paint(context);
  if (glow) {
    const image = context.getImageData(0, 0, width, height), data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = Math.max(data[i], data[i + 1], data[i + 2]);
      if (alpha) for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * 255 / alpha);
      data[i + 3] = alpha;
    }
    context.putImageData(image, 0, 0);
  }
  return new THREE.CanvasTexture(canvas);
}
const radial = (stops: [number, string][], glow = true) => canvasTexture(128, 128, (context) => {
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([at, color]) => gradient.addColorStop(at, color));
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
}, glow);
const additive = (map: THREE.Texture | null, color: number, side: THREE.Side = THREE.FrontSide) =>
  new THREE.MeshBasicMaterial({ map, color, side, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });

// Decode compressed geometry in workers so loading never stalls the charge animation.
(MeshoptDecoder as typeof MeshoptDecoder & { useWorkers?: (count: number) => void }).useWorkers?.(2);

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const NO_LINEUP: string[] = [];
const random = (min: number, max: number) => min + Math.random() * (max - min);

export default function FigurineStage({ files, boxMode, open, charging = false, interactive = false, round = 0, rotate, labels, lineup = NO_LINEUP, silhouettes, signature, view = "opening", series, world, figureKey, onNavigate, onBack, onPickSeries, onInspect, onHoverFigure, onStatus, onRevealed, onBoxTap, onLoaded, onProgress, arrival = 0, filesFor = null, showing = null, immersive = false, gallery = false }: {
  files: File[]; boxMode: boolean; open: boolean; rotate: boolean; labels: StageLabels;
  // Character names printed in the "collect all" grid on the back of the box.
  lineup?: string[];
  // Baked silhouette sheet for the lineup print (scripts/bake-figurine-silhouettes.mjs).
  silhouettes?: string;
  // Class key of the drawn figure; picks its landing signature sound.
  signature?: string;
  // World mode (immersive): which station the camera is at, the series whose box is on the
  // pedestal, every series for the shop and case, and the key of the figure in `files`.
  view?: WorldView;
  series?: string;
  world?: StageWorld;
  figureKey?: string;
  onNavigate?: (view: WorldView) => void;
  onBack?: () => void;
  onPickSeries?: (id: string) => void;
  onInspect?: (key: string) => void;
  onHoverFigure?: (key: string | null) => void;
  // Immersive only: the box builds up while the drawn model loads, then bursts once `open`.
  charging?: boolean;
  // Immersive only: tapping the sealed box calls onBoxTap; a new round replays the box's entrance in place.
  interactive?: boolean;
  round?: number;
  onBoxTap?: () => void;
  onStatus?: (status: "loading" | "ready" | "empty" | "error" | "webgl") => void;
  onRevealed?: () => void;
  // World mode: start-up loading (scenery, every series' box, owned figures' portraits, shaders).
  onLoaded?: () => void;
  onProgress?: (fraction: number) => void;
  // Bumped each time a series is picked: the box drops onto the pedestal again once the camera arrives.
  arrival?: number;
  // World mode: the figure `files` holds and the one the view wants; the viewer shows the
  // loaded model only when they match, never the box's figure while another one loads.
  filesFor?: string | null;
  showing?: string | null;
  immersive?: boolean;
  gallery?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ boxMode, open, charging, interactive, round, rotate, signature, view, figureKey, arrival, showing });
  useEffect(() => { state.current = { boxMode, open, charging, interactive, round, rotate, signature, view, figureKey, arrival, showing }; }, [boxMode, open, charging, interactive, round, rotate, signature, view, figureKey, arrival, showing]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error" | "webgl">("empty");
  const [filename, setFilename] = useState("");
  const callbacks = useRef({ onStatus, onRevealed, onBoxTap, onNavigate, onBack, onPickSeries, onInspect, onHoverFigure, onLoaded, onProgress });
  useEffect(() => { callbacks.current = { onStatus, onRevealed, onBoxTap, onNavigate, onBack, onPickSeries, onInspect, onHoverFigure, onLoaded, onProgress }; });
  useEffect(() => { callbacks.current.onStatus?.(status); }, [status]);
  // The packaging is rebuilt only when its printed text changes, not on every new labels object.
  const packagingKey = JSON.stringify(labels.packaging ?? null), lineupKey = lineup.join("|");
  const labelsRef = useRef(labels), lineupRef = useRef(lineup), silhouettesRef = useRef(silhouettes), worldRef = useRef(world), seriesRef = useRef(series);
  useEffect(() => { labelsRef.current = labels; lineupRef.current = lineup; silhouettesRef.current = silhouettes; worldRef.current = world; seriesRef.current = series; });
  // Lets later prop changes reach the running scene without rebuilding the renderer.
  const api = useRef<{ rebuildBox: () => void; showBox: () => void; setCollection: (collection: Readonly<Record<string, number>>) => void } | null>(null);
  const loaderState = useRef<{ load: (files: File[]) => void } | null>(null);
  const filesRef = useRef(files), filesForRef = useRef(filesFor);
  filesForRef.current = filesFor;
  useEffect(() => { filesRef.current = files; loaderState.current?.load(files); }, [files]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { queueMicrotask(() => setStatus("webgl")); return; }
    const maxPixelRatio = Math.min(window.devicePixelRatio, 1.5);
    let pixelRatio = maxPixelRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = immersive;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const exposure = 1.25;
    renderer.toneMappingExposure = exposure;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.4, 140);
    // The world's home shot faces the pedestal head-on, with the shop and the case at either side.
    camera.position.set(gallery ? 2.3 : immersive ? 0.6 : 4.2, gallery ? 2.5 : immersive ? 3.6 : 3, gallery ? 6 : immersive ? 9.6 : 6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.5, 0); controls.enableDamping = true;
    controls.minDistance = 3; controls.maxDistance = 15;
    controls.maxPolarAngle = Math.PI * 0.53;
    controls.enablePan = !immersive;
    controls.autoRotateSpeed = 0.65;
    // The shop and the case stand about as far out as the home camera, so the world orbit keeps to
    // the front arc; auto-rotation turns back at its ends instead of stopping there.
    const ORBIT_ARC = 1.2;
    if (immersive) { controls.minAzimuthAngle = -ORBIT_ARC; controls.maxAzimuthAngle = ORBIT_ARC; }
    let sweep = 1;
    // Auto-rotation yields to the user: it stops on grab and, a while after release, eases back in.
    const AUTO_ROTATE_SPEED = 0.65, AUTO_ROTATE_DELAY = 2.5;
    let userOrbit = { holding: false, released: -Infinity }, autoRotate = 0;
    controls.addEventListener("start", () => { userOrbit = { holding: true, released: -Infinity }; autoRotate = 0; });
    controls.addEventListener("end", () => { userOrbit = { holding: false, released: performance.now() }; });
    const homeOffset = camera.position.clone().sub(controls.target);
    let framing = 1;
    // The world is an afternoon clearing: sky fill, a warm sun whose shadow covers the plaza and
    // both stations (one map, so trees, stalls and the box all shade the ground), and a cool rim.
    // The lab keeps its studio lights.
    scene.add(immersive ? new THREE.HemisphereLight(0xd6e6ff, 0x5b5236, 1.3) : new THREE.HemisphereLight(0xe0efff, 0x333048, 3));
    const keyLight = new THREE.DirectionalLight(immersive ? 0xffe4bd : 0xffe2b0, immersive ? 3.4 : 4); scene.add(keyLight, keyLight.target);
    if (immersive) keyLight.position.set(-16, 24, 18); else keyLight.position.set(4, 6, 5);
    keyLight.castShadow = immersive;
    if (immersive) keyLight.target.position.set(0, 0, -2);
    keyLight.shadow.mapSize.set(2048, 2048); keyLight.shadow.radius = 4; keyLight.shadow.bias = -0.0005; keyLight.shadow.normalBias = 0.035;
    Object.assign(keyLight.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 5, far: 75 });
    const rim = new THREE.DirectionalLight(immersive ? 0xa9cfff : 0x69bbff, immersive ? 1 : 3); rim.position.set(-4, 4, -3); scene.add(rim);
    // Image-based fill from the painted sky shades every prop and figure without extra lights.
    let skyLight: THREE.WebGLRenderTarget | null = null;
    const updateSkyLight = () => {
      if (!scenery || disposed) return;
      const generator = new THREE.PMREMGenerator(renderer), skyScene = new THREE.Scene();
      skyScene.add(new THREE.Mesh(scenery.sky.geometry, scenery.sky.material));
      const next = generator.fromScene(skyScene, 0, 0.1, 100); generator.dispose();
      skyLight?.dispose(); skyLight = next; scene.environment = next.texture;
    };
    const scenery = immersive ? buildWorld(scene, { onSky: updateSkyLight }) : null;
    if (immersive) { scene.fog = new THREE.FogExp2(0xc3d5e6, 0.0115); scene.environmentIntensity = 0.55; }
    const modelRoot = new THREE.Group(); scene.add(modelRoot);
    const box = new THREE.Group(); scene.add(box);
    // The box rests just on the pedestal top; its idle float only ever lifts it.
    const width = 2.05, depth = 1.8, height = 2.75, bottom = PEDESTAL_TOP + 0.003;
    // Neutral studio reflections for the foil and holographic seal only, so figure lighting is unchanged.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
    const pedestal = buildPedestal(scene, { envMap: environment, title: labels.boxTitle, series: labels.series ?? "Series 001", count: lineupRef.current.length || 16 });
    // Box designs: the selected series' box on the pedestal, and every series' boxes in the shop.
    const packagingLabels = (): PackagingLabels => ({ title: labelsRef.current.boxTitle, subtitle: labelsRef.current.boxSubtitle, ...PACKAGING_FALLBACK, ...labelsRef.current.packaging });
    const designOf = (entry?: StageSeries): BoxDesign => ({
      labels: packagingLabels(), theme: PACKAGING_THEMES[entry?.theme ?? "amethyst"],
      lineup: entry?.names ?? lineupRef.current, silhouettes: entry?.silhouettes ?? silhouettesRef.current,
    });
    const selectedSeries = () => worldRef.current?.series.find((entry) => entry.id === seriesRef.current);
    let spin = 0;
    const worldSetup = immersive ? worldRef.current : undefined;
    const shopGroup = immersive ? placeStation(scene, "shop") : null, caseGroup = immersive ? placeStation(scene, "gallery") : null;
    const accentOf = (entry: StageSeries) => PACKAGING_THEMES[entry.theme].glow;
    const shop = shopGroup && worldSetup?.series.length ? buildShop(shopGroup, {
      series: worldSetup.series.map((entry) => ({ id: entry.id, count: entry.keys.length, accent: accentOf(entry), design: designOf(entry) })),
      envMap: environment, labels: worldSetup.labels,
    }) : null;
    const cabinet = caseGroup && worldSetup?.series.length ? buildCase(caseGroup, {
      series: worldSetup.series.map((entry) => ({ id: entry.id, number: entry.number, accent: accentOf(entry), silhouettes: entry.silhouettes, keys: entry.keys })),
      labels: worldSetup.labels, envMap: environment,
    }) : null;
    // Stations glow faintly under the pointer; their own textures light up, so prints stay legible.
    const glowing = new Map<WorldView, THREE.MeshStandardMaterial[]>();
    for (const [group, view] of [[shopGroup, "shop"], [caseGroup, "gallery"]] as const) {
      const materials = new Set<THREE.MeshStandardMaterial>();
      group?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          if (material instanceof THREE.MeshStandardMaterial && material.map && !material.emissiveMap) materials.add(material);
      });
      materials.forEach((material) => { material.emissiveMap = material.map; material.emissive.set(0xffe2b8); material.emissiveIntensity = 0; });
      glowing.set(view, [...materials]);
    }
    let stationGlow = { shop: 0, gallery: 0, opening: 0 };
    // Outer glows on hover: each series' boxes, each station's frame, and the pedestal with its box.
    const GOLD_GLOW = 0xffcf7a;
    const stackOutlines = new Map([...(shop?.boxes ?? [])].map(([id, meshes]) => [id, hoverOutline(meshes, PACKAGING_THEMES[worldSetup?.series.find((entry) => entry.id === id)?.theme ?? "amethyst"].glow, 0.03)]));
    const stationOutlines = { shop: shop ? hoverOutline(shop.frame, GOLD_GLOW, 0.035) : null, gallery: cabinet ? hoverOutline(cabinet.frame, GOLD_GLOW, 0.035) : null };
    const pedestalOutline = immersive ? hoverOutline([pedestal.body], GOLD_GLOW, 0.035) : null;
    let boxOutline: ReturnType<typeof hoverOutline> | null = null;
    // Portraits of owned figures for the case, rendered once per figure into small targets.
    const portraits = new Map<string, THREE.WebGLRenderTarget>();
    const portraitScene = new THREE.Scene();
    portraitScene.add(new THREE.HemisphereLight(0xe0efff, 0x333048, 3));
    const portraitKey = new THREE.DirectionalLight(0xffe2b0, 4); portraitKey.position.set(4, 6, 5); portraitScene.add(portraitKey);
    const portraitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60); portraitCamera.position.set(0, 1.5, 20);
    const solid = new THREE.Box3(), part = new THREE.Box3();
    const compileTarget = new THREE.WebGLRenderTarget(1, 1); compileTarget.texture.colorSpace = THREE.SRGBColorSpace;
    const capture = (object: THREE.Object3D, key: string) => {
      const target = new THREE.WebGLRenderTarget(Math.round(432 * SILHOUETTE.w / SILHOUETTE.h), 432, { samples: 4 }); target.texture.colorSpace = THREE.SRGBColorSpace;
      const parent = object.parent, alpha = renderer.getClearAlpha();
      portraitScene.add(object);
      // Matches scripts/bake-figurine-silhouettes.mjs: solid surfaces only, 6 px headroom and side margins per cell.
      object.updateMatrixWorld(true); solid.makeEmpty();
      object.traverse((mesh) => {
        if (!(mesh instanceof THREE.Mesh) || !mesh.visible) return;
        const materials: THREE.Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (materials.some((material) => material.blending !== THREE.NormalBlending)) return;
        if (mesh instanceof THREE.SkinnedMesh) { mesh.computeBoundingBox(); part.copy(mesh.boundingBox!); }
        else { mesh.geometry.computeBoundingBox(); part.copy(mesh.geometry.boundingBox!); }
        solid.union(part.applyMatrix4(mesh.matrixWorld));
      });
      if (solid.isEmpty()) solid.setFromObject(object);
      const { w: cellW, h: cellH } = SILHOUETTE;
      let frameH = (solid.max.y - PEDESTAL_TOP) * cellH / (cellH - 6), frameW = frameH * cellW / cellH;
      if (solid.max.x - solid.min.x > frameW * (cellW - 12) / cellW) { frameW = (solid.max.x - solid.min.x) * cellW / (cellW - 12); frameH = frameW * cellH / cellW; }
      const centreX = (solid.min.x + solid.max.x) / 2;
      Object.assign(portraitCamera, { left: centreX - frameW / 2, right: centreX + frameW / 2, bottom: PEDESTAL_TOP, top: PEDESTAL_TOP + frameH });
      portraitCamera.position.set(0, 0, 20); portraitCamera.updateProjectionMatrix();
      renderer.setRenderTarget(target); renderer.setClearAlpha(0); renderer.clear(); renderer.render(portraitScene, portraitCamera);
      renderer.setRenderTarget(null); renderer.setClearAlpha(alpha);
      if (parent) parent.add(object); else portraitScene.remove(object);
      portraits.get(key)?.dispose(); portraits.set(key, target);
      cabinet?.setSlot(key, "owned", target.texture);
    };
    let owned: Readonly<Record<string, number>> = {};
    const portraitQueue: string[] = [];
    let portraitBusy = false;
    const pumpPortraits = async () => {
      if (portraitBusy || disposed) return;
      const key = portraitQueue.shift();
      if (!key) return;
      const entry = worldRef.current?.series.find((candidate) => candidate.keys.includes(key));
      const url = entry?.models[entry.keys.indexOf(key)];
      if (!url || portraits.has(key)) { void pumpPortraits(); return; }
      portraitBusy = true;
      try {
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
        if (!disposed) { const figure = prepareModel(gltf.scene); capture(figure, key); disposeObject(figure); }
      } catch { /* the silhouette stays until a later visit */ }
      finally { portraitBusy = false; }
      void pumpPortraits();
    };
    const setCollection = (collection: Readonly<Record<string, number>>) => {
      owned = collection;
      for (const entry of worldRef.current?.series ?? []) {
        let got = 0;
        for (const key of entry.keys) {
          if (!collection[key]) { cabinet?.setSlot(key, "locked"); continue; }
          got++;
          const portrait = portraits.get(key);
          if (portrait) cabinet?.setSlot(key, "owned", portrait.texture);
          else { cabinet?.setSlot(key, "pending"); if (!portraitQueue.includes(key) && !(key === state.current.figureKey && model)) portraitQueue.push(key); }
        }
        shop?.setCollected(entry.id, got); cabinet?.setCollected(entry.id, got);
      }
    };
    // Every series' box is built once and kept: switching series swaps which one is shown, so the
    // print textures are never repainted or re-uploaded mid-game. Print text changes rebuild them all.
    type Packaging = { group: THREE.Group; parts: BlindBoxParts; outline: ReturnType<typeof hoverOutline> | null };
    const packagings = new Map<string, Packaging>();
    let walls!: BlindBoxParts["walls"], lidPivot!: THREE.Group, tape!: BlindBoxParts["tape"], thickness = 0;
    let boxMeshes: THREE.Mesh[] = [], packaging: THREE.Material[] = [];
    const packagingFor = (entry?: StageSeries) => {
      const key = entry?.id ?? "lab", cached = packagings.get(key);
      if (cached) return cached;
      const group = new THREE.Group(); group.visible = false; box.add(group);
      const parts = buildBlindBox(group, { bottom, design: designOf(entry), envMap: environment });
      parts.tape.mesh.castShadow = immersive;
      parts.meshes.forEach((mesh) => { mesh.castShadow = immersive; });
      // The tape lights up on its own when hovered.
      parts.tape.material.emissiveMap = parts.tape.material.map; parts.tape.material.emissive.set(0xffe2a8); parts.tape.material.emissiveIntensity = 0;
      const made = { group, parts, outline: immersive ? hoverOutline(parts.meshes, 0xffcf7a, 0.03) : null };
      packagings.set(key, made);
      return made;
    };
    const clearPackagings = () => {
      sheen.removeFromParent();
      packagings.forEach(({ group, parts, outline }) => { parts.stop(); outline?.dispose(); box.remove(group); disposeObject(group); });
      packagings.clear();
    };
    const mountBox = () => {
      const shown = packagingFor(selectedSeries());
      packagings.forEach((entry) => { entry.group.visible = entry === shown; });
      ({ walls, lidPivot, tape, thickness, meshes: boxMeshes, materials: packaging } = shown.parts);
      boxOutline = shown.outline;
      walls[0].pivot.add(sheen); sheen.position.set(0, height / 2, thickness / 2 + 0.003);
      // Force the next opacity write: this box's materials may have been left faded.
      packagingOpacity = Number.NaN;
    };
    // Soft contact shadow that grounds the box, then shrinks under the figure.
    const contactMaterial = new THREE.MeshBasicMaterial({ map: radial([[0, "rgba(255,255,255,.9)"], [0.5, "rgba(255,255,255,.45)"], [1, "rgba(255,255,255,0)"]], false), color: 0x000000, transparent: true, depthWrite: false, opacity: 0 });
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactMaterial);
    contact.rotation.x = -Math.PI / 2; contact.position.y = PEDESTAL_TOP + 0.001; contact.visible = immersive; scene.add(contact);
    // Light leaking from under the lid, a periodic sheen across the print, and the reveal effects.
    const glowMap = radial([[0, "#fff"], [0.25, "rgba(255,255,255,.55)"], [1, "#000"]]);
    const seamMaterial = additive(null, 0xffd58a);
    for (const [w, d, x, z] of [[width + 0.02, 0.012, 0, depth / 2 + 0.006], [width + 0.02, 0.012, 0, -depth / 2 - 0.006], [0.012, depth + 0.02, width / 2 + 0.006, 0], [0.012, depth + 0.02, -width / 2 - 0.006, 0]]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), seamMaterial); seam.position.set(x, bottom + height - 0.03, z); box.add(seam);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: 0xffcf7a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.y = bottom + height + 0.05; halo.scale.set(4.4, 2, 1); box.add(halo);
    // A slanted band kept clear of the texture edges: the sweep offsets the map past its
    // bounds, and clamping would smear any lit edge pixel into a static stripe.
    const sheenMap = canvasTexture(512, 256, (context) => {
      context.fillStyle = "#000"; context.fillRect(0, 0, 512, 256);
      context.setTransform(1, 0, -0.35, 1, 45, 0);
      const gradient = context.createLinearGradient(206, 0, 306, 0);
      gradient.addColorStop(0, "#000"); gradient.addColorStop(0.5, "#fff"); gradient.addColorStop(1, "#000");
      context.fillStyle = gradient; context.fillRect(206, 0, 100, 256);
    });
    const sheenMaterial = additive(sheenMap, 0xffe7b8);
    const sheen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), sheenMaterial);
    let packagingOpacity = 1;
    worldSetup?.series.forEach((entry) => packagingFor(entry));
    mountBox();
    const beamMap = canvasTexture(4, 128, (context) => {
      const gradient = context.createLinearGradient(0, 0, 0, 128);
      gradient.addColorStop(0, "#000"); gradient.addColorStop(0.55, "#4a3a20"); gradient.addColorStop(1, "#fff");
      context.fillStyle = gradient; context.fillRect(0, 0, 4, 128);
    });
    const beamMaterial = additive(beamMap, 0xffe2a8, THREE.DoubleSide), coreMaterial = additive(beamMap, 0xfff6e2, THREE.DoubleSide);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.85, 7, 48, 1, true), beamMaterial); beam.position.y = bottom + 3.5; scene.add(beam);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.16, 7, 32, 1, true), coreMaterial); core.position.y = bottom + 3.5; scene.add(core);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: 0xfff1d6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.y = 1.7; scene.add(flash);
    const ringMap = radial([[0, "#000"], [0.72, "#000"], [0.88, "#fff"], [1, "#000"]]);
    const shockwave = () => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(ringMap, 0xffe0a0));
      mesh.rotation.x = -Math.PI / 2; mesh.position.y = PEDESTAL_TOP + 0.0016; scene.add(mesh); return mesh;
    };
    const burstRing = shockwave(), landRing = shockwave();
    const discMaterial = additive(glowMap, 0xffd28a);
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), discMaterial); disc.rotation.x = -Math.PI / 2; disc.position.y = PEDESTAL_TOP + 0.0013; scene.add(disc);
    const glow = new THREE.PointLight(0xffd9a0, 0, 7); glow.position.set(0, 1.8, 0); scene.add(glow);
    // Figure silhouette: an unlit copy that fades to reveal the real materials.
    const silhouetteMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0cf, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    let silhouette: THREE.Object3D | null = null;

    const particlesGeometry = new THREE.BufferGeometry();
    const seeds = new Float32Array(48 * 3);
    for (let i = 0; i < 48; i++) { seeds[i * 3] = Math.sin(i * 2.399) * (0.3 + (i % 7) / 6); seeds[i * 3 + 1] = (i % 13) / 13 * 2; seeds[i * 3 + 2] = Math.cos(i * 2.399) * (0.3 + (i % 5) / 5); }
    particlesGeometry.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
    const particles = new THREE.Points(particlesGeometry, new THREE.PointsMaterial({ color: 0xffdf9c, size: 0.035, transparent: true, opacity: 0 }));
    particles.position.y = 2; particles.visible = !immersive; box.add(particles);
    // Ambient motes drift upward and are drawn toward the box while it charges.
    const MOTES = 110, MOTE_TOP = 4.8, moteCenter = new THREE.Vector3(0, 1.6, 0);
    const moteBase = new Float32Array(MOTES * 3), moteSpeed = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) {
      const angle = Math.random() * Math.PI * 2, radius = random(0.6, 3.4);
      moteBase.set([Math.cos(angle) * radius, Math.random() * MOTE_TOP, Math.sin(angle) * radius], i * 3); moteSpeed[i] = random(0.05, 0.22);
    }
    const motesGeometry = new THREE.BufferGeometry(); motesGeometry.setAttribute("position", new THREE.BufferAttribute(moteBase.slice(), 3));
    const motesMaterial = new THREE.PointsMaterial({ map: glowMap, color: 0xffdca0, size: 0.07, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const motes = new THREE.Points(motesGeometry, motesMaterial); motes.visible = immersive; scene.add(motes);
    // Pooled sparks; brightness doubles as alpha under additive blending.
    const SPARKS = 480;
    const sparkPosition = new Float32Array(SPARKS * 3), sparkColor = new Float32Array(SPARKS * 3), sparkVelocity = new Float32Array(SPARKS * 3);
    const sparkTint = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS), sparkSpan = new Float32Array(SPARKS).fill(1), sparkGravity = new Float32Array(SPARKS);
    const sparksGeometry = new THREE.BufferGeometry();
    sparksGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPosition, 3));
    sparksGeometry.setAttribute("color", new THREE.BufferAttribute(sparkColor, 3));
    const sparks = new THREE.Points(sparksGeometry, new THREE.PointsMaterial({ map: glowMap, size: 0.085, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false; sparks.visible = immersive; scene.add(sparks);
    let sparkCursor = 0;
    const spawn = (position: THREE.Vector3, velocity: THREE.Vector3, life: number, gravity: number, tint: number) => {
      const i = sparkCursor; sparkCursor = (sparkCursor + 1) % SPARKS;
      sparkPosition.set([position.x, position.y, position.z], i * 3); sparkVelocity.set([velocity.x, velocity.y, velocity.z], i * 3);
      sparkTint.set(tint > 0.5 ? [1, 0.96, 0.86] : [1, 0.7 + tint * 0.3, 0.32 + tint * 0.3], i * 3);
      sparkLife[i] = sparkSpan[i] = life; sparkGravity[i] = gravity;
    };
    const point = new THREE.Vector3(), velocity = new THREE.Vector3();
    const emit = (cue: FigurineCue) => {
      if (cue === "rip") for (let i = 0; i < 46; i++) {
        point.copy(tape.end).add(box.position).add(new THREE.Vector3(random(-0.13, 0.13), 0.02, random(0, 0.5)));
        velocity.set(random(-1.4, 1.4), random(0.8, 2.6), random(0.6, 2));
        spawn(point, velocity, random(0.5, 1.1), 5.5, 0.6 + Math.random() * 0.4);
      }
      if (cue === "burst") for (let i = 0; i < 190; i++) {
        point.set(random(-0.8, 0.8), random(2.5, 2.95), random(-0.7, 0.7));
        velocity.set(random(-1, 1) * 3.2, random(2.5, 8), random(-1, 1) * 3.2);
        spawn(point, velocity, random(0.7, 1.9), 7, Math.random());
      }
      if (cue === "land") for (let i = 0; i < 90; i++) {
        const angle = Math.random() * Math.PI * 2, radius = random(0.35, 0.8), speed = random(1.8, 4.2);
        point.set(Math.cos(angle) * radius, 0.22, Math.sin(angle) * radius);
        velocity.set(Math.cos(angle) * speed, random(0.4, 2), Math.sin(angle) * speed);
        spawn(point, velocity, random(0.45, 1.1), 5, Math.random() * 0.6);
      }
    };
    const updateSparks = (delta: number) => {
      for (let i = 0; i < SPARKS; i++) {
        if (sparkLife[i] <= 0) { sparkColor[i * 3] = sparkColor[i * 3 + 1] = sparkColor[i * 3 + 2] = 0; continue; }
        sparkLife[i] -= delta;
        const drag = Math.exp(-1.6 * delta);
        sparkVelocity[i * 3] *= drag; sparkVelocity[i * 3 + 2] *= drag;
        sparkVelocity[i * 3 + 1] = sparkVelocity[i * 3 + 1] * drag - sparkGravity[i] * delta;
        for (let axis = 0; axis < 3; axis++) sparkPosition[i * 3 + axis] += sparkVelocity[i * 3 + axis] * delta;
        if (sparkPosition[i * 3 + 1] < 0.2 && sparkVelocity[i * 3 + 1] < 0 && Math.hypot(sparkPosition[i * 3], sparkPosition[i * 3 + 2]) < 1.8) { sparkPosition[i * 3 + 1] = 0.2; sparkVelocity[i * 3 + 1] *= -0.3; }
        const fade = Math.max(0, sparkLife[i] / sparkSpan[i]) ** 1.4;
        for (let axis = 0; axis < 3; axis++) sparkColor[i * 3 + axis] = sparkTint[i * 3 + axis] * fade;
      }
      sparksGeometry.attributes.position.needsUpdate = true; sparksGeometry.attributes.color.needsUpdate = true;
    };
    // Continuous emitters: seam sparks while charging, embers from dissolving walls, and a trail around the rising figure.
    const stream = (rate: number, delta: number, make: () => void) => { let count = rate * delta; while (count > 0) { if (count >= 1 || Math.random() < count) make(); count--; } };
    const wallSpark = () => {
      const target = walls[Math.floor(Math.random() * walls.length)];
      point.set(random(-0.5, 0.5) * target.w, random(-0.5, 0.5) * height, 0); target.mesh.localToWorld(point);
      spawn(point, velocity.set(random(-0.3, 0.3), random(0.4, 1.5), random(-0.3, 0.3)), random(0.6, 1.3), -0.6, Math.random() * 0.4);
    };
    const seamSpark = () => {
      const t = Math.random() * 2 - 1, side = Math.random() < 0.5;
      point.set(side ? t * width / 2 : Math.sign(t || 1) * width / 2, bottom + height + box.position.y, side ? Math.sign(Math.random() - 0.5) * depth / 2 : t * depth / 2);
      spawn(point, velocity.set(point.x * 0.3, random(0.6, 1.8), point.z * 0.3), random(0.35, 0.8), 1.5, 0.3 + Math.random() * 0.4);
    };
    const trailSpark = () => {
      const angle = Math.random() * Math.PI * 2, radius = random(0.45, 0.9);
      point.set(Math.cos(angle) * radius, modelRoot.position.y + random(0.2, 2.4) * modelRoot.scale.y, Math.sin(angle) * radius);
      spawn(point, velocity.set(-Math.sin(angle) * 1.2, random(0.3, 1), Math.cos(angle) * 1.2), random(0.5, 0.9), -0.4, 0.5 + Math.random() * 0.5);
    };

    let model: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    let disposed = false, generation = 0;
    const pendingUrls = new Set<string>();
    // Restores materials, faces the camera, scales to 2.5 units and stands the figure on the disc.
    const prepareModel = (root: THREE.Object3D) => {
      restoreFigurineMaterials(root);
      if (immersive || gallery) root.rotation.y = -Math.PI / 2;
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0 || size.length() === 0) { disposeObject(root); throw new Error("Empty model"); }
      const scale = Math.min(2.5 / size.y, 2.9 / Math.max(size.x, size.z));
      const support = figurineSupport(root, bounds);
      root.scale.multiplyScalar(scale);
      root.position.x -= support.x * scale;
      root.position.z -= support.z * scale;
      root.position.y = PEDESTAL_TOP - support.y * scale;
      return root;
    };
    let loadedFor: string | null = null;
    const load = async (selected: File[]) => {
      const loading = filesForRef.current; loadedFor = null;
      const current = ++generation;
      mixer?.stopAllAction(); mixer = null;
      if (silhouette) { modelRoot.remove(silhouette); silhouette = null; }
      if (model) { modelRoot.remove(model); disposeObject(model); model = null; }
      const roots = selected.filter((file) => /\.(glb|gltf)$/i.test(file.name));
      if (!selected.length) { setStatus("empty"); setFilename(""); return; }
      if (roots.length !== 1 || selected.reduce((size, file) => size + file.size, 0) > 150 * 1024 * 1024) { setStatus("error"); return; }
      setStatus("loading"); setFilename(roots[0].name);
      const objects = new Map<string, string>();
      const paths = selected.map((file) => (file.webkitRelativePath || file.name).replace(/\\/g, "/"));
      selected.forEach((file, index) => { const url = URL.createObjectURL(file); objects.set(paths[index], url); pendingUrls.add(url); });
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        const resolved = resolveModelResource(url, paths);
        if (!resolved) throw new Error("Missing or external model resource");
        return objects.get(resolved) ?? resolved;
      });
      const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
      try {
        const rootPath = paths[selected.indexOf(roots[0])];
        const gltf = await loader.loadAsync(rootPath);
        if (disposed || generation !== current) { disposeObject(gltf.scene); return; }
        model = prepareModel(gltf.scene); loadedFor = loading;
        modelRoot.add(model);
        displayClock = 0;
        const textures = new Set<THREE.Texture>();
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const sources: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
          object.castShadow = immersive && sources.every((material) => !material.transparent);
          object.receiveShadow = immersive;
          sources.forEach((material) => Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) textures.add(value); }));
        });
        if (immersive) {
          // Shares geometry with the model, so only the shared material is ever disposed separately.
          silhouette = cloneSkinned(model);
          silhouette.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const sources = Array.isArray(object.material) ? object.material : [object.material];
            object.visible = sources.every((material: THREE.Material) => !material.transparent && material.blending === THREE.NormalBlending);
            object.material = silhouetteMaterial; object.castShadow = false;
          });
          modelRoot.add(silhouette);
        }
        const idle = gltf.animations.find((clip) => /stand|idle/i.test(clip.name));
        if (idle) { mixer = new THREE.AnimationMixer(model); mixer.clipAction(idle).play(); }
        // Upload textures and compile shaders now, while the box is still charging, not on the burst frame.
        textures.forEach((texture) => renderer.initTexture(texture));
        await precompile();
        // Also its portrait shaders, used when it joins the case. Portraits render off-screen, which
        // selects different shader variants (no tone mapping), so compile with a target bound.
        if (immersive && cabinet) {
          renderer.setRenderTarget(compileTarget);
          const compiled = renderer.compileAsync(model, portraitCamera, portraitScene).catch(() => undefined);
          renderer.setRenderTarget(null);
          await compiled;
        }
        if (disposed || generation !== current) return;
        setStatus("ready");
      } catch { if (!disposed && generation === current) setStatus("error"); }
      finally { objects.forEach((url) => { URL.revokeObjectURL(url); pendingUrls.delete(url); }); }
    };
    // compile() skips hidden objects, so briefly reveal everything the reveal will show.
    const precompile = () => {
      const revealed: THREE.Object3D[] = [];
      scene.traverse((object) => { if (!object.visible) { revealed.push(object); object.visible = true; } });
      const ready = renderer.compileAsync(scene, camera).catch(() => undefined);
      revealed.forEach((object) => { object.visible = false; });
      return ready;
    };
    updateSkyLight(); void precompile();
    api.current = {
      rebuildBox: () => { clearPackagings(); worldRef.current?.series.forEach((entry) => packagingFor(entry)); mountBox(); void precompile(); },
      showBox: () => mountBox(),
      setCollection,
    };
    if (worldSetup) setCollection(worldSetup.collection);
    if (immersive && scenery) void (async () => {
      const portraitsQueued = Math.max(1, portraitQueue.length);
      const report = (sceneryDone: boolean) => callbacks.current.onProgress?.((sceneryDone ? 0.35 : 0) + 0.55 * (1 - portraitQueue.length / portraitsQueued));
      report(false);
      void pumpPortraits();
      await scenery.ready; report(true);
      while (!disposed && (portraitQueue.length || portraitBusy)) { report(true); await new Promise((resolve) => setTimeout(resolve, 60)); }
      // Upload every texture now (hidden boxes included), or the first look at one stalls a frame.
      const textures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      });
      textures.forEach((texture) => renderer.initTexture(texture));
      await precompile();
      if (!disposed) { callbacks.current.onProgress?.(1); callbacks.current.onLoaded?.(); }
    })();
    loaderState.current = { load: (selected) => { void load(selected); } };
    void load(filesRef.current);
    const resize = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix();
      // Portrait screens back the camera off so the whole disc stays in frame.
      framing = immersive ? THREE.MathUtils.clamp(0.85 / camera.aspect, 1, 1.6) : 1;
      if (immersive && state.current.view === "opening" && !state.current.charging && !state.current.open) camera.position.copy(homeOffset).multiplyScalar(framing).add(controls.target);
    }); resize.observe(element);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let last = performance.now(), reveal = 0, notifiedReveal = false;
    // Immersive clocks advance only while the tab is visible; cue cursors start at -1 so zero-time cues fire.
    let idle = 0, entrance = 0, charge = 0, burst = 0, bursting = false, hitstop = 0;
    let entranceCue = -1, chargeCue = -1, burstCue = -1;
    let hum: (() => void) | null = null;
    let orbitOffset: THREE.Vector3 | null = null;
    const setPackagingOpacity = (opacity: number) => {
      if (opacity === packagingOpacity) return;
      // Fading walls stop writing depth so they never hide what is behind them.
      packaging.forEach((material) => { material.opacity = opacity; material.depthWrite = opacity > 0.99; });
      boxMeshes.forEach((mesh) => { mesh.castShadow = immersive && opacity > 0.5; });
      packagingOpacity = opacity;
    };
    // Pull the tear tape to open: press the tab, drag along the tape, release once it is fully peeled.
    // Releasing early sticks it back down. Tapping the box only wiggles the tab; other drags orbit.
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    type Grab = { id: number; x: number; y: number; from: number; axis: THREE.Vector2; moved: boolean };
    let grab: Grab | null = null, hovering = false, hoverTape = false, hover = 0, tapeGlow = 0;
    let peel = 0, peelTarget = 0, peelSpeed = 0, released = 0, ready = false, nudge = 0;
    let peelSound: ReturnType<typeof startFigurineLoop> | null = null;
    // Grab the box anywhere off the tape to lift and shake it: it trails the finger on a spring,
    // leans with its speed, and every sharp change of direction rattles the figure inside.
    let shake: { id: number; x: number; y: number; scale: number; moved: boolean } | null = null;
    const held = new THREE.Vector2(), heldVelocity = new THREE.Vector2(), heldTarget = new THREE.Vector2(), heldPrevious = new THREE.Vector2(), heldAccel = new THREE.Vector2(), heldRight = new THREE.Vector3();
    let rattleCooldown = 0;
    const grabPoint = new THREE.Vector3(), plane = new THREE.Plane(), toward = new THREE.Vector3(), screen = new THREE.Vector3();
    const aim = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const hits = (objects: THREE.Object3D[]) => box.visible && raycaster.intersectObjects(objects, true).length > 0;
    const toScreen = (local: THREE.Vector3) => {
      screen.copy(local); box.localToWorld(screen).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2((screen.x + 1) / 2 * rect.width, (1 - screen.y) / 2 * rect.height);
    };
    const tappable = () => immersive && state.current.interactive && state.current.view === "opening" && !flight;
    // The world is the interface: tap a station to go there, a series to open it, an owned figure
    // to inspect it, and empty ground or sky to step back. The target must match on release.
    type Pick = { kind: "station"; view: WorldView } | { kind: "series"; id: string } | { kind: "figure"; key: string } | { kind: "back" };
    let press: { x: number; y: number; pick: Pick | null; yaw: number; pitch: number } | null = null;
    const look = { yaw: 0, pitch: 0, zoom: 1 }, lookTarget = { yaw: 0, pitch: 0, zoom: 1 };
    let looking: { id: number; x: number; y: number; yaw: number; pitch: number } | null = null;
    const lookLimits = () => ({ yaw: 0.35, pitch: 0.15, near: 0.6, far: 1.3 });
    const directed = () => immersive && !flight && (state.current.view === "shop" || state.current.view === "gallery");
    const steer = (dx: number, dy: number, from: { yaw: number; pitch: number }) => {
      const limits = lookLimits(), size = renderer.domElement;
      lookTarget.yaw = THREE.MathUtils.clamp(from.yaw - dx / size.clientWidth * 1.8, -limits.yaw, limits.yaw);
      lookTarget.pitch = THREE.MathUtils.clamp(from.pitch + dy / size.clientHeight * 0.9, -limits.pitch, limits.pitch);
    };
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    const onWheel = (event: WheelEvent) => {
      if (!directed()) return;
      event.preventDefault();
      const limits = lookLimits();
      lookTarget.zoom = THREE.MathUtils.clamp(lookTarget.zoom * Math.exp(event.deltaY * 0.0012), limits.near, limits.far);
    };
    let hoveredSeries: string | null = null, hoveredFigure: string | null = null, hoveredStation: WorldView | null = null;
    // Not while a box is mid-opening: the burst owns the camera.
    const navigable = () => !state.current.charging && (!state.current.open || notifiedReveal);
    const pickAt = (): Pick | null => {
      const view = state.current.view;
      if ((flight && flight.t < 0.6) || !immersive || !navigable()) return null;
      // Only the stations are targets; glows and sprites never block what is behind them.
      const roots: [THREE.Object3D | null, WorldView][] = [[shopGroup, "shop"], [caseGroup, "gallery"]];
      const hit = raycaster.intersectObjects(roots.map(([root]) => root).filter((root): root is THREE.Object3D => !!root && root.visible), true)
        .find(({ object }) => !(object instanceof THREE.Sprite) && !(object instanceof THREE.Points));
      // Empty ground steps back from a station; at the centre (home) it does nothing.
      if (!hit) return view === "shop" || view === "gallery" ? { kind: "back" } : null;
      let station: WorldView | null = null;
      for (let object: THREE.Object3D | null = hit.object; object && !station; object = object.parent) station = roots.find(([root]) => root === object)?.[1] ?? null;
      // Boxes and figures can be picked straight from the hub, not only from their station.
      if (station === "shop") { const stack = raycaster.intersectObjects(shop?.picks ?? [], false)[0]; if (stack) return { kind: "series", id: stack.object.userData.series }; }
      if (station === "gallery") { const card = raycaster.intersectObjects(cabinet?.picks ?? [], false)[0]; if (card) return { kind: "figure", key: card.object.userData.figure }; }
      // Tapping the station you are at (off its items) steps back to the hub.
      if (station === view) return { kind: "back" };
      // The pedestal hosts both the opening and the viewer; tapping it there does nothing.
      if (station === "opening" && (view === "opening" || view === "viewer")) return null;
      return station ? { kind: "station", view: station } : null;
    };
    const samePick = (a: Pick | null, b: Pick | null) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
    let figureNudge: { key: string; time: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (!immersive) return;
      aim(event);
      if (tappable() && hits([tape.mesh, tape.hit])) {
        // Claim the gesture before OrbitControls sees it.
        event.stopImmediatePropagation(); controls.enabled = false;
        // Capture is a nicety (keeps the drag when the pointer leaves the canvas); the grab works without it.
        try { renderer.domElement.setPointerCapture(event.pointerId); } catch { /* pointer no longer active */ }
        unlockFigurineAudio(); playFigurineCue("tap");
        grab = { id: event.pointerId, x: event.clientX, y: event.clientY, from: peel, axis: toScreen(tape.end).sub(toScreen(tape.start)), moved: false };
        peelSound?.stop(); peelSound = startFigurineLoop("peel");
        renderer.domElement.style.cursor = "grabbing";
        return;
      }
      if (tappable() && hits(boxMeshes)) {
        event.stopImmediatePropagation(); controls.enabled = false;
        try { renderer.domElement.setPointerCapture(event.pointerId); } catch { /* pointer no longer active */ }
        unlockFigurineAudio();
        // World units per screen pixel at the box, so the box keeps pace with the finger.
        const distance = camera.position.distanceTo(box.getWorldPosition(screen));
        shake = { id: event.pointerId, x: event.clientX, y: event.clientY, scale: 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / renderer.domElement.clientHeight, moved: false };
        renderer.domElement.style.cursor = "grabbing";
        return;
      }
      if (event.button === 1 && directed()) {
        event.preventDefault(); event.stopImmediatePropagation();
        looking = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: lookTarget.yaw, pitch: lookTarget.pitch };
        return;
      }
      if (event.button !== 0) return;
      press = { x: event.clientX, y: event.clientY, pick: pickAt(), yaw: lookTarget.yaw, pitch: lookTarget.pitch };
    };
    const onPointerMove = (event: PointerEvent) => {
      aim(event);
      if (grab && event.pointerId === grab.id) {
        const dx = event.clientX - grab.x, dy = event.clientY - grab.y;
        if (Math.hypot(dx, dy) > 6) grab.moved = true;
        peelTarget = THREE.MathUtils.clamp(grab.from + (dx * grab.axis.x + dy * grab.axis.y) / grab.axis.lengthSq(), 0, 1.04);
        return;
      }
      if (shake && event.pointerId === shake.id) {
        const dx = event.clientX - shake.x, dy = event.clientY - shake.y;
        if (Math.hypot(dx, dy) > 6) shake.moved = true;
        // Lifted, not pushed through the pedestal; it slides a little either way.
        heldTarget.set(THREE.MathUtils.clamp(dx * shake.scale, -0.55, 0.55), THREE.MathUtils.clamp(-dy * shake.scale, 0, 0.9));
        return;
      }
      if (looking && event.pointerId === looking.id) { if (directed()) steer(event.clientX - looking.x, event.clientY - looking.y, looking); return; }
      if (event.buttons || !immersive) return;
      const pick = event.pointerType === "mouse" ? pickAt() : null;
      hoveredSeries = pick?.kind === "series" ? pick.id : null;
      hoveredStation = pick?.kind === "station" ? pick.view : null;
      const figure = pick?.kind === "figure" ? pick.key : null;
      if (figure !== hoveredFigure) { hoveredFigure = figure; callbacks.current.onHoverFigure?.(figure); }
      hoverTape = tappable() && event.pointerType === "mouse" && hits([tape.mesh, tape.hit]);
      hovering = hoverTape || (tappable() && event.pointerType === "mouse" && hits(boxMeshes));
      renderer.domElement.style.cursor = hovering ? "grab" : pick && pick.kind !== "back" ? "pointer" : "";
    };
    const letGo = (event: PointerEvent) => {
      if (looking && event.pointerId === looking.id) { looking = null; return; }
      if (press) {
        aim(event);
        const pick = pickAt(), moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10;
        // A press made while the camera was still settling counts with what is under the finger now.
        if (!moved && pick && (samePick(pick, press.pick) || (!press.pick && pick.kind !== "back"))) {
          unlockFigurineAudio();
          if (pick.kind === "station") callbacks.current.onNavigate?.(pick.view);
          else if (pick.kind === "back") callbacks.current.onBack?.();
          else if (pick.kind === "series") { playFigurineCue("ready"); callbacks.current.onPickSeries?.(pick.id); }
          else if (owned[pick.key]) { playFigurineCue("sparkle"); callbacks.current.onInspect?.(pick.key); }
          else { playFigurineCue("tap"); figureNudge = { key: pick.key, time: 0 }; }
        }
        press = null;
        return;
      }
      if (shake && event.pointerId === shake.id) {
        // A tap without a drag gives the box a little jiggle and a single rattle.
        if (!shake.moved) { nudge = 1; playFigurineCue("tap"); playFigurineCue("rattle", { intensity: 0.45 }); }
        shake = null; heldTarget.set(0, 0);
        renderer.domElement.style.cursor = "";
        return;
      }
      if (!grab || event.pointerId !== grab.id) return;
      const opened = peelTarget >= 0.97 && tappable();
      if (!grab.moved) nudge = 1;
      grab = null; peelSound?.stop(); peelSound = null;
      renderer.domElement.style.cursor = "";
      if (opened) { released = peel; callbacks.current.onBoxTap?.(); }
      else { peelTarget = 0; if (peel > 0.05) released = -1; }
    };
    const onPointerLeave = () => { hovering = hoverTape = false; press = null; hoveredSeries = null; hoveredStation = null; if (!grab) renderer.domElement.style.cursor = ""; };
    renderer.domElement.addEventListener("pointerdown", onPointerDown, { capture: true });
    renderer.domElement.addEventListener("pointerup", letGo);
    renderer.domElement.addEventListener("pointercancel", letGo);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    const homeTarget = controls.target.clone();
    // Camera director: flies between station poses; the opening view keeps its own cinematic camera.
    let flight: { from: THREE.Vector3; fromTarget: THREE.Vector3; t: number } | null = null;
    let currentView: WorldView = state.current.view, displayClock = 0;
    if (immersive && currentView !== "opening") {
      const start = viewPose(currentView, framing, { offset: homeOffset, target: homeTarget }, camera.aspect);
      camera.position.copy(start.position); controls.target.copy(start.target);
    }
    const FLIGHT_SECONDS = 0.95;
    let centreShot: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
    const ease = (t: number) => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    // A picked box waits out part of the camera's flight (hidden), then drops in to land as it arrives.
    let seenRound = state.current.round, seenArrival = state.current.arrival, dropDelay = -1;
    // Drop resolution if frames stay slow; isolated hitches are ignored.
    let frameTime = 0, frameCount = 0, settle = 0;
    const stopHum = () => { hum?.(); hum = null; };
    renderer.setAnimationLoop((now) => {
      const elapsed = (now - last) / 1000;
      const delta = Math.min(elapsed, 0.05); last = now;
      if (document.hidden) return;
      const current = state.current;
      settle += delta;
      scenery?.update(now / 1000);
      if (settle > 2 && elapsed < 0.1) {
        frameTime += elapsed; frameCount++;
        if (frameCount === 90) {
          if (frameTime / frameCount > 1 / 40 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); settle = 0; }
          frameTime = frameCount = 0;
        }
      }
      if (immersive && current.view !== currentView) {
        // Between the box and an inspected figure the camera stays where the user left it.
        const centre = (view: WorldView) => view === "opening" || view === "viewer";
        const flying = !(centre(current.view) && centre(currentView));
        // Leaving the centre remembers its camera, so coming back lands where the user left it.
        if (flying && centre(currentView) && !orbitOffset) centreShot = { position: camera.position.clone(), target: controls.target.clone() };
        if (flying) flight = { from: camera.position.clone(), fromTarget: controls.target.clone(), t: 0 };
        currentView = current.view; displayClock = 0; press = null; looking = null; Object.assign(lookTarget, { yaw: 0, pitch: 0, zoom: 1 }); Object.assign(look, lookTarget); grab = null; shake = null; heldTarget.set(0, 0); peelSound?.stop(); peelSound = null;
        if (flying && !reducedMotion.matches) playFigurineCue("whoosh");
      }
      if (current.arrival !== seenArrival) {
        seenArrival = current.arrival;
        if (immersive && !current.charging && !current.open) dropDelay = flight ? FLIGHT_SECONDS * 0.45 : 0;
      }
      if (dropDelay >= 0 && (dropDelay -= delta) < 0) { entrance = 0; entranceCue = -1; peel = peelTarget = released = 0; ready = false; }
      if (current.round !== seenRound) {
        seenRound = current.round;
        if (immersive && !current.charging && !current.open) { entrance = 0; entranceCue = -1; peel = peelTarget = released = 0; ready = false; }
      }
      const reduced = reducedMotion.matches;
      const target = current.open ? 1 : 0;
      reveal = reduced ? target : THREE.MathUtils.damp(reveal, target, 4.5, delta);
      idle += delta;

      const active = immersive && (current.charging || current.open);
      if (!active) { charge = burst = 0; bursting = false; chargeCue = burstCue = -1; notifiedReveal = false; stopHum(); }
      const startBurst = active && current.open && !bursting && (reduced || charge >= CHARGE_SECONDS);
      if (startBurst) { bursting = true; burst = 0; stopHum(); if (reduced) playFigurineCue("land"); }
      else if (bursting) {
        // Hit-stop: the reveal holds for a beat on touchdown, so the landing reads as heavy.
        if (hitstop > 0) hitstop -= delta;
        else if (!reduced && burst < LAND_AT && burst + delta >= LAND_AT) { burst = LAND_AT; hitstop = HITSTOP_SECONDS; }
        else burst += delta;
      }
      else if (active) charge += delta;
      if (immersive) entrance += delta;
      const intro = figurineEntrance(entrance, reduced);
      const build = figurineCharge(charge);
      const motion = figurineReveal(burst, reduced);
      if (immersive && !reduced) {
        for (const { cue } of cuesBetween(ENTRANCE_CUES, entranceCue, entrance)) playFigurineCue(cue);
        entranceCue = entrance;
        if (active && !bursting) {
          for (const { cue } of cuesBetween(CHARGE_CUES, chargeCue, charge)) { playFigurineCue(cue); emit(cue); }
          chargeCue = charge;
          if (build.ready && !hum) hum = playFigurineCue("hum", { loop: true });
        }
        if (bursting) {
          for (const { cue } of cuesBetween(REVEAL_CUES, burstCue, burst)) { playFigurineCue(cue, { signature: current.signature }); emit(cue); }
          burstCue = burst;
        }
      }

      const finished = immersive ? bursting && motion.complete : reveal > 0.99;
      const landed = immersive ? bursting && burst >= LAND_AT + 0.12 : finished;
      if (current.open && landed && !notifiedReveal) {
        notifiedReveal = true; callbacks.current.onRevealed?.();
        // The case portrait waits for an idle moment, so the reveal's last frame never stalls.
        if (model && current.figureKey && cabinet) {
          const figure = model, key = current.figureKey;
          const later = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 400));
          later(() => { if (!disposed && model === figure) capture(figure, key); }, { timeout: 1500 });
        }
      }
      if (immersive) {
        const building = active && !bursting;
        const tremble = building ? build.tremble * 0.014 : 0, knock = building ? build.knock : 0;
        box.visible = current.boxMode && dropDelay < 0 && (!bursting || motion.boxOpacity > 0.001);
        hover = THREE.MathUtils.damp(hover, (hovering || grab || shake) && current.interactive ? 1 : 0, 10, delta);
        if (!current.interactive || active) { shake = null; heldTarget.set(0, 0); }
        // Stiff and lagging while held, so quick strokes overshoot; looser and bouncier once let go.
        const stiffness = shake ? 260 : 150, damping = shake ? 15 : 9;
        heldVelocity.x += ((heldTarget.x - held.x) * stiffness - heldVelocity.x * damping) * delta;
        heldVelocity.y += ((heldTarget.y - held.y) * stiffness - heldVelocity.y * damping) * delta;
        held.addScaledVector(heldVelocity, delta);
        if (held.y < 0) { held.y = 0; if (heldVelocity.y < -1.2) { playFigurineCue("rattle", { intensity: Math.min(1, -heldVelocity.y / 5) }); navigator.vibrate?.(10); } heldVelocity.y *= -0.25; }
        // Hard braking (a reversal or a sudden stop) throws the figure against the wall.
        const was = heldPrevious.length();
        const braking = was > 0.8 ? -heldAccel.copy(heldVelocity).sub(heldPrevious).dot(heldPrevious) / (was * Math.max(delta, 1e-3)) : 0;
        rattleCooldown -= delta;
        if (shake && rattleCooldown <= 0 && braking > 22) {
          playFigurineCue("rattle", { intensity: Math.min(1, 0.3 + braking / 80) }); navigator.vibrate?.(8);
          rattleCooldown = random(0.08, 0.14);
        }
        heldPrevious.copy(heldVelocity);
        // Slide along the camera's right, so sideways on screen is sideways in the world.
        heldRight.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
        const jolt = building ? build.jolt : 0;
        box.position.set(heldRight.x * held.x, intro.drop + knock * 0.075 + hover * 0.04 + jolt * 0.05 + held.y, heldRight.z * held.x);
        const lean = THREE.MathUtils.clamp(-heldVelocity.x * 0.05, -0.3, 0.3), pitch = THREE.MathUtils.clamp(heldVelocity.y * 0.03, -0.15, 0.15);
        box.rotation.set(tremble * Math.sin(idle * 57) - jolt * 0.03 + pitch * heldRight.x + lean * heldRight.z * -1, active || grab || shake ? 0 : Math.sin(idle * 0.45) * 0.05, build.knockSide * knock * 0.04 + tremble * Math.cos(idle * 61) + lean * heldRight.x + pitch * heldRight.z);
        box.scale.set(1 + 0.035 * intro.squash, 1 - 0.07 * intro.squash, 1 + 0.035 * intro.squash);
        const unfold = bursting ? motion.unfold * Math.PI * 0.52 : 0;
        walls.forEach(({ pivot }) => { pivot.rotation.x = unfold; });
        // Tape: springs toward the finger while held, snaps back when let go early, and once
        // released fully peeled (or opened from the keyboard) tears free and tumbles away.
        if (!active) {
          const previous = peel;
          const target = grab ? Math.min(peelTarget, 1) : 0;
          peel = THREE.MathUtils.damp(peel, target, grab ? 16 : 11, delta);
          peelSpeed = THREE.MathUtils.damp(peelSpeed, Math.abs(peel - previous) / Math.max(delta, 1e-3), 12, delta);
          peelSound?.set(Math.min(1, peelSpeed * 1.4), 0.85 + Math.min(0.4, peelSpeed * 0.25));
          if (grab && peelTarget >= 0.97 && !ready) { ready = true; playFigurineCue("ready"); navigator.vibrate?.(12); }
          if (peelTarget < 0.85) ready = false;
          if (released < 0 && peel < 0.04) { released = 0; playFigurineCue("stick"); }
        }
        nudge = Math.max(0, nudge - delta * 1.6);
        const wiggle = nudge * 0.06 * Math.sin(nudge * 26);
        const shown = active ? Math.max(released, building ? build.rip : 1) : Math.max(0, peel + wiggle);
        let aimAt: THREE.Vector3 | null = null;
        if (grab) {
          // Bend the lifted tape toward the finger: the pointer ray meets a camera-facing plane at the peel point.
          grabPoint.copy(tape.end).lerp(tape.start, 1 - Math.min(peel, 1)); box.localToWorld(grabPoint);
          plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(toward).negate(), grabPoint);
          if (raycaster.ray.intersectPlane(plane, toward)) aimAt = box.worldToLocal(toward);
        }
        const tension = active ? 0 : Math.min(1, peel);
        tape.peel(shown, aimAt, tension ** 2 * 0.035);
        const ripFly = active ? (bursting ? 1 : build.ripFly) : 0;
        tape.group.position.set(ripFly * 0.4, ripFly * 1.4 - ripFly ** 2 * 0.5, ripFly * 1.6);
        tape.group.rotation.set(-ripFly * 2.6, ripFly * 2, ripFly * 1.2);
        tape.material.opacity = 1 - Math.min(1, ripFly * 1.3);
        tape.group.visible = tape.material.opacity > 0.01;
        const fly = bursting ? motion.lidFly : 0;
        lidPivot.position.set(fly * 0.4, bottom + height + fly * 2.6, -depth / 2 - fly * 1.4);
        lidPivot.rotation.set(-(bursting ? motion.lidHinge * Math.PI * 0.82 + fly * Math.PI * 2.2 : knock * 0.07 + tension ** 2 * 0.035), 0, fly * 0.7); // keep the tension tilt in sync with tape.peel
        setPackagingOpacity(bursting ? motion.boxOpacity : 1);
        // Light spills from under the lid as the tape comes off.
        const seam = bursting ? motion.seam : active ? build.seam : 0.1 + 0.05 * Math.sin(idle * 2.1) + tension * 0.55 + (ready ? 0.25 : 0);
        seamMaterial.opacity = Math.min(1, seam * (1 + knock) + (building ? build.ripGlow * 0.8 : 0));
        halo.material.opacity = seam * 0.4;
        const sweep = (idle % 5) / 1.3;
        sheenMaterial.opacity = active || grab || sweep > 1 ? 0 : 0.32;
        sheenMap.offset.x = 1.1 - 2.2 * sweep;
        modelRoot.visible = bursting && model !== null;
        const lifted = bursting ? Math.min(1, motion.lift / 0.75) : 0;
        // The contact shadow stays under a lifted box, fading and tightening as it rises.
        const airborne = intro.drop + held.y * 2.4;
        contact.position.set(box.position.x, contact.position.y, box.position.z);
        contact.scale.setScalar(bursting ? THREE.MathUtils.lerp(3.2, 2.2 + lifted * 0.8, Math.min(1, burst / 0.5)) : 3.4 - airborne * 0.3);
        contactMaterial.opacity = (bursting ? 0.5 * (1 - lifted * 0.7) : 0.6 * Math.max(0, 1 - airborne / 3.4)) * (1 - (bursting ? motion.flash : 0));
        modelRoot.position.y = bursting ? motion.lift : 0;
        modelRoot.scale.setScalar(motion.figureScale);
        modelRoot.rotation.y = bursting ? motion.spin : 0;
        silhouetteMaterial.opacity = motion.silhouette;
        const beamLevel = bursting ? motion.beam : 0, flashLevel = bursting ? motion.flash : 0;
        beamMaterial.opacity = beamLevel * 0.42; coreMaterial.opacity = beamLevel * 0.3;
        beam.visible = core.visible = beamLevel > 0;
        beam.scale.set(1 + flashLevel * 0.4, 1, 1 + flashLevel * 0.4);
        flash.material.opacity = flashLevel; flash.scale.setScalar(5 + 7 * (1 - flashLevel));
        flash.visible = flashLevel > 0;
        renderer.toneMappingExposure = exposure + flashLevel * 1.1 + (building ? build.build * 0.12 : 0);
        for (const [mesh, progress, size] of [[burstRing, bursting ? motion.burstRing : 0, 6], [landRing, bursting ? motion.landRing : 0, 4.6]] as const) {
          mesh.visible = progress > 0;
          mesh.scale.setScalar(0.6 + size * (1 - (1 - progress) ** 3));
          (mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) ** 1.5 * 0.9;
        }
        const plinthGlow = bursting ? motion.plinthGlow : 0;
        discMaterial.opacity = plinthGlow * 0.9 + beamLevel * 0.35 + (building ? build.build * 0.3 : 0);
        // The rune ring breathes at rest, brightens with the peel, spins up through the charge and flares on landing.
        spin += delta * (0.04 + tension * 0.25 + (building ? build.build * 1.3 : 0) + beamLevel * 0.7);
        pedestal.update(0.22 + 0.08 * Math.sin(idle * 1.6) + tension * 0.6 + (building ? build.build * 1.2 + knock * 0.5 : 0)
          + flashLevel * 2.2 + beamLevel * 0.5 + plinthGlow * 2.4 + (finished ? 0.2 : 0) + stationGlow.opening * 0.8, spin);
        glow.intensity = building ? build.seam * 6 : beamLevel * 14 + flashLevel * 24;
        // Motes swirl in during the build-up and are blown outward by the burst.
        const pull = building ? build.build * 0.6 : -0.45 * flashLevel;
        motes.rotation.y += delta * (0.05 + (building ? build.build * 0.9 : 0));
        motesMaterial.opacity = Math.min(1, intro.complete ? 0.45 + (building ? build.build * 0.55 : beamLevel * 0.4) : entrance / 0.8 * 0.45);
        const motePositions = motesGeometry.attributes.position.array as Float32Array;
        for (let i = 0; i < MOTES; i++) {
          moteBase[i * 3 + 1] = (moteBase[i * 3 + 1] + moteSpeed[i] * delta * (reduced ? 0 : 1)) % MOTE_TOP;
          for (let axis = 0; axis < 3; axis++) {
            const base = moteBase[i * 3 + axis], centre = moteCenter.getComponent(axis);
            motePositions[i * 3 + axis] = centre + (base - centre) * (1 - pull);
          }
        }
        motesGeometry.attributes.position.needsUpdate = true;
        if (!reduced) {
          if (building) stream(6 + build.build * 40, delta, seamSpark);
          if (bursting && burst > 0.25 && burst < 0.85) stream(220, delta, wallSpark);
          if (bursting && burst > 0.1 && burst < 1.7) stream(70, delta, trailSpark);
        }
        updateSparks(reduced ? 1 : delta);
        // Viewer: the chosen figure materialises on the pedestal without the box or the effects.
        if (current.view === "viewer") {
          displayClock += delta;
          box.visible = false;
          modelRoot.visible = model !== null && (!current.showing || loadedFor === current.showing); modelRoot.position.y = 0; modelRoot.scale.setScalar(1); modelRoot.rotation.y = 0;
          silhouetteMaterial.opacity = reduced ? 0 : Math.max(0, 1 - displayClock / 0.8);
          contact.scale.setScalar(2.2); contactMaterial.opacity = model ? 0.45 : 0;
          beam.visible = core.visible = flash.visible = false;
        }
        shop?.update(hoveredSeries, delta, idle);
        if (figureNudge) { figureNudge.time += delta; if (figureNudge.time > 0.5) figureNudge = null; }
        cabinet?.update(hoveredFigure, delta);
        stationGlow = { shop: THREE.MathUtils.damp(stationGlow.shop, hoveredStation === "shop" ? 1 : 0, 9, delta), gallery: THREE.MathUtils.damp(stationGlow.gallery, hoveredStation === "gallery" ? 1 : 0, 9, delta), opening: THREE.MathUtils.damp(stationGlow.opening, hoveredStation === "opening" ? 1 : 0, 9, delta) };
        glowing.forEach((materials, view) => materials.forEach((material) => { material.emissiveIntensity = stationGlow[view as "shop" | "gallery"] * 0.07; }));
        stackOutlines.forEach((outline, id) => outline.update(hoveredSeries === id ? 1 : 0, delta));
        stationOutlines.shop?.update(hoveredStation === "shop" ? 1 : 0, delta);
        stationOutlines.gallery?.update(hoveredStation === "gallery" ? 1 : 0, delta);
        pedestalOutline?.update(hoveredStation === "opening" ? 1 : 0, delta);
        boxOutline?.update(hoveredStation === "opening" || (hovering && !hoverTape && !grab) || shake ? 1 : 0, delta);
        // An invitation to grab: it fades once the peel starts.
        tapeGlow = THREE.MathUtils.damp(tapeGlow, hoverTape && !shake && !grab ? 1 : 0, 12, delta);
        tape.material.emissiveIntensity = tapeGlow * 0.3;
        tape.glowStrength.value = tapeGlow * tape.material.opacity; tape.glow.visible = tape.glowStrength.value > 0.01;
        if (figureNudge) cabinet?.picks.find((card) => card.userData.figure === figureNudge?.key)?.rotation.set(0, 0, Math.sin(figureNudge.time * 40) * 0.12 * (1 - figureNudge.time / 0.5));
        if (!portraitBusy && portraitQueue.length) void pumpPortraits();
      } else {
        box.visible = current.boxMode;
        modelRoot.visible = !current.boxMode || reveal > 0.02;
        modelRoot.scale.setScalar(current.boxMode ? 0.55 : 1);
        modelRoot.position.y = current.boxMode ? reveal * 2.7 : 0;
        lidPivot.position.set(0, bottom + height, -depth / 2);
        lidPivot.rotation.x = -reveal * Math.PI * 0.82;
        glow.intensity = reveal * 5;
        particles.material.opacity = reducedMotion.matches ? 0 : Math.sin(reveal * Math.PI) * 0.9;
        particles.position.y = 1.5 + reveal * 2.5;
        particles.rotation.y += delta * 0.2;
        beam.visible = core.visible = flash.visible = burstRing.visible = landRing.visible = false;
        pedestal.update(0.25 + reveal * 0.6, idle * 0.04);
      }
      for (const key of ["yaw", "pitch", "zoom"] as const) look[key] = THREE.MathUtils.damp(look[key], lookTarget[key], 7, delta);
      const destination = !immersive ? null : (currentView === "opening" || currentView === "viewer") && centreShot
        ? { position: centreShot.position.clone(), target: centreShot.target.clone() } : viewPose(currentView, framing, { offset: homeOffset, target: homeTarget }, camera.aspect);
      if (destination && currentView !== "opening" && currentView !== "viewer") {
        // The look-around turns the shot about its target: yaw around up, pitch around the shot's right.
        const offset = destination.position.clone().sub(destination.target);
        const right = screen.set(offset.z, 0, -offset.x).normalize();
        offset.applyAxisAngle(Y_AXIS, look.yaw).applyAxisAngle(right.applyAxisAngle(Y_AXIS, look.yaw), -look.pitch).multiplyScalar(look.zoom);
        destination.position.copy(destination.target).add(offset);
      }
      if (flight && destination) {
        flight.t = reduced ? 1 : Math.min(1, flight.t + Math.min(elapsed, 0.1) / FLIGHT_SECONDS);
        const t = ease(flight.t);
        camera.position.lerpVectors(flight.from, destination.position, t);
        camera.position.y += Math.sin(Math.PI * t) * 1.6;
        controls.target.lerpVectors(flight.fromTarget, destination.target, t);
        if (flight.t >= 1) flight = null;
      } else if (destination && currentView !== "opening" && currentView !== "viewer") {
        // Stations hold a framed shot with a gentle hand-held drift.
        camera.position.copy(destination.position).add(velocity.set(Math.sin(idle * 0.31) * 0.12, Math.sin(idle * 0.43) * 0.06, 0));
        controls.target.copy(destination.target);
      } else if (!immersive || currentView === "opening") {
        controls.target.y = THREE.MathUtils.damp(controls.target.y, immersive ? 1.5 + (bursting ? motion.lift * 0.6 : 0) : current.boxMode && current.open ? 2.1 : 1.5, 4, delta);
      }
      // Cinematic camera: dolly in while charging, pull back and drift around the reveal, then hand back to orbit controls.
      const cinematic = immersive && currentView === "opening" && !flight && active && !reduced && !finished;
      if (cinematic) {
        orbitOffset ??= camera.position.clone().sub(controls.target);
        camera.position.copy(orbitOffset).applyAxisAngle(Y_AXIS, bursting ? motion.orbit : 0).multiplyScalar(bursting ? motion.zoom : build.zoom).add(controls.target);
      } else orbitOffset = null;
      const orbiting = !immersive || (!flight && (currentView === "viewer" || (currentView === "opening" && (!active || finished))));
      const wantsRotation = current.rotate && !reduced && (!immersive || (!flight && (currentView === "viewer" || (currentView === "opening" && finished))));
      const rested = !userOrbit.holding && now - userOrbit.released > AUTO_ROTATE_DELAY * 1000;
      autoRotate = wantsRotation && rested ? Math.min(1, autoRotate + delta * 0.45) : 0;
      controls.autoRotate = autoRotate > 0;
      if (immersive && Math.abs(controls.getAzimuthalAngle()) > ORBIT_ARC - 0.02) sweep = Math.sign(controls.getAzimuthalAngle()); // a positive speed lowers the azimuth
      controls.autoRotateSpeed = sweep * AUTO_ROTATE_SPEED * autoRotate * autoRotate * (3 - 2 * autoRotate);
      controls.enabled = orbiting && !grab && !shake;
      // update() clamps to the orbit distance limits even when disabled; station shots sit farther out.
      controls.maxDistance = orbiting ? 15 : Infinity;
      controls.update(); if (!reduced) mixer?.update(delta);
      const cameraShake = cinematic ? (bursting ? motion.shake : build.knock * 0.3) : 0;
      if (cameraShake > 0) camera.position.add(velocity.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(cameraShake * 0.13));
      renderer.render(scene, camera);
    });
    return () => {
      disposed = true; generation++; loaderState.current = null; stopHum();
      peelSound?.stop();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown, { capture: true }); renderer.domElement.removeEventListener("pointerup", letGo);
      renderer.domElement.removeEventListener("pointercancel", letGo);
      renderer.domElement.removeEventListener("pointermove", onPointerMove); renderer.domElement.removeEventListener("pointerleave", onPointerLeave); renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.setAnimationLoop(null); resize.disconnect(); skyLight?.dispose(); controls.dispose(); mixer?.stopAllAction();
      packagings.forEach(({ parts }) => parts.stop()); disposeObject(scene); environment.dispose(); shop?.stop(); portraits.forEach((target) => target.dispose()); compileTarget.dispose(); api.current = null; pendingUrls.forEach((url) => URL.revokeObjectURL(url)); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [labels.boxTitle, labels.boxSubtitle, labels.series, immersive, gallery]);
  // Another series swaps in its prebuilt box; changed print text rebuilds them. The first run of
  // each effect matches what the scene was built with, so it is skipped.
  const printKey = `${packagingKey}|${lineupKey}|${silhouettes}`, builtPrint = useRef(printKey), shownSeries = useRef(series);
  useEffect(() => { if (builtPrint.current !== printKey) { builtPrint.current = printKey; api.current?.rebuildBox(); } }, [printKey]);
  useEffect(() => { if (shownSeries.current !== series) { shownSeries.current = series; api.current?.showBox(); } }, [series]);
  const collection = world?.collection;
  useEffect(() => { if (collection) api.current?.setCollection(collection); }, [collection]);

  return <div className={`${styles.stageWrap} ${immersive ? styles.immersiveStage : ""} ${gallery ? styles.galleryStage : ""}`}>
    <div ref={host} className={styles.stage} role="img" aria-label={boxMode ? labels.box : labels[status]} />
    {((!immersive && !gallery) || status === "error" || status === "webgl") && <div className={styles.stageStatus} role="status">{boxMode && status === "empty" ? labels.box : labels[status]}{status === "ready" && !boxMode && <span>{filename}</span>}</div>}
  </div>;
}
