// `memoring backfill` — ingest history from the registered sources by running
// the loop once (capture → normalize → classify → abstract → consolidate). OFF
// by default at init; this is the explicit opt-in path (FR-010).
import { isActiveRealmSilence, openResolvedRealm, type RealmContext } from '@core/runtime';
import { runLoop } from '@core/loop';
import { getConnector } from '@intake/registry';
import { getSourceCursor } from '@intake/capture';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { resolveProvider } from '../provider';
import { isDryRun, printLoopStats, sampleLineCount } from './connect';
import { printActiveRealmSilence } from './resolve';

export async function cmdBackfill(argv: string[]): Promise<number> {
  const flags = parseFlags(argv); // --since reserved; --dry-run previews without ingesting
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  try {
    if (ctx.config.connectors.length === 0) {
      console.log('  No connectors configured. Run `memoring connect claude-code` first.');
      return 0;
    }
    // --dry-run: preview which registered sources would be ingested (realm, project
    // sensitivity policy, sample count) without running the loop (Specification §1.1).
    if (isDryRun(flags)) {
      await previewBackfill(ctx);
      return 0;
    }
    const stats = await runLoop(ctx, { method: 'backfill', provider: resolveProvider(ctx.config.llm) });
    printLoopStats(stats);
    return 0;
  } finally {
    ctx.close(true);
  }
}

/** Enumerate the registered sources (as the loop would) and print what backfill
 *  would ingest — never capturing, classifying, or consolidating. The sample count
 *  reads from each source's current cursor, so it reflects only NEW, not-yet-ingested
 *  content. */
async function previewBackfill(ctx: RealmContext): Promise<void> {
  console.log('  [dry-run] No ingestion will run (no capture, classify, abstract, or consolidate).');
  console.log(`  Realm: ${ctx.realmId}`);
  let n = 0;
  let total = 0;
  for (const instance of ctx.config.connectors) {
    const connector = getConnector(instance.connector_id);
    if (!connector) continue;
    const registered = new Set(instance.source_stable_ids);
    const detection = await connector.detect();
    for (const src of detection.sources) {
      if (!registered.has(src.source_stable_id)) continue;
      const source = ctx.store.findSourceByStableId(ctx.realmId, src.source_stable_id);
      const projectId = source ? ctx.store.getMeta(`source_project:${source.source_id}`) : undefined;
      const project = projectId ? ctx.config.projects.find((p) => p.project_id === projectId) : undefined;
      const cursor = source ? getSourceCursor(ctx, source.source_id) : 0;
      const samples = sampleLineCount(connector, src, cursor);
      total += samples;
      console.log(
        `    [${n}] project=${project?.name ?? 'unscoped'} source=${src.source_stable_id} ` +
          `sensitivity=${project?.default_sensitivity ?? 'unknown'} new_samples=${samples} ` +
          `last_modified=${src.last_modified ?? '?'}`,
      );
      n += 1;
    }
  }
  console.log(`  ${n} registered source(s); ~${total} new sample line(s) would be ingested.`);
  console.log('  [dry-run] Re-run `memoring backfill` without --dry-run to ingest.');
}
