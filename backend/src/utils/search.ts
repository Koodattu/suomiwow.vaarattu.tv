const foldSearchCharacters = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[æǽ]/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/[øö]/g, "o")
    .replace(/[ðđ]/g, "d")
    .replace(/ł/g, "l")
    .replace(/þ/g, "th")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export const normalizeSearchText = (value: string): string =>
  foldSearchCharacters(value)
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const SEARCH_CHARACTER_CLASSES: Record<string, string> = {
  a: "aàáâãäåāăąǎǟǡǻȁȃạảấầẩẫậắằẳẵặ",
  c: "cçćĉċč",
  d: "dďđðḍ",
  e: "eèéêëēĕėęěȅȇẹẻẽếềểễệ",
  g: "gĝğġģǧ",
  h: "hĥħḥ",
  i: "iìíîïĩīĭįıǐȉȋịỉ",
  j: "jĵ",
  k: "kķǩḳ",
  l: "lĺļľŀłḷ",
  n: "nñńņňŉŋǹṇ",
  o: "oòóôõöøōŏőơǒǫǭȍȏọỏốồổỗộớờởỡợ",
  r: "rŕŗřṛ",
  s: "sśŝşšșṣ",
  t: "tţťŧțṭ",
  u: "uùúûüũūŭůűųưǔȕȗụủứừửữự",
  w: "wŵẁẃẅ",
  y: "yýÿŷỳỵỷỹ",
  z: "zźżžẓ",
};

const SEARCH_SEQUENCE_ALTERNATIVES: Record<string, string> = {
  ae: "æǽ",
  oe: "œ",
  ss: "ß",
  th: "þ",
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const createAccentInsensitiveSearchRegex = (
  value: string,
  options: { prefix?: boolean; exact?: boolean } = {},
): RegExp => {
  const foldedValue = foldSearchCharacters(value);
  const tokens: string[] = [];
  for (let index = 0; index < foldedValue.length; index += 1) {
    const sequence = foldedValue.slice(index, index + 2);
    const alternatives = SEARCH_SEQUENCE_ALTERNATIVES[sequence];
    if (alternatives) {
      const expanded = sequence
        .split("")
        .map((char) => `[${SEARCH_CHARACTER_CLASSES[char] ?? char}][\u0300-\u036f]*`)
        .join("");
      tokens.push(`(?:${expanded}|[${alternatives}][\u0300-\u036f]*)`);
      index += 1;
      continue;
    }

    const char = foldedValue[index];
    const characterClass = SEARCH_CHARACTER_CLASSES[char];
    const token = characterClass ? `[${characterClass}]` : escapeRegex(char);
    tokens.push(`${token}[\u0300-\u036f]*`);
  }

  const source = tokens.join("");

  return new RegExp(`${options.prefix || options.exact ? "^" : ""}${source}${options.exact ? "$" : ""}`, "i");
};

const boundedEditDistance = (a: string, b: string, maxDistance: number): number => {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMinimum = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maxDistance) return maxDistance + 1;
    previous = current;
  }

  return previous[b.length];
};

export const scoreSearchCandidate = (query: string, candidate: string): number => {
  if (!query || !candidate) return 0;
  if (candidate === query) return 100;
  if (candidate.startsWith(query)) return 92;
  if (candidate.split(" ").some((part) => part.startsWith(query))) return 84;
  if (candidate.includes(query)) return 74;

  const maxDistance = query.length <= 4 ? 1 : query.length <= 10 ? 2 : 3;
  const bestWordDistance = Math.min(...candidate.split(" ").map((part) => boundedEditDistance(query, part, maxDistance)));
  if (bestWordDistance <= maxDistance) return 70 - bestWordDistance * 6;

  const distance = boundedEditDistance(query, candidate, maxDistance);
  if (distance <= maxDistance) return 68 - distance * 6;

  return 0;
};
