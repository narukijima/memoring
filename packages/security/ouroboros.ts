// Ouroboros Guard (Final Design §10.7 / Detailed Design §4.12). Memoring must
// never count its own generated context as evidence or reinforcement. Three
// layers of defense: (1) a signed marker embedded in context.md, (2) session
// provenance (context_injected), (3) origin — the strongest, marker-independent
// layer enforced in the evidence rules (enums.ts).
import { hmacHex } from './crypto-primitives';

/** Visible token so a human (and the manual-import excluder) can spot the block. */
export const OUROBOROS_TOKEN = 'memoring:ouroboros';

export interface MarkerInput {
  context_pack_id: string;
  recipe_id: string;
  policy_digest: string;
  generated_at: string;
}

export interface SignedMarker extends MarkerInput {
  token: string;
  digest: string; // self_ingestion_marker_digest
  signature: string;
}

function canonical(m: MarkerInput): string {
  return [m.context_pack_id, m.recipe_id, m.policy_digest, m.generated_at].join('\x1f');
}

/** Compute the self-ingestion marker digest (matches ContextPack.self_ingestion_marker_digest). */
export function markerDigest(realmKey: Buffer, m: MarkerInput): string {
  return hmacHex(realmKey, canonical(m));
}

export function signMarker(realmKey: Buffer, m: MarkerInput): SignedMarker {
  const digest = markerDigest(realmKey, m);
  return {
    ...m,
    token: OUROBOROS_TOKEN,
    digest,
    signature: hmacHex(realmKey, `${OUROBOROS_TOKEN}\x1f${digest}`),
  };
}

/** Render the marker as a fenced block for embedding in context.md. */
export function renderMarkerBlock(marker: SignedMarker): string {
  return [
    '```memoring-ouroboros',
    `token: ${marker.token}`,
    `context_pack_id: ${marker.context_pack_id}`,
    `recipe_id: ${marker.recipe_id}`,
    `policy_digest: ${marker.policy_digest}`,
    `generated_at: ${marker.generated_at}`,
    `digest: ${marker.digest}`,
    `signature: ${marker.signature}`,
    '```',
  ].join('\n');
}

/**
 * Detect whether ingested text contains a Memoring-generated marker. Used to
 * fall an entire session to context_injected on the safe side (v0 over-excludes;
 * span-level tracking is v0.1, OUT-015).
 */
export function textLooksContextInjected(text: string): boolean {
  return text.includes(OUROBOROS_TOKEN);
}

/** Manual-import exclusion is path-based; this guards string-level contamination too. */
export function pathIsMemoringInternal(canonicalPath: string): boolean {
  return /(^|\/)\.memoring(\/|$)/.test(canonicalPath);
}
