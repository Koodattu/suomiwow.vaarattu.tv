// In-memory stand-in for the CCG pack-opening API so the open-packs flow can run without the backend or MongoDB.
// Start it through `npm run dev:ccg-mock`, which points the frontend at this server.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.CCG_MOCK_PORT || 3101);
const STARTING_PACKS = Number(process.env.CCG_MOCK_PACKS || 99);
// Signed-in mode (`--user` or CCG_MOCK_USER=1) unlocks sharing, which the real backend allows only for accounts.
const MOCK_USER = process.env.CCG_MOCK_USER === "1" || process.argv.includes("--user");
const MOCK_PROFILE = { username: "MockCollector", avatarUrl: "/ccg/alternative/character/labubu.png" };
const LATENCY_MS = Number(process.env.CCG_MOCK_LATENCY_MS || 220);
const CARDS_PER_PACK = 5;
const CARDS_PER_SET = 40;

const PITY_LIMITS = { foil: 5, golden: 25, prismatic: 50, holographic: 100, negative: 1000, astral: 2500 };
// Boosted well past production odds so a handful of test packs shows the full range of finishes.
const FINISH_ROLLS = [
  ["astral", 0.004],
  ["negative", 0.008],
  ["custom", 0.03],
  ["holographic", 0.025],
  ["prismatic", 0.04],
  ["golden", 0.07],
  ["foil", 0.2],
];
const GRADE_WEIGHTS = [["S", 3], ["A", 8], ["B", 15], ["C", 22], ["D", 22], ["E", 18], ["F", 12]];
const GRADE_SCORE = { S: 96, A: 88, B: 76, C: 62, D: 50, E: 38, F: 24 };

const SPECS = [
  [1, "Arms", "dps"], [1, "Protection", "tank"], [2, "Holy", "healer"], [2, "Retribution", "dps"],
  [3, "Marksmanship", "dps"], [4, "Assassination", "dps"], [5, "Shadow", "dps"], [5, "Discipline", "healer"],
  [6, "Unholy", "dps"], [7, "Elemental", "dps"], [7, "Restoration", "healer"], [8, "Fire", "dps"],
  [9, "Affliction", "dps"], [10, "Mistweaver", "healer"], [10, "Brewmaster", "tank"], [11, "Balance", "dps"],
  [11, "Restoration", "healer"], [12, "Havoc", "dps"], [13, "Devastation", "dps"], [13, "Preservation", "healer"],
];
const NAMES = [
  "Hittavainen", "Ache", "Bosso", "Kp", "Mjog", "Smurffi", "Graavi", "Ulmos", "Chozs", "Aurora", "Entrench", "Boxx",
  "Loonlet", "Suhru", "Goldship", "Labubu", "Kisu", "Vaarattu", "Noni", "Kilta", "Taika", "Sydän", "Myrsky", "Revontuli",
];
const GUILDS = ["Taikaolennot", "Sydäntalvi", "Noni", "Kilta", "TURTLES KIMBLE", "Pohjoisen Myrsky"];
const REALMS = ["silvermoon", "stormreaver", "ravencrest", "outland", "kazzak"];
const CHARACTER_ART = ["hittavainen.png", "ache.png", "bosso.png", "kp.png", "mjog.png", "smurffi.png", "boxx.png", "goldship.png", "labubu.png", "loonlet.png", "slime_kisu.png", "suhru.webp"]
  .map((file) => `/ccg/alternative/character/${file}`);

