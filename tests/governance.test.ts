import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { deleteUndiluted, forgetByPattern, forgetClaim, redactEventById, releaseSealRule } from '@security/redaction';
import { validateClaim } from '@claim/validator';
import { readClaimStatement } from '@claim/extractor';
import { rebuildIndex, searchRealm } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { buildContext } from '@retrieval/context-pack';
import type { Claim } from '@core/schema/entities';
import { seedRealmFromFixture, type SeededRealm } from './seed';

let seeded: SeededRealm;
beforeEach(async () => {
  seeded = await seedRealmFromFixture();
});
afterEach(() => seeded.restore());

function consolidatedByKind(kind: string): Claim {
  const ctx = seeded.realm.ctx;
  const c = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').find((x) => x.kind === kind);
  if (!c) throw new Error(`no consolidated ${kind} claim`);
  return c;
}

describe('forget / Seal durability (G10 / §4.15)', () => {
  it('forgetClaim redacts the claim and creates SealRules', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    expect(forgetClaim(ctx, decision.claim_id, { seal: true })).toBe(true);

    expect(ctx.store.getClaim(decision.claim_id)?.status).toBe('redacted');
    const rules = ctx.store.listSealRules(ctx.realmId);
    expect(rules.some((r) => r.match_type === 'content_signature')).toBe(true);
    expect(rules.some((r) => r.match_type === 'event_identity')).toBe(true);
  });

  it('a Sealed claim cannot re-consolidate (suppression check rejects it)', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    const statement = readClaimStatement(ctx, decision);
    forgetClaim(ctx, decision.claim_id, { seal: true });

    // A fresh candidate with identical content + evidence must be rejected.
    const fresh: Claim = { ...decision, claim_id: 'clm_fresh', status: 'candidate' };
    expect(validateClaim(ctx, fresh, statement).decision).toBe('rejected');
  });

  it('forget --pattern durably suppresses NEW matching statements (G10 / FR-072)', () => {
    const ctx = seeded.realm.ctx;
    const pref = consolidatedByKind('preference'); // reuse its (intact) user-origin evidence
    forgetByPattern(ctx, 'better-sqlite3');
    // A brand-new candidate whose statement matches the sealed pattern is suppressed,
    // even though its content/identity never existed at forget time.
    const fresh: Claim = { ...pref, claim_id: 'clm_new_match', status: 'candidate' };
    const r = validateClaim(ctx, fresh, 'we will use better-sqlite3 across the whole stack');
    expect(r.decision).toBe('rejected');
    expect(r.reasons).toContain('suppressed:sealed');
  });

  it('releasing the SealRule lets the same content validate again (user-only)', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    const statement = readClaimStatement(ctx, decision);
    forgetClaim(ctx, decision.claim_id, { seal: true });
    for (const r of ctx.store.listSealRules(ctx.realmId)) releaseSealRule(ctx, r.suppression_id);

    const fresh: Claim = { ...decision, claim_id: 'clm_fresh2', status: 'candidate' };
    expect(validateClaim(ctx, fresh, statement).decision).toBe('consolidated');
  });

  it('forgotten claims never appear in a later context build', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    forgetClaim(ctx, decision.claim_id, { seal: true });
    const out = path.join(seeded.projectRoot, '.memoring', 'context.md');
    const result = buildContext(ctx, { cwd: seeded.projectRoot, outPath: path.join('.memoring', 'context.md') });
    expect(result.kind).toBe('written');
    const doc = fs.readFileSync(out, 'utf8');
    expect(doc).not.toContain('better-sqlite3');
  });
});

describe('delete / redact cascade (G10 / §7.3)', () => {
  it('redacting an evidence event cascades the dependent claim to redacted', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    const evId = decision.evidence_event_identities[0]!;
    const event = ctx.store.findEventByIdentity(ctx.realmId, evId)!;

    const occId = decision.evidence_occurrence_ids[0]!;
    const active = resolveActiveLabelIds(ctx, ['proj_test']);
    expect(redactEventById(ctx, event.event_id, { seal: false })).toBe(true);
    expect(ctx.store.getEvent(event.event_id)?.status).toBe('redacted');
    expect(ctx.store.getEvent(event.event_id)?.text_ref).toBe(null);
    // event_identity is preserved for traversal (G11).
    expect(ctx.store.getEvent(event.event_id)?.event_identity).toBe(evId);
    // dependent claim repaired → redacted (evidence dropped below minimum).
    expect(ctx.store.getClaim(decision.claim_id)?.status).toBe('redacted');
    // index no longer surfaces it (search in-scope).
    expect(searchRealm(ctx, 'better-sqlite3', { activeLabelIds: active }).length).toBe(0);
    // The Occurrence was NOT tombstoned (only the Event redacted), so its
    // occurrence_id is retained on the claim — no over-prune (FR-068 regression guard).
    expect(ctx.store.getClaim(decision.claim_id)?.evidence_occurrence_ids).toContain(occId);
  });

  it('forget --pattern removes matching content from search/index, durably (G10/FR-072)', () => {
    const ctx = seeded.realm.ctx;
    const active = resolveActiveLabelIds(ctx, ['proj_test']);
    expect(searchRealm(ctx, 'better-sqlite3', { activeLabelIds: active }).length).toBeGreaterThan(0);
    forgetByPattern(ctx, 'better-sqlite3');
    // Both the claim and the underlying event are gone from search (derived/output
    // suppression), and a deterministic rebuild does not re-surface them.
    expect(searchRealm(ctx, 'better-sqlite3', { activeLabelIds: active }).length).toBe(0);
    rebuildIndex(ctx);
    expect(searchRealm(ctx, 'better-sqlite3', { activeLabelIds: active }).length).toBe(0);
  });

  it('deleting the Undiluted cascades to all events and claims', () => {
    const ctx = seeded.realm.ctx;
    const anyEvent = ctx.store.listEvents(ctx.realmId)[0]!;
    const occ = ctx.store.getOccurrence(anyEvent.occurrence_ids[0]!)!;
    const res = deleteUndiluted(ctx, occ.undiluted_id, { seal: true });
    expect(res.events).toBeGreaterThan(0);
    // All consolidated claims are now gone (their evidence was redacted).
    expect(ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').length).toBe(0);
    expect(ctx.store.getUndiluted(occ.undiluted_id)?.status).toBe('deleted');
    expect(ctx.store.countTombstones(ctx.realmId)).toBeGreaterThan(0);
  });

  it('prunes tombstoned occurrence_ids from Claim.evidence_occurrence_ids (FR-068)', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    const occId = decision.evidence_occurrence_ids[0]!;
    const occ = ctx.store.getOccurrence(occId)!;
    deleteUndiluted(ctx, occ.undiluted_id, { seal: false });
    const after = ctx.store.getClaim(decision.claim_id)!;
    expect(after.evidence_occurrence_ids).not.toContain(occId);
  });
});
