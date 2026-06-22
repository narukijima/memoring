// `memoring restore <backup-dir>` — the read-back half of backup_export
// (NFR-032: local restore of a self-contained, client-side-encrypted archive).
// Restore is a byte copy of the encrypted replica into the active replica root —
// there is NO re-egress and NO re-derivation: the archive already holds the
// at-rest AEAD blob + objects, and event_identity / SealRule.target_signature are
// realm_key-derived and restore-invariant (CON-012), so a forgotten/sealed item
// stays sealed. It is the carry-not-sync counterpart to backup_export: no
// first-party cloud sync, no live multi-device merge (Prohibitions / NFR-032).
import fs from 'node:fs';
import path from 'node:path';
import { defaultReplicaRoot, replicaLayout } from '@core/paths';
import { appendAudit } from '@security/audit';
import { parseFlags } from '../args';

interface BackupManifest {
  kind?: string;
  purpose?: string;
  realm_id?: string;
  same_user?: boolean;
  self_decrypting?: boolean;
  encryption?: string;
}

export async function cmdRestore(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const src = flags._[0];
  if (!src) {
    console.error('Usage: memoring restore <backup-dir>');
    console.error('  Restores a backup_export archive into MEMORING_HOME (default ~/.memoring).');
    return 1;
  }

  const source = path.resolve(process.cwd(), src);
  const manifestPath = path.join(source, 'backup-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`  ${source} is not a Memoring backup (no backup-manifest.json). Refusing.`);
    return 1;
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
  } catch (e) {
    console.error(`  Unreadable backup-manifest.json: ${(e as Error).message}. Refusing.`);
    return 1;
  }
  if (manifest.kind !== 'memoring-backup') {
    console.error(`  backup-manifest.json kind=${manifest.kind ?? '(none)'} is not 'memoring-backup'. Refusing.`);
    return 1;
  }
  // Restore is only safe for a full backup_export of the SAME user with client-side
  // encryption (Specification §6.2 / §7.3). Enforce all three as hard refusals — a
  // missing/derived purpose, or a non-same-user / non-client-side archive, is not a
  // restorable replica (a derived redacted/dataset archive may have left the key
  // boundary and is not a full vault).
  if (manifest.purpose !== 'backup_export') {
    console.error(`  Archive purpose=${manifest.purpose ?? '(none)'} is not 'backup_export' — only a full backup is restorable. Refusing.`);
    return 1;
  }
  if (manifest.same_user !== true) {
    console.error('  Archive is not marked same_user=true — restore is only for your own backup. Refusing.');
    return 1;
  }
  const CLIENT_SIDE = ['passphrase', 'local_key_included'];
  if (!manifest.encryption || !CLIENT_SIDE.includes(manifest.encryption)) {
    console.error(`  Archive encryption=${manifest.encryption ?? '(none)'} is not a client-side encrypted replica. Refusing.`);
    return 1;
  }

  // Integrity: a restorable replica must carry the encrypted DB blob and a key
  // (the wrapped bundle in passphrase mode, or the unwrapped local key otherwise).
  const srcLayout = replicaLayout(source);
  const required: ReadonlyArray<readonly [string, string]> = [
    ['realm.toml', srcLayout.realmToml],
    ['memoring.db', srcLayout.dbBlob],
  ];
  const missing = required.filter(([, p]) => !fs.existsSync(p));
  const hasKey = fs.existsSync(srcLayout.keyBundle) || fs.existsSync(srcLayout.keyFile);
  if (missing.length > 0 || !hasKey) {
    const parts = missing.map(([n]) => n);
    if (!hasKey) parts.push('keys/ (keybundle.json or key.json)');
    console.error(`  Incomplete backup — missing: ${parts.join(', ')}. Refusing.`);
    return 1;
  }

  // Never clobber an existing vault. The user picks the destination by pointing
  // MEMORING_HOME at an empty/new directory (the same root every other command
  // resolves), so restore stays a single, predictable target.
  const targetRoot = defaultReplicaRoot();
  if (fs.existsSync(targetRoot) && fs.readdirSync(targetRoot).length > 0) {
    console.error(`  Destination ${targetRoot} already holds a replica. Refusing to overwrite.`);
    console.error('  Point MEMORING_HOME at an empty directory to restore alongside the current vault.');
    return 1;
  }

  fs.mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
  // Copy the encrypted replica verbatim (preserves the AEAD blob, objects, and key
  // material). backup-manifest.json is copied too; it is inert metadata.
  fs.cpSync(source, targetRoot, { recursive: true });
  // Re-assert the private permissions the layout expects (cpSync mirrors source
  // modes, but a backup may have been moved through a permissive transport that left
  // the key material world-readable). Tighten BOTH key forms — the unwrapped local
  // key AND the scrypt-wrapped passphrase bundle (a wrapped key is still offline-
  // attack material) — plus the keys/ dir.
  try {
    const tl = replicaLayout(targetRoot);
    fs.chmodSync(targetRoot, 0o700);
    if (fs.existsSync(tl.keysDir)) fs.chmodSync(tl.keysDir, 0o700);
    for (const keyPath of [tl.keyFile, tl.keyBundle]) {
      if (fs.existsSync(keyPath)) fs.chmodSync(keyPath, 0o600);
    }
  } catch {
    /* best-effort; doctor re-checks file safety */
  }

  // Audit the restore symmetrically with export (ids/state only, never payload) —
  // written straight to the restored replica's plaintext audit log, so it needs no
  // DB unlock (the byte copy never opens the encrypted vault).
  appendAudit(
    replicaLayout(targetRoot).logsDir,
    'backup_restore',
    { realm_id: manifest.realm_id ?? 'unknown', same_user: true }, // validated === true above
    new Date().toISOString(),
  );

  const sealed = manifest.self_decrypting === false || manifest.encryption === 'passphrase';
  console.log(`  restored → ${targetRoot}`);
  console.log(`  realm_id: ${manifest.realm_id ?? '(unknown)'} · same_user: true`);
  if (sealed) {
    console.log('  Sealed copy: opens only with the original passphrase or recovery code.');
  } else {
    console.log('  This replica includes its local key and opens without a passphrase. Keep it private.');
  }
  console.log('  No re-egress or re-derivation occurred. Run `memoring doctor` to verify.');
  return 0;
}