const RAIDS = [
  ["manaforge-omega", 2810, "Manaforge Omega", "The War Within", "current", "/ccg/manaforge-omega-desktop.jpg", "phaseglass", "MO", "#58D9E8", "rgba(88, 217, 232, 0.34)"],
  ["liberation-of-undermine", 2769, "Liberation of Undermine", "The War Within", "legacy", "/ccg/liberation-of-undermine-desktop.webp", "jackpot", "LU", "#F2B84B", "rgba(242, 184, 75, 0.34)"],
  ["nerubar-palace", 2657, "Nerub-ar Palace", "The War Within", "legacy", "/ccg/nerubar-palace-desktop.avif", "royal", "NP", "#B699FF", "rgba(182, 153, 255, 0.36)"],
  ["amirdrassil", 2549, "Amirdrassil", "Dragonflight", "legacy", "/ccg/amirdrassil-desktop.jpg", "emberbloom", "AM", "#7FD66B", "rgba(127, 214, 107, 0.34)"],
  ["aberrus", 2569, "Aberrus", "Dragonflight", "legacy", "/ccg/aberrus-desktop.jpg", "shadowflame", "AB", "#D98A50", "rgba(217, 138, 80, 0.34)"],
  ["vault-of-the-incarnates", 2522, "Vault of the Incarnates", "Dragonflight", "legacy", "/ccg/vault-of-the-incarnates-desktop.avif", "primalstorm", "VI", "#6FB7FF", "rgba(111, 183, 255, 0.34)"],
  ["nyalotha", 2217, "Ny'alotha", "Battle for Azeroth", "legacy", "/ccg/nyalotha-desktop.webp", "empire", "NY", "#E2524A", "rgba(226, 82, 74, 0.34)"],
  ["march-on-queldanas", 2900, "March on Quel'Danas", "Midnight", "legacy", "/ccg/march-on-queldanas-desktop.jpg", "sanguine", "QD", "#E86C9A", "rgba(232, 108, 154, 0.34)"],
];

const hexId = () => randomBytes(12).toString("hex");
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const pickWeighted = (rows) => {
  const total = rows.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of rows) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return rows.at(-1)[0];
};
const jitter = (base, spread) => Math.round((base + (Math.random() - 0.5) * spread) * 10) / 10;

