import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

const backendRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(backendRoot, "..");

dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true });
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

type PlayableClassSummary = {
  id: number;
  name: string;
  href: string | null;
};

export type PlayableSpecialization = {
  id: number;
  name: string;
  href: string | null;
};

type PlayableClassDetails = PlayableClassSummary & {
  url: string;
  specializations: PlayableSpecialization[];
};

type RaiderIoSpecSlot = {
  raiderIoField: string;
  raiderIoSpecIndex: number;
  blizzardSpecIndex: number;
  blizzardSpecId: number;
  specName: string;
  specSlug: string;
};

type ClassSpecMapping = {
  blizzardClassId: number;
  className: string;
  classSlug: string;
  sourceUrl: string;
  specializations: RaiderIoSpecSlot[];
  raiderIoSlots: Record<string, RaiderIoSpecSlot | null>;
};

type GeneratedSpecMapping = {
  generatedAt: string;
  source: {
    region: string;
    namespace: string;
    locale: string;
    playableClassIndexUrl: string;
  };
  mappingRule: string;
  notes: string[];
  classes: ClassSpecMapping[];
};

// Raider.IO uses the in-game specialization slot order. Blizzard's playable
// class response normally follows that order, but Monk is returned by spec ID
// (Brewmaster, Windwalker, Mistweaver) instead of its in-game slot order.
const RAIDER_IO_SPEC_ID_ORDER_OVERRIDES: Readonly<Record<number, readonly number[]>> = {
  10: [268, 270, 269],
};

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function buildRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getOutputDir(): string {
  const outputDir = getArg("output-dir");
  if (outputDir) {
    return path.resolve(process.cwd(), outputDir);
  }

  return path.join(backendRoot, "logs", "blizzard-raiderio-spec-map", buildRunId());
}

function getDocumentPath(): string {
  const documentPath = getArg("document");
  if (documentPath) {
    return path.resolve(process.cwd(), documentPath);
  }

  return path.join(backendRoot, "docs", "blizzard-raiderio-spec-map.md");
}

function getJsonPath(): string {
  const jsonPath = getArg("json");
  if (jsonPath) {
    return path.resolve(process.cwd(), jsonPath);
  }

  return path.join(backendRoot, "docs", "blizzard-raiderio-spec-map.json");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function hrefValue(value: unknown): string | null {
  const object = objectValue(value);
  if (!object) return null;
  return stringValue(object.href);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildBlizzardUrl(region: string, apiPath: string, namespace: string, locale: string): string {
  const url = new URL(`https://${region}.api.blizzard.com${apiPath}`);
  url.searchParams.set("namespace", namespace);
  url.searchParams.set("locale", locale);
  return url.toString();
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.BLIZZARD_CLIENT_ID;
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing BLIZZARD_CLIENT_ID or BLIZZARD_CLIENT_SECRET in backend/.env or repo .env.");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Blizzard token: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Blizzard token response did not include access_token.");
  }

  return payload.access_token;
}

async function fetchJsonWithRetry(url: string, token: string, maxRetries = 4): Promise<unknown> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const text = await response.text();
    let payload: unknown = text;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { rawText: text };
    }

    if (response.ok) {
      return payload;
    }

    if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
      const waitMs = 1000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    const error = new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    Object.assign(error, { status: response.status, payload });
    throw error;
  }

  throw new Error(`GET ${url} failed after retries.`);
}

function parsePlayableClassSummary(value: unknown): PlayableClassSummary | null {
  const object = objectValue(value);
  if (!object) return null;

  const id = numberValue(object.id);
  const name = stringValue(object.name);
  if (id === null || name === null) return null;

  return {
    id,
    name,
    href: hrefValue(object.key),
  };
}

function parsePlayableClassIndex(payload: unknown): PlayableClassSummary[] {
  const object = objectValue(payload);
  const classes = arrayValue(object?.classes).map(parsePlayableClassSummary).filter((klass): klass is PlayableClassSummary => Boolean(klass));

  if (classes.length === 0) {
    throw new Error("Blizzard playable class index response did not include any classes.");
  }

  return classes.sort((a, b) => a.id - b.id);
}

