import fs from 'node:fs';
import { replicaLayout } from '@core/paths';
import { isActiveRealmSilence, replicaExists, resolveActiveReplicaRoot } from '@core/runtime';
import { readRealmConfig, writeRealmConfig } from '@core/realm';
import { createReplicaAtRoot, registerCreatedReplica } from './init';
import { validateConfiguration } from '../config-diagnostics';
import { ask } from '../prompt';
import { parseFlags } from '../args';
import { isLoopback } from '@integrations/llm/openai-compatible';
import { fetchLoopbackModels, resolveModelStatus } from '@integrations/llm/model-config';

export async function cmdConfigure(argv: string[] = []): Promise<number> {
  const flags = parseFlags(argv);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('memoring configure is interactive. Run it in a TTY, or use `memoring init` and `memoring config set local-model` directly.');
    return 1;
  }

  console.log('Memoring configure');
  let root = resolveActiveReplicaRoot({ flags, cwd: process.cwd(), commandClass: 'mgmt' });
  if (isActiveRealmSilence(root) || !replicaExists(root)) {
    const layout = replicaLayout();
    if (fs.existsSync(layout.realmToml) || fs.existsSync(layout.keyFile) || fs.existsSync(layout.keyBundle)) {
      console.log(`  Realm is not ready: ${isActiveRealmSilence(root) ? root.silence : 'replica incomplete'}.`);
      console.log('  Run `memoring realm current` or repair the existing replica, then retry.');
      return 1;
    }
    const init = (await ask(`  No Realm found at ${layout.root}. Initialize it now? [Y/n] `)).trim().toLowerCase();
    if (init === 'n' || init === 'no') {
      console.log('  Stopped. Run `memoring init` when ready.');
      return 1;
    }
    const created = createReplicaAtRoot({ root: layout.root, name: 'default', usePassphrase: false });
    registerCreatedReplica(created);
    root = layout.root;
    console.log(`  Initialized Realm ${created.config.name} (${created.config.realm_id}).`);
  }
  if (isActiveRealmSilence(root)) {
    console.error(`  ${root.silence}.`);
    return 1;
  }

  const tomlPath = replicaLayout(root).realmToml;
  const config = readRealmConfig(tomlPath);
  console.log(`  Current Realm: ${config.name} (${config.realm_id})`);
  console.log('');
  console.log('Local model');
  console.log(`  Current base URL: ${config.llm?.base_url ?? 'unset'}`);
  console.log(`  Current model   : ${config.llm?.model ?? 'unset'}`);
  const base = (await ask('  Local loopback base URL (blank to keep/unset, e.g. http://127.0.0.1:11434/v1): ')).trim();
  if (base.length > 0) {
    if (!isLoopback(base)) {
      console.log('  Not saved: only loopback URLs can be stored in realm.toml.');
      console.log('  Remote providers stay env-only: set MEMORING_LLM_BASE_URL, MEMORING_LLM_MODEL, MEMORING_LLM_API_KEY, and MEMORING_LLM_REMOTE_OPT_IN=1.');
    } else {
      const model = (await ask('  Model id: ')).trim();
      if (!model) {
        console.log('  Not saved: model id is required.');
      } else {
        config.llm = { base_url: base, model, egress: 'local' };
        writeRealmConfig(tomlPath, config);
        console.log('  Local model saved in realm.toml.');
      }
    }
  }

  console.log('');
  printValidation();
  console.log('');
  await printModelCheck(readRealmConfig(tomlPath).llm);
  return 0;
}

function printValidation(): void {
  const result = validateConfiguration();
  console.log('Config validation');
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.level === 'ok' || diagnostic.level === 'error') console.log(`  [${diagnostic.level}] ${diagnostic.message}`);
    else console.log(`  [warn] ${diagnostic.message}`);
  }
}

async function printModelCheck(llm: ReturnType<typeof readRealmConfig>['llm']): Promise<void> {
  console.log('Model status');
  for (const status of [resolveModelStatus('loop', llm), resolveModelStatus('output', llm)]) {
    console.log(`  ${status.label}: ${status.model ?? 'unset'} / ${status.egress ?? 'unknown'} / ${status.usable ? 'usable' : status.issue}`);
  }
  const loop = resolveModelStatus('loop', llm);
  const models = await fetchLoopbackModels(loop.baseURL, { apiKey: process.env.MEMORING_LLM_API_KEY });
  if (models.queried) console.log(`  loopback candidates: ${models.error ? `unavailable (${models.error})` : models.models.join(', ') || 'none'}`);
}
