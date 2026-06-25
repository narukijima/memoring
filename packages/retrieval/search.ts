// search — metadata filter / exact / FTS / n-gram (trigram) fallback / session
// reconstruction (FR-040..042, NFR-018). The index lives inside the encrypted DB
// (no plaintext index on disk). Index build happens only after Secret Scan;
// secret/unknown are never indexed (CON-007). Search candidates exclude
// unclassified and out-of-active-scope items.
import type { Audience, ClassificationState } from '@core/schema/enums';
import { normalizeLabel } from '@core/label-normalize';
import { readClaimStatement } from '@claim/extractor';
import { eventSealSignature, isClaimSuppressed, matchesActivePatternSeal } from '@claim/seal';
import { activeScopeContainsAll, allowedScopeState, allowedSensitivityState, bestClassificationState } from '@core/policy';
import type { Claim, MemEvent } from '@core/schema/entities';
import type { RealmContext } from '@core/runtime';
import type { IndexHit } from '@storage/repositories';

function norm(s: string): string {
  return normalizeLabel(s);
}

/** Index a non-secret, scanned Event. Skips secret/unknown and unscanned events. */
export function indexEvent(ctx: RealmContext, event: MemEvent): void {
  if (event.status !== 'active') return;
  if (event.sensitivity === 'secret' || event.sensitivity === 'unknown') return;
  if (!event.text_ref) return; // secret/unusable-scan events have no normalized text
  const scan = ctx.store.getSecretScanForEvent(event.event_id);
  if (!scan?.secret_scan_passed) return; // index build only after a passed scan
  let text: string;
  try {
    text = ctx.objects.get(event.text_ref).toString('utf8');
  } catch {
    return;
  }
  if (matchesActivePatternSeal(ctx, text)) return; // pattern Seal: do not advance to index (§4.15)
  // event_identity Seal: a forgotten/sealed event must not (re)enter the index, so
  // it stays out of search/MCP egress even across a deterministic rebuild (§4.15).
  if (ctx.store.activeSealRulesBySignature(ctx.realmId, eventSealSignature(ctx.realmKey, event.event_identity)).length > 0) {
    return;
  }
  const assignments = ctx.store.listAssignmentsForTarget('event', event.event_id);
  const labelIds = [...new Set(assignments.flatMap((a) => a.label_ids))];
  const scopeState = bestClassificationState(assignments.map((a) => a.classification_state)) ?? 'candidate';
  if (labelIds.length === 0) return; // unclassified → not a search candidate
  ctx.store.indexUpsert({
    ref_id: event.event_id,
    ref_type: 'event',
    realm_id: ctx.realmId,
    label_ids: labelIds,
    sensitivity: event.sensitivity,
    scope_state: scopeState,
    norm_text: norm(text),
  });
}

export function indexClaim(ctx: RealmContext, claim: Claim): void {
  if (claim.status !== 'consolidated') return;
  if (claim.sensitivity === 'secret' || claim.sensitivity === 'unknown') return;
  const statement = readClaimStatement(ctx, claim);
  if (!statement) return;
  if (matchesActivePatternSeal(ctx, statement)) return; // pattern Seal (§4.15)
  if (isClaimSuppressed(ctx, claim, statement)) return; // event_identity / content Seal (§4.15)
  const labelIds = claimLabelIds(ctx, claim);
  const scopeState = claimScopeState(ctx, claim) ?? 'inferred';
  if (labelIds.length === 0) return;
  ctx.store.indexUpsert({
    ref_id: claim.claim_id,
    ref_type: 'claim',
    realm_id: ctx.realmId,
    label_ids: labelIds,
    sensitivity: claim.sensitivity,
    scope_state: scopeState,
    norm_text: norm(statement),
  });
}

