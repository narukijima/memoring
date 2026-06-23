// One-hop associative proposal over existing Claim links. This is used only by
// buildContext, after seeds have already passed the output Gate.
import { activeScopeContainsAll, gate, type GateRequest } from '@core/policy';
import type { Claim } from '@core/schema/entities';
import type { RealmContext } from '@core/runtime';
import { readClaimStatement } from '@claim/extractor';
import { isClaimSuppressed } from '@claim/seal';
import { toGateItem, toScopedClaim, type ScopedClaim } from './context-pack';

function traversableEndpoint(ctx: RealmContext, claim: Claim): boolean {
  if (claim.status !== 'consolidated' && claim.status !== 'superseded' && claim.status !== 'conflicted') {
    return false;
  }
  if (claim.conflict_reason === 'forgotten') return false;
  return !isClaimSuppressed(ctx, claim, readClaimStatement(ctx, claim));
}

/** Reverse supersede index: predecessor claim_id -> ids of claims that supersede it.
 *  Built once per proposeNeighbors call so successor lookup is O(1) per seed instead
 *  of a full claim scan per seed (O(seeds x claims) on every context build). */
function buildSuccessorIndex(ctx: RealmContext): Map<string, string[]> {
  const successors = new Map<string, string[]>();
  for (const candidate of ctx.store.listClaims(ctx.realmId)) {
    for (const predecessorId of candidate.supersedes) {
      const arr = successors.get(predecessorId);
      if (arr) arr.push(candidate.claim_id);
      else successors.set(predecessorId, [candidate.claim_id]);
    }
  }
  return successors;
}

function linkedClaimIds(claim: Claim, successors: Map<string, string[]>): string[] {
  const ids = new Set<string>(claim.supersedes);
  for (const successorId of successors.get(claim.claim_id) ?? []) ids.add(successorId);
  ids.delete(claim.claim_id);
  return [...ids];
}

export function proposeNeighbors(ctx: RealmContext, seedClaims: ScopedClaim[], req: GateRequest): ScopedClaim[] {
  const seedIds = new Set(seedClaims.map((sc) => sc.claim.claim_id));
  const proposedIds = new Set<string>();
  const proposed: ScopedClaim[] = [];
  const neighborReq: GateRequest = { ...req, crossScopeAllowed: false };
  if (seedClaims.length === 0) return proposed;
  const successors = buildSuccessorIndex(ctx);

  for (const seed of seedClaims) {
    const from = ctx.store.getClaim(seed.claim.claim_id);
    if (!from || !traversableEndpoint(ctx, from)) continue;

    for (const neighborId of linkedClaimIds(from, successors)) {
      if (seedIds.has(neighborId) || proposedIds.has(neighborId)) continue;
      const neighbor = ctx.store.getClaim(neighborId);
      if (!neighbor || !traversableEndpoint(ctx, neighbor)) continue;

      const scoped = toScopedClaim(ctx, neighbor);
      if (!activeScopeContainsAll(scoped.labelIds, neighborReq.activeLabelIds)) continue;
      if (!gate(toGateItem(ctx, scoped), neighborReq).pass) continue;

      proposedIds.add(neighborId);
      proposed.push(scoped);
    }
  }

  return proposed;
}