function parsePlayableSpecialization(value: unknown): PlayableSpecialization | null {
  const object = objectValue(value);
  if (!object) return null;

  const id = numberValue(object.id);
  const name = stringValue(object.name);
  if (id === null || name === null) return null;

  return {
    id,
    name,
    href: hrefValue(object.key),
  };
}

function parsePlayableClassDetails(payload: unknown, url: string): PlayableClassDetails {
  const object = objectValue(payload);
  if (!object) {
    throw new Error(`Blizzard playable class response was not an object for ${url}.`);
  }

  const id = numberValue(object.id);
  const name = stringValue(object.name);
  if (id === null || name === null) {
    throw new Error(`Blizzard playable class response missed id or name for ${url}.`);
  }

  const specializations = arrayValue(object.specializations)
    .map(parsePlayableSpecialization)
    .filter((spec): spec is PlayableSpecialization => Boolean(spec));

  if (specializations.length === 0) {
    throw new Error(`Blizzard playable class response did not include specializations for ${name} (${id}).`);
  }

  return {
    id,
    name,
    href: hrefValue(object.key),
    url,
    specializations,
  };
}

export function orderSpecializationsForRaiderIo(classId: number, specializations: PlayableSpecialization[]): PlayableSpecialization[] {
  const override = RAIDER_IO_SPEC_ID_ORDER_OVERRIDES[classId];
  if (!override) return [...specializations];

  const specializationsById = new Map(specializations.map((spec) => [spec.id, spec]));
  const ordered = override.map((specId) => {
    const spec = specializationsById.get(specId);
    if (!spec) {
      throw new Error(`Raider.IO specialization order override for class ${classId} references missing Blizzard spec ${specId}.`);
    }
    return spec;
  });
  const overrideIds = new Set(override);
  return [...ordered, ...specializations.filter((spec) => !overrideIds.has(spec.id))];
}

