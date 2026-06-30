import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { basePath, registryPath, replicaLayout } from '@core/paths';
import { readRealmConfig, type RealmConfig, type RealmLlmConfig } from '@core/realm';
import { readRegistry } from '@core/realm-registry';
import { isLoopback } from '@integrations/llm/openai-compatible';
import { truthyEnv } from '@integrations/llm/model-config';

export type DiagnosticLevel = 'ok' | 'warn' | 'error';

export interface ConfigDiagnostic {
  level: DiagnosticLevel;
  message: string;
}

export interface ConfigValidationResult {
  diagnostics: ConfigDiagnostic[];
  errorCount: number;
  warningCount: number;
}

export function validateConfiguration(base = basePath()): ConfigValidationResult {
  const diagnostics: ConfigDiagnostic[] = [];
  const registryFile = registryPath(base);
  const roots = new Map<string, string>();

  if (fs.existsSync(registryFile)) {
    validateMode(registryFile, 'realms.toml', diagnostics);
    try {
      parseToml(fs.readFileSync(registryFile, 'utf8'));
      const registry = readRegistry(base);
      const ids = new Set<string>();
      const rootPaths = new Set<string>();
      if (registry.current && !registry.realms.some((r) => r.realm_id === registry.current)) {
        diagnostics.push({ level: 'error', message: 'realms.toml current points to an unregistered Realm.' });
      }
      for (const entry of registry.realms) {
        if (ids.has(entry.realm_id)) diagnostics.push({ level: 'error', message: `duplicate Realm id in registry: ${entry.realm_id}` });
        ids.add(entry.realm_id);
        const normalizedRoot = path.resolve(entry.root);
        if (rootPaths.has(normalizedRoot)) diagnostics.push({ level: 'error', message: `duplicate Realm root in registry: ${normalizedRoot}` });
        rootPaths.add(normalizedRoot);
        roots.set(entry.realm_id, normalizedRoot);
        validateRegistryEntry(entry.realm_id, normalizedRoot, entry.name, diagnostics);
      }
      if (registry.realms.length === 0) diagnostics.push({ level: 'warn', message: 'realms.toml has no registered Realms.' });
    } catch (e) {
      diagnostics.push({ level: 'error', message: `realms.toml is unreadable or invalid TOML: ${(e as Error).message}` });
    }
  }

  const legacy = replicaLayout(base);
  if (fs.existsSync(legacy.realmToml)) {
    try {
      const config = readRealmConfig(legacy.realmToml);
      roots.set(config.realm_id, legacy.root);
    } catch {
      roots.set('legacy', legacy.root);
    }
  }

  if (roots.size === 0) {
    diagnostics.push({ level: 'error', message: 'No Realm configuration found. Run `memoring init` first.' });
  }

  for (const root of new Set(roots.values())) validateRealmRoot(root, diagnostics);

  const errorCount = diagnostics.filter((d) => d.level === 'error').length;
  const warningCount = diagnostics.filter((d) => d.level === 'warn').length;
  if (errorCount === 0 && warningCount === 0) {
    diagnostics.push({ level: 'ok', message: 'configuration metadata looks consistent.' });
  }
  return { diagnostics, errorCount, warningCount };
}

function validateRegistryEntry(realmId: string, root: string, registryName: string, diagnostics: ConfigDiagnostic[]): void {
  const layout = replicaLayout(root);
  if (!fs.existsSync(root)) {
    diagnostics.push({ level: 'error', message: `registered Realm ${realmId} root does not exist: ${root}` });
    return;
  }
  if (!fs.existsSync(layout.realmToml)) {
    diagnostics.push({ level: 'error', message: `registered Realm ${realmId} has no realm.toml at ${layout.realmToml}` });
    return;
  }
  try {
    const config = readRealmConfig(layout.realmToml);
    if (config.realm_id !== realmId) {
      diagnostics.push({ level: 'error', message: `registry Realm id ${realmId} does not match realm.toml id ${config.realm_id}.` });
    }
    if (config.name !== registryName) {
      diagnostics.push({ level: 'warn', message: `registry name for ${realmId} differs from realm.toml name.` });
    }
  } catch (e) {
    diagnostics.push({ level: 'error', message: `registered Realm ${realmId} realm.toml is invalid: ${(e as Error).message}` });
  }
}

function validateRealmRoot(root: string, diagnostics: ConfigDiagnostic[]): void {
  const layout = replicaLayout(root);
  validateMode(root, `Realm root ${root}`, diagnostics, 0o077);
  if (!fs.existsSync(layout.realmToml)) {
    diagnostics.push({ level: 'error', message: `missing realm.toml at ${layout.realmToml}` });
    return;
  }
  validateMode(layout.realmToml, 'realm.toml', diagnostics);

  let raw: Record<string, unknown>;
  let config: RealmConfig;
  try {
    raw = parseToml(fs.readFileSync(layout.realmToml, 'utf8')) as Record<string, unknown>;
    config = readRealmConfig(layout.realmToml);
  } catch (e) {
    diagnostics.push({ level: 'error', message: `realm.toml is unreadable or invalid TOML: ${(e as Error).message}` });
    return;
  }

  if (raw.schema !== 'realm.v1') diagnostics.push({ level: 'error', message: `Realm ${config.realm_id} uses unsupported schema.` });
  if (!config.realm_id) diagnostics.push({ level: 'error', message: 'realm.toml is missing realm_id.' });
  if (!config.created_at) diagnostics.push({ level: 'error', message: `Realm ${config.realm_id} is missing created_at.` });
  validateSecretKeys(raw, `Realm ${config.realm_id} realm.toml`, diagnostics);
  validateLlmConfig(raw.llm, config.llm, diagnostics);
  validateProjects(config, diagnostics);
  validateConnectors(config, layout.connectorsDir, diagnostics);
}

