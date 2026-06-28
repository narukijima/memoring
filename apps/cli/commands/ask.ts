// `memoring ask "<question>"` — the OUTPUT-layer LLM (ADR-0011): ask your Realm in
// natural language and get a GROUNDED prose answer. It sits strictly DOWNSTREAM of
// the Gate — it reads only gated retrieval (the same `searchRealm` `memoring search`
// uses), never the raw store, and never writes (read-only; no Events / Claims /
// candidates). Grounding is strict: 0 results → no answer, no LLM call, no
// fabrication (the Silence invariant extended to the renderer, §4). The printed
// answer carries the Ouroboros self-generated marker so it can never launder back in
// as evidence (§5c). One invocation binds to exactly one Realm (§3).
import fs from 'node:fs';
import path from 'node:path';
import { isActiveRealmSilence, openResolvedRealm, type RealmContext } from '@core/runtime';
import { resolveActiveProjects } from '@core/realm';
import { searchRealmForQuestion, type SearchResult } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { printActiveRealmSilence } from './resolve';
import { resolveOutputProvider, type OutputProvider } from '../output-provider';
import { GROUNDING_INSTRUCTION, renderExcerpts, renderRendererMarker, stripRendererMarker } from '../output-render';
import { searchAudienceFor } from '../egress';
import { atomicWriteFile } from '@storage/fs-safety';

// Identifies the renderer in the Ouroboros marker (the ask path has no token-budget
// Recipe, unlike the ContextPack).
const ASK_RENDERER_RECIPE = 'ask.v1';

/** Build the one-shot grounding prompt from the gated excerpts (one query, v1 §2). */
export function buildAskPrompt(query: string, results: SearchResult[]): string {
  return `${GROUNDING_INSTRUCTION}\n\nMemory excerpts:\n${renderExcerpts(results)}\n\nQuestion: ${query}`;
}

export type AskOutcome = { grounded: false } | { grounded: true; answer: string; citations: string[] };

function ensureLocalExclude(rel: string): void {
  const exclude = path.join(process.cwd(), '.git', 'info', 'exclude');
  if (!fs.existsSync(exclude)) return;
  const current = fs.readFileSync(exclude, 'utf8');
  if (current.split(/\r?\n/).includes(rel)) return;
  fs.appendFileSync(exclude, `${current.endsWith('\n') ? '' : '\n'}${rel}\n`, { mode: 0o600 });
}

function artifactName(now: Date): string {
  return `ask-${now.toISOString().replace(/[:.]/g, '-')}.md`;
}

