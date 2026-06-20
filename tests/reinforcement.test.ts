import { describe, expect, it } from 'vitest';
import { reinforcement, type ReinforcementSignals } from '@claim/lifecycle';

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
});
