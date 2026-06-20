import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import { validateClaim } from '@claim/validator';
import type { Claim, MemEvent } from '@core/schema/entities';
import type { ClaimKind, Origin, Sensitivity } from '@core/schema/enums';
import { makeTempRealm, type TempRealm } from './helpers';

let realm: TempRealm;
beforeEach(() => {
  realm = makeTempRealm();
});
afterEach(() => realm.cleanup());

function mkEvent(origin: Origin, text: string, sensitivity: Sensitivity = 'internal'): MemEvent {
  const ctx = realm.ctx;
  const src = sourceIdentity(ctx.realmKey, 'claude_code', 'src-1');
  const ses = sessionIdentity(ctx.realmKey, src, 'host-ses-1');
  const id = newId('event');
  const e: MemEvent = {
    event_id: id,
    event_identity: eventIdentity(ctx.realmKey, src, ses, id, text),
    realm_id: ctx.realmId,
    occurrence_ids: [newId('occurrence')],
    session_id: 'ses_x',
    turn_id: null,
    event_type: 'message',
    role: null,
    origin,
    created_at: new Date().toISOString(),
    source_timestamp: null,
    timestamp_confidence: 'capture_observed',
    sequence: 1,
    text_ref: null,
    source_extra_ref: null,
    sensitivity,
    sensitivity_classification_state: 'inferred',
    context_injected: false,
    context_pack_digest: null,
    parser_version: 'test.v1',
    status: 'active',
    schema_version: SCHEMA_VERSION.event,
  };
  ctx.store.putEvent(e);
  return e;
}

function mkClaim(kind: ClaimKind, evidence: MemEvent[], overrides: Partial<Claim> = {}): Claim {
  return {
    claim_id: newId('claim'),
    realm_id: realm.ctx.realmId,
    kind,
    statement_ref: 'objects/x',
    structured_predicate_ref: null,
    assignment_ids: [],
    project_ids: [],
    abstraction_level: 4,
    status: 'candidate',
    conflict_reason: null,
    evidence_event_identities: evidence.map((e) => e.event_identity),
    evidence_occurrence_ids: evidence.flatMap((e) => e.occurrence_ids),
    created_by: 'rule',
    created_by_derivation_id: null,
    created_at: new Date().toISOString(),
    last_recalled_at: null,
    valid_from: new Date().toISOString(),
    valid_until: null,
    supersedes: [],
    evidence_count: evidence.filter((e) => ['user', 'tool_result', 'command_result', 'file_diff', 'external_artifact'].includes(e.origin)).length,
    reinforcement_score: 0,
    confidence: 0.9,
    sensitivity: 'internal',
    sensitivity_classification_state: 'inferred',
    schema_version: SCHEMA_VERSION.claim,
    ...overrides,
  };
}

describe('evidence authority by origin (G8 / CON-010)', () => {
  it('accepts a constraint backed by a user-origin event', () => {
    const c = mkClaim('constraint', [mkEvent('user', 'never commit secrets')]);
    expect(validateClaim(realm.ctx, c, 'never commit secrets').decision).toBe('consolidated');
  });

  it('rejects a constraint backed only by assistant origin (not independent)', () => {
    const c = mkClaim('constraint', [mkEvent('assistant', 'the assistant said so')]);
    expect(validateClaim(realm.ctx, c, 'the assistant said so').decision).toBe('rejected');
  });

  it('rejects a claim grounded on host_memory (host-memory laundering closed)', () => {
    const c = mkClaim('preference', [mkEvent('host_memory', 'remembered from auto memory')]);
    expect(validateClaim(realm.ctx, c, 'remembered from auto memory').decision).toBe('rejected');
  });

  it('rejects a claim grounded on host_summary or system', () => {
    expect(validateClaim(realm.ctx, mkClaim('fact', [mkEvent('host_summary', 's')]), 's').decision).toBe('rejected');
    expect(validateClaim(realm.ctx, mkClaim('decision', [mkEvent('system', 'sys')]), 'sys').decision).toBe('rejected');
  });

  it('rejects any claim citing an unknown-origin event, even with sufficient independent evidence (§3.3.1)', () => {
    // The user event alone satisfies the evidence count and sensitivity floor, so
    // only the provenance gate (canonical non-evidence set, which includes
    // `unknown`) can reject this — pins that `unknown` is in that set.
    const c = mkClaim('fact', [mkEvent('user', 'we will use X', 'internal'), mkEvent('unknown', 'noise', 'public')], {
      sensitivity: 'internal',
    });
    expect(validateClaim(realm.ctx, c, 'we will use X').decision).toBe('rejected');
  });

  it('rejects a decision below the confidence threshold (τ_conf.decision = 0.85)', () => {
    const c = mkClaim('decision', [mkEvent('user', 'we decided')], { confidence: 0.8 });
    expect(validateClaim(realm.ctx, c, 'we decided').decision).toBe('rejected');
  });

  it('rejects when claim sensitivity is below the max sensitivity of its evidence (CON-015)', () => {
    const c = mkClaim('fact', [mkEvent('user', 'mixes a secret', 'secret')], { sensitivity: 'internal' });
    expect(validateClaim(realm.ctx, c, 'mixes a secret').decision).toBe('rejected');
  });

  it('rejects an evidence-less candidate (MCP add_memory_candidate can never consolidate, FR-081)', () => {
    const c = mkClaim('fact', [], { created_by: 'ai', evidence_count: 0 });
    expect(validateClaim(realm.ctx, c, 'injected via mcp').decision).toBe('rejected');
  });
});
