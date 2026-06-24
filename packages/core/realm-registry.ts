// Local plaintext registry for multiple Realms. It stores only ids/names/roots
// and never secrets or payload; each Realm's own realm.toml remains authoritative.
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { atomicWriteFile, ensureDir } from '@storage/fs-safety';
import { basePath, registryPath, replicaLayout } from './paths';
import { readRealmConfig } from './realm';

export type RealmRegistryKeyMode = 'local' | 'passphrase';

export interface RealmRegistryEntry {
  name: string;
  realm_id: string;
  root: string;
  created_at: string;
  key_mode: RealmRegistryKeyMode;
}

export interface RealmRegistry {
  current?: string;
  realms: RealmRegistryEntry[];
}

export class RealmRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RealmRegistryError';
  }
}

export class RealmNotFoundError extends RealmRegistryError {
  constructor(query: string) {
    super(`No registered Realm matches ${query}.`);
    this.name = 'RealmNotFoundError';
  }
}

export class DuplicateRealmNameError extends RealmRegistryError {
  constructor(name: string) {
    super(`Multiple registered Realms are named ${name}; use a Realm id.`);
    this.name = 'DuplicateRealmNameError';
  }
}

type RawRegistry = {
  current?: unknown;
  realms?: unknown;
};

function normalizeRoot(root: string): string {
  return path.resolve(root);
}

export function detectKeyMode(root: string): RealmRegistryKeyMode {
  const layout = replicaLayout(root);
  if (fs.existsSync(layout.keyBundle) && !fs.existsSync(layout.keyFile)) return 'passphrase';
  return 'local';
}

export function readRegistry(base = basePath()): RealmRegistry {
  const file = registryPath(base);
  if (!fs.existsSync(file)) return { realms: [] };
  const raw = parseToml(fs.readFileSync(file, 'utf8')) as RawRegistry;
  const realmsRaw = Array.isArray(raw.realms) ? raw.realms : [];
  const realms = realmsRaw.map((entry, i) => normalizeEntry(entry, i));
  const current = typeof raw.current === 'string' && raw.current.length > 0 ? raw.current : undefined;
  return current ? { current, realms } : { realms };
}

export function writeRegistry(registry: RealmRegistry, base = basePath()): void {
  ensureDir(base, 0o700);
  const current = registry.current && registry.realms.some((r) => r.realm_id === registry.current)
    ? registry.current
    : undefined;
  const data = current ? { current, realms: registry.realms } : { realms: registry.realms };
  atomicWriteFile(registryPath(base), stringifyToml(data as unknown as Record<string, unknown>), 0o600);
}

export function listRealms(base = basePath()): RealmRegistryEntry[] {
  return readRegistry(base).realms;
}

export function getCurrent(base = basePath()): RealmRegistryEntry | undefined {
  const registry = readRegistry(base);
  if (!registry.current) return undefined;
  return registry.realms.find((r) => r.realm_id === registry.current);
}

export function setCurrent(id: string | undefined, base = basePath()): void {
  const registry = readRegistry(base);
  writeRegistry(id ? { ...registry, current: id } : { realms: registry.realms }, base);
}

export function addRealm(entry: RealmRegistryEntry, base = basePath()): RealmRegistryEntry {
  const registry = readRegistry(base);
  const normalized: RealmRegistryEntry = { ...entry, root: normalizeRoot(entry.root) };
  const existing = registry.realms.find((r) => r.realm_id === normalized.realm_id);
  if (existing) {
    const next = registry.realms.map((r) => (r.realm_id === normalized.realm_id ? normalized : r));
    writeRegistry({ ...registry, realms: next }, base);
    return normalized;
  }
  if (registry.realms.some((r) => normalizeRoot(r.root) === normalized.root)) {
    throw new RealmRegistryError(`A registered Realm already uses root ${normalized.root}.`);
  }
  writeRegistry({ ...registry, realms: [...registry.realms, normalized] }, base);
  return normalized;
}

export function removeRealm(id: string, base = basePath()): RealmRegistryEntry | undefined {
  const registry = readRegistry(base);
  const removed = registry.realms.find((r) => r.realm_id === id);
  if (!removed) return undefined;
  const remaining = registry.realms.filter((r) => r.realm_id !== id);
  const current = registry.current === id ? nextCurrent(remaining) : registry.current;
  writeRegistry(current ? { realms: remaining, current } : { realms: remaining }, base);
  return removed;
}

export function findByNameOrId(query: string, base = basePath()): RealmRegistryEntry {
  const registry = readRegistry(base);
  const byId = registry.realms.find((r) => r.realm_id === query);
  if (byId) return byId;
  const byName = registry.realms.filter((r) => r.name === query);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) throw new DuplicateRealmNameError(query);
  throw new RealmNotFoundError(query);
}

export function ensureLegacyRegistered(base = basePath()): RealmRegistryEntry | undefined {
  const layout = replicaLayout(base);
  if (!fs.existsSync(layout.realmToml) || (!fs.existsSync(layout.keyFile) && !fs.existsSync(layout.keyBundle))) {
    return undefined;
  }
  const config = readRealmConfig(layout.realmToml);
  const entry: RealmRegistryEntry = {
    name: 'default',
    realm_id: config.realm_id,
    root: normalizeRoot(base),
    created_at: config.created_at,
    key_mode: detectKeyMode(base),
  };
  try {
    const registry = readRegistry(base);
    const byId = registry.realms.find((r) => r.realm_id === entry.realm_id);
    if (byId) {
      const updated = { ...entry, name: byId.name };
      writeRegistry({
        ...registry,
        realms: registry.realms.map((r) => (r.realm_id === entry.realm_id ? updated : r)),
      }, base);
      return updated;
    }
    const byRoot = registry.realms.find((r) => normalizeRoot(r.root) === entry.root);
    if (byRoot) return byRoot;
    addRealm(entry, base);
    return entry;
  } catch {
    // Direct-root access must keep working even if the convenience registry is
    // read-only or malformed.
    return entry;
  }
}

export function nextCurrent(realms: RealmRegistryEntry[]): string | undefined {
  if (realms.length === 0) return undefined;
  return [...realms].sort((a, b) => {
    const t = a.created_at.localeCompare(b.created_at);
    return t === 0 ? a.realm_id.localeCompare(b.realm_id) : t;
  })[0]!.realm_id;
}

function normalizeEntry(entry: unknown, index: number): RealmRegistryEntry {
  if (!entry || typeof entry !== 'object') throw new RealmRegistryError(`Invalid realms.toml entry at index ${index}.`);
  const raw = entry as Record<string, unknown>;
  const name = requiredString(raw.name, `realms[${index}].name`);
  const realmId = requiredString(raw.realm_id, `realms[${index}].realm_id`);
  const root = requiredString(raw.root, `realms[${index}].root`);
  const createdAt = requiredString(raw.created_at, `realms[${index}].created_at`);
  const keyMode = requiredString(raw.key_mode, `realms[${index}].key_mode`);
  if (keyMode !== 'local' && keyMode !== 'passphrase') {
    throw new RealmRegistryError(`Invalid key_mode for Realm ${realmId}.`);
  }
  return { name, realm_id: realmId, root: normalizeRoot(root), created_at: createdAt, key_mode: keyMode };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new RealmRegistryError(`Missing ${field}.`);
  return value;
}
