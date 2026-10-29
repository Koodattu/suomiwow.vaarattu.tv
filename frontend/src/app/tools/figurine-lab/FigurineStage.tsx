"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { resolveModelResource } from "@/lib/figurine-lab";
import { CHARGE_CUES, CHARGE_SECONDS, ENTRANCE_CUES, REVEAL_CUES, cuesBetween, figurineCharge, figurineEntrance, figurineReveal, type FigurineCue } from "@/lib/figurine-reveal";
import { playFigurineCue, startFigurineLoop, unlockFigurineAudio } from "@/lib/figurine-audio";
import { figurineSupport, restoreFigurineMaterials } from "@/lib/figurine-materials";
import { PACKAGING_FALLBACK, PACKAGING_THEMES, buildBlindBox, type BlindBoxParts, type BoxDesign, type PackagingLabels } from "@/lib/figurine-packaging";
import { buildWorld, labelSprite, placeStation, viewPose, type WorldView } from "@/lib/figurine-world";
import { buildShop, type ShopLabels } from "@/lib/figurine-shop";
import { buildCase } from "@/lib/figurine-case";
import { buildPedestal } from "@/lib/figurine-pedestal";
import styles from "./figurine-lab.module.css";

export type { WorldView };
// One series as the world shows it: its box, its shelf in the shop and its section in the case.
export type StageSeries = { id: string; number: string; theme: keyof typeof PACKAGING_THEMES; silhouettes: string; keys: string[]; names: string[]; models: string[] };
export type StageWorld = {
  series: StageSeries[]; collection: Readonly<Record<string, number>>;
  labels: ShopLabels & { shop: string; collection: string; open: string; header: (number: string) => string };
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

export default function FigurineStage({ files, boxMode, open, charging = false, interactive = false, round = 0, rotate, labels, lineup = NO_LINEUP, silhouettes, signature, view = "opening", series, world, figureKey, onNavigate, onBack, onPickSeries, onInspect, onHoverFigure, onStatus, onRevealed, onBoxTap, immersive = false, gallery = false }: {
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
  immersive?: boolean;
  gallery?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef({ boxMode, open, charging, interactive, round, rotate, signature, view, figureKey });
  useEffect(() => { state.current = { boxMode, open, charging, interactive, round, rotate, signature, view, figureKey }; }, [boxMode, open, charging, interactive, round, rotate, signature, view, figureKey]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error" | "webgl">("empty");
  const [filename, setFilename] = useState("");
  const callbacks = useRef({ onStatus, onRevealed, onBoxTap, onNavigate, onBack, onPickSeries, onInspect, onHoverFigure });
  useEffect(() => { callbacks.current = { onStatus, onRevealed, onBoxTap, onNavigate, onBack, onPickSeries, onInspect, onHoverFigure }; });
  useEffect(() => { callbacks.current.onStatus?.(status); }, [status]);
  // The packaging is rebuilt only when its printed text changes, not on every new labels object.
  const packagingKey = JSON.stringify(labels.packaging ?? null), lineupKey = lineup.join("|");
  const labelsRef = useRef(labels), lineupRef = useRef(lineup), silhouettesRef = useRef(silhouettes), worldRef = useRef(world), seriesRef = useRef(series);
  useEffect(() => { labelsRef.current = labels; lineupRef.current = lineup; silhouettesRef.current = silhouettes; worldRef.current = world; seriesRef.current = series; });
  // Lets later prop changes reach the running scene without rebuilding the renderer.
  const api = useRef<{ rebuildBox: () => void; setCollection: (collection: Readonly<Record<string, number>>) => void } | null>(null);
  const loaderState = useRef<{ load: (files: File[]) => void } | null>(null);
  const filesRef = useRef(files);
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
    camera.position.set(gallery ? 2.3 : immersive ? 3.2 : 4.2, gallery ? 2.5 : 3, gallery ? 6 : immersive ? 7.8 : 6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.5, 0); controls.enableDamping = true;
    controls.minDistance = 3; controls.maxDistance = 15;
    controls.maxPolarAngle = Math.PI * 0.53;
    controls.enablePan = !immersive;
    controls.autoRotateSpeed = 0.65;
    const homeOffset = camera.position.clone().sub(controls.target);
    let framing = 1;
    scene.add(new THREE.HemisphereLight(0xe0efff, 0x333048, 3));
    const keyLight = new THREE.DirectionalLight(0xffe2b0, 4); keyLight.position.set(4, 6, 5); scene.add(keyLight);
    keyLight.castShadow = immersive;
    keyLight.shadow.mapSize.set(1024, 1024); keyLight.shadow.radius = 5; keyLight.shadow.bias = -0.0004; keyLight.shadow.normalBias = 0.02;
    Object.assign(keyLight.shadow.camera, { left: -3, right: 3, top: 3.2, bottom: -2.4, near: 2, far: 16 });
    const rim = new THREE.DirectionalLight(0x69bbff, 3); rim.position.set(-4, 4, -3); scene.add(rim);
    if (immersive) { buildWorld(scene); scene.fog = new THREE.FogExp2(0x1f1c36, 0.02); }
    const modelRoot = new THREE.Group(); scene.add(modelRoot);
    const box = new THREE.Group(); scene.add(box);
    const width = 2.05, depth = 1.8, height = 2.75, bottom = 0.18;
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
      header: worldSetup.labels.header,
    }) : null;
    // Floating station names, shown on the main menu.
    const stationLabels = worldSetup && shopGroup && caseGroup ? [
      [labelSprite(worldSetup.labels.shop), shopGroup, new THREE.Vector3(0, 5.5, 1)],
      [labelSprite(worldSetup.labels.collection), caseGroup, new THREE.Vector3(0, 5.8, 0.6)],
      [labelSprite(worldSetup.labels.open), pedestal.group, new THREE.Vector3(0, 4.4, 0)],
    ] as const : [];
    const labelViews: WorldView[] = ["shop", "gallery", "opening"];
    stationLabels.forEach(([sprite, parent, at]) => { sprite.position.copy(at); parent.add(sprite); });
    // Portraits of owned figures for the case, rendered once per figure into small targets.
    const portraits = new Map<string, THREE.WebGLRenderTarget>();
    const portraitScene = new THREE.Scene();
    portraitScene.add(new THREE.HemisphereLight(0xe0efff, 0x333048, 3));
    const portraitKey = new THREE.DirectionalLight(0xffe2b0, 4); portraitKey.position.set(4, 6, 5); portraitScene.add(portraitKey);
    const portraitCamera = new THREE.PerspectiveCamera(24, 240 / 432, 0.1, 50); portraitCamera.position.set(0, 1.5, 7.2); portraitCamera.lookAt(0, 1.4, 0);
    const capture = (object: THREE.Object3D, key: string) => {
      const target = new THREE.WebGLRenderTarget(240, 432, { samples: 4 }); target.texture.colorSpace = THREE.SRGBColorSpace;
      const parent = object.parent, alpha = renderer.getClearAlpha();
      portraitScene.add(object);
      renderer.setRenderTarget(target); renderer.setClearAlpha(0); renderer.clear(); renderer.render(portraitScene, portraitCamera);
      renderer.setRenderTarget(null); renderer.setClearAlpha(alpha);
      parent?.add(object);
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
          else { cabinet?.setSlot(key, "pending"); if (!portraitQueue.includes(key)) portraitQueue.push(key); }
        }
        shop?.setCollected(entry.id, got);
      }
    };
    // The packaging lives in its own group so another series' box can replace it in place.
    let packagingGroup = new THREE.Group(); box.add(packagingGroup);
    let walls!: BlindBoxParts["walls"], lidPivot!: THREE.Group, tape!: BlindBoxParts["tape"], thickness = 0;
    let boxMeshes: THREE.Mesh[] = [], packaging: THREE.Material[] = [], stopPackaging = () => {};
    const mountBox = () => {
      if (packagingGroup.children.length) {
        sheen.removeFromParent(); stopPackaging();
        box.remove(packagingGroup); disposeObject(packagingGroup);
        packagingGroup = new THREE.Group(); box.add(packagingGroup);
      }
      ({ walls, lidPivot, tape, thickness, meshes: boxMeshes, materials: packaging, stop: stopPackaging } = buildBlindBox(packagingGroup, { bottom, design: designOf(selectedSeries()), envMap: environment }));
      tape.mesh.castShadow = immersive;
      boxMeshes.forEach((mesh) => { mesh.castShadow = immersive; });
      walls[0].pivot.add(sheen); sheen.position.set(0, height / 2, thickness / 2 + 0.003);
      packagingOpacity = 1;
    };
    // Soft contact shadow that grounds the box, then shrinks under the figure.
    const contactMaterial = new THREE.MeshBasicMaterial({ map: radial([[0, "rgba(255,255,255,.9)"], [0.5, "rgba(255,255,255,.45)"], [1, "rgba(255,255,255,0)"]], false), color: 0x000000, transparent: true, depthWrite: false, opacity: 0 });
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactMaterial);
    contact.rotation.x = -Math.PI / 2; contact.position.y = 0.168; contact.visible = immersive; scene.add(contact);
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
      mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.175; scene.add(mesh); return mesh;
    };
    const burstRing = shockwave(), landRing = shockwave();
    const discMaterial = additive(glowMap, 0xffd28a);
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), discMaterial); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.17; scene.add(disc);
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
      root.position.y = 0.18 - support.y * scale;
      return root;
    };
    const load = async (selected: File[]) => {
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
        model = prepareModel(gltf.scene);
        modelRoot.add(model);
        displayClock = 0;
        const textures = new Set<THREE.Texture>();
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const sources: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
          object.castShadow = immersive && sources.every((material) => !material.transparent);
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
    void precompile();
    api.current = { rebuildBox: () => { mountBox(); void precompile(); }, setCollection };
    if (worldSetup) setCollection(worldSetup.collection);
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
    let idle = 0, entrance = 0, charge = 0, burst = 0, bursting = false;
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
    let grab: Grab | null = null, hovering = false, hover = 0;
    let peel = 0, peelTarget = 0, peelSpeed = 0, released = 0, ready = false, nudge = 0;
    let peelSound: ReturnType<typeof startFigurineLoop> | null = null;
    const grabPoint = new THREE.Vector3(), plane = new THREE.Plane(), toward = new THREE.Vector3(), screen = new THREE.Vector3();
    const aim = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const hits = (objects: THREE.Object3D[]) => box.visible && raycaster.intersectObjects(objects, false).length > 0;
    const toScreen = (local: THREE.Vector3) => {
      screen.copy(local); box.localToWorld(screen).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2((screen.x + 1) / 2 * rect.width, (1 - screen.y) / 2 * rect.height);
    };
    const tappable = () => immersive && state.current.interactive && state.current.view === "opening" && !flight;
    // The world is the interface: tap a station to go there, a series to open it, an owned figure
    // to inspect it, and empty ground or sky to step back. The target must match on release.
    type Pick = { kind: "station"; view: WorldView } | { kind: "series"; id: string } | { kind: "figure"; key: string } | { kind: "back" };
    let press: { x: number; y: number; pick: Pick | null; pan: number } | null = null, menuPan = 0, menuPanTarget = 0;
    let hoveredSeries: string | null = null, hoveredFigure: string | null = null, hoveredStation: WorldView | null = null;
    // Not while a box is mid-opening: the burst owns the camera.
    const navigable = () => !state.current.charging && (!state.current.open || notifiedReveal);
    const pickAt = (): Pick | null => {
      const view = state.current.view;
      if (flight || !immersive || !navigable()) return null;
      const roots: [THREE.Object3D | null, WorldView][] = [[shopGroup, "shop"], [caseGroup, "gallery"], [box, "opening"], [pedestal.group, "opening"], [modelRoot, "opening"]];
      const hit = raycaster.intersectObjects(roots.map(([root]) => root).filter((root): root is THREE.Object3D => !!root && root.visible), true)[0];
      if (!hit) return view === "menu" ? null : { kind: "back" };
      let station: WorldView | null = null;
      for (let object: THREE.Object3D | null = hit.object; object && !station; object = object.parent) station = roots.find(([root]) => root === object)?.[1] ?? null;
      if (view === "shop" && station === "shop") { const stack = raycaster.intersectObjects(shop?.picks ?? [], false)[0]; return stack ? { kind: "series", id: stack.object.userData.series } : null; }
      if (view === "gallery" && station === "gallery") { const card = raycaster.intersectObjects(cabinet?.picks ?? [], false)[0]; return card ? { kind: "figure", key: card.object.userData.figure } : null; }
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
      if (tappable() && hits(boxMeshes)) { unlockFigurineAudio(); playFigurineCue("tap"); nudge = 1; return; }
      press = { x: event.clientX, y: event.clientY, pick: pickAt(), pan: menuPanTarget };
    };
    const onPointerMove = (event: PointerEvent) => {
      aim(event);
      if (grab && event.pointerId === grab.id) {
        const dx = event.clientX - grab.x, dy = event.clientY - grab.y;
        if (Math.hypot(dx, dy) > 6) grab.moved = true;
        peelTarget = THREE.MathUtils.clamp(grab.from + (dx * grab.axis.x + dy * grab.axis.y) / grab.axis.lengthSq(), 0, 1.04);
        return;
      }
      // Dragging across the menu slides the camera between the stations.
      if (event.buttons && press && state.current.view === "menu" && !flight) {
        menuPanTarget = THREE.MathUtils.clamp(press.pan - (event.clientX - press.x) / renderer.domElement.clientWidth * 2.2, -1, 1);
        return;
      }
      if (event.buttons || !immersive) return;
      const pick = event.pointerType === "mouse" ? pickAt() : null;
      hoveredSeries = pick?.kind === "series" ? pick.id : null;
      hoveredStation = pick?.kind === "station" ? pick.view : null;
      const figure = pick?.kind === "figure" ? pick.key : null;
      if (figure !== hoveredFigure) { hoveredFigure = figure; callbacks.current.onHoverFigure?.(figure); }
      hovering = tappable() && event.pointerType === "mouse" && hits([tape.mesh, tape.hit, ...boxMeshes]);
      renderer.domElement.style.cursor = hovering ? "grab" : pick && pick.kind !== "back" ? "pointer" : "";
    };
    const letGo = (event: PointerEvent) => {
      if (press) {
        aim(event);
        const pick = pickAt(), moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10;
        if (!moved && samePick(pick, press.pick) && pick) {
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
      if (!grab || event.pointerId !== grab.id) return;
      const opened = peelTarget >= 0.97 && tappable();
      if (!grab.moved) nudge = 1;
      grab = null; peelSound?.stop(); peelSound = null;
      renderer.domElement.style.cursor = "";
      if (opened) { released = peel; callbacks.current.onBoxTap?.(); }
      else { peelTarget = 0; if (peel > 0.05) released = -1; }
    };
    const onPointerLeave = () => { hovering = false; press = null; hoveredSeries = null; hoveredStation = null; if (!grab) renderer.domElement.style.cursor = ""; };
    renderer.domElement.addEventListener("pointerdown", onPointerDown, { capture: true });
    renderer.domElement.addEventListener("pointerup", letGo);
    renderer.domElement.addEventListener("pointercancel", letGo);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    const homeTarget = controls.target.clone();
    // Camera director: flies between station poses; the opening view keeps its own cinematic camera.
    let flight: { from: THREE.Vector3; fromTarget: THREE.Vector3; t: number } | null = null;
    let currentView: WorldView = state.current.view, displayClock = 0;
    if (immersive && currentView !== "opening") {
      const start = viewPose(currentView, framing, { offset: homeOffset, target: homeTarget });
      camera.position.copy(start.position); controls.target.copy(start.target);
    }
    const ease = (t: number) => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    let seenRound = state.current.round;
    // Drop resolution if frames stay slow; isolated hitches are ignored.
    let frameTime = 0, frameCount = 0, settle = 0;
    const stopHum = () => { hum?.(); hum = null; };
    renderer.setAnimationLoop((now) => {
      const elapsed = (now - last) / 1000;
      const delta = Math.min(elapsed, 0.05); last = now;
      if (document.hidden) return;
      const current = state.current;
      settle += delta;
      if (settle > 2 && elapsed < 0.1) {
        frameTime += elapsed; frameCount++;
        if (frameCount === 90) {
          if (frameTime / frameCount > 1 / 40 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); settle = 0; }
          frameTime = frameCount = 0;
        }
      }
      if (immersive && current.view !== currentView) {
        flight = { from: camera.position.clone(), fromTarget: controls.target.clone(), t: 0 };
        currentView = current.view; displayClock = 0; press = null; menuPan = menuPanTarget = 0; grab = null; peelSound?.stop(); peelSound = null;
        if (!reducedMotion.matches) playFigurineCue("whoosh");
      }
      if (current.round !== seenRound) {
        seenRound = current.round;
        if (immersive && current.view === "opening" && !flight && !current.charging && !current.open) { entrance = 0; entranceCue = -1; peel = peelTarget = released = 0; ready = false; controls.target.copy(homeTarget); camera.position.copy(homeOffset).multiplyScalar(framing).add(homeTarget); }
      }
      const reduced = reducedMotion.matches;
      const target = current.open ? 1 : 0;
      reveal = reduced ? target : THREE.MathUtils.damp(reveal, target, 4.5, delta);
      idle += delta;

      const active = immersive && (current.charging || current.open);
      if (!active) { charge = burst = 0; bursting = false; chargeCue = burstCue = -1; notifiedReveal = false; stopHum(); }
      const startBurst = active && current.open && !bursting && (reduced || charge >= CHARGE_SECONDS);
      if (startBurst) { bursting = true; burst = 0; stopHum(); if (reduced) playFigurineCue("land"); }
      else if (bursting) burst += delta;
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
      if (current.open && finished && !notifiedReveal) {
        notifiedReveal = true; callbacks.current.onRevealed?.();
        if (model && current.figureKey && cabinet) capture(model, current.figureKey);
      }
      if (immersive) {
        const building = active && !bursting;
        const tremble = building ? build.tremble * 0.014 : 0, knock = building ? build.knock : 0;
        box.visible = current.boxMode && (!bursting || motion.boxOpacity > 0.001);
        hover = THREE.MathUtils.damp(hover, (hovering || grab) && current.interactive ? 1 : 0, 10, delta);
        const jolt = building ? build.jolt : 0;
        box.position.y = intro.drop + (active ? 0 : Math.sin(idle * 1.4) * 0.035) + knock * 0.075 + hover * 0.04 + jolt * 0.05;
        box.rotation.set(tremble * Math.sin(idle * 57) - jolt * 0.03, active || grab ? 0 : Math.sin(idle * 0.45) * 0.05, build.knockSide * knock * 0.04 + tremble * Math.cos(idle * 61));
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
        contact.scale.setScalar(bursting ? THREE.MathUtils.lerp(3.2, 2.2 + lifted * 0.8, Math.min(1, burst / 0.5)) : 3.4 - intro.drop * 0.3);
        contactMaterial.opacity = (bursting ? 0.5 * (1 - lifted * 0.7) : 0.6 * Math.max(0, 1 - intro.drop / 3.4)) * (1 - (bursting ? motion.flash : 0));
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
          + flashLevel * 2.2 + beamLevel * 0.5 + plinthGlow * 2.4 + (finished ? 0.2 : 0), spin);
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
          modelRoot.visible = model !== null; modelRoot.position.y = 0; modelRoot.scale.setScalar(1); modelRoot.rotation.y = 0;
          silhouetteMaterial.opacity = reduced ? 0 : Math.max(0, 1 - displayClock / 0.8);
          contact.scale.setScalar(2.2); contactMaterial.opacity = model ? 0.45 : 0;
          beam.visible = core.visible = flash.visible = false;
        }
        const menu = current.view === "menu" && !flight;
        stationLabels.forEach(([sprite], index) => {
          const station = labelViews[index], here = station === current.view || (station === "opening" && current.view === "viewer");
          const shown = flight ? 0 : menu ? 1 : !here && navigable() ? 0.55 : 0;
          sprite.material.opacity = THREE.MathUtils.damp(sprite.material.opacity, shown, 6, delta);
          const grow = THREE.MathUtils.damp(sprite.scale.y / 0.8, hoveredStation === station ? 1.18 : 1, 10, delta);
          sprite.scale.set(3.2 * grow, 0.8 * grow, 1);
          sprite.position.y += Math.sin(idle * 1.5 + index) * 0.002;
          sprite.visible = sprite.material.opacity > 0.01;
        });
        shop?.update(current.view === "shop" ? hoveredSeries : null, delta, idle);
        if (figureNudge) { figureNudge.time += delta; if (figureNudge.time > 0.5) figureNudge = null; }
        cabinet?.update(current.view === "gallery" ? hoveredFigure : null, delta);
        if (figureNudge) cabinet?.picks.find((card) => card.userData.figure === figureNudge?.key)?.rotation.set(0, 0, Math.sin(figureNudge.time * 40) * 0.12 * (1 - figureNudge.time / 0.5));
        if (current.view === "gallery" && !portraitBusy) void pumpPortraits();
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
      menuPan = THREE.MathUtils.damp(menuPan, menuPanTarget, 7, delta);
      const destination = immersive ? viewPose(currentView, framing, { offset: homeOffset, target: homeTarget }, menuPan) : null;
      if (flight && destination) {
        flight.t = reduced ? 1 : Math.min(1, flight.t + delta / 1.3);
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
      controls.autoRotate = current.rotate && !reduced && (!immersive || (!flight && (currentView === "viewer" || (currentView === "opening" && finished))));
      controls.enabled = orbiting && !grab;
      // update() clamps to the orbit distance limits even when disabled; station shots sit farther out.
      controls.maxDistance = orbiting ? 15 : Infinity;
      controls.update(); if (!reduced) mixer?.update(delta);
      const shake = cinematic ? (bursting ? motion.shake : build.knock * 0.3) : 0;
      if (shake > 0) camera.position.add(velocity.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake * 0.13));
      renderer.render(scene, camera);
    });
    return () => {
      disposed = true; generation++; loaderState.current = null; stopHum();
      peelSound?.stop();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown, { capture: true }); renderer.domElement.removeEventListener("pointerup", letGo);
      renderer.domElement.removeEventListener("pointercancel", letGo);
      renderer.domElement.removeEventListener("pointermove", onPointerMove); renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.setAnimationLoop(null); resize.disconnect(); controls.dispose(); mixer?.stopAllAction();
      disposeObject(scene); environment.dispose(); stopPackaging(); shop?.stop(); portraits.forEach((target) => target.dispose()); api.current = null; pendingUrls.forEach((url) => URL.revokeObjectURL(url)); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [labels.boxTitle, labels.boxSubtitle, labels.series, immersive, gallery]);
  // A different series or print text swaps the box in place.
  useEffect(() => { api.current?.rebuildBox(); }, [packagingKey, lineupKey, silhouettes, series]);
  const collection = world?.collection;
  useEffect(() => { if (collection) api.current?.setCollection(collection); }, [collection]);

  return <div className={`${styles.stageWrap} ${immersive ? styles.immersiveStage : ""} ${gallery ? styles.galleryStage : ""}`}>
    <div ref={host} className={styles.stage} role="img" aria-label={boxMode ? labels.box : labels[status]} />
    {((!immersive && !gallery) || status === "error" || status === "webgl") && <div className={styles.stageStatus} role="status">{boxMode && status === "empty" ? labels.box : labels[status]}{status === "ready" && !boxMode && <span>{filename}</span>}</div>}
  </div>;
}
