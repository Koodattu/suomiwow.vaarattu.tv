const APOSTROPHE_LIKE_CHARACTERS = /['’‘ʼ＇]/gu;

/**
 * Normalize a realm value that is already an authoritative API slug.
 * Punctuation and diacritics are significant in some Blizzard realm slugs.
 */
export function normalizeRealmSlug(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, "-");
}

/**
 * Produce a slug-shaped fallback when an API only supplies a realm display name.
 * This is not authoritative: exceptional Blizzard slugs must still come from API data.
 */
export function realmNameToSlugCandidate(value: string): string {
  return normalizeRealmSlug(value)
    .replace(APOSTROPHE_LIKE_CHARACTERS, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Comparison-only key for matching display names and API slugs for the same realm.
 */
export function createRealmIdentityKey(value: string): string {
  return normalizeRealmSlug(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

export function areEquivalentRealms(left: string, right: string): boolean {
  const leftKey = createRealmIdentityKey(left);
  return leftKey.length > 0 && leftKey === createRealmIdentityKey(right);
}
