// Shared Realm-lifecycle orchestrators (ADR-0010 §1). `memoring realm new/use/
// rename/rm` (CLI) and the web panel BOTH call these, so the lifecycle audit
// lives HERE — one trail across both surfaces. The audit is deliberately NOT in
// addRealm/setCurrent: those primitives are reused by ensureLegacyRegistered and
// idempotent re-adds, and auditing there would emit phantom realm_new records.
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '@security/audit';
import { basePath, registryRealmsDir, replicaLayout } from '@core/paths';
import {
  addRealm,
  findByNameOrId,
  getCurrent,
  listRealms,
  readRegistry,
  removeRealm,
  setCurrent,
  writeRegistry,
  type RealmRegistryEntry,
} from '@core/realm-registry';
import { readRealmConfig, writeRealmConfig } from '@core/realm';
import { createReplicaAtRoot, type CreatedReplica } from './commands/init';

export class RealmActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RealmActionError';
  }
}

/** Realm-lifecycle audit: registry-scoped, so it writes to <base>/logs/audit.log
 *  (matching the existing realm_rm precedent), carrying ids only — never names or
 *  passphrases (NFR-004). */
function auditLifecycle(base: string, op: string, fields: Record<string, string | number | boolean>): void {
  appendAudit(path.join(base, 'logs'), op, fields, new Date().toISOString());
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'realm';
}

export function nextRealmRoot(name: string, base: string): string {
  const dir = registryRealmsDir(base);
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let i = 2;
  while (fs.existsSync(path.join(dir, slug))) {
    slug = `${baseSlug}-${i}`;
    i += 1;
  }
  return path.join(dir, slug);
}

export interface CreateRealmOptions {
  name: string;
  usePassphrase: boolean;
  passphrase?: string;
  base?: string;
  now?: Date;
}

/** Create a replica, register it, make it current, and audit realm_new — the
 *  single shared "an owner created a Realm" invariant. */
export function createRealm(opts: CreateRealmOptions): CreatedReplica {
  const base = opts.base ?? basePath();
  if (listRealms(base).some((r) => r.name === opts.name)) {
    throw new RealmActionError(`A Realm named ${opts.name} already exists. Use a unique name.`);
  }
  const root = nextRealmRoot(opts.name, base);
  const created = createReplicaAtRoot({
    root,
    name: opts.name,
    usePassphrase: opts.usePassphrase,
    passphrase: opts.passphrase,
    now: opts.now,
  });
  addRealm(
    {
      name: created.config.name,
      realm_id: created.config.realm_id,
      root: created.layout.root,
      created_at: created.config.created_at,
      key_mode: created.keyMode,
    },
    base,
  );
  setCurrent(created.config.realm_id, base);
  auditLifecycle(base, 'realm_new', { realm_id: created.config.realm_id, key_mode: created.keyMode });
  return created;
}

/** Set the active Realm for the CLI (the only setCurrent caller besides create):
 *  validates the id exists, performs the single registry write, and audits it. */
export function setActiveRealm(query: string, base = basePath()): RealmRegistryEntry {
  const realm = findByNameOrId(query, base);
  setCurrent(realm.realm_id, base);
  auditLifecycle(base, 'realm_use', { realm_id: realm.realm_id });
  return realm;
}

export interface RenameRealmResult {
  realm: RealmRegistryEntry;
  previousName: string;
}

export function renameRealm(query: string, newName: string, base = basePath()): RenameRealmResult {
  const registry = readRegistry(base);
  const realm = findByNameOrId(query, base);
  const collision = registry.realms.find((r) => r.name === newName && r.realm_id !== realm.realm_id);
  if (collision) {
    throw new RealmActionError(`A Realm named ${newName} already exists (${collision.realm_id}).`);
  }
  const configPath = replicaLayout(realm.root).realmToml;
  const config = readRealmConfig(configPath);
  writeRealmConfig(configPath, { ...config, name: newName });
  writeRegistry(
    {
      ...registry,
      realms: registry.realms.map((r) => (r.realm_id === realm.realm_id ? { ...r, name: newName } : r)),
    },
    base,
  );
  auditLifecycle(base, 'realm_rename', { realm_id: realm.realm_id });
  return { realm, previousName: realm.name };
}

export interface DeleteRealmResult {
  removed: RealmRegistryEntry;
  current?: RealmRegistryEntry;
}

/** Delete a Realm's on-disk replica and registry entry, audited. Enforces the
 *  floor (refuse the last Realm; refuse a root that contains the base or another
 *  Realm) so neither the CLI nor the panel can relax it. Ordering: rmSync FIRST,
 *  then drop the entry, then audit — so a crash leaves the Realm re-removable and
 *  never orphans secret material. */
export function deleteRealm(query: string, base = basePath()): DeleteRealmResult {
  const registry = readRegistry(base);
  const realm = findByNameOrId(query, base);
  if (registry.realms.length <= 1) {
    throw new RealmActionError('Refusing to remove the last registered Realm.');
  }
  const safety = removalSafety(realm, registry.realms, base);
  if (safety) {
    throw new RealmActionError(`Refusing to remove ${realm.name}: ${safety}`);
  }
  fs.rmSync(realm.root, { recursive: true, force: true });
  removeRealm(realm.realm_id, base);
  auditLifecycle(base, 'realm_rm', { realm_id: realm.realm_id });
  return { removed: realm, current: getCurrent(base) };
}

/** Resolve symlinks so the containment guard reflects the true on-disk target;
 *  fall back to a lexical resolve when the path does not exist yet. */
function canonical(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function removalSafety(realm: RealmRegistryEntry, realms: RealmRegistryEntry[], base: string): string | undefined {
  const root = canonical(realm.root);
  if (containsOrEqual(root, canonical(base))) return 'the Realm root contains the registry base';
  const other = realms.find((r) => r.realm_id !== realm.realm_id && containsOrEqual(root, canonical(r.root)));
  if (other) return `the Realm root contains another registered Realm (${other.realm_id})`;
  return undefined;
}

function containsOrEqual(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
