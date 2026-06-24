// `memoring realm ...` — first-class local multi-Realm management. The registry
// is plaintext metadata only; each per-Realm realm.toml remains authoritative.
// Lifecycle writes (new/use/rename/rm) and their audit live in the shared
// orchestrators (realm-actions), which the web panel reuses (ADR-0010 §1).
import path from 'node:path';
import { basePath, replicaLayout } from '@core/paths';
import {
  ensureLegacyRegistered,
  findByNameOrId,
  getCurrent,
  listRealms,
  readRegistry,
  type RealmRegistryEntry,
} from '@core/realm-registry';
import { openRealmLocal, resolveActiveReplicaRoot, isActiveRealmSilence } from '@core/runtime';
import { readRealmConfig } from '@core/realm';
import { ask, getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { confirm } from './forget';
import { createRealm, deleteRealm, removalSafety, renameRealm, setActiveRealm, RealmActionError } from '../realm-actions';

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
  const usePassphrase = flags.passphrase === true || typeof flags.passphrase === 'string';
  const passphrase = usePassphrase ? await collectPassphrase() : undefined;
  if (usePassphrase && !passphrase) return 1;

  let created;
  try {
    created = createRealm({ name, usePassphrase, passphrase, base });
  } catch (e) {
    if (e instanceof RealmActionError) {
      console.error(`  ${e.message}`);
      return 1;
    }
    throw e;
  }

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
  const realm = setActiveRealm(query, base);
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
  let result;
  try {
    result = renameRealm(query, newName, base);
  } catch (e) {
    if (e instanceof RealmActionError) {
      console.error(`  ${e.message}`);
      return 1;
    }
    throw e;
  }
  console.log(`  Renamed Realm ${result.realm.realm_id}: ${result.previousName} -> ${newName}`);
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

  // The shared orchestrator deletes the on-disk replica FIRST, then drops the
  // registry entry, then audits — keeping the Realm re-removable across a crash
  // and never orphaning secret material (see realm-actions.deleteRealm).
  const { removed, current } = deleteRealm(realm.realm_id, base);
  console.log(`  Removed Realm ${removed.name} (${removed.realm_id}).`);
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
