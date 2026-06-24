// `memoring realm ...` — first-class local multi-Realm management. The registry
// is plaintext metadata only; each per-Realm realm.toml remains authoritative.
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '@security/audit';
import { basePath, registryRealmsDir, replicaLayout } from '@core/paths';
import {
  addRealm,
  ensureLegacyRegistered,
  findByNameOrId,
  getCurrent,
  listRealms,
  readRegistry,
  removeRealm,
  setCurrent,
  writeRegistry,
  type RealmRegistryEntry,
} from '@core/realm-registry';
import { openRealmLocal, resolveActiveReplicaRoot, isActiveRealmSilence } from '@core/runtime';
import { readRealmConfig, writeRealmConfig } from '@core/realm';
import { ask, getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { confirm } from './forget';
import { createReplicaAtRoot } from './init';

export async function cmdRealm(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const sub = flags._[0];
  switch (sub) {
    case 'new':
      return cmdRealmNew(flags);
    case 'list':
      return cmdRealmList(flags);
    case 'use':
      return cmdRealmUse(flags);
    case 'current':
      return cmdRealmCurrent(flags);
    case 'rename':
      return cmdRealmRename(flags);
    case 'rm':
      return cmdRealmRm(flags);
    default:
      console.error('Usage: memoring realm new|list|use|current|rename|rm');
      return 1;
  }
}

async function cmdRealmNew(flags: ReturnType<typeof parseFlags>): Promise<number> {
  const name = flags._[1];
  if (!name) {
    console.error('Usage: memoring realm new <name> [--passphrase]');
    return 1;
  }
  const base = basePath();
  ensureLegacyRegistered(base);
  if (listRealms(base).some((r) => r.name === name)) {
    console.error(`  A Realm named ${name} already exists. Use a unique name.`);
    return 1;
  }
  const usePassphrase = flags.passphrase === true || typeof flags.passphrase === 'string';
  const passphrase = usePassphrase ? await collectPassphrase() : undefined;
  if (usePassphrase && !passphrase) return 1;

  const root = nextRealmRoot(name, base);
  const created = createReplicaAtRoot({
    root,
    name,
    usePassphrase,
    passphrase,
  });
  addRealm({
    name: created.config.name,
    realm_id: created.config.realm_id,
    root: created.layout.root,
    created_at: created.config.created_at,
    key_mode: created.keyMode,
  }, base);
  setCurrent(created.config.realm_id, base);

  console.log(`  Created Realm ${created.config.name}.`);
  console.log(`  Realm    : ${created.config.realm_id}`);
  console.log(`  Location : ${created.layout.root}`);
  console.log(`  Mode     : ${created.keyMode === 'passphrase' ? 'passphrase-encrypted' : 'default (no Memoring password)'}`);
  if (created.recoveryCode) {
    console.log('');
    console.log('  RECOVERY CODE (write this down — it is shown only once):');
    console.log('');
    console.log(`      ${created.recoveryCode}`);
    console.log('');
    if (!process.env.MEMORING_PASSPHRASE) await ask('  Press Enter once you have saved the recovery code... ');
  }
  return 0;
}

async function cmdRealmList(flags: ReturnType<typeof parseFlags>): Promise<number> {
  const base = basePath();
  ensureLegacyRegistered(base);
  const realms = listRealms(base);
  const current = getCurrent(base);
  if (realms.length === 0) {
    console.log('  No registered Realms.');
    return 0;
  }
  const withStats = flags.stats === true || typeof flags.stats === 'string';
  for (const realm of realms) {
    const marker = current?.realm_id === realm.realm_id ? '*' : ' ';
    const stats = withStats ? statsFor(realm) : '';
    console.log(
      `${marker} ${realm.name} ${realm.realm_id} key=${realm.key_mode} created=${realm.created_at} root=${realm.root}${stats}`,
    );
  }
  return 0;
}

async function cmdRealmUse(flags: ReturnType<typeof parseFlags>): Promise<number> {
  const query = flags._[1];
  if (!query) {
    console.error('Usage: memoring realm use <name|id>');
    return 1;
  }
  const base = basePath();
  ensureLegacyRegistered(base);
  const realm = findByNameOrId(query, base);
  setCurrent(realm.realm_id, base);
  console.log(`  Current Realm: ${realm.name} (${realm.realm_id})`);
  return 0;
}

async function cmdRealmCurrent(flags: ReturnType<typeof parseFlags>): Promise<number> {
  const base = basePath();
  ensureLegacyRegistered(base);
  const resolved = resolveActiveReplicaRoot({
    flags,
    cwd: process.cwd(),
    commandClass: 'mgmt',
    base,
  });
  if (isActiveRealmSilence(resolved)) {
    console.error(`  ${resolved.silence}.`);
    return 1;
  }
  const realm = entryForRoot(resolved, base);
  if (realm) {
    console.log(`  Current Realm: ${realm.name} (${realm.realm_id})`);
    console.log(`  Location     : ${realm.root}`);
    return 0;
  }
  const config = readRealmConfig(replicaLayout(resolved).realmToml);
  console.log(`  Current Realm: ${config.name} (${config.realm_id})`);
  console.log(`  Location     : ${resolved}`);
  return 0;
}

async function cmdRealmRename(flags: ReturnType<typeof parseFlags>): Promise<number> {
  const query = flags._[1];
  const newName = flags._[2];
  if (!query || !newName) {
    console.error('Usage: memoring realm rename <name|id> <newName>');
    return 1;
  }
  const base = basePath();
  ensureLegacyRegistered(base);
  const registry = readRegistry(base);
  const realm = findByNameOrId(query, base);
  const collision = registry.realms.find((r) => r.name === newName && r.realm_id !== realm.realm_id);
  if (collision) {
    console.error(`  A Realm named ${newName} already exists (${collision.realm_id}).`);
    return 1;
  }
  const configPath = replicaLayout(realm.root).realmToml;
  const config = readRealmConfig(configPath);
  writeRealmConfig(configPath, { ...config, name: newName });
  writeRegistry({
    ...registry,
    realms: registry.realms.map((r) => (r.realm_id === realm.realm_id ? { ...r, name: newName } : r)),
  }, base);
  console.log(`  Renamed Realm ${realm.realm_id}: ${realm.name} -> ${newName}`);
  return 0;
}

async function cmdRealmRm(flags: ReturnType<typeof parseFlags>): Promise<number> {
  const query = flags._[1];
  if (!query) {
    console.error('Usage: memoring realm rm <name|id> --yes');
    return 1;
  }
  const base = basePath();
  ensureLegacyRegistered(base);
  const registry = readRegistry(base);
  const realm = findByNameOrId(query, base);
  if (registry.realms.length <= 1) {
    console.error('  Refusing to remove the last registered Realm.');
    return 1;
  }
  const safety = removalSafety(realm, registry.realms, base);
  if (safety) {
    console.error(`  Refusing to remove ${realm.name}: ${safety}`);
    return 1;
  }
  if (!(await confirm(flags, `remove Realm ${realm.name} (${realm.realm_id}) and delete its directory`))) return 1;

  appendAudit(path.join(base, 'logs'), 'realm_rm', { realm_id: realm.realm_id }, new Date().toISOString());
  const before = readRegistry(base);
  removeRealm(realm.realm_id, base);
  try {
    fs.rmSync(realm.root, { recursive: true, force: true });
  } catch (e) {
    writeRegistry(before, base);
    throw e;
  }
  console.log(`  Removed Realm ${realm.name} (${realm.realm_id}).`);
  const current = getCurrent(base);
  if (current) console.log(`  Current Realm: ${current.name} (${current.realm_id})`);
  return 0;
}

async function collectPassphrase(): Promise<string | undefined> {
  const passphrase = await getPassphrase('Choose a passphrase: ');
  if (!process.env.MEMORING_PASSPHRASE) {
    const confirmPassphrase = await getPassphrase('Confirm passphrase: ');
    if (confirmPassphrase !== passphrase) {
      console.error('Passphrases did not match.');
      return undefined;
    }
  }
  if (passphrase.length < 8) {
    console.error('Passphrase must be at least 8 characters.');
    return undefined;
  }
  return passphrase;
}

function nextRealmRoot(name: string, base: string): string {
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

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'realm';
}

function statsFor(realm: RealmRegistryEntry): string {
  let sources = 0;
  try {
    const config = readRealmConfig(replicaLayout(realm.root).realmToml);
    sources = new Set(config.connectors.flatMap((c) => c.source_stable_ids)).size;
  } catch {
    return ' stats=unavailable';
  }
  if (realm.key_mode !== 'local') return ` sources=${sources} claims=locked`;
  try {
    const ctx = openRealmLocal(realm.root);
    try {
      return ` sources=${sources} claims=${ctx.store.listClaims(ctx.realmId).length}`;
    } finally {
      ctx.close(false);
    }
  } catch {
    return ` sources=${sources} claims=unavailable`;
  }
}

function entryForRoot(root: string, base: string): RealmRegistryEntry | undefined {
  const normalized = path.resolve(root);
  try {
    return readRegistry(base).realms.find((r) => path.resolve(r.root) === normalized);
  } catch {
    return undefined;
  }
}

function removalSafety(realm: RealmRegistryEntry, realms: RealmRegistryEntry[], base: string): string | undefined {
  const root = path.resolve(realm.root);
  if (containsOrEqual(root, path.resolve(base))) return 'the Realm root contains the registry base';
  const other = realms.find((r) => r.realm_id !== realm.realm_id && containsOrEqual(root, path.resolve(r.root)));
  if (other) return `the Realm root contains another registered Realm (${other.realm_id})`;
  return undefined;
}

function containsOrEqual(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