function makeSet(slug, zoneId, raidName, expansionName, state, backgroundPath, customFinish, mark, accent, glow, kind = "raid") {
  return {
    id: hexId(),
    slug,
    zoneId,
    raidName,
    expansionName,
    state,
    kind,
    enabledAt: "2026-01-01T00:00:00.000Z",
    themeKey: slug,
    theme: { mark, accent, glow },
    customFinish: customFinish ? { key: customFinish, hardPity: 250 } : null,
    backgroundPath,
    iconUrl: null,
    packArtOffsetX: 0,
    cardCount: CARDS_PER_SET,
    ownedCards: 0,
    publicationWave: 1,
    lastPublishedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeCard(set, index) {
  const [classID, specName, role] = SPECS[(index * 7 + set.zoneId) % SPECS.length];
  const tierGrade = pickWeighted(GRADE_WEIGHTS);
  const base = GRADE_SCORE[tierGrade];
  return {
    id: hexId(),
    characterId: hexId(),
    setNumber: index + 1,
    snapshotVersion: 1,
    snapshotKey: null,
    name: NAMES[(index + set.zoneId) % NAMES.length],
    realm: pick(REALMS),
    region: "eu",
    guildId: null,
    guildName: pick(GUILDS),
    guildRealm: null,
    classID,
    specName,
    role,
    metric: role === "healer" ? "hps" : "dps",
    itemLevel: 690 + Math.floor(Math.random() * 30),
    scores: {
      performance: jitter(base, 12),
      mechanics: jitter(base - 4, 18),
      combined: jitter(base - 2, 10),
      mythicPlus: Math.round(1600 + base * 22 + Math.random() * 300),
    },
    tierGrade,
    avatarUrl: null,
    renderUrl: CHARACTER_ART[(index + set.zoneId) % CHARACTER_ART.length],
    renderFit: null,
    availabilityStatus: "active",
    alternativeArt: null,
    quip: null,
    backgroundCrop: { x: 50, y: 50, scale: 1 },
    backgroundPath: null,
    performanceSnapshotAt: "2026-01-01T00:00:00.000Z",
    mediaCapturedAt: null,
    publicationWave: 1,
    publishedAt: "2026-01-01T00:00:00.000Z",
    setId: set.id,
  };
}

function createState() {
  const sets = [
    ...RAIDS.map((row) => makeSet(...row)),
    makeSet("supporter", 0, "Supporter Pack", "Community", "current", "/ccg/general_wide.webp", null, "SP", "#F4D78C", "rgba(244, 215, 140, 0.36)", "supporter"),
  ];
  const cardsBySet = new Map(sets.map((set) => [set.id, Array.from({ length: CARDS_PER_SET }, (_, index) => makeCard(set, index))]));
  return {
    sets,
    cardsBySet,
    packs: STARTING_PACKS,
    qualityProtection: { foil: 0, golden: 0, prismatic: 0, holographic: 0, negative: 0, astral: 0 },
    customProtection: new Map(),
    ownedCardIds: new Set(),
    ownedFinishKeys: new Set(),
    openings: new Map(),
    processedKeys: new Map(),
    batches: new Map(),
    batchOpenings: new Map(),
    shares: new Map(),
    shareKeys: new Map(),
  };
}

let state = createState();

function sessionPayload() {
  const now = Date.now();
  return {
    ownerType: MOCK_USER ? "user" : "guest",
    dateKey: new Date(now).toISOString().slice(0, 10),
    resetAt: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
    packs: { regularRemaining: state.packs, bonusRemaining: 0, totalRemaining: state.packs },
    recharge: { cap: 10, intervalMinutes: 90, nextAt: new Date(now + 45 * 60 * 1000).toISOString() },
    qualityProtection: { ...state.qualityProtection },
    customQualityProtection: state.sets
      .filter((set) => set.customFinish)
      .map((set) => ({ setSlug: set.slug, raidName: set.raidName, finish: set.customFinish.key, counter: state.customProtection.get(set.slug) ?? 0, hardPity: 250 })),
    ownedFinishes: state.ownedFinishKeys.size,
  };
}

function rollFinish(set) {
  for (const key of Object.keys(state.qualityProtection)) state.qualityProtection[key] += 1;
  if (set.customFinish) state.customProtection.set(set.slug, (state.customProtection.get(set.slug) ?? 0) + 1);

  for (const [finish, chance] of FINISH_ROLLS) {
    if (finish === "custom") {
      if (set.customFinish && (Math.random() < chance || state.customProtection.get(set.slug) >= set.customFinish.hardPity)) {
        state.customProtection.set(set.slug, 0);
        return set.customFinish.key;
      }
      continue;
    }
    if (Math.random() < chance || state.qualityProtection[finish] >= PITY_LIMITS[finish]) {
      state.qualityProtection[finish] = 0;
      return finish;
    }
  }
  return "standard";
}

function resolvePool(body) {
  if (body.type === "supporter") {
    const supporter = state.sets.find((set) => set.kind === "supporter");
    return { selection: { type: "supporter" }, pool: [supporter] };
  }
  if (body.setId) {
    const set = state.sets.find((row) => row.id === body.setId);
    if (!set) return { error: { status: 400, code: "selected_sets_unavailable", error: "That raid set is not available." } };
    return { selection: { type: "raid", setId: set.id }, pool: [set] };
  }
  const raids = state.sets.filter((set) => set.kind === "raid");
  const pool = Array.isArray(body.setIds) ? raids.filter((set) => body.setIds.includes(set.id)) : raids;
  if (pool.length === 0) return { error: { status: 400, code: "invalid_pack_sets", error: "Select at least one set." } };
  return { selection: Array.isArray(body.setIds) ? { type: "all", setIds: pool.map((set) => set.id) } : { type: "all" }, pool };
}

function openPack(body, batchId = null) {
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey) {
    return { status: 400, payload: { error: "Missing idempotency key", code: "invalid_request" } };
  }
  const replayed = state.processedKeys.get(body.idempotencyKey);
  if (replayed) return { status: 200, payload: state.openings.get(replayed) };
  if (state.packs <= 0) return { status: 409, payload: { error: "No packs remaining.", code: "no_packs" } };

  const { selection, pool, error } = resolvePool(body);
  if (error) return { status: error.status, payload: { error: error.error, code: error.code } };

  state.packs -= 1;
  const ownedCardsBySetDelta = {};
  let ownedFinishesDelta = 0;
  const results = Array.from({ length: CARDS_PER_PACK }, (_, position) => {
    const set = pick(pool);
    const card = pick(state.cardsBySet.get(set.id));
    const finish = rollFinish(set);
    const finishKey = `${card.id}:${finish}`;
    const isNewCard = !state.ownedCardIds.has(card.id);
    const isNewFinish = !isNewCard && !state.ownedFinishKeys.has(finishKey);
    if (isNewCard) {
      state.ownedCardIds.add(card.id);
      set.ownedCards += 1;
      ownedCardsBySetDelta[set.id] = (ownedCardsBySetDelta[set.id] ?? 0) + 1;
    }
    if (!state.ownedFinishKeys.has(finishKey)) {
      state.ownedFinishKeys.add(finishKey);
      ownedFinishesDelta += 1;
    }
    return {
      position,
      finish,
      artVariant: "standard",
      isDuplicate: !isNewCard && !isNewFinish,
      isNewCard,
      isNewFinish,
      isNewSnapshot: false,
      bonusPackReward: false,
      card,
    };
  });

  const session = sessionPayload();
  const opening = {
    id: hexId(),
    ...(batchId ? { batchId } : {}),
    selection,
    sets: state.sets,
    allowanceSource: "daily",
    duplicateRewards: 0,
    createdAt: new Date().toISOString(),
    results,
    cacheUpdates: {
      packs: session.packs,
      qualityProtection: session.qualityProtection,
      customQualityProtection: session.customQualityProtection.map((row) => ({ setSlug: row.setSlug, counter: row.counter })),
      ownedFinishesDelta,
      ownedCardsBySetDelta,
    },
  };
  // Snapshot the sets so later openings do not rewrite the owned counts this response reported.
  const stored = JSON.parse(JSON.stringify(opening));
  state.openings.set(opening.id, stored);
  state.processedKeys.set(body.idempotencyKey, opening.id);
  return { status: 200, payload: stored };
}

// Mirrors POST /api/ccg/packs/open-batch: all packs open or none do, each as its own opening sharing a batch ID.
function openPackBatch(body) {
  const count = body.count;
  if (!Number.isInteger(count) || count < 2 || count > 5) {
    return { status: 400, payload: { error: "Open between 2 and 5 packs at once", code: "invalid_pack_count" } };
  }
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey) {
    return { status: 400, payload: { error: "Missing idempotency key", code: "invalid_request" } };
  }
  const replayed = state.batches.get(body.idempotencyKey);
  if (replayed) return { status: 200, payload: { batchId: replayed, openings: state.batchOpenings.get(replayed) } };
  if (state.packs < count) return { status: 409, payload: { error: "No packs remain", code: "no_packs" } };
  const { error } = resolvePool(body);
  if (error) return { status: error.status, payload: { error: error.error, code: error.code } };

  const batchId = hexId();
  const openings = Array.from({ length: count }, (_, index) => (
    openPack({ ...body, idempotencyKey: `${body.idempotencyKey}:${index + 1}` }, batchId).payload
  ));
  state.batches.set(body.idempotencyKey, batchId);
  state.batchOpenings.set(batchId, openings);
  return { status: 200, payload: { batchId, openings } };
}