function claimLabelIds(ctx: RealmContext, claim: Claim): string[] {
  const ids = new Set<string>();
  for (const eid of claim.evidence_event_identities) {
    const e = ctx.store.findEventByIdentity(ctx.realmId, eid);
    if (!e) continue;
    for (const a of ctx.store.listAssignmentsForTarget('event', e.event_id)) a.label_ids.forEach((l) => ids.add(l));
  }
  // Fallback for an evidence-less claim (a promoted import, ADR-0007): use the
  // claim's OWN explicit_user scope Assignment. No-op for evidence-backed claims —
  // they already resolve labels from their evidence above.
  if (ids.size === 0) {
    for (const a of ctx.store.listAssignmentsForTarget('claim', claim.claim_id)) a.label_ids.forEach((l) => ids.add(l));
  }
  return [...ids];
}

function claimScopeState(ctx: RealmContext, claim: Claim): ClassificationState | null {
  const states: ClassificationState[] = [];
  for (const eid of claim.evidence_event_identities) {
    const e = ctx.store.findEventByIdentity(ctx.realmId, eid);
    if (!e) continue;
    for (const a of ctx.store.listAssignmentsForTarget('event', e.event_id)) states.push(a.classification_state);
  }
  if (states.length === 0) {
    for (const a of ctx.store.listAssignmentsForTarget('claim', claim.claim_id)) states.push(a.classification_state);
  }
  return bestClassificationState(states);
}

export interface SearchResult {
  ref_id: string;
  ref_type: 'event' | 'claim';
  snippet: string;
  sensitivity: string;
}

export interface SearchOptions {
  /** Active scope labels. REQUIRED for any result: search fails closed — an
   *  empty/absent set excludes everything, so out-of-scope items can never leak
   *  (G4/FR-042). The CLI Silences when active scope is unresolved. */
  activeLabelIds?: string[];
  /** Audience for the search egress gate. Defaults to local ai_tool; remote
   *  output renderers must pass remote_ai_processing (ADR-0011 §5a). */
  audience?: Audience;
  limit?: number;
}

export interface QuestionSearchResult {
  results: SearchResult[];
  queries: string[];
}

