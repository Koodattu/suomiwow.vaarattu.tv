import { randomBytes } from "crypto";

export const CCG_SHARE_SHORT_ID_LENGTH = 8;
export const CCG_SHARE_PUBLIC_ID_LENGTH = 22;

const URL_SAFE_ID_CHARACTERS = "[A-Za-z0-9_-]";
const SHORT_ID_PATTERN = new RegExp(`^${URL_SAFE_ID_CHARACTERS}{${CCG_SHARE_SHORT_ID_LENGTH}}$`);
const PUBLIC_ID_PATTERN = new RegExp(`^${URL_SAFE_ID_CHARACTERS}{${CCG_SHARE_PUBLIC_ID_LENGTH}}$`);

export type CcgShareLookup =
  | { shortId: string }
  | { publicId: string };

export function createCcgShareShortId(): string {
  return randomBytes(6).toString("base64url");
}

export function resolveCcgShareLookup(value: string): CcgShareLookup | null {
  if (SHORT_ID_PATTERN.test(value)) return { shortId: value };
  if (PUBLIC_ID_PATTERN.test(value)) return { publicId: value };
  return null;
}
