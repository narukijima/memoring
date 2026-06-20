// `memoring init` — create the encrypted replica and mandatorily generate the
// passphrase wrapping + recovery material (FR-083). The recovery code is shown
// once and never stored; losing it (and the passphrase) makes the Realm
// undecryptable (NFR-016).
import { newId } from '@core/schema/ids';
import { replicaLayout, REPLICA_SUBDIRS } from '@core/paths';
import { attachRealm } from '@core/runtime';
import { type RealmConfig, writeRealmConfig } from '@core/realm';
import { createKeyMaterial } from '@security/key-lifecycle';
import { ensureDir, atomicWriteFile } from '@storage/fs-safety';
import { claudeCodeConnector } from '@integrations/claude-code/index';
import { log } from '@core/log';
import { ask, getPassphrase } from '../prompt';
import { parseFlags } from '../args';

export async function cmdInit(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const layout = replicaLayout();
  const fs = await import('node:fs');

  if (fs.existsSync(layout.realmToml) || fs.existsSync(layout.keyBundle)) {
    log.error('init:exists', { root: layout.root });
    console.error(`A Memoring replica already exists at ${layout.root}. Refusing to overwrite.`);
    return 1;
  }

  const passphrase = await getPassphrase('Choose a passphrase: ');
  if (!process.env.MEMORING_PASSPHRASE) {
    const confirm = await getPassphrase('Confirm passphrase: ');
    if (confirm !== passphrase) {
      console.error('Passphrases did not match.');
      return 1;
    }
  }
  if (passphrase.length < 8) {
    console.error('Passphrase must be at least 8 characters.');
    return 1;
  }

  // 1. Replica directories (root 0700).
  ensureDir(layout.root, 0o700);
  for (const key of REPLICA_SUBDIRS) ensureDir(layout[key], 0o700);

  // 2. Key material (envelope DEK/KEK + recovery + realm_key).
  const { bundle, recoveryCode, keyring } = createKeyMaterial(passphrase);
  atomicWriteFile(layout.keyBundle, JSON.stringify(bundle, null, 2), 0o600);

  // 3. Realm config (plaintext, holds resolution basis).
  const config: RealmConfig = {
    schema: 'realm.v1',
    realm_id: newId('realm'),
    name: (flags.name as string) ?? 'default',
    created_at: new Date().toISOString(),
    projects: [],
    connectors: [],
  };
  writeRealmConfig(layout.realmToml, config);

  // 4. Initialize the encrypted DB (tables) and persist.
  const ctx = attachRealm(layout, config, keyring);
  ctx.store.setMeta('realm_id', config.realm_id);
  ctx.close(true);

  // 5. Show recovery code ONCE.
  console.log('');
  console.log('  Memoring replica initialized.');
  console.log(`  Location : ${layout.root}`);
  console.log(`  Realm    : ${config.realm_id} (${config.name})`);
  console.log('');
  console.log('  RECOVERY CODE (write this down — it is shown only once):');
  console.log('');
  console.log(`      ${recoveryCode}`);
  console.log('');
  console.log('  If you lose both your passphrase and this recovery code, the Realm');
  console.log('  cannot be decrypted. Memoring does not keep a copy.');
  console.log('');

  // 6. Inventory preview (selection happens in `connect`).
  const detection = await claudeCodeConnector.detect();
  if (detection.sources.length > 0) {
    console.log(`  Detected ${detection.sources.length} Claude Code source(s).`);
    console.log('  Next: `memoring connect claude-code` to choose which to include.');
  } else {
    console.log('  No Claude Code transcripts detected yet.');
    for (const note of detection.notes) console.log(`    - ${note}`);
  }
  console.log('');

  // Acknowledge that the recovery code was seen (skipped when headless).
  if (!process.env.MEMORING_PASSPHRASE) {
    await ask('  Press Enter once you have saved the recovery code... ');
  }
  return 0;
}
