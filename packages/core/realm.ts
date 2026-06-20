// Realm = 1 identity = 1 trust boundary = 1 key (Glossary). A replica holds
// exactly one Realm. Active Realm / active scope resolution must run *before*
// unlocking, so the resolution basis (root_paths / git_remotes) lives in the
// plaintext realm.toml (Specification §5.1). Label sets live in the encrypted DB
// and are resolved after unlock.
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { atomicWriteFile } from '@storage/fs-safety';

export interface RealmProjectConfig {
  project_id: string;
  name: string;
  root_paths: string[];
  git_remotes: string[];
  /**
   * Explicit project policy: default sensitivity for this project's scope. This
   * is a non-AI Declassify authority (Detailed Design §4.3) recorded at connect
   * time by the user's explicit inclusion of the source; classify uses it to set
   * events from unknown to this value (never to lower an already-higher value).
   */
  default_sensitivity?: 'public' | 'internal' | 'confidential';
}

export interface RealmConnectorConfig {
  connector_instance_id: string;
  connector_id: string;
  source_stable_ids: string[];
}

export interface RealmConfig {
  schema: 'realm.v1';
  realm_id: string;
  name: string;
  created_at: string;
  projects: RealmProjectConfig[];
  connectors: RealmConnectorConfig[];
}

export function readRealmConfig(realmTomlPath: string): RealmConfig {
  const raw = parseToml(fs.readFileSync(realmTomlPath, 'utf8')) as unknown as Partial<RealmConfig>;
  return {
    schema: 'realm.v1',
    realm_id: raw.realm_id!,
    name: raw.name ?? 'default',
    created_at: raw.created_at!,
    projects: raw.projects ?? [],
    connectors: raw.connectors ?? [],
  };
}

export function writeRealmConfig(realmTomlPath: string, config: RealmConfig): void {
  atomicWriteFile(realmTomlPath, stringifyToml(config as unknown as Record<string, unknown>), 0o600);
}

export function canonicalize(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Read the CWD's git remote URLs from plaintext .git/config (no subprocess), for
 *  §3.4 active-scope resolution. Walks up to the repo root; returns [] if none. */
function cwdGitRemotes(cwd: string): string[] {
  let dir = canonicalize(cwd);
  for (let i = 0; i < 32; i++) {
    try {
      const cfg = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8');
      const urls: string[] = [];
      const re = /^\s*url\s*=\s*(.+?)\s*$/gim;
      let m: RegExpExecArray | null;
      while ((m = re.exec(cfg)) !== null) urls.push(m[1]!);
      return urls;
    } catch {
      /* not a repo at this level — keep walking up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [];
}

/**
 * Active Realm resolution (§6.5). A replica holds one Realm, so resolution is
 * trivial unless an explicit --realm is given that does not match.
 */
export function resolveActiveRealm(config: RealmConfig, explicitRealm?: string): string | 'silence' {
  if (explicitRealm && explicitRealm !== config.realm_id) return 'silence';
  return config.realm_id;
}

export type ScopeResolution =
  | { kind: 'resolved'; projectIds: string[]; basis: 'cli_scope' | 'cli_project' | 'cwd_project_match' }
  | { kind: 'silence'; reason: string };

/**
 * Resolve the active project(s) (Detailed Design §3.4 steps 1–4). The label set
 * derived from these projects is computed later against the unlocked DB. CLI
 * --scope/--project win; otherwise the canonical CWD must match exactly one
 * registered project, else Silence.
 */
export function resolveActiveProjects(
  config: RealmConfig,
  opts: { cwd: string; scope?: string; project?: string },
): ScopeResolution {
  if (opts.scope) {
    // --scope names a label directly; project set is unconstrained (all registered).
    return { kind: 'resolved', projectIds: config.projects.map((p) => p.project_id), basis: 'cli_scope' };
  }
  if (opts.project) {
    const match = config.projects.find((p) => p.project_id === opts.project || p.name === opts.project);
    if (!match) return { kind: 'silence', reason: `No registered project matches --project ${opts.project}` };
    return { kind: 'resolved', projectIds: [match.project_id], basis: 'cli_project' };
  }
  const cwd = canonicalize(opts.cwd);
  // §3.4 step 2: match the canonical CWD against Project.root_paths AND git_remotes.
  // git_remotes are read (only when any project registers one) from the CWD's
  // plaintext .git/config — resolution runs before unlock, so no DB access.
  const anyRemotes = config.projects.some((p) => p.git_remotes.length > 0);
  const remotes = anyRemotes ? new Set(cwdGitRemotes(opts.cwd)) : new Set<string>();
  const matches = config.projects.filter(
    (p) =>
      p.root_paths.some((root) => {
        const r = canonicalize(root);
        return cwd === r || cwd.startsWith(r + path.sep);
      }) || p.git_remotes.some((g) => remotes.has(g)),
  );
  if (matches.length === 1) {
    return { kind: 'resolved', projectIds: [matches[0]!.project_id], basis: 'cwd_project_match' };
  }
  if (matches.length === 0) {
    return { kind: 'silence', reason: 'CWD does not match any registered project root' };
  }
  return { kind: 'silence', reason: 'CWD matches multiple projects; specify --project/--scope' };
}
