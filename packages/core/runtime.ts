// Open-replica runtime: binds the unlocked keyring to the encrypted DB, the
// object store, the typed repositories, and the chronicler. Commands operate on
// a RealmContext and must call close()/flush() to persist (the DB is in-memory
// until serialized to the AEAD blob).
import fs from 'node:fs';
import { ObjectStore } from '@storage/object-store';
import { EncryptedDb } from '@storage/encrypted-db';
import { Store } from '@storage/repositories';
import { type KeyBundle, type Keyring, unlockWithPassphrase } from '@security/key-lifecycle';
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
  return fs.existsSync(layout.realmToml) && fs.existsSync(layout.keyBundle);
}

export function loadKeyBundle(layout: ReplicaLayout): KeyBundle {
  return JSON.parse(fs.readFileSync(layout.keyBundle, 'utf8')) as KeyBundle;
}

/** Open an existing replica with a passphrase. */
export function openRealm(passphrase: string, root?: string): RealmContext {
  const layout = replicaLayout(root);
  if (!replicaExists(root)) throw new ReplicaNotFoundError(layout.root);
  const config = readRealmConfig(layout.realmToml);
  const bundle = loadKeyBundle(layout);
  const keyring = unlockWithPassphrase(bundle, passphrase);
  const edb = EncryptedDb.openOrCreate(layout.dbBlob, keyring.dek);
  const store = new Store(edb.db, () => edb.markDirty());
  const objects = new ObjectStore(layout.objectsDir, keyring.dek, keyring.realmKey);
  const chronicler = new Chronicler(store, config.realm_id, keyring.realmKey);
  return new RealmContext(layout, config, keyring, edb, store, objects, chronicler);
}

/** Build a RealmContext from an already-unlocked keyring (used right after init). */
export function attachRealm(layout: ReplicaLayout, config: RealmConfig, keyring: Keyring): RealmContext {
  const edb = EncryptedDb.openOrCreate(layout.dbBlob, keyring.dek);
  const store = new Store(edb.db, () => edb.markDirty());
  const objects = new ObjectStore(layout.objectsDir, keyring.dek, keyring.realmKey);
  const chronicler = new Chronicler(store, config.realm_id, keyring.realmKey);
  return new RealmContext(layout, config, keyring, edb, store, objects, chronicler);
}