function validateProjects(config: RealmConfig, diagnostics: ConfigDiagnostic[]): void {
  const ids = new Set<string>();
  for (const project of config.projects) {
    if (!project.project_id || !project.name) diagnostics.push({ level: 'error', message: `Realm ${config.realm_id} has a project with missing id/name.` });
    if (ids.has(project.project_id)) diagnostics.push({ level: 'error', message: `Realm ${config.realm_id} has duplicate project id ${project.project_id}.` });
    ids.add(project.project_id);
    for (const rootPath of project.root_paths) {
      if (!path.isAbsolute(rootPath)) diagnostics.push({ level: 'warn', message: `project ${project.project_id} root_path is not absolute.` });
    }
  }
}

function validateConnectors(config: RealmConfig, connectorsDir: string, diagnostics: ConfigDiagnostic[]): void {
  const ids = new Set<string>();
  for (const connector of config.connectors) {
    if (!connector.connector_instance_id || !connector.connector_id) {
      diagnostics.push({ level: 'error', message: `Realm ${config.realm_id} has a connector with missing id.` });
    }
    if (ids.has(connector.connector_instance_id)) {
      diagnostics.push({ level: 'error', message: `Realm ${config.realm_id} has duplicate connector instance ${connector.connector_instance_id}.` });
    }
    ids.add(connector.connector_instance_id);
    if (connector.source_stable_ids.length === 0) {
      diagnostics.push({ level: 'warn', message: `connector ${connector.connector_instance_id} has no selected sources.` });
    }
  }
  if (fs.existsSync(connectorsDir)) {
    validateMode(connectorsDir, 'connectors directory', diagnostics, 0o077);
    for (const entry of fs.readdirSync(connectorsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(connectorsDir, entry.name);
      validateMode(file, `connector config ${entry.name}`, diagnostics);
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = parseConnectorConfig(entry.name, raw);
        validateSecretKeys(parsed, `connector config ${entry.name}`, diagnostics);
      } catch (e) {
        diagnostics.push({ level: 'error', message: `connector config ${entry.name} is invalid: ${(e as Error).message}` });
      }
    }
  }
}

function parseConnectorConfig(name: string, raw: string): unknown {
  if (name.endsWith('.json')) return JSON.parse(raw) as unknown;
  if (name.endsWith('.toml')) return parseToml(raw) as unknown;
  if (name.endsWith('.jsonl')) {
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
  }
  return {};
}

function validateLlmConfig(raw: unknown, llm: RealmLlmConfig | undefined, diagnostics: ConfigDiagnostic[]): void {
  if (raw === undefined) return;
  if (!raw || typeof raw !== 'object') {
    diagnostics.push({ level: 'error', message: '[llm] must be a table when present.' });
    return;
  }
  const value = raw as Record<string, unknown>;
  validateSecretKeys(value, '[llm]', diagnostics);
  if (typeof value.base_url !== 'string' || value.base_url.length === 0) {
    diagnostics.push({ level: 'error', message: '[llm].base_url must be a non-empty URL string.' });
  } else {
    try {
      new URL(value.base_url);
    } catch {
      diagnostics.push({ level: 'error', message: '[llm].base_url is not a valid URL.' });
    }
  }
  if (typeof value.model !== 'string' || value.model.length === 0) {
    diagnostics.push({ level: 'error', message: '[llm].model must be a non-empty string.' });
  }
  if (value.egress !== undefined && value.egress !== 'local' && value.egress !== 'remote') {
    diagnostics.push({ level: 'error', message: '[llm].egress must be local or remote.' });
  }
  if (!llm) return;
  if (llm.egress === 'local' && !isLoopback(llm.base_url)) {
    diagnostics.push({ level: 'error', message: '[llm].egress=local requires a loopback base_url.' });
  }
  if (llm.egress === 'remote' || (!isLoopback(llm.base_url) && llm.egress !== 'local')) {
    if (!truthyEnv(process.env.MEMORING_LLM_REMOTE_OPT_IN)) {
      diagnostics.push({ level: 'warn', message: '[llm] points to a remote endpoint; remote AI remains default-off until MEMORING_LLM_REMOTE_OPT_IN=1.' });
    }
  }
}

function validateSecretKeys(value: unknown, context: string, diagnostics: ConfigDiagnostic[], pathParts: string[] = []): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = [...pathParts, key];
    if (/(api[_-]?key|token|secret|password|passphrase)/i.test(key)) {
      diagnostics.push({ level: 'error', message: `${context} contains forbidden secret-like key ${next.join('.')}; keep secrets in env/keychain only.` });
    }
    validateSecretKeys(child, context, diagnostics, next);
  }
}

function validateMode(file: string, label: string, diagnostics: ConfigDiagnostic[], mask = 0o077): void {
  try {
    const mode = fs.statSync(file).mode & 0o777;
    if (mode & mask) diagnostics.push({ level: 'warn', message: `${label} mode is ${mode.toString(8)}; 0600 files / 0700 directories recommended.` });
  } catch {
    diagnostics.push({ level: 'warn', message: `could not inspect permissions for ${label}.` });
  }
}
