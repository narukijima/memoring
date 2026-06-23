import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { cmdClaim } from '../apps/cli/commands/claim';
import { openRealmLocal } from '@core/runtime';
import { deleteUndiluted, forgetByPattern, forgetClaim, redactEventById, releaseSealRule } from '@security/redaction';
import { validateClaim } from '@claim/validator';
import { readClaimStatement } from '@claim/extractor';
import { createSealRule, patternSealSignature } from '@claim/seal';
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

  it('rejects unsafe user regex Seal patterns before mutation', () => {
    const ctx = seeded.realm.ctx;
    const before = ctx.store.listSealRules(ctx.realmId).length;
    expect(() => forgetByPattern(ctx, '^(a+)+$')).toThrow(/Unsafe Seal pattern/);
    expect(() => forgetByPattern(ctx, '(')).toThrow(/Unsafe Seal pattern/);
    expect(ctx.store.listSealRules(ctx.realmId).length).toBe(before);
  });

  it('fails closed when an active stored pattern SealRule is undecidable', () => {
    const ctx = seeded.realm.ctx;
    const pref = consolidatedByKind('preference');
    createSealRule(ctx, 'pattern', patternSealSignature(ctx.realmKey, '('), new Date(), '(');

    const fresh: Claim = { ...pref, claim_id: 'clm_malformed_pattern', status: 'candidate' };
    const r = validateClaim(ctx, fresh, 'a clean statement still cannot bypass an undecidable SealRule');
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

  it('tombstones the ContextPack manifest reference when its claim is forgotten (§7.3 final step)', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    buildContext(ctx, { cwd: seeded.projectRoot, outPath: path.join('.memoring', 'context.md') });
    expect(ctx.store.listContextPacks(ctx.realmId).some((p) => p.evidence_ids.includes(decision.claim_id))).toBe(true);
    const tombsBefore = ctx.store.countTombstones(ctx.realmId);

    forgetClaim(ctx, decision.claim_id, { seal: true });

    expect(ctx.store.listContextPacks(ctx.realmId).some((p) => p.evidence_ids.includes(decision.claim_id))).toBe(false);
    expect(ctx.store.countTombstones(ctx.realmId)).toBeGreaterThan(tombsBefore);
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

  it('deleteUndiluted reports found=false for a missing id (honest not-found, no false success)', () => {
    const ctx = seeded.realm.ctx;
    expect(deleteUndiluted(ctx, 'und_does_not_exist', { seal: false }).found).toBe(false);
    const real = ctx.store.listEvents(ctx.realmId)[0]!;
    const occ = ctx.store.getOccurrence(real.occurrence_ids[0]!)!;
    expect(deleteUndiluted(ctx, occ.undiluted_id, { seal: false }).found).toBe(true);
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

describe('physical blob deletion (NFR-002 / §7.3 — delete is physical, not just deindexed)', () => {
  // Status flips, tombstones, and search-absence all pass even if `objects.delete`
  // silently no-op'd — leaving the recoverable AEAD payload on disk. Only a direct
  // store probe catches that, so these assertions guard the one invariant the
  // search-absence tests structurally cannot see (the 2026-06-23 audit gap).
  it('redactEventById physically removes the event text blob from the object store', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    const event = ctx.store.findEventByIdentity(ctx.realmId, decision.evidence_event_identities[0]!)!;
    const textRef = event.text_ref!;
    expect(textRef).toBeTruthy();
    // Precondition: the encrypted blob is readable on disk before redaction.
    expect(ctx.objects.exists(textRef)).toBe(true);
    expect(() => ctx.objects.get(textRef)).not.toThrow();

    redactEventById(ctx, event.event_id, { seal: false });

    // The recoverable payload must be physically gone, not merely excluded from
    // the index/output.
    expect(ctx.objects.exists(textRef)).toBe(false);
    expect(() => ctx.objects.get(textRef)).toThrow();
  });

  it('deleteUndiluted physically removes the Undiluted payload blob from the object store', () => {
    const ctx = seeded.realm.ctx;
    const anyEvent = ctx.store.listEvents(ctx.realmId)[0]!;
    const occ = ctx.store.getOccurrence(anyEvent.occurrence_ids[0]!)!;
    const payloadRef = ctx.store.getUndiluted(occ.undiluted_id)!.encrypted_payload_ref;
    expect(ctx.objects.exists(payloadRef)).toBe(true);

    expect(deleteUndiluted(ctx, occ.undiluted_id, { seal: true }).found).toBe(true);

    expect(ctx.objects.exists(payloadRef)).toBe(false);
    expect(() => ctx.objects.get(payloadRef)).toThrow();
  });
});

describe('claim correction safety', () => {
  it('escalates corrected statement text containing a secret and removes it from egress', async () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    const secret = `sk-proj-${'A'.repeat(48)}`;
    const prevHome = process.env.MEMORING_HOME;
    const prevPass = process.env.MEMORING_PASSPHRASE;

    ctx.flush();
    ctx.close(true);
    process.env.MEMORING_HOME = seeded.realm.root;
    process.env.MEMORING_PASSPHRASE = 'test-passphrase-1234';
    try {
      await expect(cmdClaim(['correct', decision.claim_id, 'token', secret])).resolves.toBe(0);
    } finally {
      if (prevHome === undefined) delete process.env.MEMORING_HOME;
      else process.env.MEMORING_HOME = prevHome;
      if (prevPass === undefined) delete process.env.MEMORING_PASSPHRASE;
      else process.env.MEMORING_PASSPHRASE = prevPass;
    }

    seeded.realm.ctx = openRealmLocal(seeded.realm.root);
    const reopened = seeded.realm.ctx;
    expect(reopened.store.getClaim(decision.claim_id)?.status).toBe('superseded');
    const replacement = reopened
      .store
      .listClaims(reopened.realmId)
      .find((c) => c.supersedes.includes(decision.claim_id));
    expect(replacement?.sensitivity).toBe('secret');
    expect(searchRealm(reopened, secret, { activeLabelIds: resolveActiveLabelIds(reopened, ['proj_test']) })).toEqual([]);

    const result = buildContext(reopened, { cwd: seeded.projectRoot, outPath: path.join('.memoring', 'context.md') });
    expect(result.kind).toBe('written');
    expect(fs.readFileSync(path.join(seeded.projectRoot, '.memoring', 'context.md'), 'utf8')).not.toContain(secret);
  });

  it('does not print a secret corrected claim statement in claim list stdout', async () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    const secret = `sk-list-${'B'.repeat(48)}`;
    const prevHome = process.env.MEMORING_HOME;
    const prevPass = process.env.MEMORING_PASSPHRASE;
    const logs: string[] = [];

    ctx.flush();
    ctx.close(true);
    process.env.MEMORING_HOME = seeded.realm.root;
    process.env.MEMORING_PASSPHRASE = 'test-passphrase-1234';
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    try {
      await expect(cmdClaim(['correct', decision.claim_id, 'token', secret])).resolves.toBe(0);
      logs.length = 0;
      await expect(cmdClaim(['list'])).resolves.toBe(0);
    } finally {
      logSpy.mockRestore();
      if (prevHome === undefined) delete process.env.MEMORING_HOME;
      else process.env.MEMORING_HOME = prevHome;
      if (prevPass === undefined) delete process.env.MEMORING_PASSPHRASE;
      else process.env.MEMORING_PASSPHRASE = prevPass;
    }

    const out = logs.join('\n');
    expect(out).toContain('[suppressed:secret]');
    expect(out).not.toContain(secret);
    seeded.realm.ctx = openRealmLocal(seeded.realm.root);
  });
});

describe('ContextPack provenance gate', () => {
  it('drops a consolidated claim if its current evidence origin cannot be evidence', () => {
    const ctx = seeded.realm.ctx;
    const template = consolidatedByKind('decision');
    const hostSummary = ctx.store.listEvents(ctx.realmId).find((e) => e.origin === 'host_summary');
    expect(hostSummary).toBeDefined();
    if (!hostSummary) return;
    const statementRef = ctx.objects.put('bad_host_summary_claim', Buffer.from('Host summary should not be current guidance', 'utf8')).ref;
    ctx.store.putClaim({
      ...template,
      claim_id: 'clm_bad_host_summary',
      kind: 'fact',
      statement_ref: statementRef,
      evidence_event_identities: [hostSummary.event_identity],
      evidence_occurrence_ids: hostSummary.occurrence_ids,
      evidence_count: 1,
      status: 'consolidated',
      sensitivity: 'internal',
      sensitivity_classification_state: 'inferred',
    });

    const result = buildContext(ctx, { cwd: seeded.projectRoot, outPath: path.join('.memoring', 'context.md') });
    expect(result.kind).toBe('written');
    const doc = fs.readFileSync(path.join(seeded.projectRoot, '.memoring', 'context.md'), 'utf8');
    expect(doc).not.toContain('clm_bad_host_summary');
    expect(doc).not.toContain('Host summary should not be current guidance');
  });

  it('records permissive confidential confirmation in the manifest policy', () => {
    const ctx = seeded.realm.ctx;
    const template = consolidatedByKind('decision');
    const statementRef = ctx.objects.put('confidential_claim', Buffer.from('Confirmed confidential memory', 'utf8')).ref;
    ctx.store.putClaim({
      ...template,
      claim_id: 'clm_confidential_confirmed',
      kind: 'fact',
      statement_ref: statementRef,
      sensitivity: 'confidential',
      sensitivity_classification_state: 'inferred',
      status: 'consolidated',
    });

    const result = buildContext(ctx, {
      cwd: seeded.projectRoot,
      outPath: path.join('.memoring', 'context.md'),
      aperture: 'permissive',
      confidentialConfirmed: true,
    });
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') return;
    const pack = ctx.store.listContextPacks(ctx.realmId).find((p) => p.context_pack_id === result.packId);
    expect(pack?.policy_applied).toContain('confidential_one_shot_confirmed');
    expect(pack?.policy_applied).not.toContain('no_confidential');
  });
});

describe('Open conflicts section (§3.4 not_conflicted_for_request)', () => {
  it('emits an otherwise-safe conflicted claim into Open conflicts, not normal recall', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    // The loop would mark this conflicted on counter-evidence; simulate that state.
    ctx.store.putClaim({ ...decision, status: 'conflicted', conflict_reason: 'counter_evidence' });

    const result = buildContext(ctx, { cwd: seeded.projectRoot, outPath: path.join('.memoring', 'context.md') });
    expect(result.kind).toBe('written');
    const doc = fs.readFileSync(path.join(seeded.projectRoot, '.memoring', 'context.md'), 'utf8');

    const conflictsSection = doc.slice(doc.indexOf('## Open conflicts'), doc.indexOf('## Citations'));
    expect(conflictsSection).toContain('(conflict — do not follow)'); // §9 is not actionable guidance
    expect(conflictsSection).toContain(decision.claim_id);

    // It must NOT leak into normal recall (Recent decisions).
    const decisionsSection = doc.slice(doc.indexOf('## Recent decisions'), doc.indexOf('## Relevant episodic'));
    expect(decisionsSection).not.toContain(decision.claim_id);
  });

  it('suppresses a near-duplicate (duplicate_candidate) — not even in Open conflicts (§1.5)', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    ctx.store.putClaim({ ...decision, status: 'conflicted', conflict_reason: 'duplicate_candidate' });

    const result = buildContext(ctx, { cwd: seeded.projectRoot, outPath: path.join('.memoring', 'context.md') });
    expect(result.kind).toBe('written');
    const doc = fs.readFileSync(path.join(seeded.projectRoot, '.memoring', 'context.md'), 'utf8');
    // A duplicate is a density-control suppression, not a real contradiction.
    expect(doc).not.toContain(decision.claim_id);
    expect(doc.slice(doc.indexOf('## Open conflicts'))).toContain('_None._');
  });

  it('fully drops a conflicted claim that also fails another Gate axis (e.g. out of scope)', () => {
    const ctx = seeded.realm.ctx;
    const decision = consolidatedByKind('decision');
    ctx.store.putClaim({ ...decision, status: 'conflicted', conflict_reason: 'counter_evidence' });

    // Build with an unknown --scope so active_scope_match also fails: the conflicted
    // claim must NOT appear even in Open conflicts (more than one Gate axis fails).
    const result = buildContext(ctx, {
      cwd: seeded.projectRoot,
      scope: 'no-such-scope-label',
      outPath: path.join('.memoring', 'context.md'),
    });
    expect(result.kind).toBe('written');
    const doc = fs.readFileSync(path.join(seeded.projectRoot, '.memoring', 'context.md'), 'utf8');
    expect(doc).not.toContain(decision.claim_id);
  });
});
