// `memoring mcp` — start the read-only MCP stdio server (v0 optional). stdout is
// reserved for the JSON-RPC protocol; all logs go to stderr.
import { isActiveRealmSilence, openResolvedRealm } from '@core/runtime';
import { runStdioMcp } from '@retrieval/mcp';
import { log } from '@core/log';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { printActiveRealmSilence } from './resolve';

export async function cmdMcp(argv: string[] = []): Promise<number> {
  const flags = parseFlags(argv);
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  log.info('mcp:start', { realm_id: ctx.realmId });
  try {
    await runStdioMcp(ctx);
    return 0;
  } finally {
    ctx.close(true);
  }
}
