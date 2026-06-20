// `memoring init` — create the encrypted replica. Default mode uses an unwrapped
// local key file (no password to remember); `--passphrase` opts into a strong
// scrypt-wrapped vault with a one-time recovery code (FR-083 becomes opt-in; see
// docs/adr/0001-passwordless-default.md).
import { newId } from '@core/schema/ids';
import { replicaLayout, REPLICA_SUBDIRS } from '@core/paths';
import { attachRealm } from '@core/runtime';
import { type RealmConfig, writeRealmConfig } from '@core/realm';
import { createKeyMaterial, createLocalKeyMaterial } from '@security/key-lifecycle';
import { ensureDir, atomicWriteFile } from '@storage/fs-safety';
import { claudeCodeConnector } from '@integrations/claude-code/index';
import { log } from '@core/log';
import { ask, getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import type { Keyring } from '@security/key-lifecycle';

export async function cmdInit(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const layout = replicaLayout();
  const fs = await import('node:fs');

  if (fs.existsSync(layout.realmToml) || fs.existsSync(layout.keyBundle) || fs.existsSync(layout.keyFile)) {
    log.error('init:exists', { root: layout.root });
    console.error(`A Memoring replica already exists at ${layout.root}. Refusing to overwrite.`);
    return 1;
  }

  // Treat --passphrase as a boolean toggle regardless of any trailing token the
  // flag parser may attach to it; the passphrase itself comes from the prompt /
  // MEMORING_PASSPHRASE, never from the command line.
  const usePassphrase = flags.passphrase === true || typeof flags.passphrase === 'string';

  // Gather the passphrase up front (only in opt-in strong mode) so we fail before
  // creating any files if it is rejected.
  let passphrase = '';
  if (usePassphrase) {
    passphrase = await getPassphrase('Choose a passphrase: ');
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
  }

  // 1. Replica directories (root 0700).
  ensureDir(layout.root, 0o700);
  for (const key of REPLICA_SUBDIRS) ensureDir(layout[key], 0o700);

  // 2. Key material. Default = unwrapped local key (0600); opt-in = envelope
  //    DEK/KEK + one-time recovery code.
  let keyring: Keyring;
  let recoveryCode: string | undefined;
  if (usePassphrase) {
    const km = createKeyMaterial(passphrase);
    atomicWriteFile(layout.keyBundle, JSON.stringify(km.bundle, null, 2), 0o600);
    keyring = km.keyring;
    recoveryCode = km.recoveryCode;
  } else {
    const km = createLocalKeyMaterial();
    atomicWriteFile(layout.keyFile, JSON.stringify(km.keyFile, null, 2), 0o600);
    keyring = km.keyring;
  }

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

  // 5. Report the mode (and the recovery code, once, in strong mode).
  console.log('');
  console.log('  Memoring replica initialized.');
  console.log(`  Location : ${layout.root}`);
  console.log(`  Realm    : ${config.realm_id} (${config.name})`);
  console.log('');
  if (usePassphrase) {
    console.log('  Mode     : passphrase-encrypted (strong).');
    console.log('');
    console.log('  RECOVERY CODE (write this down — it is shown only once):');
    console.log('');
    console.log(`      ${recoveryCode}`);
    console.log('');
    console.log('  If you lose BOTH your passphrase and this recovery code, the Realm');
    console.log('  cannot be decrypted. Memoring has no server-side recovery.');
    console.log('');
  } else {
    console.log('  Mode     : default (no Memoring password).');
    console.log('  The vault is encrypted with a local key file (keys/key.json, mode 0600).');
    console.log('  This avoids plaintext SQLite/WAL and protects against leaking the vault');
    console.log('  blob alone, but NOT against someone who can read your home directory.');
    console.log('  For that, use full-disk encryption — or initialize with:');
    console.log('      memoring init --passphrase');
    console.log('');
  }

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

  // Acknowledge that the recovery code was seen (strong mode, interactive only).
  if (usePassphrase && !process.env.MEMORING_PASSPHRASE) {
    await ask('  Press Enter once you have saved the recovery code... ');
  }
  return 0;
}
