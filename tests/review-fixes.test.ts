// Regression tests for the multi-reviewer audit fixes (F1–F12). Each test pins a
// specific bug the review found so it cannot silently regress.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import { abstractEvents } from '@claim/extractor';
import { runSecretScan } from '@security/secret-scan';
import { forgetClaim, redactEventById } from '@security/redaction';
import { createSealRule, eventSealSignature } from '@claim/seal';
import { rebuildIndex, searchRealm } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { openRealmLocal } from '@core/runtime';
import {
  createKeyMaterial,
  createLocalKeyMaterial,
  rekeyPassphrase,
  unlockWithPassphrase,
  unlockWithRecovery,
  upgradeLocalToPassphrase,
  WrongCredentialError,
} from '@security/key-lifecycle';
import { parseFlags } from '../apps/cli/args';
import type { AbstractCandidate, AbstractInput, MemoryProvider } from '@claim/provider';
import type { Claim, MemEvent } from '@core/schema/entities';
import type { ClassificationState, Origin, Sensitivity } from '@core/schema/enums';
import { makeTempRealm, type TempRealm } from './helpers';
import { seedRealmFromFixture, type SeededRealm } from './seed';

function putEvent(
  ctx: TempRealm['ctx'],
  text: string,
  sensitivity: Sensitivity = 'internal',
  state: ClassificationState = 'inferred',
  origin: Origin = 'user',
): MemEvent {
  const src = sourceIdentity(ctx.realmKey, 'claude_code', 'src-1');
  const ses = sessionIdentity(ctx.realmKey, src, 'host-ses-1');
  const id = newId('event');
  const ref = ctx.objects.put(`${id}_txt`, Buffer.from(text, 'utf8')).ref;
  const e: MemEvent = {
    event_id: id,
    event_identity: eventIdentity(ctx.realmKey, src, ses, id, text),
    realm_id: ctx.realmId,
    occurrence_ids: [newId('occurrence')],
    session_id: 'ses_x',
    turn_id: null,
    event_type: 'message',
    role: 'user',
    origin,
    created_at: new Date().toISOString(),
    source_timestamp: null,
    timestamp_confidence: 'capture_observed',
    sequence: 1,
    text_ref: ref,
    source_extra_ref: null,
    sensitivity,
    sensitivity_classification_state: state,
    context_injected: false,
    context_pack_digest: null,
    parser_version: 'test.v1',
    status: 'active',
    schema_version: SCHEMA_VERSION.event,
  };
  ctx.store.putEvent(e);
  return e;
}

/** Give an event the scope assignment + passed secret scan a classified event
 *  always carries in production, so it clears the remote pre-egress scope/scan
 *  floor (the suppression check under test is then the only thing that can drop it). */
function egressReady(ctx: TempRealm['ctx'], event: MemEvent): MemEvent {
  ctx.store.putAssignment({
    assignment_id: newId('assignment'),
    realm_id: ctx.realmId,
    target_type: 'event',
    target_id: event.event_id,
    label_ids: [newId('label')],
    project_ids: ['proj_test'],
    classification_state: 'inferred',
    assigned_by: 'rule:path_git_remote',
    confidence: 0.9,
    evidence: event.occurrence_ids,
    created_by_derivation_id: null,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION.assignment,
  });
  ctx.store.putSecretScan(runSecretScan(event.event_id, 'clean text'));
  return event;
}

class RecordingProvider implements MemoryProvider {
  id = 'recording';
  name = 'recording';
  version = 'recording.v1';
  seen: string[] = [];
  constructor(public egress: 'local' | 'remote') {}
  abstract(inputs: AbstractInput[]): AbstractCandidate[] {
    this.seen.push(...inputs.map((i) => i.text));
    return [];
  }
}

class FixedProvider implements MemoryProvider {
  id = 'fixed';
  name = 'fixed';
  version = 'fixed.v1';
  egress = 'local' as const;
  constructor(private readonly cand: AbstractCandidate) {}
  abstract(): AbstractCandidate[] {
    return [this.cand];
  }
}

