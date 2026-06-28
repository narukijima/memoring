// Key model: passwordless default (local key file) vs opt-in passphrase
// (envelope + recovery), and the mode-aware openActiveRealm dispatcher.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newId } from '@core/schema/ids';
import { replicaLayout, REPLICA_SUBDIRS } from '@core/paths';
import {
  attachRealm,
  isPassphraseMode,
  loadKeyBundle,
  openActiveRealm,
  openRealm,
  openRealmLocal,
} from '@core/runtime';
import { type RealmConfig, writeRealmConfig } from '@core/realm';
import {
  createKeyMaterial,
  createLocalKeyMaterial,
  rekeyFromRecovery,
  unlockWithPassphrase,
  unlockWithRecovery,
  WrongCredentialError,
} from '@security/key-lifecycle';
import { ensureDir, atomicWriteFile } from '@storage/fs-safety';

const PASS = 'correct-horse-battery-staple';
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function setupRealm(mode: 'local' | 'passphrase'): { root: string; realmId: string; recoveryCode?: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-key-'));
  roots.push(root);
  const layout = replicaLayout(root);
  ensureDir(layout.root, 0o700);
  for (const key of REPLICA_SUBDIRS) ensureDir(layout[key], 0o700);

  let recoveryCode: string | undefined;
  let keyring;
  if (mode === 'local') {
    const km = createLocalKeyMaterial();
    atomicWriteFile(layout.keyFile, JSON.stringify(km.keyFile), 0o600);
    keyring = km.keyring;
  } else {
    const km = createKeyMaterial(PASS);
    atomicWriteFile(layout.keyBundle, JSON.stringify(km.bundle), 0o600);
    keyring = km.keyring;
    recoveryCode = km.recoveryCode;
  }
  const config: RealmConfig = {
    schema: 'realm.v1',
    realm_id: newId('realm'),
    name: 'test',
    created_at: new Date().toISOString(),
    projects: [],
    connectors: [],
  };
  writeRealmConfig(layout.realmToml, config);
  const ctx = attachRealm(layout, config, keyring);
  ctx.store.setMeta('realm_id', config.realm_id);
  ctx.close(true);
  return { root, realmId: config.realm_id, recoveryCode };
}

describe('passwordless default mode', () => {
  it('opens with no passphrase via the local key file', () => {
    const { root, realmId } = setupRealm('local');
    expect(isPassphraseMode(root)).toBe(false);
    const ctx = openRealmLocal(root);
    try {
      expect(ctx.realmId).toBe(realmId);
    } finally {
      ctx.close(false);
    }
  });

  it('openActiveRealm never invokes the passphrase provider for a passwordless realm', async () => {
    const { root, realmId } = setupRealm('local');
    let prompted = false;
    const ctx = await openActiveRealm(root, async () => {
      prompted = true;
      return 'should-not-be-used';
    });
    try {
      expect(prompted).toBe(false);
      expect(ctx.realmId).toBe(realmId);
    } finally {
      ctx.close(false);
    }
  });

  it('refuses an ambiguous crash state where both key files exist', async () => {
    const { root } = setupRealm('local');
    const layout = replicaLayout(root);
    const km = createKeyMaterial(PASS);
    atomicWriteFile(layout.keyBundle, JSON.stringify(km.bundle), 0o600);
    let prompted = false;

    await expect(
      openActiveRealm(root, async () => {
        prompted = true;
        return PASS;
      }),
    ).rejects.toThrow(/Ambiguous Memoring key mode/);
    expect(prompted).toBe(false);
    expect(() => openRealmLocal(root)).toThrow(/Ambiguous Memoring key mode/);
  });
});

describe('opt-in passphrase mode', () => {
  it('is detected as passphrase mode and opens only with the correct passphrase', () => {
    const { root, realmId } = setupRealm('passphrase');
    expect(isPassphraseMode(root)).toBe(true);
    expect(() => openRealm('wrong-passphrase', root)).toThrow();
    const ctx = openRealm(PASS, root);
    try {
      expect(ctx.realmId).toBe(realmId);
    } finally {
      ctx.close(false);
    }
  });

  it('openActiveRealm prompts (via provider) and opens a passphrase realm', async () => {
    const { root, realmId } = setupRealm('passphrase');
    let prompted = false;
    const ctx = await openActiveRealm(root, async () => {
      prompted = true;
      return PASS;
    });
    try {
      expect(prompted).toBe(true);
      expect(ctx.realmId).toBe(realmId);
    } finally {
      ctx.close(false);
    }
  });

  it('the recovery code reaches the same realm key as the passphrase', () => {
    const { root, recoveryCode } = setupRealm('passphrase');
    const bundle = loadKeyBundle(replicaLayout(root));
    const viaPass = unlockWithPassphrase(bundle, PASS);
    const viaRecovery = unlockWithRecovery(bundle, recoveryCode!);
    try {
      expect(viaRecovery.realmKey.equals(viaPass.realmKey)).toBe(true);
      expect(viaRecovery.dekId).toBe(viaPass.dekId);
    } finally {
      viaPass.dispose();
      viaRecovery.dispose();
    }
  });

  it('rekey --recovery resets a lost passphrase via the recovery code, preserving realm_key', () => {
    const { root, recoveryCode } = setupRealm('passphrase');
    const bundle = loadKeyBundle(replicaLayout(root));
    const original = unlockWithPassphrase(bundle, PASS);

    const NEWPASS = 'a-brand-new-strong-passphrase';
    const next = rekeyFromRecovery(bundle, recoveryCode!, NEWPASS);
    // The old passphrase no longer opens it; the new one does.
    expect(() => unlockWithPassphrase(next, PASS)).toThrow(WrongCredentialError);
    const viaNew = unlockWithPassphrase(next, NEWPASS);
    // The recovery wrap is untouched, so the same recovery code still works.
    const viaRecovery = unlockWithRecovery(next, recoveryCode!);
    try {
      expect(viaNew.realmKey.equals(original.realmKey)).toBe(true); // realm_key (identities/Seals) preserved
      expect(viaNew.dekId).toBe(original.dekId); // same DEK — data survives
      expect(viaRecovery.realmKey.equals(original.realmKey)).toBe(true);
    } finally {
      original.dispose();
      viaNew.dispose();
      viaRecovery.dispose();
    }
  });

  it('rekey --recovery rejects a wrong recovery code', () => {
    const { root } = setupRealm('passphrase');
    const bundle = loadKeyBundle(replicaLayout(root));
    expect(() => rekeyFromRecovery(bundle, '0000-0000-0000-0000', 'whatever-passphrase')).toThrow(WrongCredentialError);
  });
});