function buildClassSpecMapping(details: PlayableClassDetails, maxSlots: number): ClassSpecMapping {
  const specializations = orderSpecializationsForRaiderIo(details.id, details.specializations).map((spec, index) => ({
    raiderIoField: `spec_${index}`,
    raiderIoSpecIndex: index,
    blizzardSpecIndex: index + 1,
    blizzardSpecId: spec.id,
    specName: spec.name,
    specSlug: slugify(spec.name),
  }));

  const raiderIoSlots: Record<string, RaiderIoSpecSlot | null> = {};
  for (let index = 0; index < maxSlots; index++) {
    const field = `spec_${index}`;
    raiderIoSlots[field] = specializations[index] ?? null;
  }

  return {
    blizzardClassId: details.id,
    className: details.name,
    classSlug: slugify(details.name),
    sourceUrl: details.url,
    specializations,
    raiderIoSlots,
  };
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function buildMarkdown(mapping: GeneratedSpecMapping): string {
  const lines: string[] = [];
  const maxSlots = Math.max(...mapping.classes.map((klass) => Object.keys(klass.raiderIoSlots).length));

  lines.push("# Blizzard to Raider.IO Spec Slot Mapping");
  lines.push("");
  lines.push(`Generated from Blizzard Playable Class API on ${mapping.generatedAt}.`);
  lines.push("");
  lines.push("## Source");
  lines.push("");
  lines.push(`- Region: \`${mapping.source.region}\``);
  lines.push(`- Namespace: \`${mapping.source.namespace}\``);
  lines.push(`- Locale: \`${mapping.source.locale}\``);
  lines.push(`- Playable class index: ${mapping.source.playableClassIndexUrl}`);
  lines.push("");
  lines.push("## Mapping Rule");
  lines.push("");
  lines.push(`- ${mapping.mappingRule}`);
  for (const note of mapping.notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  lines.push("## Mapping");
  lines.push("");
  lines.push("| Blizzard class ID | Class | Raider.IO field | Blizzard spec index | Blizzard spec ID | Spec name | Spec slug |");
  lines.push("| ---: | --- | --- | ---: | ---: | --- | --- |");

  for (const klass of mapping.classes) {
    for (let index = 0; index < maxSlots; index++) {
      const field = `spec_${index}`;
      const slot = klass.raiderIoSlots[field];
      if (slot) {
        lines.push(
          `| ${klass.blizzardClassId} | ${escapeMarkdownTableCell(klass.className)} | \`${field}\` | ${slot.blizzardSpecIndex} | ${slot.blizzardSpecId} | ${escapeMarkdownTableCell(slot.specName)} | \`${slot.specSlug}\` |`,
        );
      } else {
        lines.push(`| ${klass.blizzardClassId} | ${escapeMarkdownTableCell(klass.className)} | \`${field}\` | - | - | unused | - |`);
      }
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function fetchClassDetails(token: string, region: string, namespace: string, locale: string, klass: PlayableClassSummary, rawDir: string): Promise<PlayableClassDetails> {
  const url = buildBlizzardUrl(region, `/data/wow/playable-class/${klass.id}`, namespace, locale);
  const payload = await fetchJsonWithRetry(url, token);
  await writeJson(path.join(rawDir, `playable-class-${klass.id}.json`), {
    fetchedAt: new Date().toISOString(),
    url,
    payload,
  });

  return parsePlayableClassDetails(payload, url);
}

async function main(): Promise<void> {
  const region = (getArg("region") || "us").toLocaleLowerCase("en-US");
  const namespace = getArg("namespace") || `static-${region}`;
  const locale = getArg("locale") || "en_US";
  const runDir = getOutputDir();
  const rawDir = path.join(runDir, "raw");
  const documentPath = getDocumentPath();
  const jsonPath = getJsonPath();
  const classIndexUrl = buildBlizzardUrl(region, "/data/wow/playable-class/index", namespace, locale);

  await fs.mkdir(rawDir, { recursive: true });
  await writeJson(path.join(runDir, "run.json"), {
    startedAt: new Date().toISOString(),
    region,
    namespace,
    locale,
    classIndexUrl,
    documentPath,
    jsonPath,
    note: "Raw Blizzard API responses are stored under raw/. Authorization headers and credentials are not written.",
  });

  if (hasFlag("dry-run")) {
    console.log(JSON.stringify({ runDir, region, namespace, locale, classIndexUrl, documentPath, jsonPath }, null, 2));
    return;
  }

  const token = await getAccessToken();
  const classIndexPayload = await fetchJsonWithRetry(classIndexUrl, token);
  await writeJson(path.join(rawDir, "playable-class-index.json"), {
    fetchedAt: new Date().toISOString(),
    url: classIndexUrl,
    payload: classIndexPayload,
  });

  const classSummaries = parsePlayableClassIndex(classIndexPayload);
  const classDetails: PlayableClassDetails[] = [];

  for (const klass of classSummaries) {
    console.log(`Fetching ${klass.name} (${klass.id})...`);
    classDetails.push(await fetchClassDetails(token, region, namespace, locale, klass, rawDir));
  }

  const maxSlots = Math.max(4, ...classDetails.map((klass) => klass.specializations.length));
  const mapping: GeneratedSpecMapping = {
    generatedAt: new Date().toISOString(),
    source: {
      region,
      namespace,
      locale,
      playableClassIndexUrl: classIndexUrl,
    },
    mappingRule:
      "Raider.IO spec_N fields are zero-based in-game specialization slots; spec_0 maps to specialization position 1, spec_1 to position 2, and so on.",
    notes: [
      "The Blizzard class IDs in this document come from the Blizzard Playable Class API and are not interchangeable with WarcraftLogs/internal class IDs.",
      "The Blizzard Playable Class API does not always return specializations in Raider.IO slot order; Monk is explicitly reordered to Brewmaster, Mistweaver, Windwalker.",
      "Unused Raider.IO fields are represented as null in the JSON artifact and as unused rows in the Markdown table.",
    ],
    classes: classDetails.map((klass) => buildClassSpecMapping(klass, maxSlots)),
  };

  const markdown = buildMarkdown(mapping);

  await writeJson(path.join(runDir, "blizzard-raiderio-spec-map.json"), mapping);
  await writeText(path.join(runDir, "blizzard-raiderio-spec-map.md"), markdown);
  await writeJson(jsonPath, mapping);
  await writeText(documentPath, markdown);

  console.log(
    JSON.stringify(
      {
        runDir,
        documentPath,
        jsonPath,
        classCount: mapping.classes.length,
        specCount: mapping.classes.reduce((total, klass) => total + klass.specializations.length, 0),
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
