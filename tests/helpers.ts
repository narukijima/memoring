// Test helpers: build an ephemeral unlocked Realm in a temp dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { newId } from '@core/schema/ids';
import { replicaLayout } from '@core/paths';
import { attachRealm, type RealmContext } from '@core/runtime';
import { type RealmConfig, writeRealmConfig } from '@core/realm';
import { createKeyMaterial } from '@security/key-lifecycle';
import { ensureDir, atomicWriteFile } from '@storage/fs-safety';
import { REPLICA_SUBDIRS } from '@core/paths';

export interface TempRealm {
  ctx: RealmContext;
  root: string;
  cleanup: () => void;
}

export function makeTempRealm(opts?: { projects?: RealmConfig['projects'] }): TempRealm {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-test-'));
  const layout = replicaLayout(root);
  ensureDir(layout.root, 0o700);
  for (const key of REPLICA_SUBDIRS) ensureDir(layout[key], 0o700);
  const { bundle, keyring } = createKeyMaterial('test-passphrase-1234');
  atomicWriteFile(layout.keyBundle, JSON.stringify(bundle), 0o600);
  const config: RealmConfig = {
    schema: 'realm.v1',
    realm_id: newId('realm'),
    name: 'test',
    created_at: new Date().toISOString(),
    projects: opts?.projects ?? [],
    connectors: [],
  };
  writeRealmConfig(layout.realmToml, config);
  const ctx = attachRealm(layout, config, keyring);
  ctx.store.setMeta('realm_id', config.realm_id);
  return {
    ctx,
    root,
    cleanup: () => {
      try {
        ctx.close(false);
      } catch {
        /* ignore */
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function randomText(): string {
  return randomBytes(8).toString('hex');
}
