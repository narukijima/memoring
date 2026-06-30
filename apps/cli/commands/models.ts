import { replicaLayout } from '@core/paths';
import { isActiveRealmSilence, replicaExists, resolveActiveReplicaRoot } from '@core/runtime';
import { readRealmConfig } from '@core/realm';
import { fetchLoopbackModels, resolveModelStatus, type ModelStatus } from '@integrations/llm/model-config';
import { parseFlags } from '../args';

export async function cmdModels(argv: string[] = []): Promise<number> {
  const flags = parseFlags(argv);
  const sub = flags._[0];
  if (sub !== 'status') {
    console.error('Usage: memoring models status');
    return 1;
  }
  const resolved = resolveActiveReplicaRoot({ flags, cwd: process.cwd(), commandClass: 'mgmt' });
  if (isActiveRealmSilence(resolved)) {
    console.error(`  ${resolved.silence}.`);
    return 1;
  }
  const layout = replicaLayout(resolved);
  if (!replicaExists(layout.root)) {
    console.error(`  No replica found at ${layout.root}. Run \`memoring init\`.`);
    return 1;
  }

  const config = readRealmConfig(layout.realmToml);
  console.log('Memoring models');
  console.log(`  Realm: ${config.name} (${config.realm_id})`);
  console.log(`  Config: ${layout.realmToml}`);
  console.log('');
  await printStatus(resolveModelStatus('loop', config.llm));
  console.log('');
  await printStatus(resolveModelStatus('output', config.llm));
  return 0;
}

async function printStatus(status: ModelStatus): Promise<void> {
  console.log(`${status.label}:`);
  console.log(`  configured     : ${status.configured ? 'yes' : 'no'}`);
  console.log(`  model          : ${status.model ?? 'unset'} (${status.modelSource})`);
  console.log(`  base_url       : ${status.baseURL ?? 'unset'} (${status.baseSource})`);
  console.log(`  local/remote   : ${status.egress ?? 'unknown'}${status.loopback ? ' (loopback)' : ''}`);
  console.log(`  egress source  : ${status.egressSource}`);
  console.log(`  remote opt-in  : ${status.remoteOptIn ? 'on' : 'off'}`);
  console.log(`  usable         : ${status.usable ? 'yes' : `no (${status.issue ?? 'unusable'})`}`);
  const listed = await fetchLoopbackModels(status.baseURL, { apiKey: process.env.MEMORING_LLM_API_KEY });
  if (!listed.queried) {
    const reason = listed.skippedReason === 'proxy_remote' ? 'proxy mode is remote egress' : 'not a loopback endpoint';
    console.log(`  /models        : skipped (${reason})`);
    return;
  }
  if (listed.error) {
    console.log(`  /models        : unavailable (${listed.error})`);
    return;
  }
  console.log(`  /models        : ${listed.models.length > 0 ? listed.models.join(', ') : 'no models returned'}`);
}
