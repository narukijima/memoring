// `memoring watch` — resident, diff-driven loop (Daemon spec; FR-008/037/038,
// NFR-019/020). Watches ONLY the selected sources, runs the loop on a debounced
// diff, and goes idle (no AI/compute) when there is nothing new. Key-holding
// model (§7.4): the DEK lives in memory only while unlocked; on idle timeout it
// is discarded (realm closed) and re-derived from the held passphrase on the
// next diff.
import fs from 'node:fs';
import path from 'node:path';
import { replicaLayout } from '@core/paths';
import { openRealm, type RealmContext } from '@core/runtime';
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
  const flags = parseFlags(argv);
  const idleTimeoutMs = (Number(flags['idle-timeout']) || 900) * 1000; // default 15 min
  const debounceMs = 600;

  const passphrase = await getPassphrase();
  const root = replicaLayout().root;
  let ctx: RealmContext | null = openRealm(passphrase, root);
  if (ctx.config.connectors.length === 0) {
    console.log('  No connectors configured. Run `memoring connect claude-code` first.');
    ctx.close(false);
    return 0;
  }

  const ensureOpen = (): RealmContext => {
    if (!ctx) {
      ctx = openRealm(passphrase, root); // re-derive DEK from the held passphrase
      log.info('watch:reunlocked', {});
    }
    return ctx;
  };

  // Catch-up pass.
  printStats(await runLoop(ensureOpen(), { method: 'watch' }));

  const roots = await watchRoots(ensureOpen());
  console.log(`  Watching ${roots.length} location(s) for selected sources. Ctrl-C to stop.`);

  let debounce: ReturnType<typeof setTimeout> | null = null;
  let lastActivity = Date.now();
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      lastActivity = Date.now();
      printStats(await runLoop(ensureOpen(), { method: 'watch' }));
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

  // Idle key-discard: drop the DEK after inactivity; re-unlock lazily on next diff.
  const idleTimer = setInterval(() => {
    if (ctx && !running && Date.now() - lastActivity > idleTimeoutMs) {
      ctx.close(true); // flush + dispose key material
      ctx = null;
      log.info('watch:idle_locked', {});
    }
  }, Math.min(idleTimeoutMs, 60_000));

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      clearInterval(idleTimer);
      if (debounce) clearTimeout(debounce);
      for (const w of watchers) w.close();
      if (ctx) ctx.close(true);
      console.log('\n  Stopped.');
      resolve();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
  return 0;
}
