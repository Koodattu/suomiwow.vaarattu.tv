export type RclcRecord = {
  sourceIndex: number;
  id: string;
  player: string;
  dateKey: string;
  time: string;
  timestamp: number;
  instanceName: string;
  difficulty: string;
  boss: string;
  itemName: string;
  itemId: string;
  response: string;
  className: string;
  equipLocation: string;
  itemType: string;
  note: string;
};

export type RclcParseErrorCode = "invalid-json" | "invalid-shape" | "no-records";

export class RclcParseError extends Error {
  readonly code: RclcParseErrorCode;

  constructor(code: RclcParseErrorCode) {
    super(code);
    this.name = "RclcParseError";
    this.code = code;
  }
}

type RclcParseResult = {
  records: RclcRecord[];
  skipped: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function getDateParts(value: string) {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return {
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    timestamp,
  };
}

function getRecordDate(row: Record<string, unknown>) {
  const sourceDate = getDateParts(toText(row.date));
  const serverTime = Number(row.servertime);
  const serverTimestamp = Number.isFinite(serverTime) && serverTime > 0 ? serverTime * 1000 : null;

  if (sourceDate) {
    const time = toText(row.time);
    const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
    const timeOffset = timeMatch
      ? (Number(timeMatch[1]) * 60 * 60 + Number(timeMatch[2]) * 60 + Number(timeMatch[3] || 0)) * 1000
      : 0;

    return {
      dateKey: sourceDate.dateKey,
      timestamp: serverTimestamp ?? sourceDate.timestamp + timeOffset,
    };
  }

  if (serverTimestamp) {
    const date = new Date(serverTimestamp);
    return {
      dateKey: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`,
      timestamp: serverTimestamp,
    };
  }

  return null;
}

function splitInstance(value: unknown) {
  const instance = toText(value);
  const flexibleRaidingSuffix = " - Flexible Raiding";
  const hasFlexibleRaidingSuffix = instance.endsWith(flexibleRaidingSuffix);
  const baseInstance = hasFlexibleRaidingSuffix ? instance.slice(0, -flexibleRaidingSuffix.length) : instance;
  const separatorIndex = baseInstance.lastIndexOf("-");

  if (separatorIndex < 0) {
    return { instanceName: instance, difficulty: "" };
  }

  const difficulty = baseInstance.slice(separatorIndex + 1).trim();
  return {
    instanceName: baseInstance.slice(0, separatorIndex).trim(),
    difficulty: difficulty && hasFlexibleRaidingSuffix ? `${difficulty}${flexibleRaidingSuffix}` : difficulty,
  };
}

function normalizeRecord(value: unknown, sourceIndex: number): RclcRecord | null {
  if (!isObject(value)) return null;

  const player = toText(value.player);
  const itemName = toText(value.itemName);
  const recordDate = getRecordDate(value);
  if (!player || !itemName || !recordDate) return null;
  const instance = splitInstance(value.instance);

  return {
    sourceIndex,
    id: toText(value.id) || String(sourceIndex),
    player,
    dateKey: recordDate.dateKey,
    time: toText(value.time),
    timestamp: recordDate.timestamp,
    instanceName: instance.instanceName,
    difficulty: instance.difficulty,
    boss: toText(value.boss),
    itemName,
    itemId: toText(value.itemID),
    response: toText(value.response),
    className: toText(value.class).toUpperCase(),
    equipLocation: toText(value.equipLoc),
    itemType: toText(value.subType),
    note: toText(value.note),
  };
}

export function parseRclcExport(text: string): RclcParseResult {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    throw new RclcParseError("invalid-json");
  }

  if (!Array.isArray(value)) {
    throw new RclcParseError("invalid-shape");
  }

  const records: RclcRecord[] = [];
  let skipped = 0;

  value.forEach((row, index) => {
    const record = normalizeRecord(row, index);
    if (record) {
      records.push(record);
    } else {
      skipped += 1;
    }
  });

  if (records.length === 0) {
    throw new RclcParseError("no-records");
  }

  return { records, skipped };
}

export function getDateGapInDays(firstDateKey: string, secondDateKey: string) {
  const first = Date.parse(`${firstDateKey}T00:00:00Z`);
  const second = Date.parse(`${secondDateKey}T00:00:00Z`);
  return Math.round(Math.abs(first - second) / 86_400_000);
}
