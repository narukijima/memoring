// `memoring chat` — the multi-turn OUTPUT-layer surface (ADR-0011). A conversation
// with ONE Realm where each turn reuses the exact `memoring ask` guarantees:
//   - retrieval is ONLY via `searchRealm` — strictly downstream of the Gate, never
//     the raw store (secret / unknown / out-of-scope / unclassified never appear);
//   - strict grounding: 0 results → no answer, no model call (the Silence invariant
//     extended to the renderer, §4) — no fabrication, no general-knowledge backfill;
//   - the model answers ONLY from the released excerpts, in the user's language, and
//     refuses when they do not contain it;
//   - EVERY answer carries the signed `memoring:ouroboros` self-generation marker so
//     it can never launder back in as evidence / reinforcement (§5c);
//   - READ-ONLY: it creates no Events / Claims / candidates (§5d).
// One session binds to exactly one Realm and cross-Realm recall is prohibited (§3):
// the Realm + scope are resolved ONCE up front (fail-closed to Silence on ambiguity,
// like `search`), and every turn retrieves only within that scope. Conversation
// context is kept across turns for the model's phrasing, but each turn still performs
// its OWN gated retrieval (one-shot per turn; agentic multi-hop is deferred, §2).
import readline from 'node:readline';
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

// Identifies the multi-turn renderer in the Ouroboros marker (distinct from 'ask.v1').
const CHAT_RENDERER_RECIPE = 'chat.v1';
const NO_GROUNDED_MSG =
  '  No grounded answer for this scope. Nothing in the gated memory matches; not answering from outside knowledge.';

function providerSearchAudience(provider: OutputProvider): Audience {
  return provider.egress === 'remote' ? 'remote_ai_processing' : 'ai_tool';
}

/** One completed, grounded exchange — kept ONLY to give the model conversational
 *  continuity. `answer` is the clean synthesized prose (NOT the marker block): every
 *  fact in it was itself grounded in that turn's gated excerpts, so re-showing it
 *  introduces nothing the Gate did not already release. */
export interface ChatTurn {
  question: string;
  answer: string;
}

export type ChatOutcome = { grounded: false } | { grounded: true; answer: string; reply: string };

/** Build the per-turn grounding prompt: the strict-grounding instruction, the prior
 *  conversation (for continuity only), THIS turn's freshly-gated excerpts, and the
 *  question. The excerpts remain the only fact source (§4). */
export function buildChatPrompt(history: ChatTurn[], query: string, results: SearchResult[]): string {
  const parts = [GROUNDING_INSTRUCTION];
  if (history.length > 0) {
    const convo = history.map((t) => `User: ${t.question}\nAssistant: ${t.answer}`).join('\n');
    parts.push(
      'The conversation so far is provided for continuity only; still answer ONLY from the memory excerpts below.',
      `Conversation so far:\n${convo}`,
    );
  }
  parts.push(`Memory excerpts:\n${renderExcerpts(results)}`, `Question: ${query}`);
  return parts.join('\n\n');
}

/**
 * Per-turn renderer core: gated retrieval → strict grounding → marked prose. Mirrors
 * `askRealm` turn-for-turn (same `searchRealm` read, same Silence-on-zero, same
 * marker), adding only conversation continuity. Pure over an injected OutputProvider
 * so the safety properties are unit-testable without a network. On 0 results it
 * returns { grounded: false } and the provider is NEVER called (Silence). READ-ONLY:
 * it only reads the index and signs a marker; it writes nothing.
 */
export async function chatTurn(
  ctx: RealmContext,
  provider: OutputProvider,
  history: ChatTurn[],
  query: string,
  opts: { activeLabelIds?: string[] } = {},
  now = new Date(),
): Promise<ChatOutcome> {
  const { results } = searchRealmForQuestion(ctx, query, {
    activeLabelIds: opts.activeLabelIds,
    audience: providerSearchAudience(provider),
  });
  if (results.length === 0) return { grounded: false };
  const reply = (await provider.generate(buildChatPrompt(history, query, results))).trim();
  return { grounded: true, answer: `${reply}\n\n${renderRendererMarker(ctx, CHAT_RENDERER_RECIPE, now)}`, reply };
}

export async function cmdChat(argv: string[], input: NodeJS.ReadableStream = process.stdin): Promise<number> {
  const flags = parseFlags(argv);
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  try {
    // Scope-gated and fail-closed: an ambiguous scope Silences (never a Realm-wide
    // read) BEFORE the provider is resolved or the session starts — mirrors
    // `search` / `ask` (G4/FR-042). Resolved ONCE: the session binds to one Realm +
    // scope, so cross-Realm recall is impossible by construction (§3).
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
    console.error(
      `  memoring chat — talking to this Realm (output: ${provider.egress}). Read-only, grounded. Type ':exit' to end.`,
    );
    const history: ChatTurn[] = [];
    const rl = readline.createInterface({ input, terminal: false });
    try {
      for await (const raw of rl) {
        const q = raw.trim();
        if (!q) continue;
        if (q === ':exit' || q === ':quit') break;
        const outcome = await chatTurn(ctx, provider, history, q, { activeLabelIds });
        if (!outcome.grounded) {
          console.log(NO_GROUNDED_MSG);
          continue;
        }
        console.log(outcome.answer);
        history.push({ question: q, answer: outcome.reply });
      }
    } finally {
      rl.close();
    }
    return 0;
  } finally {
    ctx.close(false);
  }
}
