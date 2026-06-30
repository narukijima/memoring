// Recall accounting for gated current-guidance emission. This is a separate
// meta counter; it never mutates the lifecycle field named valid_recall_count
// (external re-confirmation only) and never creates evidence authority.
import type { RealmContext } from '@core/runtime';
import type { Claim } from '@core/schema/entities';
import { reinforcement } from './lifecycle';
import { recordRankingSurface } from '@retrieval/ranking-signals';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AGE_DECAY_DAYS = 365;

export function recallCountMetaKey(claimId: string): string {
  return `claim_recall_count:${claimId}`;
}

export function getRecallCount(ctx: RealmContext, claimId: string): number {
  const raw = ctx.store.getMeta(recallCountMetaKey(claimId));
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function setRecallCount(ctx: RealmContext, claimId: string, count: number): void {
  ctx.store.setMeta(recallCountMetaKey(claimId), String(count));
}

function ageDecay(claim: Claim, now: Date): number {
  const anchor = claim.last_recalled_at ?? claim.valid_from;
  const t = Date.parse(anchor);
  if (!Number.isFinite(t)) return 0;
  const days = Math.max(0, (now.getTime() - t) / MS_PER_DAY);
  return Math.min(1, days / AGE_DECAY_DAYS);
}

export function recomputeReinforcement(ctx: RealmContext, claim: Claim, now: Date): Claim {
  const score = reinforcement({
    current: claim.reinforcement_score,
    // The formula field is named after the original signal. The value here is
    // the separate current-guidance emission counter, not external
    // valid_recall_count.
    valid_recall_count: getRecallCount(ctx, claim.claim_id),
    user_pin: 0,
    independent_evidence_count: claim.evidence_count,
    correction_count: 0,
    conflict_count: 0,
    age_decay: ageDecay(claim, now),
  });
  const updated: Claim = {
    ...claim,
    last_recalled_at: now.toISOString(),
    reinforcement_score: score,
  };
  ctx.store.putClaim(updated);
  return updated;
}

export function recordRecall(ctx: RealmContext, claimIds: string[], now: Date): void {
  for (const claimId of new Set(claimIds)) {
    const claim = ctx.store.getClaim(claimId);
    if (!claim || claim.status === 'redacted' || claim.status === 'rejected') continue;
    setRecallCount(ctx, claimId, getRecallCount(ctx, claimId) + 1);
    recordRankingSurface(ctx, claimId, now);
    recomputeReinforcement(ctx, claim, now);
  }
}
