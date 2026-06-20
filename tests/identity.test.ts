import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';

const realmKey = randomBytes(32);
const otherKey = randomBytes(32);

describe('event_identity stability (G11 / CON-012)', () => {
  const src = sourceIdentity(realmKey, 'claude_code', 'session-uuid-1');
  const ses = sessionIdentity(realmKey, src, 'host-session-1');

  it('is stable across reprocess: same message_id → same identity regardless of text/blob', () => {
    const a = eventIdentity(realmKey, src, ses, 'msg-1', 'original text');
    const b = eventIdentity(realmKey, src, ses, 'msg-1', 'DIFFERENT text after reparse');
    expect(a).toBe(b); // depends on message_id, not blob/text granularity
  });

  it('falls back to a content anchor when there is no message_id (stable per content)', () => {
    const a = eventIdentity(realmKey, src, ses, null, 'same content');
    const b = eventIdentity(realmKey, src, ses, null, 'same content');
    expect(a).toBe(b);
    const c = eventIdentity(realmKey, src, ses, null, 'other content');
    expect(c).not.toBe(a);
  });

  it('does not collide across Realms (keyed by realm_key)', () => {
    const a = eventIdentity(realmKey, src, ses, 'msg-1', 't');
    const srcOther = sourceIdentity(otherKey, 'claude_code', 'session-uuid-1');
    const sesOther = sessionIdentity(otherKey, srcOther, 'host-session-1');
    const b = eventIdentity(otherKey, srcOther, sesOther, 'msg-1', 't');
    expect(a).not.toBe(b);
  });

  it('never exposes plaintext (opaque hmac form)', () => {
    const a = eventIdentity(realmKey, src, ses, 'msg-1', 'secret content here');
    expect(a.startsWith('hmac-sha256:')).toBe(true);
    expect(a).not.toContain('secret content');
  });
});
