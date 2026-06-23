import { describe, expect, it } from 'vitest';
import { reinforcement, type ReinforcementSignals } from '@claim/lifecycle';
import { getRecallCount, recordRecall } from '@claim/recall';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import type { Claim } from '@core/schema/entities';
import { makeTempRealm } from './helpers';

const base: ReinforcementSignals = {
  current: 0.5,
  valid_recall_count: 0,
  user_pin: 0,
  independent_evidence_count: 0,
  correction_count: 0,
  conflict_count: 0,
  age_decay: 0,
};

describe('reinforcement invariant (§4.8 / CON-019)', () => {
  it('is bounded to [0,1]', () => {
    expect(reinforcement({ ...base, current: 1, user_pin: 1, independent_evidence_count: 100 })).toBeLessThanOrEqual(1);
    expect(reinforcement({ ...base, current: 0, conflict_count: 100 })).toBeGreaterThanOrEqual(0);
  });
  it('correction alone does not raise the score', () => {
    const before = reinforcement(base);
    const after = reinforcement({ ...base, correction_count: 1 });
    expect(after).toBeLessThanOrEqual(before);
  });
  it('conflict alone does not raise the score', () => {
    const before = reinforcement(base);
    const after = reinforcement({ ...base, conflict_count: 1 });
    expect(after).toBeLessThanOrEqual(before);
  });
  it('independent evidence raises the score (saturating)', () => {
    const e1 = reinforcement({ ...base, current: 0, independent_evidence_count: 1 });
    const e5 = reinforcement({ ...base, current: 0, independent_evidence_count: 5 });
    expect(e5).toBeGreaterThan(e1);
  });
  it('explicit external recall accounting drives monotonic reinforcement', () => {
    const realm = makeTempRealm();
    try {
      const claim: Claim = {
        claim_id: newId('claim'),
        realm_id: realm.ctx.realmId,
        kind: 'fact',
        statement_ref: 'objects/not-read',
        structured_predicate_ref: null,
        assignment_ids: [],
        project_ids: [],
        abstraction_level: 2,
        status: 'consolidated',
        conflict_reason: null,
        evidence_event_identities: [],
        evidence_occurrence_ids: [],
        created_by: 'rule',
        created_by_derivation_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
        last_recalled_at: null,
        valid_from: '2026-01-01T00:00:00.000Z',
        valid_until: null,
        supersedes: [],
        evidence_count: 1,
        reinforcement_score: 0,
        confidence: 0.9,
        sensitivity: 'internal',
        sensitivity_classification_state: 'inferred',
        schema_version: SCHEMA_VERSION.claim,
      };
      realm.ctx.store.putClaim(claim);

      recordRecall(realm.ctx, [claim.claim_id], new Date('2026-01-02T00:00:00.000Z'));
      const afterOne = realm.ctx.store.getClaim(claim.claim_id)!;
      recordRecall(realm.ctx, [claim.claim_id], new Date('2026-01-02T00:00:01.000Z'));
      const afterTwo = realm.ctx.store.getClaim(claim.claim_id)!;

      expect(getRecallCount(realm.ctx, claim.claim_id)).toBe(2);
      expect(afterTwo.reinforcement_score).toBeGreaterThan(afterOne.reinforcement_score);
      expect(afterTwo.reinforcement_score).toBeLessThanOrEqual(1);
      expect(afterTwo.last_recalled_at).toBe('2026-01-02T00:00:01.000Z');
    } finally {
      realm.cleanup();
    }
  });
});
