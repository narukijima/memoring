// validator — the referee (Basic Design §2.4). It verifies a Claim candidate
// through the chain: schema → evidence (incl. origin authority) → sensitivity /
// scope → policy → lifecycle / conflict → suppression. AI/rule output only
// proposes; authority lives here (CON-002). The exact auto-consolidate predicate
// is §4.7.
import type { RealmContext } from '@core/runtime';
import {
  CLAIM_KINDS,
  isIndependentEvidenceOrigin,
  maxSensitivityOf,
  type ClaimKind,
  type Origin,
  type Sensitivity,
} from '@core/schema/enums';
import { minEvidenceCount, tauConf, thresholdKey } from '@core/recipe';
import type { Claim, MemEvent } from '@core/schema/entities';
import { isClaimSuppressed } from './seal';

export interface ValidationResult {
  decision: 'consolidated' | 'rejected' | 'conflicted';
  reasons: string[];
}

/** Kinds that require at least one user-origin evidence (CON-010 / §3.3.1). */
const REQUIRE_USER_ORIGIN: ReadonlySet<ClaimKind> = new Set(['constraint', 'decision', 'preference']);

function evidenceEvents(ctx: RealmContext, claim: Claim): MemEvent[] {
  const out: MemEvent[] = [];
  for (const eid of claim.evidence_event_identities) {
    const e = ctx.store.findEventByIdentity(ctx.realmId, eid);
    if (e) out.push(e);
  }
  return out;
}

/** independent evidence: events with an external-observation origin that are not
 * a context_injected assistant paraphrase (the latter never has an independent
 * origin anyway; checked for defense in depth). */
function independentEvidence(events: MemEvent[]): MemEvent[] {
  return events.filter((e) => {
    if (!isIndependentEvidenceOrigin(e.origin)) return false;
    if (e.context_injected && e.origin === 'assistant') return false;
    return true;
  });
}

export function validateClaim(ctx: RealmContext, claim: Claim, statement: string): ValidationResult {
  const reasons: string[] = [];

  // 1. schema validation
  if (!CLAIM_KINDS.includes(claim.kind)) return { decision: 'rejected', reasons: ['schema:bad_kind'] };
  if (!statement || statement.trim().length === 0) return { decision: 'rejected', reasons: ['schema:empty_statement'] };

  // 2. evidence validation (incl. origin authority)
  const events = evidenceEvents(ctx, claim);
  const independent = independentEvidence(events);
  const origins = new Set<Origin>(events.map((e) => e.origin));

  if (events.length === 0) return { decision: 'rejected', reasons: ['evidence:none'] };
  if (REQUIRE_USER_ORIGIN.has(claim.kind) && !origins.has('user')) {
    return { decision: 'rejected', reasons: [`evidence:${claim.kind}_requires_user_origin`] };
  }

  const userPinned = false;
  const mode = claim.created_by === 'rule' || claim.created_by === 'user' ? 'explicit' : 'inferred';
  const key = thresholdKey(claim.kind, mode, userPinned);
  const minEv = minEvidenceCount(key);
  if (independent.length < minEv) {
    return { decision: 'rejected', reasons: [`evidence:insufficient(${independent.length}/${minEv})`] };
  }

  // 3. confidence threshold
  const tau = tauConf(key);
  if (claim.confidence < tau) {
    return { decision: 'rejected', reasons: [`confidence:${claim.confidence}<${tau}`] };
  }

  // 4. sensitivity floor — claim inherits MAX sensitivity of its evidence (CON-015).
  const evidenceMax = maxSensitivityOf(events.map((e) => e.sensitivity) as Sensitivity[]);
  if (sensitivityRank(claim.sensitivity) < sensitivityRank(evidenceMax)) {
    return { decision: 'rejected', reasons: ['sensitivity:below_evidence_max'] };
  }

  // 5. provenance / Ouroboros: no self-generated context as evidence (CON-009/010).
  for (const e of events) {
    if (e.origin === 'host_memory' || e.origin === 'host_summary' || e.origin === 'system') {
      return { decision: 'rejected', reasons: ['provenance:non_evidence_origin'] };
    }
  }

  // 6. suppression check (Seal does not revive, §4.15).
  if (isClaimSuppressed(ctx, claim, statement)) {
    return { decision: 'rejected', reasons: ['suppressed:sealed'] };
  }

  // 7. lifecycle / conflict — v0 has no automated contradiction detection yet.
  return { decision: 'consolidated', reasons };
}

// Local sensitivity ranking incl. unknown as the top (Silence) bound.
function sensitivityRank(s: Sensitivity): number {
  switch (s) {
    case 'public':
      return 0;
    case 'internal':
      return 1;
    case 'confidential':
      return 2;
    case 'secret':
      return 3;
    case 'unknown':
      return 4;
  }
}
