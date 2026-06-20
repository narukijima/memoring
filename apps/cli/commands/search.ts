// `memoring search <query>` — exact / FTS / n-gram fallback over the encrypted
// index. Locked Realm / unclassified / out-of-scope / secret never appear
// (FR-040..042). Not the lead command; `context build` is.
import { replicaLayout } from '@core/paths';
import { openRealm } from '@core/runtime';
import { resolveActiveProjects } from '@core/realm';
import { searchRealm } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';

export async function cmdSearch(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const query = flags._.join(' ').trim();
  if (!query) {
    console.error('Usage: memoring search <query> [--scope <label>] [--project <id>]');
    return 1;
  }
  const passphrase = await getPassphrase();
  const ctx = openRealm(passphrase, replicaLayout().root);
  try {
    // Restrict to active scope when resolvable; otherwise search the whole Realm
    // the owner just unlocked (still classified / non-secret only).
    let activeLabelIds: string[] | undefined;
    const res = resolveActiveProjects(ctx.config, {
      cwd: process.cwd(),
      scope: flags.scope as string | undefined,
      project: flags.project as string | undefined,
    });
    if (res.kind === 'resolved') activeLabelIds = resolveActiveLabelIds(ctx, res.projectIds, flags.scope as string | undefined);

    const results = searchRealm(ctx, query, { activeLabelIds });
    if (results.length === 0) {
      console.log('  No matches.');
      return 0;
    }
    for (const r of results) {
      console.log(`  ${r.ref_id} [${r.ref_type}] ${r.snippet}`);
    }
    return 0;
  } finally {
    ctx.close(false);
  }
}
