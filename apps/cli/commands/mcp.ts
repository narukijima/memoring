// `memoring mcp` — start the read-only MCP stdio server (v0 optional). stdout is
// reserved for the JSON-RPC protocol; all logs go to stderr.
import { replicaLayout } from '@core/paths';
import { openActiveRealm } from '@core/runtime';
import { runStdioMcp } from '@retrieval/mcp';
import { log } from '@core/log';
import { getPassphrase } from '../prompt';

export async function cmdMcp(): Promise<number> {
  const ctx = await openActiveRealm(replicaLayout().root, getPassphrase);
  log.info('mcp:start', { realm_id: ctx.realmId });
  try {
    await runStdioMcp(ctx);
    return 0;
  } finally {
    ctx.close(true);
  }
}
