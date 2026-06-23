// Redaction / deletion cascade + Seal (Detailed Design §7.3 / §4.15, gate 10).
//
//   Undiluted delete → Occurrence tombstone → Event redact (drop text_ref, KEEP
//   event_identity for traversal) → remove from index → drop event_identity from
//   Claim.evidence → evidence-short Claim → redacted → tombstone.
//
// Seal adds a SealRule so the same content cannot revive on reprocess/re-capture
// (enforced at normalize and consolidation). delete is physical (object payload
// removed); redact excludes from derived/index/output. Creation/release of a
// SealRule is user-only.
import type { RealmContext } from '@core/runtime';
import { log } from '@core/log';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { isIndependentEvidenceOrigin, type ClaimKind } from '@core/schema/enums';
import { minEvidenceCount, thresholdKey } from '@core/recipe';
import { claimKeyMeta, readClaimStatement } from '@claim/extractor';
import {
  compileSealPattern,
  contentSealSignature,
  createSealRule,
  eventSealSignature,
  patternSealSignature,
} from '@claim/seal';
import type { Claim, MemEvent, Tombstone } from '@core/schema/entities';

function tombstone(ctx: RealmContext, deletedRef: string, range: string, now: Date): void {
  const t: Tombstone = {
    tombstone_id: newId('tombstone', now.getTime()),
    realm_id: ctx.realmId,
    deleted_ref: deletedRef,
    minimal_range: range,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.tombstone,
  };
  ctx.store.putTombstone(t);
}

/** Final cascade step (§7.3): drop a redacted Claim's id from any stored
 *  ContextPack manifest and tombstone the reference, so no manifest retains a
 *  dangling pointer to deleted content. */
function tombstoneClaimFromPacks(ctx: RealmContext, claimId: string, now: Date): void {
  for (const pack of ctx.store.listContextPacks(ctx.realmId)) {
    if (!pack.evidence_ids.includes(claimId)) continue;
    ctx.store.putContextPack({ ...pack, evidence_ids: pack.evidence_ids.filter((id) => id !== claimId) });
    tombstone(ctx, pack.context_pack_id, 'context_pack_evidence', now);
  }
}

/** Redact one Event: drop normalized text + object, keep event_identity, deindex. */
export function redactEvent(ctx: RealmContext, event: MemEvent, now = new Date()): void {
  if (event.text_ref) {
    try {
      ctx.objects.delete(event.text_ref);
    } catch (e) {
      // A failed unlink must not abort the cascade, but it must not be silent:
      // the recoverable AEAD payload may still be on disk (NFR-002). The ref is an
      // opaque id (no content), so it is safe to log (NFR-004).
      log.warn('redact:blob_delete_failed', { ref: event.text_ref, msg: (e as Error).message });
    }
  }
  const updated: MemEvent = { ...event, text_ref: null, status: 'redacted' };
  ctx.store.putEvent(updated);
  ctx.store.indexDelete(event.event_id);
  ctx.chronicler.append('redact', event.event_id, now);
}

/** After an evidence Event is gone, repair Claims that cited it. Also prunes any
 *  tombstoned occurrence_ids from the Claim's evidence_occurrence_ids (§7.3). */