// ── F1: remote pre-egress gate honors Seals ────────────────────────────────────
describe('F1 — remote pre-egress gate withholds Sealed events', () => {
  let realm: TempRealm;
  beforeEach(() => (realm = makeTempRealm()));
  afterEach(() => realm.cleanup());

  it('a remote provider never receives a Sealed event_identity (forgotten content stays off-device)', async () => {
    const ctx = realm.ctx;
    const open = egressReady(ctx, putEvent(ctx, 'forward this one'));
    const sealed = egressReady(ctx, putEvent(ctx, 'this one was forgotten'));
    // Seal the second event_identity (what `forget` does to evidence events).
    createSealRule(ctx, 'event_identity', eventSealSignature(ctx.realmKey, sealed.event_identity));

    const remote = new RecordingProvider('remote');
    await abstractEvents(ctx, remote, [open, sealed]);
    expect(remote.seen).toEqual(['forward this one']); // sealed event withheld from egress
  });

  it('a redacted (inactive) event is also withheld from a remote provider', async () => {
    const ctx = realm.ctx;
    const ev = putEvent(ctx, 'redacted content');
    ctx.store.putEvent({ ...ev, status: 'redacted' });
    const remote = new RecordingProvider('remote');
    await abstractEvents(ctx, remote, [ctx.store.getEvent(ev.event_id)!]);
    expect(remote.seen).toEqual([]);
  });
});

// ── F2: forget(claim) removes evidence from search / MCP, durably ──────────────
describe('F2 — forgetClaim drops the forgotten content from search (durable across rebuild)', () => {
  let seeded: SeededRealm;
  beforeEach(async () => (seeded = await seedRealmFromFixture()));
  afterEach(() => seeded.restore());

  it('the forgotten claim AND its evidence event leave search, and stay gone after rebuild', () => {
    const ctx = seeded.realm.ctx;
    const active = resolveActiveLabelIds(ctx, ['proj_test']);
    const decision = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').find((c) => c.kind === 'decision')!;
    expect(searchRealm(ctx, 'better-sqlite3', { activeLabelIds: active }).length).toBeGreaterThan(0);

    forgetClaim(ctx, decision.claim_id, { seal: true }); // the plain `memoring forget <clm>` path

    expect(searchRealm(ctx, 'better-sqlite3', { activeLabelIds: active }).length).toBe(0);
    rebuildIndex(ctx); // deterministic rebuild must NOT resurface the sealed evidence
    expect(searchRealm(ctx, 'better-sqlite3', { activeLabelIds: active }).length).toBe(0);
  });
});

// ── F4: redaction repair uses the claim's OWN evidence bar ─────────────────────
describe('F4 — repairClaimsCiting demotes an inferred claim that drops below its bar', () => {
  let realm: TempRealm;
  beforeEach(() => (realm = makeTempRealm()));
  afterEach(() => realm.cleanup());

  it('an ai/inferred claim with 2 evidence redacts when one evidence event is redacted (bar=2, not 1)', () => {
    const ctx = realm.ctx;
    const ev1 = putEvent(ctx, 'inferred pattern A');
    const ev2 = putEvent(ctx, 'inferred pattern B');
    const stmtRef = ctx.objects.put('aiclaim_stmt', Buffer.from('uses tabs', 'utf8')).ref;
    const claim: Claim = {
      claim_id: newId('claim'),
      realm_id: ctx.realmId,
      kind: 'preference',
      statement_ref: stmtRef,
      structured_predicate_ref: null,
      assignment_ids: [],
      project_ids: [],
      abstraction_level: 4,
      status: 'consolidated',
      conflict_reason: null,
      evidence_event_identities: [ev1.event_identity, ev2.event_identity],
      evidence_occurrence_ids: [],
      created_by: 'ai', // inferred → ai_inferred_pattern bar (min_evidence 2)
      created_by_derivation_id: null,
      created_at: new Date().toISOString(),
      last_recalled_at: null,
      valid_from: new Date().toISOString(),
      valid_until: null,
      supersedes: [],
      evidence_count: 2,
      reinforcement_score: 0,
      confidence: 0.9,
      sensitivity: 'internal',
      sensitivity_classification_state: 'inferred',
      schema_version: SCHEMA_VERSION.claim,
    };
    ctx.store.putClaim(claim);

    redactEventById(ctx, ev1.event_id, { seal: false }); // one evidence event gone → 1 left
    // With the explicit bar (1) this stayed 'consolidated' and searchable; the ai
    // bar (2) correctly demotes it to redacted.
    expect(ctx.store.getClaim(claim.claim_id)?.status).toBe('redacted');
  });
});

