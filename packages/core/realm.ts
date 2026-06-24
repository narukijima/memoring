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

export interface RealmLlmConfig {
  base_url: string;
  model: string;
  egress?: 'local' | 'remote';
}

export interface RealmConfig {
  schema: 'realm.v1';
  realm_id: string;
  name: string;
  created_at: string;
  projects: RealmProjectConfig[];
  connectors: RealmConnectorConfig[];
  llm?: RealmLlmConfig;
}

export function readRealmConfig(realmTomlPath: string): RealmConfig {
  const raw = parseToml(fs.readFileSync(realmTomlPath, 'utf8')) as unknown as Partial<RealmConfig>;
  const llm = normalizeLlmConfig(raw.llm);
  return {
    schema: 'realm.v1',
    realm_id: raw.realm_id!,
    name: raw.name ?? 'default',
    created_at: raw.created_at!,
    projects: raw.projects ?? [],
    connectors: raw.connectors ?? [],
    ...(llm ? { llm } : {}),
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

function normalizeLlmConfig(raw: unknown): RealmLlmConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const baseUrl = value.base_url;
  const model = value.model;
  const egress = value.egress;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0 || typeof model !== 'string' || model.length === 0) {
    return undefined;
  }
  return {
    base_url: baseUrl,
    model,
    ...(egress === 'local' || egress === 'remote' ? { egress } : {}),
  };
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

function matchingProjectsForCwd(config: RealmConfig, cwdRaw: string): RealmProjectConfig[] {
  const cwd = canonicalize(cwdRaw);
  // §3.4 step 2: match the canonical CWD against Project.root_paths AND git_remotes.
  // git_remotes are read (only when any project registers one) from the CWD's
  // plaintext .git/config — resolution runs before unlock, so no DB access.
  const anyRemotes = config.projects.some((p) => p.git_remotes.length > 0);
  const remotes = anyRemotes ? new Set(cwdGitRemotes(cwdRaw)) : new Set<string>();
  return config.projects.filter(
    (p) =>
      p.root_paths.some((root) => {
        const r = canonicalize(root);
        return cwd === r || cwd.startsWith(r + path.sep);
      }) || p.git_remotes.some((g) => remotes.has(g)),
  );
}

export interface ActiveRealmCandidate {
  root: string;
}

export type ActiveRealmResolution =
  | { kind: 'resolved'; root: string; realmId: string; config: RealmConfig }
  | { kind: 'silence'; reason: string };

export function resolveActiveRealmByCwd(candidates: ActiveRealmCandidate[], cwd: string): ActiveRealmResolution {
  const matches: { root: string; config: RealmConfig }[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const realmToml = path.join(candidate.root, 'realm.toml');
    if (!fs.existsSync(realmToml)) continue;
    const config = readRealmConfig(realmToml);
    if (seen.has(config.realm_id)) continue;
    if (matchingProjectsForCwd(config, cwd).length > 0) {
      matches.push({ root: candidate.root, config });
      seen.add(config.realm_id);
    }
  }
  if (matches.length === 1) {
    const match = matches[0]!;
    return { kind: 'resolved', root: match.root, realmId: match.config.realm_id, config: match.config };
  }
  if (matches.length === 0) return { kind: 'silence', reason: 'Active Realm unresolved: CWD matches no registered Realm' };
  return { kind: 'silence', reason: 'Active Realm unresolved: CWD matches multiple registered Realms' };
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
  const matches = matchingProjectsForCwd(config, opts.cwd);
  if (matches.length === 1) {
    return { kind: 'resolved', projectIds: [matches[0]!.project_id], basis: 'cwd_project_match' };
  }
  if (matches.length === 0) {
    return { kind: 'silence', reason: 'CWD does not match any registered project root' };
  }
  return { kind: 'silence', reason: 'CWD matches multiple projects; specify --project/--scope' };
}