function repairClaimsCiting(
  ctx: RealmContext,
  eventIdentity: string,
  prunedOccurrenceIds: Set<string>,
  now: Date,
): void {
  for (const claim of ctx.store.listClaimsCitingEvent(ctx.realmId, eventIdentity)) {
    const remaining = claim.evidence_event_identities.filter((e) => e !== eventIdentity);
    // Recount independent evidence among the events that still exist & are active.
    const independent = remaining.filter((eid) => {
      const e = ctx.store.findEventByIdentity(ctx.realmId, eid);
      return e && e.status === 'active' && isIndependentEvidenceOrigin(e.origin);
    }).length;
    // Use the claim's OWN evidence bar: an ai/inferred claim needs ai_inferred_pattern
    // (min 2), not the explicit bar (min 1). Hardcoding 'explicit' kept inferred claims
    // indexed/searchable with a single surviving evidence after redaction (they should
    // demote to redacted, matching what the validator would require).
    const mode = claim.created_by === 'ai' ? 'inferred' : 'explicit';
    const minEv = minEvidenceCount(thresholdKey(claim.kind as ClaimKind, mode));
    const updated: Claim = {
      ...claim,
      evidence_event_identities: remaining,
      evidence_occurrence_ids: claim.evidence_occurrence_ids.filter((oid) => !prunedOccurrenceIds.has(oid)),
      evidence_count: independent,
    };
    if (independent < minEv || remaining.length === 0) {
      updated.status = 'redacted';
      updated.conflict_reason = 'evidence_insufficient_after_redaction';
      ctx.store.indexDelete(claim.claim_id);
      tombstoneClaimFromPacks(ctx, claim.claim_id, now);
    }
    ctx.store.putClaim(updated);
  }
}

/** Redact a single Event by id, repair citing Claims, optionally Seal it. */
export function redactEventById(
  ctx: RealmContext,
  eventId: string,
  opts: { seal?: boolean } = {},
  now = new Date(),
): boolean {
  const event = ctx.store.getEvent(eventId);
  if (!event) return false;
  redactEvent(ctx, event, now);
  if (opts.seal) createSealRule(ctx, 'event_identity', eventSealSignature(ctx.realmKey, event.event_identity), now);
  // A single-event redact does NOT tombstone the (possibly shared) Occurrence, so
  // its occurrence_id stays valid for sibling events — prune nothing here. Only
  // an actual Occurrence tombstone (deleteUndiluted) prunes occurrence_ids (§7.3).
  repairClaimsCiting(ctx, event.event_identity, new Set(), now);
  ctx.audit('redact', { event_id: eventId, sealed: opts.seal === true }, now);
  return true;
}

/** Full Undiluted-delete cascade. seal=true makes affected events non-revivable. */
export function deleteUndiluted(
  ctx: RealmContext,
  undilutedId: string,
  opts: { seal?: boolean } = {},
  now = new Date(),
): { found: boolean; events: number; claims: number } {
  const u = ctx.store.getUndiluted(undilutedId);
  if (!u) return { found: false, events: 0, claims: 0 };

  try {
    ctx.objects.delete(u.encrypted_payload_ref);
  } catch (e) {
    // Surface, don't swallow: the recoverable payload may still be on disk
    // (NFR-002). The ref is an opaque id (no content) — safe to log (NFR-004).
    log.warn('delete:blob_delete_failed', { ref: u.encrypted_payload_ref, msg: (e as Error).message });
  }
  ctx.store.putUndiluted({ ...u, status: 'deleted' });
  tombstone(ctx, undilutedId, 'undiluted', now);

  let events = 0;
  const affectedIdentities: string[] = [];
  const tombstonedOccurrenceIds = new Set<string>();
  for (const occ of ctx.store.listOccurrencesByUndiluted(undilutedId)) {
    ctx.store.putOccurrence({ ...occ, status: 'tombstoned' });
    tombstone(ctx, occ.occurrence_id, 'occurrence', now);
    tombstonedOccurrenceIds.add(occ.occurrence_id);
    for (const ev of ctx.store.listEventsForOccurrence(ctx.realmId, occ.occurrence_id)) {
      redactEvent(ctx, ev, now);
      affectedIdentities.push(ev.event_identity);
      if (opts.seal) createSealRule(ctx, 'event_identity', eventSealSignature(ctx.realmKey, ev.event_identity), now);
      events += 1;
    }
  }
  const before = new Set<string>();
  for (const eid of affectedIdentities) {
    ctx.store.listClaimsCitingEvent(ctx.realmId, eid).forEach((c) => before.add(c.claim_id));
    repairClaimsCiting(ctx, eid, tombstonedOccurrenceIds, now);
  }
  ctx.chronicler.append('delete', undilutedId, now);
  ctx.audit('delete', { undiluted_id: undilutedId, events, claims: before.size, sealed: opts.seal === true }, now);
  return { found: true, events, claims: before.size };
}

