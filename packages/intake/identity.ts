// Stable identity derivation (Detailed Design §1.3.1 / CON-012). All keyed on
// realm_key (rotation-invariant), so identities are stable across reprocess /
// re-dedup / reconnect / restore / KEK rotation / DEK rekey, never collide
// across Realms, and never expose plaintext.
import { createHash } from 'node:crypto';
import { realmHmac } from '@security/crypto-primitives';

export function sourceIdentity(
  realmKey: Buffer,
  connectorId: string,
  sourceStableId: string,
  sourceAccountStableKey = '',
): string {
  return realmHmac(realmKey, connectorId, sourceStableId, sourceAccountStableKey);
}

export function sessionIdentity(realmKey: Buffer, srcIdentity: string, hostSessionStableId: string): string {
  return realmHmac(realmKey, srcIdentity, hostSessionStableId);
}

/** message_id if the source has a stable id, otherwise a content anchor. */
export function eventIdentity(
  realmKey: Buffer,
  srcIdentity: string,
  sesIdentity: string,
  messageId: string | null,
  text: string,
): string {
  const anchor = messageId ? `mid:${messageId}` : `anchor:${createHash('sha256').update(text).digest('hex')}`;
  return realmHmac(realmKey, srcIdentity, sesIdentity, anchor);
}
