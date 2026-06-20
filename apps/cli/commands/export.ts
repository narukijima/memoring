// `memoring export --purpose backup <dest>` — backup_export (FR-074/075). A
// full-text, same-user copy of the Realm (incl. secret/unknown, note4 §7.3). The
// at-rest files are AEAD-encrypted (DB blob + objects). In passphrase mode only
// the scrypt-wrapped key bundle is copied, so the backup stays sealed; in the
// default passwordless mode the copy also includes the unwrapped local key, so
// the backup is self-decrypting (the manifest and console say so honestly).
// redacted/dataset export are derivatives that may leave the key boundary — v0
// fixes only their constraints.
import fs from 'node:fs';
import path from 'node:path';
import { replicaLayout } from '@core/paths';
import { isPassphraseMode, openActiveRealm } from '@core/runtime';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';

export async function cmdExport(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const positionalPurpose = ['backup', 'redacted', 'dataset'].includes(flags._[0] ?? '') ? flags._[0] : undefined;
  const purpose = (flags.purpose as string) ?? positionalPurpose ?? 'backup';
  const dest = positionalPurpose ? flags._[1] : flags._[0];

  if (purpose !== 'backup') {
    console.error(
      `  export --purpose ${purpose}: v0 fixes only the constraints (no lineage/consent pipeline). ` +
        'Only backup_export is implemented.',
    );
    return 1;
  }
  if (!dest) {
    console.error('Usage: memoring export --purpose backup <dest-dir>');
    return 1;
  }

  // Flush any pending state into the encrypted blob, then copy the replica.
  const ctx = await openActiveRealm(replicaLayout().root, getPassphrase);
  let realmId = '';
  let claims = 0;
  try {
    ctx.flush();
    realmId = ctx.realmId;
    claims = ctx.store.listClaims(ctx.realmId).length;
    ctx.audit('backup_export', { claims });
  } finally {
    ctx.close(true);
  }

  const layout = replicaLayout();
  // Passphrase mode copies only the scrypt-wrapped bundle → the backup stays
  // sealed. Default (passwordless) mode also copies the unwrapped local key
  // (keys/key.json), so the backup is self-decrypting — report that honestly
  // instead of claiming it stays sealed.
  const sealed = isPassphraseMode(layout.root);
  const target = path.resolve(process.cwd(), dest);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    console.error(`  Destination ${target} is not empty. Refusing to overwrite.`);
    return 1;
  }
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.cpSync(layout.root, target, { recursive: true });

  const manifest = {
    kind: 'memoring-backup',
    purpose: 'backup_export',
    realm_id: realmId,
    claims,
    same_user: true,
    self_decrypting: !sealed,
    encryption: sealed ? 'passphrase' : 'local_key_included',
    note: sealed
      ? 'Sealed copy (incl. secret/unknown). Decrypts only with the original passphrase or recovery code.'
      : 'Includes the unwrapped local key (keys/key.json); this backup is self-decrypting. Anyone who obtains it can open the vault — keep it private.',
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(target, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  console.log(`  backup_export → ${target}`);
  if (sealed) {
    console.log('  Sealed copy (incl. secret/unknown). It stays sealed without your passphrase or recovery code.');
  } else {
    console.log('  This backup includes your local key (keys/key.json) and is self-decrypting —');
    console.log('  anyone who obtains it can open your vault. Keep it private.');
  }
  return 0;
}
