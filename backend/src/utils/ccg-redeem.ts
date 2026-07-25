export const CCG_REDEEM_CODE_PATTERN = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/;
export const CCG_REDEEM_CODE_MIN_LENGTH = 3;
export const CCG_REDEEM_CODE_MAX_LENGTH = 64;
export const CCG_REDEEM_PACK_GRANT_MAX = 10_000;

export function normalizeCcgRedeemCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  if (code.length < CCG_REDEEM_CODE_MIN_LENGTH || code.length > CCG_REDEEM_CODE_MAX_LENGTH) return null;
  return CCG_REDEEM_CODE_PATTERN.test(code) ? code : null;
}
