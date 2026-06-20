// Deterministic label normalization (Detailed Design §10.5: casefold +
// width_fold + whitespace_trim). Used to compute normalized_key (a realm_key
// HMAC) for vocabulary dedup. Possible from v0 without AI.
export function normalizeLabel(name: string): string {
  return name
    .normalize('NFKC') // width_fold (full-width → half-width) and compatibility forms
    .toLowerCase() // casefold
    .trim()
    .replace(/\s+/g, ' '); // whitespace_trim (collapse internal runs)
}
