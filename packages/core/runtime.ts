// Open-replica runtime: binds the unlocked keyring to the encrypted DB, the
// object store, the typed repositories, and the chronicler. Commands operate on
// a RealmContext and must call close()/flush() to persist (the DB is in-memory
// until serialized to the AEAD blob).
import fs from 'node:fs';
import { ObjectStore } from '@storage/object-store';
import { EncryptedDb } from '@storage/encrypted-db';
import { Store } from '@storage/repositories';
import {
  type KeyBundle,
  type Keyring,
  type LocalKeyFile,
  unlockFromLocalKey,
  unlockWithPassphrase,
} from '@security/key-lifecycle';
import { appendAudit, type AuditFields } from '@security/audit';
import { Chronicler } from './chronicle';
import { type RealmConfig, readRealmConfig } from './realm';
import { type ReplicaLayout, replicaLayout } from './paths';

export class ReplicaNotFoundError extends Error {
  constructor(root: string) {
    super(`No Memoring replica at ${root}. Run \`memoring init\` first.`);
    this.name = 'ReplicaNotFoundError';
  }
}

export class RealmContext {
  constructor(
    readonly layout: ReplicaLayout,
    readonly config: RealmConfig,
    readonly keyring: Keyring,
    readonly edb: EncryptedDb,
    readonly store: Store,
    readonly objects: ObjectStore,
    readonly chronicler: Chronicler,
  ) {}

  get realmId(): string {
    return this.config.realm_id;
  }
  get realmKey(): Buffer {
    return this.keyring.realmKey;
  }

  flush(): void {
    this.edb.flush();
  }

  /** Append an audit entry (ids/counts/state only — never payload). */
  audit(op: string, fields: AuditFields = {}, now = new Date()): void {
    appendAudit(this.layout.logsDir, op, { realm_id: this.realmId, ...fields }, now.toISOString());
  }

  close(persist = true): void {
    this.edb.close(persist);
    this.keyring.dispose();
  }
}

export function replicaExists(root?: string): boolean {
  const layout = replicaLayout(root);
  return fs.existsSync(layout.realmToml) && (fs.existsSync(layout.keyFile) || fs.existsSync(layout.keyBundle));
}

/** A replica is in passphrase mode when it has a key bundle and no local key file. */
export function isPassphraseMode(root?: string): boolean {
  const layout = replicaLayout(root);
  return !fs.existsSync(layout.keyFile) && fs.existsSync(layout.keyBundle);
}

export function loadKeyBundle(layout: ReplicaLayout): KeyBundle {
  return JSON.parse(fs.readFileSync(layout.keyBundle, 'utf8')) as KeyBundle;
}

export function loadLocalKey(layout: ReplicaLayout): LocalKeyFile {
  return JSON.parse(fs.readFileSync(layout.keyFile, 'utf8')) as LocalKeyFile;
}

/** Bind an unlocked keyring to the encrypted DB, object store, repositories, chronicler. */
function buildContext(layout: ReplicaLayout, config: RealmConfig, keyring: Keyring): RealmContext {
  const edb = EncryptedDb.openOrCreate(layout.dbBlob, keyring.dek);
  const store = new Store(edb.db, () => edb.markDirty());
  const objects = new ObjectStore(layout.objectsDir, keyring.dek, keyring.realmKey);
  const chronicler = new Chronicler(store, config.realm_id, keyring.realmKey);
  return new RealmContext(layout, config, keyring, edb, store, objects, chronicler);
}

/** Open a passphrase-mode replica. */
export function openRealm(passphrase: string, root?: string): RealmContext {
  const layout = replicaLayout(root);
  if (!replicaExists(root)) throw new ReplicaNotFoundError(layout.root);
  const config = readRealmConfig(layout.realmToml);
  const keyring = unlockWithPassphrase(loadKeyBundle(layout), passphrase);
  return buildContext(layout, config, keyring);
}

/** Open a default-mode (passwordless, local key file) replica. */
export function openRealmLocal(root?: string): RealmContext {
  const layout = replicaLayout(root);
  if (!replicaExists(root)) throw new ReplicaNotFoundError(layout.root);
  const config = readRealmConfig(layout.realmToml);
  const keyring = unlockFromLocalKey(loadLocalKey(layout));
  return buildContext(layout, config, keyring);
}

/**
 * Single mode-aware entry point for the CLI. Detects the replica's key mode and
 * only invokes `passphraseProvider` (e.g. a TTY prompt) when the replica is
 * passphrase-encrypted — passwordless replicas open without ever prompting.
 * Keeping this in core (not scattered in CLI commands) is what lets a future
 * UI reuse the same key handling.
 */
export async function openActiveRealm(
  root: string | undefined,
  passphraseProvider: () => Promise<string>,
): Promise<RealmContext> {
  const layout = replicaLayout(root);
  if (fs.existsSync(layout.keyFile)) return openRealmLocal(root);
  if (fs.existsSync(layout.keyBundle)) return openRealm(await passphraseProvider(), root);
  throw new ReplicaNotFoundError(layout.root);
}

/** Build a RealmContext from an already-unlocked keyring (used right after init). */
export function attachRealm(layout: ReplicaLayout, config: RealmConfig, keyring: Keyring): RealmContext {
  return buildContext(layout, config, keyring);
}
