// Durable ranking signals. These are quality signals only; ranking.ts consumes
// them after Gate success, so they never loosen safety.
import { normalizeLabel } from '@core/label-normalize';
import { hmacHex } from '@security/crypto-primitives';
import type { RealmContext } from '@core/runtime';

export function distinctQueryCountMetaKey(claimId: string): string {
  return `claim_rank_distinct_queries:${claimId}`;
}

export function distinctDayCountMetaKey(claimId: string): string {
  return `claim_rank_distinct_days:${claimId}`;
}

export function correctionCountMetaKey(claimId: string): string {
  return `claim_correction_count:${claimId}`;
}

function readSet(ctx: RealmContext, key: string): Set<string> {
  const raw = ctx.store.getMeta(key);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeSet(ctx: RealmContext, key: string, values: Set<string>): void {
  ctx.store.setMeta(key, JSON.stringify([...values].sort()));
}

export function getDistinctQueryCount(ctx: RealmContext, claimId: string): number {
  return readSet(ctx, distinctQueryCountMetaKey(claimId)).size;
}

export function getDistinctDayCount(ctx: RealmContext, claimId: string): number {
  return readSet(ctx, distinctDayCountMetaKey(claimId)).size;
}

export function recordRankingQuery(ctx: RealmContext, claimId: string, query: string): void {
  const normalized = normalizeLabel(query);
  if (!normalized) return;
  const key = distinctQueryCountMetaKey(claimId);
  const values = readSet(ctx, key);
  values.add(hmacHex(ctx.realmKey, normalized));
  writeSet(ctx, key, values);
}

export function recordRankingSurface(ctx: RealmContext, claimId: string, now: Date): void {
  const key = distinctDayCountMetaKey(claimId);
  const values = readSet(ctx, key);
  values.add(now.toISOString().slice(0, 10));
  writeSet(ctx, key, values);
}

export function getCorrectionCount(ctx: RealmContext, claimId: string): number {
  const raw = ctx.store.getMeta(correctionCountMetaKey(claimId));
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function incrementCorrectionCount(ctx: RealmContext, claimId: string): void {
  ctx.store.setMeta(correctionCountMetaKey(claimId), String(getCorrectionCount(ctx, claimId) + 1));
}
