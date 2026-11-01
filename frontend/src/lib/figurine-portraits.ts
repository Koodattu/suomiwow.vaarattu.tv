import * as THREE from "three";

// Baked colour portraits, one sheet per series (scripts/bake-figurine-portraits.mjs): 280×360 cells,
// eight to a row, in catalog order. The collection UI shows them as CSS sprites and the machines'
// cards as texture windows, so no figure has to be loaded or rendered to be shown in a list.
// Bump PORTRAIT_VERSION when the sheets are re-baked: browsers keep the old ones otherwise.
export const PORTRAIT_VERSION = 2;
export const PORTRAIT_CELL = { w: 280, h: 360, columns: 8 } as const;
export const portraitSheet = (seriesId: string) => `/figurines/${seriesId}/portraits.webp?v=${PORTRAIT_VERSION}`;
const rowsOf = (count: number) => Math.max(1, Math.ceil(count / PORTRAIT_CELL.columns));

// CSS background for figure `index` of a series of `count`: the sheet scaled so one cell fills the element.
export function portraitStyle(seriesId: string, index: number, count: number) {
  const rows = rowsOf(count), column = index % PORTRAIT_CELL.columns, row = Math.floor(index / PORTRAIT_CELL.columns);
  return {
    backgroundImage: `url(${portraitSheet(seriesId)})`,
    backgroundSize: `${PORTRAIT_CELL.columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${column / (PORTRAIT_CELL.columns - 1) * 100}% ${rows > 1 ? row / (rows - 1) * 100 : 0}%`,
  };
}

// One loader per scene: each sheet loads once; every card gets its own window onto it (a texture
// clone shares the image, so the sheet uploads once).
export function portraitAtlas() {
  const loader = new THREE.TextureLoader();
  const sheets = new Map<string, THREE.Texture>(), windows: THREE.Texture[] = [];
  return {
    texture(seriesId: string, index: number, count: number) {
      let sheet = sheets.get(seriesId);
      if (!sheet) { sheet = loader.load(portraitSheet(seriesId)); sheet.colorSpace = THREE.SRGBColorSpace; sheet.anisotropy = 4; sheets.set(seriesId, sheet); }
      const rows = rowsOf(count), window = sheet.clone();
      window.repeat.set(1 / PORTRAIT_CELL.columns, 1 / rows);
      window.offset.set((index % PORTRAIT_CELL.columns) / PORTRAIT_CELL.columns, 1 - (Math.floor(index / PORTRAIT_CELL.columns) + 1) / rows);
      windows.push(window);
      return window;
    },
    dispose() { sheets.forEach((sheet) => sheet.dispose()); windows.forEach((window) => window.dispose()); sheets.clear(); windows.length = 0; },
  };
}