function createShare(kind, body) {
  if (!MOCK_USER) return { status: 401, payload: { error: "Log in to share", code: "authentication_required" } };
  const target = kind === "batch" ? body.batchId : kind === "card" ? body.cardId : body.openingId;
  const exists = kind === "batch" ? state.batchOpenings.has(target)
    : kind === "card" ? Boolean(findCard(target))
      : state.openings.has(target);
  if (!exists) return { status: 404, payload: { error: "Pack opening not found", code: "opening_not_found" } };
  const key = kind === "card" ? `card:${target}:${body.finish}:${body.artVariant}` : `${kind}:${target}`;
  let id = state.shareKeys.get(key);
  if (!id) {
    id = randomBytes(6).toString("base64url");
    state.shareKeys.set(key, id);
    state.shares.set(id, { kind, target, finish: body.finish, artVariant: body.artVariant, createdAt: new Date().toISOString() });
  }
  return { status: 200, payload: { id, kind, path: `/ccg/share/${id}` } };
}

function findCard(cardId) {
  for (const cards of state.cardsBySet.values()) {
    const card = cards.find((row) => row.id === cardId);
    if (card) return card;
  }
  return null;
}

function readShare(id) {
  const share = state.shares.get(id);
  if (!share) return { status: 404, payload: { error: "Shared opening not found", code: "share_not_found" } };
  const base = { id, kind: share.kind, createdAt: share.createdAt, unboxedBy: MOCK_PROFILE };
  if (share.kind === "card") {
    const card = findCard(share.target);
    const set = state.sets.find((row) => row.id === card.setId);
    return { status: 200, payload: { ...base, sets: [set], card: { card, finish: share.finish ?? "standard", artVariant: share.artVariant ?? "standard" } } };
  }
  return share.kind === "batch"
    ? { status: 200, payload: { ...base, batch: { batchId: share.target, openings: state.batchOpenings.get(share.target) } } }
    : { status: 200, payload: { ...base, pack: state.openings.get(share.target) } };
}

