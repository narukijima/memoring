// `memoring export --purpose backup <dest>` — backup_export (FR-074/075). A
// full-text, same-user, client-side-encrypted copy of the Realm. Because the
// at-rest representation is already AEAD-encrypted (DB blob + objects, wrapped
// key bundle), a faithful directory copy keeps plaintext inside the key boundary
// while including secret/unknown (note4, §7.3). redacted/dataset export are
// derivatives that may leave the key boundary — v0 fixes only their constraints.
import fs from 'node:fs';
import path from 'node:path';
import { replicaLayout } from '@core/paths';
import { openRealm } from '@core/runtime';
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
  const passphrase = await getPassphrase();
  const ctx = openRealm(passphrase, replicaLayout().root);
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
  const target = path.resolve(process.cwd(), dest);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    console.error(`  Destination ${target} is not empty. Refusing to overwrite.`);
    return 1;
  }
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  // Encrypted-at-rest files only; nothing here is plaintext content.
  fs.cpSync(layout.root, target, { recursive: true });

  const manifest = {
    kind: 'memoring-backup',
    purpose: 'backup_export',
    realm_id: realmId,
    claims,
    same_user: true,
    encryption: 'client_side',
    note: 'Full encrypted copy incl. secret/unknown. Decrypts only with the original passphrase or recovery code.',
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(target, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  console.log(`  backup_export → ${target}`);
  console.log('  Encrypted copy (incl. secret/unknown). Carry it anywhere; it stays sealed without your key.');
  return 0;
}
