// Single source of truth for deriving a Claim's (labelIds, scopeState) from its
// evidence. Both the search/MCP/browse surfaces (search.ts) and the context.md exit
// (context-pack.ts) MUST resolve a claim's scope identically — otherwise a claim can be
// recallable on one surface and silently absent on the other.
//
// The ADR-0007 fallback is the reason this is shared: a user-promoted imported claim
// carries NO evidence events (evidence_event_identities: []); its scope lives only on
// the claim's OWN explicit_user Assignment. Without the fallback, context.md derived
// labelIds: [] and dropped the claim as out-of-scope while search still surfaced it.
import type { Claim, MemEvent } from '@core/schema/entities';
import type { ClassificationState } from '@core/schema/enums';
import type { RealmContext } from '@core/runtime';
import { bestClassificationState } from '@core/policy';

/** Derive a claim's scope (labelIds + best scopeState) from the assignments of its
 *  evidence events, falling back — per axis, independently — to the claim's OWN
 *  Assignment when the evidence walk yields nothing (ADR-0007 promoted import). For an
 *  ordinary evidence-backed claim both axes come from the evidence, so no fallback runs
 *  and behavior is unchanged. */
export function claimScope(
  ctx: RealmContext,
  claim: Claim,
): { labelIds: string[]; scopeState: ClassificationState | null } {
  const labelIds = new Set<string>();
  const states: ClassificationState[] = [];
  for (const eid of claim.evidence_event_identities) {
    const e: MemEvent | undefined = ctx.store.findEventByIdentity(ctx.realmId, eid);
    if (!e) continue;
    for (const a of ctx.store.listAssignmentsForTarget('event', e.event_id)) {
      a.label_ids.forEach((l) => labelIds.add(l));
      states.push(a.classification_state);
    }
  }
  if (labelIds.size === 0 || states.length === 0) {
    const own = ctx.store.listAssignmentsForTarget('claim', claim.claim_id);
    if (labelIds.size === 0) for (const a of own) a.label_ids.forEach((l) => labelIds.add(l));
    if (states.length === 0) for (const a of own) states.push(a.classification_state);
  }
  return { labelIds: [...labelIds], scopeState: bestClassificationState(states) };
}
