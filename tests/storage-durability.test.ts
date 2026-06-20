import { describe, expect, it } from 'vitest';
import { openRealm } from '@core/runtime';
import { makeTempRealm } from './helpers';

describe('encrypted DB durability', () => {
  it('rejects a second live opener so a stale snapshot cannot overwrite a Seal', () => {
    const prev = process.env.MEMORING_LOCK_MAX_WAIT_MS;
    process.env.MEMORING_LOCK_MAX_WAIT_MS = '0'; // fail fast instead of waiting through the retry window
    const realm = makeTempRealm();
    try {
      expect(() => openRealm('test-passphrase-1234', realm.root)).toThrow(/already open/);

      realm.ctx.flush();
      realm.ctx.close(true);

      // After the holder releases the lock, the next open succeeds — this is the
      // basis for daemon (watch) + context build coexistence: the daemon holds
      // the lock only per tick, so a CLI command can interleave between ticks.
      const reopened = openRealm('test-passphrase-1234', realm.root);
      try {
        expect(reopened.realmId).toBe(realm.ctx.realmId);
      } finally {
        reopened.close(false);
      }
    } finally {
      realm.cleanup();
      if (prev === undefined) delete process.env.MEMORING_LOCK_MAX_WAIT_MS;
      else process.env.MEMORING_LOCK_MAX_WAIT_MS = prev;
    }
  });
});
