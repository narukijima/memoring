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
import type { Audience } from '@core/schema/enums';
import { searchRealmForQuestion, type SearchResult } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { printActiveRealmSilence } from './resolve';
import { resolveOutputProvider, type OutputProvider } from '../output-provider';
import { GROUNDING_INSTRUCTION, renderExcerpts, renderRendererMarker } from '../output-render';

// Identifies the renderer in the Ouroboros marker (the ask path has no token-budget
// Recipe, unlike the ContextPack).
const ASK_RENDERER_RECIPE = 'ask.v1';

function providerSearchAudience(provider: OutputProvider): Audience {
  return provider.egress === 'remote' ? 'remote_ai_processing' : 'ai_tool';
}

/** Build the one-shot grounding prompt from the gated excerpts (one query, v1 §2). */
export function buildAskPrompt(query: string, results: SearchResult[]): string {
  return `${GROUNDING_INSTRUCTION}\n\nMemory excerpts:\n${renderExcerpts(results)}\n\nQuestion: ${query}`;
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
  const { results } = searchRealmForQuestion(ctx, query, {
    activeLabelIds: opts.activeLabelIds,
    audience: providerSearchAudience(provider),
  });
  if (results.length === 0) return { grounded: false };
  const raw = await provider.generate(buildAskPrompt(query, results));
  return { grounded: true, answer: `${raw.trim()}\n\n${renderRendererMarker(ctx, ASK_RENDERER_RECIPE, now)}` };
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
    const provider = resolveOutputProvider(ctx.config.llm);
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