function readBody(request) {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function route(request) {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/auth/me") {
    return MOCK_USER
      ? { status: 200, payload: { discord: MOCK_PROFILE, isAdmin: false } }
      : { status: 401, payload: { error: "Not signed in" } };
  }
  if (request.method === "POST" && /^\/api\/ccg\/shares\/(pack|batch|card)$/.test(path)) {
    return createShare(path.split("/").pop(), await readBody(request));
  }
  const shareMatch = path.match(/^\/api\/ccg\/shares\/([A-Za-z0-9_-]+)$/);
  if (request.method === "GET" && shareMatch) return readShare(shareMatch[1]);
  if (request.method === "GET" && path === "/api/ccg/session") return { status: 200, payload: sessionPayload() };
  if (request.method === "GET" && path === "/api/ccg/sets") return { status: 200, payload: { sets: state.sets } };
  if (request.method === "GET" && path === "/api/pickems/ccg-opportunity") return { status: 200, payload: { hasOpportunity: false, claimablePacks: 0 } };
  if (request.method === "POST" && path === "/api/ccg/packs/open") return openPack(await readBody(request));
  if (request.method === "POST" && path === "/api/ccg/packs/open-batch") return openPackBatch(await readBody(request));
  const batchMatch = path.match(/^\/api\/ccg\/openings\/batch\/([a-f\d]{24})$/i);
  if (request.method === "GET" && batchMatch) {
    const openings = state.batchOpenings.get(batchMatch[1]);
    return openings
      ? { status: 200, payload: { batchId: batchMatch[1], openings } }
      : { status: 404, payload: { error: "Pack opening not found", code: "opening_not_found" } };
  }
  const openingMatch = path.match(/^\/api\/ccg\/openings\/([a-f\d]{24})$/i);
  if (request.method === "GET" && openingMatch) {
    const opening = state.openings.get(openingMatch[1]);
    return opening ? { status: 200, payload: opening } : { status: 404, payload: { error: "Opening not found", code: "not_found" } };
  }
  if (path === "/__mock/reset") {
    state = createState();
    return { status: 200, payload: { ok: true, packs: state.packs } };
  }
  if (path === "/__mock/packs") {
    state.packs = Math.max(0, Number(url.searchParams.get("count") ?? STARTING_PACKS));
    return { status: 200, payload: { ok: true, packs: state.packs } };
  }
  return { status: 404, payload: { error: `Mock CCG API does not implement ${request.method} ${path}`, code: "mock_not_implemented" } };
}

export function startCcgMockApi() {
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const { status, payload } = await route(request);
    if (status === 404) console.log(`[ccg-mock] ${request.method} ${request.url} -> 404`);
    const delay = request.url?.startsWith("/api/ccg/packs/open") ? LATENCY_MS : 0;
    setTimeout(() => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    }, delay);
  });
  server.listen(PORT, () => {
    console.log(`[ccg-mock] CCG mock API on http://localhost:${PORT} (${state.packs} packs; reset: /__mock/reset, set packs: /__mock/packs?count=N)`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startCcgMockApi();
}
