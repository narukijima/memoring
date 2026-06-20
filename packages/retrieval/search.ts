// search — metadata filter / exact / FTS / n-gram (trigram) fallback / session
// reconstruction (FR-040..042, NFR-018). The index lives inside the encrypted DB
// (no plaintext index on disk). Index build happens only after Secret Scan;
// secret/unknown are never indexed (CON-007). Search candidates exclude
// unclassified and out-of-active-scope items.
import { CLASSIFIED_STATES, type ClassificationState } from '@core/schema/enums';
import { normalizeLabel } from '@core/label-normalize';
import { readClaimStatement } from '@claim/extractor';
import { matchesActivePatternSeal } from '@claim/seal';
import { bestClassificationState } from '@core/policy';
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
  if (scan && !scan.secret_scan_passed) return; // index build only after a passed scan
  let text: string;
  try {
    text = ctx.objects.get(event.text_ref).toString('utf8');
  } catch {
    return;
  }
  if (matchesActivePatternSeal(ctx, text)) return; // pattern Seal: do not advance to index (§4.15)
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
  return [...ids];
}

function claimScopeState(ctx: RealmContext, claim: Claim): ClassificationState | null {
  const states: ClassificationState[] = [];
  for (const eid of claim.evidence_event_identities) {
    const e = ctx.store.findEventByIdentity(ctx.realmId, eid);
    if (!e) continue;
    for (const a of ctx.store.listAssignmentsForTarget('event', e.event_id)) states.push(a.classification_state);
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
  limit?: number;
}

/** Run exact ∪ n-gram search, filtered to classified / non-secret / in-scope. */
export function searchRealm(ctx: RealmContext, query: string, opts: SearchOptions = {}): SearchResult[] {
  const nq = norm(query);
  if (!nq) return [];
  const limit = opts.limit ?? 20;
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
    // Defense in depth: never surface secret/unknown or unclassified.
    if (hit.sensitivity === 'secret' || hit.sensitivity === 'unknown') continue;
    if (!CLASSIFIED_STATES.has(hit.scope_state as ClassificationState)) continue;
    // Query-time pattern-Seal gate (defense in depth; also covers the MCP egress
    // surface and any stale index entry).
    if (matchesActivePatternSeal(ctx, hit.norm_text)) continue;
    const labels: string[] = JSON.parse(hit.label_ids);
    if (!labels.some((l) => active.has(l))) continue; // out-of-scope excluded (always enforced)
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