// ── F6: forget clears the dedup key so re-derivation makes a fresh candidate ────
describe('F6 — a forgotten statement is not auto-merged back into the dead claim', () => {
  let realm: TempRealm;
  beforeEach(() => (realm = makeTempRealm()));
  afterEach(() => realm.cleanup());

  it('re-deriving a forgotten statement creates a fresh candidate, not a merge into the redacted claim', async () => {
    const ctx = realm.ctx;
    const provider = new FixedProvider({
      kind: 'constraint',
      statement: 'always run the linter',
      confidence: 0.9,
      mode: 'explicit',
      sourceIndex: 0,
    });
    const first = await abstractEvents(ctx, provider, [putEvent(ctx, 'always run the linter')]);
    expect(first.newCandidates).toHaveLength(1);

    forgetClaim(ctx, first.newCandidates[0]!.claim_id, { seal: true });

    // A NEW event with the same statement must NOT merge into the redacted claim.
    const second = await abstractEvents(ctx, provider, [putEvent(ctx, 'always run the linter')]);
    expect(second.merged).toBe(0);
    expect(second.newCandidates).toHaveLength(1);
    expect(second.newCandidates[0]!.claim_id).not.toBe(first.newCandidates[0]!.claim_id);
  });

  it('re-deriving a superseded statement records the temporal supersedes edge', async () => {
    const ctx = realm.ctx;
    const provider = new FixedProvider({
      kind: 'constraint',
      statement: 'always run the linter',
      confidence: 0.9,
      mode: 'explicit',
      sourceIndex: 0,
    });
    const first = await abstractEvents(ctx, provider, [putEvent(ctx, 'always run the linter')]);
    const old = first.newCandidates[0]!;
    ctx.store.putClaim({ ...old, status: 'superseded' });

    const second = await abstractEvents(ctx, provider, [putEvent(ctx, 'always run the linter again')]);

    expect(second.merged).toBe(0);
    expect(second.newCandidates).toHaveLength(1);
    expect(second.newCandidates[0]!.claim_id).not.toBe(old.claim_id);
    expect(second.newCandidates[0]!.supersedes).toEqual([old.claim_id]);
  });
});

// ── F9: KEK rotation preserves realm_key (identities/Seals survive) ────────────
describe('F9 — KEK rotation re-wraps the DEK without changing realm_key', () => {
  it('rekeyPassphrase: the new passphrase unlocks the SAME dek/realm_key; the old one fails', () => {
    const km = createKeyMaterial('old-passphrase-1');
    const rotated = rekeyPassphrase(km.bundle, 'old-passphrase-1', 'new-passphrase-2');

    const reopened = unlockWithPassphrase(rotated, 'new-passphrase-2');
    expect(reopened.realmKey.toString('hex')).toBe(km.keyring.realmKey.toString('hex'));
    expect(reopened.dek.toString('hex')).toBe(km.keyring.dek.toString('hex'));
    expect(() => unlockWithPassphrase(rotated, 'old-passphrase-1')).toThrow(WrongCredentialError);
    // The recovery path is untouched and still yields the same realm_key.
    expect(unlockWithRecovery(rotated, km.recoveryCode).realmKey.toString('hex')).toBe(
      km.keyring.realmKey.toString('hex'),
    );
  });

  it('rekeyPassphrase rejects a wrong current passphrase', () => {
    const km = createKeyMaterial('old-passphrase-1');
    expect(() => rekeyPassphrase(km.bundle, 'WRONG', 'new-passphrase-2')).toThrow(WrongCredentialError);
  });

  it('upgradeLocalToPassphrase: the passphrase AND issued recovery code both unlock the same realm_key', () => {
    const local = createLocalKeyMaterial();
    const { bundle, recoveryCode } = upgradeLocalToPassphrase(local.keyFile, 'fresh-passphrase-9');
    expect(unlockWithPassphrase(bundle, 'fresh-passphrase-9').realmKey.toString('hex')).toBe(
      local.keyring.realmKey.toString('hex'),
    );
    expect(unlockWithRecovery(bundle, recoveryCode).realmKey.toString('hex')).toBe(
      local.keyring.realmKey.toString('hex'),
    );
  });
});

// ── F10: vault format version is validated on open ─────────────────────────────
describe('F10 — a vault written by a newer format is refused', () => {
  it('opening a replica whose store_format_version is newer than supported throws', () => {
    const realm = makeTempRealm();
    const root = realm.root;
    try {
      realm.ctx.store.setMeta('store_format_version', '999');
      realm.ctx.flush();
      realm.ctx.close(true);
      expect(() => openRealmLocal(root)).toThrow(/newer/i);
    } finally {
      realm.cleanup();
    }
  });
});

// ── F12: the `--` end-of-flags terminator ──────────────────────────────────────
describe('F12 — parseFlags supports a `--` end-of-flags terminator', () => {
  it('everything after `--` is a positional, even if it starts with --', () => {
    const flags = parseFlags(['correct', 'clm_1', 'use', '--', '--prod', 'tabs not spaces']);
    expect(flags._).toEqual(['correct', 'clm_1', 'use', '--prod', 'tabs not spaces']);
  });

  it('still parses normal flags before the terminator', () => {
    const flags = parseFlags(['--scope', 'work', '--', 'a', 'b']);
    expect(flags.scope).toBe('work');
    expect(flags._).toEqual(['a', 'b']);
  });
});