export function saveAskArtifact(ctx: RealmContext, query: string, outcome: Extract<AskOutcome, { grounded: true }>, now = new Date()): string {
  const dir = path.resolve('.memoring', 'artifacts');
  const memoringDir = path.resolve('.memoring');
  if (fs.existsSync(memoringDir) && fs.lstatSync(memoringDir).isSymbolicLink()) {
    throw new Error('.memoring is a symlink; refusing to write artifact');
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  ensureLocalExclude('.memoring/artifacts/');
  const target = path.join(dir, artifactName(now));
  const markerStart = outcome.answer.indexOf('```memoring-ouroboros');
  const marker = markerStart >= 0 ? outcome.answer.slice(markerStart) : '';
  const body = [
    '---',
    'authority: derived',
    'can_be_evidence: false',
    'source: post-gate synthesis',
    'artifact_type: ask_answer',
    `realm_id: ${ctx.realmId}`,
    `created_at: ${now.toISOString()}`,
    'cited_ids:',
    ...outcome.citations.map((id) => `  - ${id}`),
    '---',
    '',
    '# Ask Artifact',
    '',
    `Question: ${query}`,
    '',
    '## Answer',
    '',
    stripRendererMarker(outcome.answer),
    '',
    '## Citations',
    '',
    ...outcome.citations.map((id) => `- ${id}`),
    '',
    marker,
    '',
  ].join('\n');
  atomicWriteFile(target, body, 0o600);
  return target;
}

function shellArg(value: string): string {
  return JSON.stringify(value);
}

function looksLikePlaceholder(query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === 'question' || q === 'your question' || q === '\u805e\u304d\u305f\u3044\u3053\u3068';
}

function labelNames(ctx: RealmContext, labelIds: string[]): string[] {
  return labelIds.map((id) => ctx.store.getLabel(id)?.canonical_name).filter((name): name is string => Boolean(name));
}

function availableScopeNames(ctx: RealmContext): string[] {
  return ctx.store
    .listLabels(ctx.realmId)
    .filter((l) => l.state === 'active')
    .map((l) => l.canonical_name)
    .sort((a, b) => a.localeCompare(b));
}

function suggestedScope(
  scopes: string[],
  searched: string[],
  explicitScope: string | undefined,
  preferMemoring: boolean,
): string | undefined {
  if (explicitScope && scopes.includes(explicitScope)) return explicitScope;
  if (preferMemoring && scopes.includes('Memoring')) return 'Memoring';
  if (searched.length > 0) return searched[0];
  return scopes.includes('Memoring') ? 'Memoring' : scopes[0];
}

export function printNoGroundedAnswer(
  ctx: RealmContext,
  query: string,
  activeLabelIds: string[],
  explicitScope: string | undefined,
): void {
  const searched = labelNames(ctx, activeLabelIds);
  console.log('  No grounded answer in the searched memory. Not answering from outside knowledge.');
  if (looksLikePlaceholder(query)) {
    console.log('  The text you typed looks like a placeholder. Replace it with the actual thing you want to recall.');
  }
  if (explicitScope && activeLabelIds.length === 0) {
    console.log(`  Scope not found or not active: ${explicitScope}`);
  } else {
    console.log(`  Searched scope: ${searched.length > 0 ? searched.join(', ') : '(none)'}`);
  }
  const scopes = availableScopeNames(ctx);
  if (scopes.length > 0) {
    const shown = scopes.slice(0, 8);
    const more = scopes.length > shown.length ? `, +${scopes.length - shown.length} more` : '';
    console.log(`  Available scopes: ${shown.join(', ')}${more}`);
    const placeholder = looksLikePlaceholder(query);
    const nextQuery = placeholder ? 'what did we decide about Memoring?' : query;
    const nextScope = suggestedScope(scopes, searched, explicitScope, placeholder);
    if (nextScope && (placeholder || !searched.includes(nextScope))) {
      console.log(`  Try: memoring ask ${shellArg(nextQuery)} --scope ${shellArg(nextScope)}`);
    } else {
      console.log('  Try a more specific memory question, or choose a different scope from the list above.');
    }
  }
  console.log('  Run `memoring status` to see the current memory setup.');
}

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
    audience: searchAudienceFor(provider.egress),
  });
  if (results.length === 0) return { grounded: false };
  const raw = await provider.generate(buildAskPrompt(query, results));
  return {
    grounded: true,
    answer: `${raw.trim()}\n\n${renderRendererMarker(ctx, ASK_RENDERER_RECIPE, now)}`,
    citations: results.map((r) => r.ref_id),
  };
}

export async function cmdAsk(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const query = flags._.join(' ').trim();
  if (!query) {
    console.error('Usage: memoring ask <question> [--scope <label>] [--project <id>] [--show-marker] [--save artifact]');
    return 1;
  }
  if (flags.save !== undefined && flags.save !== 'artifact') {
    console.error('  Unsupported --save value. Use: --save artifact');
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
      printNoGroundedAnswer(ctx, query, activeLabelIds, flags.scope as string | undefined);
      return 0;
    }
    console.log(flags['show-marker'] === true ? outcome.answer : stripRendererMarker(outcome.answer));
    if (flags.save === 'artifact') {
      const target = saveAskArtifact(ctx, query, outcome);
      console.log(`  Saved artifact: ${target}`);
      console.log('  authority=derived can_be_evidence=false');
    }
    return 0;
  } finally {
    ctx.close(false);
  }
}
