// `memoring ask "<question>"` — the OUTPUT-layer LLM (ADR-0011): ask your Realm in
// natural language and get a GROUNDED prose answer. It sits strictly DOWNSTREAM of
// the Gate — it reads only gated retrieval (the same `searchRealm` `memoring search`
// uses), never the raw store, and never writes (read-only; no Events / Claims /
// candidates). Grounding is strict: 0 results → no answer, no LLM call, no
// fabrication (the Silence invariant extended to the renderer, §4). The printed
// answer carries the Ouroboros self-generated marker so it can never launder back in
// as evidence (§5c). One invocation binds to exactly one Realm (§3).
import { isActiveRealmSilence, openResolvedRealm, type RealmContext } from '@core/runtime';
import { resolveActiveProjects } from '@core/realm';
import { searchRealm, type SearchResult } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { renderMarkerBlock, signMarker } from '@security/ouroboros';
import { hmacHex } from '@security/crypto-primitives';
import { newId } from '@core/schema/ids';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { printActiveRealmSilence } from './resolve';
import { resolveOutputProvider, type OutputProvider } from '../output-provider';

// Identifies the renderer in the Ouroboros marker (the ask path has no token-budget
// Recipe, unlike the ContextPack).
const ASK_RENDERER_RECIPE = 'ask.v1';
// The Gate constraints `searchRealm` enforces on every excerpt this renderer sees
// (recorded in the marker's policy digest, mirroring the ContextPack path).
const ASK_POLICY_APPLIED = ['active_scope_only', 'no_secret', 'no_unknown', 'no_confidential', 'classified_only'];

// Strict-grounding instruction (ADR-0011 §4): phrase ONLY what retrieval released,
// in the user's language, and refuse when the excerpts do not contain it. The
// model's parametric knowledge is a phrasing aid, never a source of facts.
const GROUNDING_INSTRUCTION = [
  'You answer the question using ONLY the memory excerpts provided below.',
  '- Use ONLY facts found in the excerpts. Never use outside or general knowledge as fact.',
  '- If the excerpts do not contain the answer, say you cannot answer from the stored memory.',
  '- Answer in the same language as the question.',
  '- Be concise; do not invent details, sources, or citations.',
].join('\n');

/** Build the one-shot grounding prompt from the gated excerpts (one query, v1 §2). */
export function buildAskPrompt(query: string, results: SearchResult[]): string {
  const excerpts = results.map((r, i) => `[${i + 1}] (${r.ref_type}) ${r.snippet}`).join('\n');
  return `${GROUNDING_INSTRUCTION}\n\nMemory excerpts:\n${excerpts}\n\nQuestion: ${query}`;
}

export type AskOutcome = { grounded: false } | { grounded: true; answer: string };

/**
 * Core renderer: gated retrieval → strict grounding → marked prose. Pure over an
 * injected OutputProvider so the safety properties are unit-testable without a
 * network. On 0 results it returns { grounded: false } and the provider is NEVER
 * called (Silence). On results it returns the synthesized answer with the Ouroboros
 * marker appended.
 */
export async function askRealm(
  ctx: RealmContext,
  provider: OutputProvider,
  query: string,
  opts: { activeLabelIds?: string[] } = {},
  now = new Date(),
): Promise<AskOutcome> {
  const results = searchRealm(ctx, query, { activeLabelIds: opts.activeLabelIds });
  if (results.length === 0) return { grounded: false };
  const raw = await provider.generate(buildAskPrompt(query, results));
  return { grounded: true, answer: `${raw.trim()}\n\n${askMarkerBlock(ctx, now)}` };
}

/** Sign + render the Ouroboros marker the same way the ContextPack path does, so the
 *  answer is recognizable as Memoring-generated (textLooksContextInjected) on any
 *  re-ingestion and can never count as evidence / reinforcement (ADR-0011 §5c). */
function askMarkerBlock(ctx: RealmContext, now: Date): string {
  const marker = signMarker(ctx.realmKey, {
    context_pack_id: newId('contextPack', now.getTime()),
    recipe_id: ASK_RENDERER_RECIPE,
    policy_digest: hmacHex(ctx.realmKey, ASK_POLICY_APPLIED.join('|')),
    generated_at: now.toISOString(),
  });
  return renderMarkerBlock(marker);
}

export async function cmdAsk(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const query = flags._.join(' ').trim();
  if (!query) {
    console.error('Usage: memoring ask <question> [--scope <label>] [--project <id>]');
    return 1;
  }
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  try {
    // Scope-gated and fail-closed: if the active scope cannot be resolved, Silence
    // (never a Realm-wide read) — mirrors search / context build (G4/FR-042). This
    // runs BEFORE provider resolution so an ambiguous scope never reaches the LLM.
    const res = resolveActiveProjects(ctx.config, {
      cwd: process.cwd(),
      scope: flags.scope as string | undefined,
      project: flags.project as string | undefined,
    });
    if (res.kind !== 'resolved') {
      console.error(`  Silence: ${res.reason}. Specify --scope <label> or --project <id>.`);
      return 0;
    }
    // No usable output model → actionable guidance + non-zero; never fabricate an
    // answer (no rule-based fallback for the renderer, ADR-0011 §5/§6).
    const provider = resolveOutputProvider();
    if (!provider) return 1;

    const activeLabelIds = resolveActiveLabelIds(ctx, res.projectIds, flags.scope as string | undefined);
    const outcome = await askRealm(ctx, provider, query, { activeLabelIds });
    if (!outcome.grounded) {
      console.log(
        '  No grounded answer for this scope. Nothing in the gated memory matches; not answering from outside knowledge.',
      );
      return 0;
    }
    console.log(outcome.answer);
    return 0;
  } finally {
    ctx.close(false);
  }
}
