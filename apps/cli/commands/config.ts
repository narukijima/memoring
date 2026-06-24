// `memoring config ...` — local operator configuration that does not require
// opening the encrypted DB. Only non-secret provider coordinates are persisted in
// realm.toml; API keys remain env/keychain-only.
import { isLoopback } from '@integrations/llm/openai-compatible';
import { replicaLayout } from '@core/paths';
import { isActiveRealmSilence, resolveActiveReplicaRoot } from '@core/runtime';
import { readRealmConfig, writeRealmConfig, type RealmLlmConfig } from '@core/realm';
import { parseFlags, type Flags } from '../args';

export async function cmdConfig(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const sub = flags._[0];
  if (sub === 'show') return cmdConfigShow(flags);
  if (sub === 'set' && flags._[1] === 'local-model') return cmdConfigSetLocalModel(flags);
  if ((sub === 'unset' || sub === 'clear') && flags._[1] === 'local-model') return cmdConfigUnsetLocalModel(flags);
  console.error('Usage: memoring config show | set local-model --base-url <url> --model <id> | unset local-model');
  return 1;
}

function resolveRealmConfigPath(flags: Flags): string | undefined {
  const root = resolveActiveReplicaRoot({
    flags,
    cwd: process.cwd(),
    commandClass: 'mgmt',
  });
  if (isActiveRealmSilence(root)) {
    console.error(`  ${root.silence}.`);
    return undefined;
  }
  return replicaLayout(root).realmToml;
}

function cmdConfigShow(flags: Flags): number {
  const configPath = resolveRealmConfigPath(flags);
  if (!configPath) return 1;
  const config = readRealmConfig(configPath);
  console.log(`  Realm: ${config.name} (${config.realm_id})`);
  printLlm(config.llm);
  return 0;
}

function cmdConfigSetLocalModel(flags: Flags): number {
  const configPath = resolveRealmConfigPath(flags);
  if (!configPath) return 1;
  const baseUrl = stringFlag(flags, 'base-url') ?? flags._[2];
  const model = stringFlag(flags, 'model') ?? flags._[3];
  if (!baseUrl || !model) {
    console.error('Usage: memoring config set local-model --base-url <url> --model <id>');
    return 1;
  }
  const error = validateLocalBaseUrl(baseUrl);
  if (error) {
    console.error(`  ${error}`);
    return 1;
  }

  const config = readRealmConfig(configPath);
  config.llm = { base_url: baseUrl, model, egress: 'local' };
  writeRealmConfig(configPath, config);
  console.log(`  Local model configured for Realm ${config.name} (${config.realm_id}).`);
  printLlm(config.llm);
  return 0;
}

function cmdConfigUnsetLocalModel(flags: Flags): number {
  const configPath = resolveRealmConfigPath(flags);
  if (!configPath) return 1;
  const config = readRealmConfig(configPath);
  delete config.llm;
  writeRealmConfig(configPath, config);
  console.log(`  Local model config cleared for Realm ${config.name} (${config.realm_id}).`);
  return 0;
}

function validateLocalBaseUrl(raw: string): string | undefined {
  try {
    new URL(raw);
  } catch {
    return `Invalid --base-url ${raw}`;
  }
  if (!isLoopback(raw)) {
    return 'local-model requires a loopback base URL (localhost / 127.0.0.1 / ::1). Use env-based remote opt-in for remote providers.';
  }
  return undefined;
}

function printLlm(llm: RealmLlmConfig | undefined): void {
  if (!llm) {
    console.log('  Local model: unset');
    return;
  }
  console.log(`  Local model: ${llm.model}`);
  console.log(`  Base URL   : ${llm.base_url}`);
  console.log(`  Egress     : ${llm.egress ?? 'auto'}`);
}

function stringFlag(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
