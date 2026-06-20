// `memoring reprocess [--parser <ver>]` — re-parse stored Undiluted with the
// current Parser. event_identity is rotation/blob-invariant, so reprocessing
// produces no duplicate Events and never leaves Claim evidence dangling (G11);
// candidates matching an active SealRule do not revive (§4.15).
import { replicaLayout } from '@core/paths';
import { openRealm, type RealmContext } from '@core/runtime';
import { normalizeOccurrence } from '@intake/normalize';
import { getConnector } from '@intake/registry';
import { indexEvent } from '@retrieval/search';
import { classifyEvent } from '@claim/classify';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';

export async function cmdReprocess(argv: string[]): Promise<number> {
  parseFlags(argv); // --parser reserved (v0 has a single parser version per connector)
  const passphrase = await getPassphrase();
  const ctx = openRealm(passphrase, replicaLayout().root);
  try {
    let reEvents = 0;
    let occurrences = 0;
    // Walk every source's occurrences and re-normalize from the stored raw.
    for (const source of sourcesOf(ctx)) {
      const connector = getConnector(source.connector_id);
      if (!connector) continue;
      for (const occ of occurrencesForSource(ctx, source.source_id)) {
        const u = ctx.store.getUndiluted(occ.undiluted_id);
        if (!u || u.status !== 'active') continue;
        occurrences += 1;
        const res = normalizeOccurrence(ctx, source, occ, u, connector);
        for (const e of res.events) {
          classifyEvent(ctx, e);
          const cur = ctx.store.getEvent(e.event_id);
          if (cur) indexEvent(ctx, cur);
        }
        reEvents += res.events.length;
      }
    }
    ctx.chronicler.append('reindex', ctx.realmId);
    ctx.flush();
    console.log(`  Reprocessed ${occurrences} occurrence(s); ${reEvents} new event(s) (identity-stable, no dup).`);
    return 0;
  } finally {
    ctx.close(true);
  }
}

function sourcesOf(ctx: RealmContext) {
  const ids = new Set<string>();
  for (const c of ctx.config.connectors) for (const s of c.source_stable_ids) ids.add(s);
  return [...ids]
    .map((sid) => ctx.store.findSourceByStableId(ctx.realmId, sid))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
}

function occurrencesForSource(ctx: RealmContext, sourceId: string) {
  // Reuse the raw scan via undiluted→occurrence is indirect; scan occurrence by source.
  return ctx.store.listOccurrencesBySource(sourceId);
}
