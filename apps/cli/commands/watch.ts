// `memoring watch` — resident, diff-driven loop (Daemon spec; FR-008/037/038,
// NFR-019/020). Watches ONLY the selected sources, runs the loop on a debounced
// diff, and goes idle (no AI/compute) when there is nothing new. Key-holding
// model (§7.4): the DEK lives in memory only while unlocked; on idle timeout it
// is discarded (realm closed) and re-derived from the held passphrase on the
// next diff.
import fs from 'node:fs';
import path from 'node:path';
import { replicaLayout } from '@core/paths';
import { openActiveRealm, type RealmContext } from '@core/runtime';
import { getConnector } from '@intake/registry';
import { runLoop, type LoopStats } from '@core/loop';
import { log } from '@core/log';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';

async function watchRoots(ctx: RealmContext): Promise<string[]> {
  const roots = new Set<string>();
  for (const inst of ctx.config.connectors) {
    const connector = getConnector(inst.connector_id);
    if (!connector) continue;
    const det = await connector.detect();
    const selected = new Set(inst.source_stable_ids);
    for (const s of det.sources) {
      if (!selected.has(s.source_stable_id)) continue;
      roots.add(path.dirname(s.transcript_path));
      roots.add(path.dirname(path.dirname(s.transcript_path)));
    }
  }
  return [...roots].filter((r) => fs.existsSync(r));
}

function printStats(stats: LoopStats): void {
  if (stats.events > 0 || stats.consolidated > 0) {
    console.log(
      `  [loop] events=${stats.events} classified=${stats.classified} ` +
        `consolidated=${stats.consolidated} rejected=${stats.rejected}`,
    );
  }
}

export async function cmdWatch(argv: string[]): Promise<number> {
  parseFlags(argv);
  const debounceMs = 600;

  const root = replicaLayout().root;

  // The daemon holds the replica lock ONLY for the duration of a tick (open →
  // loop → close), never continuously. This keeps context build / search /
  // governance usable while watching (they only contend during the brief tick
  // window, and the lock acquire retries across it), and each tick re-reads the
  // latest blob so a concurrent CLI write is never clobbered. In passphrase mode
  // the passphrase is held in memory and the DEK re-derived per tick (disposed
  // immediately after); passwordless replicas open via the local key, no prompt.
  // Either way key residency is minimized (§7.4).
  let heldPassphrase: string | undefined;
  const provider = async (): Promise<string> => (heldPassphrase ??= await getPassphrase());
  const withRealm = async <T>(fn: (ctx: RealmContext) => Promise<T> | T): Promise<T> => {
    const ctx = await openActiveRealm(root, provider);
    try {
      return await fn(ctx);
    } finally {
      ctx.close(true); // flush + release lock + dispose key material
    }
  };

  if (!(await withRealm((ctx) => ctx.config.connectors.length > 0))) {
    console.log('  No connectors configured. Run `memoring connect claude-code` first.');
    return 0;
  }

  // Catch-up pass.
  printStats(await withRealm((ctx) => runLoop(ctx, { method: 'watch' })));

  const roots = await withRealm((ctx) => watchRoots(ctx));
  console.log(`  Watching ${roots.length} location(s) for selected sources. Ctrl-C to stop.`);

  let debounce: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      printStats(await withRealm((ctx) => runLoop(ctx, { method: 'watch' })));
    } catch (e) {
      log.error('watch:loop_error', { msg: (e as Error).message });
    } finally {
      running = false;
    }
  };

  const onChange = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void tick(), debounceMs);
  };

  const watchers = roots.map((r) => {
    try {
      return fs.watch(r, { recursive: true }, onChange);
    } catch {
      return fs.watch(r, onChange); // recursive unsupported → watch the dir itself
    }
  });

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      if (debounce) clearTimeout(debounce);
      for (const w of watchers) w.close();
      console.log('\n  Stopped.');
      resolve();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
  return 0;
}
