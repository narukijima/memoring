import { describe, expect, it } from 'vitest';
import { openRealm } from '@core/runtime';
import { makeTempRealm } from './helpers';

describe('encrypted DB durability', () => {
  it('rejects a second live opener so a stale snapshot cannot overwrite a Seal', () => {
    const realm = makeTempRealm();
    try {
      expect(() => openRealm('test-passphrase-1234', realm.root)).toThrow(/already open/);

      realm.ctx.flush();
      realm.ctx.close(true);

      const reopened = openRealm('test-passphrase-1234', realm.root);
      try {
        expect(reopened.realmId).toBe(realm.ctx.realmId);
      } finally {
        reopened.close(false);
      }
    } finally {
      realm.cleanup();
    }
  });
});