/** Run exact ∪ n-gram search, filtered to classified / non-secret / in-scope. */
export function searchRealm(ctx: RealmContext, query: string, opts: SearchOptions = {}): SearchResult[] {
  const nq = norm(query);
  if (!nq) return [];
  const limit = opts.limit ?? 20;
  const audience = opts.audience ?? 'ai_tool';
  const seen = new Set<string>();
  const merged: IndexHit[] = [];
  for (const hit of [...ctx.store.searchExact(ctx.realmId, nq), ...ctx.store.searchFts(ctx.realmId, nq)]) {
    if (seen.has(hit.ref_id)) continue;
    seen.add(hit.ref_id);
    merged.push(hit);
  }

  // Fail closed: a missing/empty active scope matches nothing (no Realm-wide fallback).
  const active = new Set(opts.activeLabelIds ?? []);
  const out: SearchResult[] = [];
  for (const hit of merged) {
    // Defense in depth: never surface secret/unknown/confidential or unclassified.
    // Confidential is excluded on every search/MCP egress surface (Specification §4);
    // the context.md Gate adjudicates confidential separately (one-shot confirm).
    if (hit.sensitivity === 'secret' || hit.sensitivity === 'unknown' || hit.sensitivity === 'confidential') continue;
    const sensitivityState = hitSensitivityState(ctx, hit);
    if (!sensitivityState || !allowedSensitivityState(sensitivityState, audience, 'standard')) continue;
    if (!allowedScopeState(hit.scope_state as ClassificationState, audience, 'standard')) continue;
    if (hit.scope_state === 'conflicted') continue;
    // Query-time Seal gate (defense in depth; also covers the MCP egress surface and
    // any stale index entry that predates a Seal — e.g. before a deterministic rebuild).
    if (matchesActivePatternSeal(ctx, hit.norm_text)) continue;
    if (hitIsSealed(ctx, hit)) continue;
    const labels: string[] = JSON.parse(hit.label_ids);
    if (hit.ref_type === 'claim') {
      if (!activeScopeContainsAll(labels, opts.activeLabelIds ?? [])) continue;
    } else if (!labels.some((l) => active.has(l))) continue; // event seed path keeps some() matching
    out.push({
      ref_id: hit.ref_id,
      ref_type: hit.ref_type,
      snippet: snippet(hit.norm_text, nq),
      sensitivity: hit.sensitivity,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Natural-language `ask` / `chat` retrieval helper. It preserves the hard safety
 * contract of searchRealm (same Gate/scope filters, no model call before retrieval)
 * but fixes the CLI ergonomics: if the full question misses, retry with concrete
 * code-like / alphanumeric terms embedded in the question (e.g. Japanese prose
 * around `redaction` or `better-sqlite3`).
 */
export function searchRealmForQuestion(ctx: RealmContext, query: string, opts: SearchOptions = {}): QuestionSearchResult {
  const limit = opts.limit ?? 20;
  const queries = queryCandidates(query);
  const first = searchRealm(ctx, queries[0] ?? query, { ...opts, limit });
  if (first.length > 0 || queries.length <= 1) return { results: first, queries: queries.slice(0, 1) };

  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  const used = [queries[0]!];
  for (const candidate of queries.slice(1)) {
    used.push(candidate);
    for (const result of searchRealm(ctx, candidate, { ...opts, limit })) {
      if (seen.has(result.ref_id)) continue;
      seen.add(result.ref_id);
      merged.push(result);
      if (merged.length >= limit) return { results: merged, queries: used };
    }
    if (merged.length > 0) return { results: merged, queries: used };
  }
  return { results: [], queries: used };
}

export function queryCandidates(query: string): string[] {
  const out: string[] = [];
  const add = (value: string | undefined): void => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const normalized = trimmed.replace(/^['"`]+|['"`]+$/g, '');
    if (!normalized) return;
    if (!out.some((v) => norm(v) === norm(normalized))) out.push(normalized);
  };

  add(query);
  for (const quoted of query.matchAll(/[`"'“”‘’]([^`"'“”‘’]{2,})[`"'“”‘’]/g)) add(quoted[1]);
  for (const term of query.match(/[A-Za-z0-9][A-Za-z0-9._:/@+-]{2,}/g) ?? []) {
    if (!STOP_WORDS.has(term.toLowerCase())) add(term);
  }
  return out;
}

const STOP_WORDS = new Set([
  'about',
  'what',
  'which',
  'where',
  'when',
  'who',
  'why',
  'how',
  'the',
  'and',
  'for',
  'with',
  'you',
  'your',
  'are',
  'is',
  'was',
  'were',
  'can',
  'could',
  'tell',
  'know',
  'please',
]);

/** Honor identity/content Seals at query time so a forgotten event or claim is
 *  never re-emitted via search/MCP, even from an index row that predates the Seal. */
function hitIsSealed(ctx: RealmContext, hit: IndexHit): boolean {
  if (hit.ref_type === 'event') {
    const ev = ctx.store.getEvent(hit.ref_id);
    return (
      !!ev &&
      ctx.store.activeSealRulesBySignature(ctx.realmId, eventSealSignature(ctx.realmKey, ev.event_identity)).length > 0
    );
  }
  const claim = ctx.store.getClaim(hit.ref_id);
  return !!claim && isClaimSuppressed(ctx, claim, readClaimStatement(ctx, claim));
}

function hitSensitivityState(ctx: RealmContext, hit: IndexHit): ClassificationState | null {
  if (hit.ref_type === 'event') return ctx.store.getEvent(hit.ref_id)?.sensitivity_classification_state ?? null;
  return ctx.store.getClaim(hit.ref_id)?.sensitivity_classification_state ?? null;
}

function snippet(text: string, q: string): string {
  const i = text.indexOf(q);
  if (i < 0) return text.slice(0, 80);
  const start = Math.max(0, i - 30);
  return (start > 0 ? '…' : '') + text.slice(start, start + 80) + (text.length > start + 80 ? '…' : '');
}

/** Deterministically rebuild the index from lower layers (NFR-006). */
export function rebuildIndex(ctx: RealmContext): { events: number; claims: number } {
  ctx.store.indexClear(ctx.realmId);
  let events = 0;
  let claims = 0;
  for (const e of ctx.store.listEvents(ctx.realmId)) {
    indexEvent(ctx, e);
    events += 1;
  }
  for (const c of ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')) {
    indexClaim(ctx, c);
    claims += 1;
  }
  return { events, claims };
}
