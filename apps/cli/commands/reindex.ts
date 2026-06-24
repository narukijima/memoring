// `memoring index rebuild` — deterministically rebuild the search index from the
// lower layers / Chronicle (NFR-006). The index is a regenerable projection.
import { isActiveRealmSilence, openResolvedRealm } from '@core/runtime';
import { rebuildIndex } from '@retrieval/search';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { printActiveRealmSilence } from './resolve';

export async function cmdIndex(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const sub = flags._[0];
  if (sub !== 'rebuild') {
    console.error('Usage: memoring index rebuild');
    return 1;
  }
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  try {
    const stats = rebuildIndex(ctx);
    ctx.flush();
    console.log(`  Reindexed ${stats.events} event(s), ${stats.claims} claim(s).`);
    return 0;
  } finally {
    ctx.close(true);
  }
}
