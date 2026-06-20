// `memoring index rebuild` — deterministically rebuild the search index from the
// lower layers / Chronicle (NFR-006). The index is a regenerable projection.
import { replicaLayout } from '@core/paths';
import { openRealm } from '@core/runtime';
import { rebuildIndex } from '@retrieval/search';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';

export async function cmdIndex(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const sub = flags._[0];
  if (sub !== 'rebuild') {
    console.error('Usage: memoring index rebuild');
    return 1;
  }
  const passphrase = await getPassphrase();
  const ctx = openRealm(passphrase, replicaLayout().root);
  try {
    const stats = rebuildIndex(ctx);
    ctx.flush();
    console.log(`  Reindexed ${stats.events} event(s), ${stats.claims} claim(s).`);
    return 0;
  } finally {
    ctx.close(true);
  }
}
