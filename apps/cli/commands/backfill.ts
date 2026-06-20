// `memoring backfill` — ingest history from the registered sources by running
// the loop once (capture → normalize → classify → abstract → consolidate). OFF
// by default at init; this is the explicit opt-in path (FR-010).
import { replicaLayout } from '@core/paths';
import { openRealm } from '@core/runtime';
import { runLoop } from '@core/loop';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { printLoopStats } from './connect';

export async function cmdBackfill(argv: string[]): Promise<number> {
  parseFlags(argv); // reserved: --since / --dry-run (not yet implemented)
  const passphrase = await getPassphrase();
  const ctx = openRealm(passphrase, replicaLayout().root);
  try {
    if (ctx.config.connectors.length === 0) {
      console.log('  No connectors configured. Run `memoring connect claude-code` first.');
      return 0;
    }
    const stats = await runLoop(ctx, { method: 'backfill' });
    printLoopStats(stats);
    return 0;
  } finally {
    ctx.close(true);
  }
}
