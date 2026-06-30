// Ranking is quality adjustment only. This module refuses to score anything
// until the output Gate has passed (Gate First).
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { gate, type GateItem, type GateRequest } from '@core/policy';
import { getRecallCount } from '@claim/recall';
import { getCorrectionCount, getDistinctDayCount, getDistinctQueryCount } from './ranking-signals';
import type { RankingMetadata, Claim } from '@core/schema/entities';
import type { RealmContext } from '@core/runtime';

function computeScore(
  metadata: Omit<RankingMetadata, 'ranking_metadata_id' | 'created_at' | 'schema_version' | 'score'>,
): number {
  const positive =
    0.45 * saturate(metadata.recall_count) +
    0.2 * saturate(metadata.distinct_query_count) +
    0.15 * saturate(metadata.distinct_day_count);
  const negative =
    0.12 * saturate(metadata.correction_count) +
    0.18 * saturate(metadata.conflict_count) +
    (metadata.stale_signal ? 0.2 : 0);
  return clamp01(0.5 + positive - negative);
}

function saturate(n: number): number {
  return n / (n + 5);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function rankingMetadataAfterGate(
  ctx: RealmContext,
  claim: Claim,
  item: GateItem,
  request: GateRequest,
  now = new Date(),
): RankingMetadata | undefined {
  if (!gate(item, request).pass) return undefined;
  const base = {
    realm_id: ctx.realmId,
    target_type: 'claim' as const,
    target_id: claim.claim_id,
    recall_count: getRecallCount(ctx, claim.claim_id),
    distinct_query_count: getDistinctQueryCount(ctx, claim.claim_id),
    distinct_day_count: getDistinctDayCount(ctx, claim.claim_id),
    correction_count: getCorrectionCount(ctx, claim.claim_id),
    conflict_count: claim.status === 'conflicted' || claim.conflict_reason ? 1 : 0,
    stale_signal: claim.status === 'superseded' || (claim.valid_until ? claim.valid_until < now.toISOString() : false),
    computed_after_gate: true as const,
  };
  const score = computeScore(base);
  return {
    ranking_metadata_id: newId('rankingMetadata', now.getTime()),
    ...base,
    score,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.rankingMetadata,
  };
}
