// `memoring rekey` — rotate the KEK (envelope re-encryption of the DEK). The DEK
// and realm_key are unchanged, so all memory, identities, and Seals survive
// (NFR-014). Two modes:
//   passphrase vault          → change the passphrase (re-wrap the DEK).
//   default (passwordless) +  → upgrade to a strong passphrase vault, reusing the
//     --passphrase               same DEK and printing a one-time recovery code.
import fs from 'node:fs';
import { replicaLayout } from '@core/paths';
import { assertKeyModeUnambiguous, isPassphraseMode, loadKeyBundle, loadLocalKey, replicaExists } from '@core/runtime';
import { rekeyPassphrase, upgradeLocalToPassphrase } from '@security/key-lifecycle';
import { atomicWriteFile } from '@storage/fs-safety';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';

async function confirmNewPassphrase(prompt: string): Promise<string | null> {
  const passphrase = await getPassphrase(prompt);
  if (!process.env.MEMORING_PASSPHRASE) {
    const confirm = await getPassphrase('Confirm passphrase: ');
    if (confirm !== passphrase) {
      console.error('Passphrases did not match.');
      return null;
    }
  }
  if (passphrase.length < 8) {
    console.error('Passphrase must be at least 8 characters.');
    return null;
  }
  return passphrase;
}

export async function cmdRekey(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const layout = replicaLayout();
  if (!replicaExists(layout.root)) {
    console.error('No Memoring replica here. Run `memoring init` first.');
    return 1;
  }
  try {
    assertKeyModeUnambiguous(layout.root);
  } catch (e) {
    console.error(`  ${(e as Error).message}`);
    return 1;
  }

  // Passphrase vault → change the passphrase (re-wrap the DEK under a new KEK).
  if (isPassphraseMode(layout.root)) {
    const oldPassphrase = await getPassphrase('Current passphrase: ');
    const newPassphrase = await confirmNewPassphrase('New passphrase: ');
    if (newPassphrase === null) return 1;
    let next;
    try {
      next = rekeyPassphrase(loadKeyBundle(layout), oldPassphrase, newPassphrase);
    } catch (e) {
      console.error(`  ${(e as Error).message}`);
      return 1;
    }
    atomicWriteFile(layout.keyBundle, JSON.stringify(next, null, 2), 0o600);
    console.log('  Passphrase rotated. The DEK was re-wrapped (data, identities, and Seals unchanged).');
    return 0;
  }

  // Default (passwordless) vault → only meaningful action is upgrading to a passphrase.
  const wantPassphrase = flags.passphrase === true || typeof flags.passphrase === 'string';
  if (!wantPassphrase) {
    console.error('  Default (passwordless) mode has no KEK to rotate.');
    console.error('  Upgrade to a strong passphrase vault (reuses the same DEK):');
    console.error('      memoring rekey --passphrase');
    return 1;
  }
  const passphrase = await confirmNewPassphrase('Choose a passphrase: ');
  if (passphrase === null) return 1;

  const { bundle, recoveryCode } = upgradeLocalToPassphrase(loadLocalKey(layout), passphrase);
  // Write the bundle first, then drop the local key file. If interrupted in the
  // middle, runtime refuses the ambiguous two-key state instead of opening the
  // weaker passwordless mode.
  atomicWriteFile(layout.keyBundle, JSON.stringify(bundle, null, 2), 0o600);
  fs.rmSync(layout.keyFile);

  console.log('');
  console.log('  Upgraded to passphrase-encrypted (strong). The DEK was re-wrapped, not changed,');
  console.log('  so all memory, identities, and Seals are preserved.');
  console.log('');
  console.log('  RECOVERY CODE (write this down — it is shown only once):');
  console.log('');
  console.log(`      ${recoveryCode}`);
  console.log('');
  console.log('  If you lose BOTH your passphrase and this recovery code, the Realm cannot be');
  console.log('  decrypted. Memoring has no server-side recovery.');
  console.log('');
  return 0;
}
