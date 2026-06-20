// consolidate — pass candidates through the validator and settle them as
// consolidated / conflicted / rejected (FR-030). Fully automatic: no review
// queue (OUT-006). Safety is enforced at the output Gate, not by withholding
// consolidation — high-risk Claims still consolidate (§4.7).
import type { RealmContext } from '@core/runtime';
import type { Claim } from '@core/schema/entities';
import { readClaimStatement } from './extractor';
import { initialReinforcement } from './lifecycle';
import { validateClaim } from './validator';

export interface ConsolidateOutcome {
  claim_id: string;
  status: Claim['status'];
  reasons: string[];
}

export function consolidateClaim(ctx: RealmContext, claim: Claim, now = new Date()): ConsolidateOutcome {
  if (claim.status !== 'candidate') {
    return { claim_id: claim.claim_id, status: claim.status, reasons: ['not_candidate'] };
  }
  const statement = readClaimStatement(ctx, claim);
  const result = validateClaim(ctx, claim, statement);

  const updated: Claim = {
    ...claim,
    status: result.decision,
    conflict_reason: result.decision === 'conflicted' ? (result.reasons[0] ?? 'conflict') : null,
    reinforcement_score:
      result.decision === 'consolidated' ? initialReinforcement(claim) : claim.reinforcement_score,
  };
  ctx.store.putClaim(updated);
  if (result.decision === 'consolidated') {
    ctx.chronicler.append('consolidate', claim.claim_id, now);
  }
  return { claim_id: claim.claim_id, status: result.decision, reasons: result.reasons };
}

/** Consolidate all candidate Claims in the Realm (used by the loop). */
export function consolidatePending(ctx: RealmContext, now = new Date()): ConsolidateOutcome[] {
  const candidates = ctx.store.listClaimsByStatus(ctx.realmId, 'candidate');
  return candidates.map((c) => consolidateClaim(ctx, c, now));
}
