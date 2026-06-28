// Shared OUTPUT-layer rendering for the natural-language surfaces (ADR-0011):
// `memoring ask` (one-shot) and `memoring chat` (multi-turn). Both sit strictly
// DOWNSTREAM of the Gate — they only ever phrase post-Gate, secret-free, in-scope
// excerpts (the same `searchRealm` results `memoring search` returns), never the raw
// store. Both must apply the SAME safety properties: strict grounding (the Silence
// invariant extended to the renderer, §4) and the signed `memoring:ouroboros`
// self-generation marker on every answer (§5c). Keeping that safety code in ONE
// place is why the two surfaces can never drift apart.
import type { RealmContext } from '@core/runtime';
import type { SearchResult } from '@retrieval/search';
import { renderMarkerBlock, signMarker } from '@security/ouroboros';
import { hmacHex } from '@security/crypto-primitives';
import { newId } from '@core/schema/ids';

// Strict-grounding instruction (ADR-0011 §4): phrase ONLY what retrieval released,
// in the user's language, and refuse when the excerpts do not contain it. The
// model's parametric knowledge is a phrasing aid, never a source of facts.
export const GROUNDING_INSTRUCTION = [
  'You answer the question using ONLY the memory excerpts provided below.',
  '- Use ONLY facts found in the excerpts. Never use outside or general knowledge as fact.',
  '- If the excerpts do not contain the answer, say you cannot answer from the stored memory.',
  '- Answer in the same language as the question.',
  '- Be concise; do not invent details, sources, or citations.',
].join('\n');

// The Gate constraints `searchRealm` enforces on every excerpt these renderers see
// (recorded in the marker's policy digest, mirroring the ContextPack path).
const RENDERER_POLICY_APPLIED = ['active_scope_only', 'no_secret', 'no_unknown', 'no_confidential', 'classified_only'];

/** Format the gated excerpts as a numbered block (one query's worth, v1 §2). */
export function renderExcerpts(results: SearchResult[]): string {
  return results.map((r, i) => `[${i + 1}] (${r.ref_type}) ${r.snippet}`).join('\n');
}

/** Sign + render the Ouroboros marker the same way the ContextPack path does, so a
 *  synthesized answer is recognizable as Memoring-generated (textLooksContextInjected)
 *  on any re-ingestion and can never count as evidence / reinforcement (ADR-0011 §5c).
 *  `recipeId` names the renderer (e.g. 'ask.v1' / 'chat.v1'). */
export function renderRendererMarker(ctx: RealmContext, recipeId: string, now: Date): string {
  const marker = signMarker(ctx.realmKey, {
    context_pack_id: newId('contextPack', now.getTime()),
    recipe_id: recipeId,
    policy_digest: hmacHex(ctx.realmKey, RENDERER_POLICY_APPLIED.join('|')),
    generated_at: now.toISOString(),
  });
  return renderMarkerBlock(marker);
}

export function stripRendererMarker(text: string): string {
  const markerStart = text.indexOf('\n\n```memoring-ouroboros');
  return markerStart >= 0 ? text.slice(0, markerStart).trimEnd() : text;
}
