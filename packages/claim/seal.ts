// Seal / SealRule (Detailed Design §4.15 / §7.3). Durable suppression: a Sealed
// target must not revive on reprocess / re-capture. Signatures are realm_key
// HMACs (rotation-invariant), so they keep matching across rekey. Creation and
// release are user-only (enforced at the CLI / caller).
import type { RealmContext } from '@core/runtime';
import { realmHmac } from '@security/crypto-primitives';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { normalizeLabel } from '@core/label-normalize';
import type { Claim, SealRule } from '@core/schema/entities';

export function eventSealSignature(realmKey: Buffer, eventIdentity: string): string {
  return realmHmac(realmKey, 'event', eventIdentity);
}
export function patternSealSignature(realmKey: Buffer, pattern: string): string {
  return realmHmac(realmKey, 'pattern', normalizeLabel(pattern));
}
export function contentSealSignature(realmKey: Buffer, kind: string, statement: string): string {
  return realmHmac(realmKey, 'content', kind, normalizeLabel(statement));
}

/** True if `text` matches any active pattern SealRule (regex source recovered
 *  from reason_ref). Enforces the `pattern` match_type at §4.15. */
export function matchesActivePatternSeal(ctx: RealmContext, text: string): boolean {
  for (const rule of ctx.store.listSealRules(ctx.realmId)) {
    if (!rule.active || rule.match_type !== 'pattern' || !rule.reason_ref) continue;
    try {
      if (new RegExp(rule.reason_ref, 'i').test(text)) return true;
    } catch {
      /* a malformed stored pattern never matches */
    }
  }
  return false;
}

/** A candidate matching an active SealRule must not proceed (suppression check). */
export function isClaimSuppressed(ctx: RealmContext, claim: Claim, statement: string): boolean {
  for (const eid of claim.evidence_event_identities) {
    const sig = eventSealSignature(ctx.realmKey, eid);
    if (ctx.store.activeSealRulesBySignature(ctx.realmId, sig).length > 0) return true;
  }
  const contentSig = contentSealSignature(ctx.realmKey, claim.kind, statement);
  if (ctx.store.activeSealRulesBySignature(ctx.realmId, contentSig).length > 0) return true;
  if (matchesActivePatternSeal(ctx, statement)) return true; // pattern match_type (§4.15)
  return false;
}

export function createSealRule(
  ctx: RealmContext,
  matchType: SealRule['match_type'],
  targetSignature: string,
  now = new Date(),
  patternSource?: string,
): SealRule {
  const rule: SealRule = {
    suppression_id: newId('sealRule', now.getTime()),
    realm_id: ctx.realmId,
    match_type: matchType,
    target_signature: targetSignature,
    scope: 'Realm',
    scope_ref: null,
    // For pattern rules, reason_ref carries the recoverable regex source (the DB
    // is encrypted at rest, so this stays inside the key boundary).
    reason_ref: patternSource ?? null,
    created_by: 'user',
    active: true,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.sealRule,
  };
  ctx.store.putSealRule(rule);
  ctx.chronicler.append('seal', rule.suppression_id, now);
  return rule;
}