/** forget a Claim: redact it and (by default) Seal it so it cannot revive. */
export function forgetClaim(
  ctx: RealmContext,
  claimId: string,
  opts: { seal?: boolean } = { seal: true },
  now = new Date(),
): boolean {
  const claim = ctx.store.getClaim(claimId);
  if (!claim) return false;
  const statement = readClaimStatement(ctx, claim);
  ctx.store.putClaim({ ...claim, status: 'redacted', conflict_reason: 'forgotten' });
  ctx.store.indexDelete(claimId);
  // Drop the dedup key so a later re-derivation produces a FRESH candidate that
  // re-enters validation (where the content Seal, if any, rejects it) instead of
  // silently auto-merging new evidence into this dead claim (§4.15 durability).
  ctx.store.deleteMeta(claimKeyMeta(ctx.realmKey, claim.kind, statement, claim.project_ids));
  tombstoneClaimFromPacks(ctx, claimId, now);
  ctx.chronicler.append('redact', claimId, now);
  if (opts.seal !== false) {
    createSealRule(ctx, 'content_signature', contentSealSignature(ctx.realmKey, claim.kind, statement), now);
    for (const eid of claim.evidence_event_identities) {
      createSealRule(ctx, 'event_identity', eventSealSignature(ctx.realmKey, eid), now);
      // Deindex the sealed evidence event so its raw text is not returned by
      // search / MCP before the next rebuild (the index/searchRealm Seal checks
      // keep it out durably; this drops the live row immediately).
      const ev = ctx.store.findEventByIdentity(ctx.realmId, eid);
      if (ev) ctx.store.indexDelete(ev.event_id);
    }
  }
  ctx.audit('redact', { claim_id: claimId, kind: claim.kind, sealed: opts.seal !== false }, now);
  return true;
}

/** forget --pattern: redact + Seal every Claim whose statement matches, and
 *  redact matching Events so the Sealed content is also removed from the index /
 *  search / egress (suppression covers derived/output, §4.15/§7.3) while the raw
 *  Undiluted persists. */
export function forgetByPattern(ctx: RealmContext, pattern: string, now = new Date()): number {
  const re = compileSealPattern(pattern);
  let count = 0;
  for (const claim of ctx.store.listClaims(ctx.realmId)) {
    if (claim.status === 'redacted' || claim.status === 'rejected') continue;
    const statement = readClaimStatement(ctx, claim);
    if (re.test(statement)) {
      forgetClaim(ctx, claim.claim_id, { seal: true }, now);
      count += 1;
    }
  }
  // Redact already-indexed Events whose text matches (drops text_ref + deindexes).
  let events = 0;
  for (const ev of ctx.store.listEvents(ctx.realmId)) {
    if (ev.status !== 'active' || !ev.text_ref) continue;
    let text: string;
    try {
      text = ctx.objects.get(ev.text_ref).toString('utf8');
    } catch {
      continue;
    }
    if (re.test(text)) {
      redactEvent(ctx, ev, now);
      repairClaimsCiting(ctx, ev.event_identity, new Set(), now);
      events += 1;
    }
  }
  // A pattern SealRule suppresses future matches that re-enter via reprocess.
  // The regex source is stored so isClaimSuppressed / normalize / index re-evaluate it.
  createSealRule(ctx, 'pattern', patternSealSignature(ctx.realmKey, pattern), now, pattern);
  ctx.audit('seal_pattern', { matched_claims: count, matched_events: events }, now);
  return count;
}

/** Release a SealRule (user-only; AI/policy never release). */
export function releaseSealRule(ctx: RealmContext, suppressionId: string, now = new Date()): boolean {
  const rule = ctx.store.getSealRule(suppressionId);
  if (!rule) return false;
  ctx.store.putSealRule({ ...rule, active: false });
  ctx.chronicler.append('seal', suppressionId, now);
  ctx.audit('seal_release', { suppression_id: suppressionId }, now);
  return true;
}
