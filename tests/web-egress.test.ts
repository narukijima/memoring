import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listMemoriesForView } from '@retrieval/browse';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import type { Claim, MemEvent } from '@core/schema/entities';
import type { Sensitivity } from '@core/schema/enums';
import { seedRealmFromFixture, type SeededRealm } from './seed';

const SCOPE = 'memoring-proj';
const PROJECT_ID = 'proj_test';
const SECRET = 'sk-web1234567890';

function putScopedClaim(
  seeded: SeededRealm,
  statement: string,
  labelIds: string[],
  sensitivity: Sensitivity = 'internal',
): Claim {
  const ctx = seeded.realm.ctx;
  const eventId = newId('event');
  const occurrenceId = newId('occurrence');
  const event: MemEvent = {
    event_id: eventId,
    event_identity: `evt_web_${eventId}`,
    realm_id: ctx.realmId,
    occurrence_ids: [occurrenceId],
    session_id: `ses_web_${eventId}`,
    turn_id: null,
    event_type: 'message',
    role: 'user',
    origin: 'user',
    created_at: '2026-01-01T00:00:00.000Z',
    source_timestamp: null,
    timestamp_confidence: 'capture_observed',
    sequence: 30_000,
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
  ctx.store.putEvent(event);
  ctx.store.putAssignment({
    assignment_id: newId('assignment'),
    realm_id: ctx.realmId,
    target_type: 'event',
    target_id: event.event_id,
    label_ids: labelIds,
    project_ids: [PROJECT_ID],
    classification_state: 'inferred',
    assigned_by: 'rule:path_git_remote',
    confidence: 0.9,
    evidence: [occurrenceId],
    created_by_derivation_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    schema_version: SCHEMA_VERSION.assignment,
  });

  const claimId = newId('claim');
  const claim: Claim = {
    claim_id: claimId,
    realm_id: ctx.realmId,
    kind: 'fact',
    statement_ref: ctx.objects.put(`${claimId}_stmt`, Buffer.from(statement, 'utf8')).ref,
    structured_predicate_ref: null,
    assignment_ids: [],
    project_ids: [PROJECT_ID],
    abstraction_level: 1,
    status: 'consolidated',
    conflict_reason: null,
    evidence_event_identities: [event.event_identity],
    evidence_occurrence_ids: [occurrenceId],
    created_by: 'user',
    created_by_derivation_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    last_recalled_at: null,
    valid_from: '2026-01-01T00:00:00.000Z',
    valid_until: null,
    supersedes: [],
    evidence_count: 1,
    reinforcement_score: 0,
    confidence: 0.95,
    sensitivity,
    sensitivity_classification_state: 'inferred',
    schema_version: SCHEMA_VERSION.claim,
  };
  ctx.store.putClaim(claim);
  return claim;
}

describe('web memory browser egress (human_local_view)', () => {
  let seeded: SeededRealm;

  beforeEach(async () => {
    seeded = await seedRealmFromFixture();
  });

  afterEach(() => seeded.restore());

  it('returns gated public/internal rows for a resolved scope', () => {
    const rows = listMemoriesForView(seeded.realm.ctx, { scope: SCOPE, project: PROJECT_ID });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.sensitivity === 'public' || row.sensitivity === 'internal')).toBe(true);
  });

  it('never returns a planted active-scope secret', () => {
    const activeLabelIds = resolveActiveLabelIds(seeded.realm.ctx, [PROJECT_ID], SCOPE);
    const secretClaim = putScopedClaim(seeded, `Web view must not leak ${SECRET}`, activeLabelIds, 'secret');

    const rows = listMemoriesForView(seeded.realm.ctx, { scope: SCOPE, project: PROJECT_ID });
    const serialized = JSON.stringify(rows);

    expect(rows.map((row) => row.claim_id)).not.toContain(secretClaim.claim_id);
    expect(serialized).not.toContain(SECRET);
  });

  it('never returns an out-of-active-scope claim', () => {
    const outside = putScopedClaim(seeded, 'Out-of-scope browser memory should stay hidden', ['lbl_web_outside_scope']);

    const rows = listMemoriesForView(seeded.realm.ctx, { scope: SCOPE, project: PROJECT_ID });

    expect(rows.map((row) => row.claim_id)).not.toContain(outside.claim_id);
    expect(rows.map((row) => row.statement)).not.toContain('Out-of-scope browser memory should stay hidden');
  });

  it('returns Silence for unresolved or absent scope', () => {
    expect(listMemoriesForView(seeded.realm.ctx, { scope: 'no-such-scope-label', project: PROJECT_ID })).toEqual([]);
    expect(listMemoriesForView(seeded.realm.ctx, { project: 'no-such-project' })).toEqual([]);
    expect(listMemoriesForView(seeded.realm.ctx, { project: PROJECT_ID })).toEqual([]);
    expect(listMemoriesForView(seeded.realm.ctx, { scope: SCOPE })).toEqual([]);
    expect(listMemoriesForView(seeded.realm.ctx, {})).toEqual([]);
  });
});
