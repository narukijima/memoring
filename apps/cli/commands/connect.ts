// `memoring connect <connector>` — detect, present the Inventory (enumerated
// sources, NOT one lump), and let the user choose include/exclude + Realm
// assignment (FR-001..006, gate 12). Whole-tool watch is never the default:
// nothing is captured unless a source is explicitly selected.
import { isActiveRealmSilence, openResolvedRealm } from '@core/runtime';
import { getConnector } from '@intake/registry';
import { connectSources, projectNameFor } from '@intake/connect-sources';
import { runLoop, type LoopStats } from '@core/loop';
import type { Connector, DetectedSource } from '@intake/types';
import { log } from '@core/log';
import { ask, getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { resolveProvider } from '../provider';
import { printActiveRealmSilence } from './resolve';

function normalizeConnectorId(raw: string | undefined): string {
  return (raw ?? 'claude-code').replace(/-/g, '_');
}

async function chooseSources(sources: DetectedSource[], flags: ReturnType<typeof parseFlags>): Promise<DetectedSource[]> {
  if (flags.all === true) return sources;
  if (typeof flags.source === 'string') return sources.filter((s) => s.source_stable_id === flags.source);
  if (process.env.MEMORING_PASSPHRASE) {
    // Headless: refuse to default to whole-tool; require an explicit selection.
    throw new Error('Headless connect requires --all or --source <id> (whole-tool watch is not the default).');
  }
  console.log('  Detected sources:');
  sources.forEach((s, i) => {
    console.log(`    [${i}] ${s.project_root ?? '(no project root)'} — ${s.source_stable_id} (${s.last_modified ?? '?'})`);
  });
  const answer = await ask("  Include which? (comma-separated indices, 'all', or blank to cancel): ");
  if (answer.trim() === '') return [];
  if (answer.trim() === 'all') return sources;
  const idx = answer.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n));
  return idx.map((i) => sources[i]).filter((s): s is DetectedSource => Boolean(s));
}

type DeclaredSensitivity = 'public' | 'internal' | 'confidential' | undefined;

/** Resolve the explicit sensitivity policy for the connected project's scope.
 *  Never synthesizes a default: a flag value (headless) or an interactive answer
 *  is an explicit user declaration; blank → no policy (events stay unknown). */
async function resolveDefaultSensitivity(flags: ReturnType<typeof parseFlags>): Promise<DeclaredSensitivity> {
  const flagVal = flags['default-sensitivity'] as string | undefined;
  const valid = (v: string): DeclaredSensitivity =>
    v === 'public' || v === 'internal' || v === 'confidential' ? v : undefined;
  if (typeof flagVal === 'string') return valid(flagVal);
  if (process.env.MEMORING_PASSPHRASE) return undefined; // headless without flag → no policy
  const a = await ask(
    "  Declare this project's default sensitivity (explicit policy) [internal/public/confidential, blank=leave unknown]: ",
  );
  return valid(a.trim());
}

export async function cmdConnect(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const connectorId = normalizeConnectorId(flags._[0]);
  const connector = getConnector(connectorId);
  if (!connector) {
    console.error(`Unknown connector: ${connectorId}`);
    return 1;
  }

  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  try {
    const detection = await connector.detect();
    console.log(`  ${connector.displayName}: detected ${detection.sources.length} source(s).`);
    for (const note of detection.notes) console.log(`    - ${note}`);
    if (detection.sources.length === 0) return 0;

    // --dry-run: show the Inventory (sources, would-be project, sensitivity hint,
    // sample count) and the active Realm, then stop. Nothing is persisted — the user
    // confirms by re-running without the flag (Specification §1.1, G12).
    if (isDryRun(flags)) {
      printConnectPreview(ctx.realmId, detection.sources, connector);
      return 0;
    }

    const selected = await chooseSources(detection.sources, flags);
    if (selected.length === 0) {
      console.log('  No sources selected. Nothing to connect.');
      return 0;
    }

    // Sensitivity is an explicit project policy (a §4.3 Declassify authority), never
    // a silent code default. Headless requires --default-sensitivity; interactive
    // prompts. If left blank, the project gets NO policy and its events stay
    // `unknown` (Silence) until the user declares one.
    const defaultSensitivity = await resolveDefaultSensitivity(flags);

    const { sources: connected } = connectSources(ctx, connectorId, selected, defaultSensitivity);
    ctx.flush();

    console.log(`  Connected ${connected} source(s) to realm ${ctx.realmId}.`);
    console.log('  Whole-tool watch is NOT enabled; only the selected sources are tracked.');

    if (flags.backfill === true) {
      console.log('  Running backfill loop...');
      const stats = await runLoop(ctx, { method: 'backfill', provider: resolveProvider(ctx.config.llm) });
      printLoopStats(stats);
    } else {
      console.log('  Next: `memoring backfill` to ingest history, then `memoring context build`.');
    }
    return 0;
  } finally {
    ctx.close(true);
  }
}

/** True when `--dry-run` is present (boolean or value form, mirroring init's
 *  --passphrase handling so a trailing token never disables the preview). */
export function isDryRun(flags: ReturnType<typeof parseFlags>): boolean {
  return flags['dry-run'] === true || typeof flags['dry-run'] === 'string';
}

/** Estimate how many raw lines/messages a source would yield from `fromCursor`,
 *  without mutating anything (read() is a pure read). Used by the dry-run preview. */
export function sampleLineCount(connector: Connector, src: DetectedSource, fromCursor = 0): number {
  try {
    return connector
      .read(src, fromCursor, 'backfill')
      .reduce((n, c) => n + c.bytes.toString('utf8').split('\n').filter((l) => l.trim().length > 0).length, 0);
  } catch {
    return 0;
  }
}

function printConnectPreview(realmId: string, sources: DetectedSource[], connector: Connector): void {
  console.log('  [dry-run] No changes will be made (no source, project, or config is persisted).');
  console.log(`  Realm: ${realmId}`);
  console.log(`  Inventory — ${sources.length} source(s) available to connect:`);
  sources.forEach((s, i) => {
    const { name } = projectNameFor(s);
    console.log(
      `    [${i}] project=${name} source=${s.source_stable_id} sensitivity_hint=${s.sensitivity_hint} ` +
        `samples=${sampleLineCount(connector, s)} realm_suggestion=${s.suggested_realm ?? '-'} ` +
        `last_modified=${s.last_modified ?? '?'}`,
    );
  });
  console.log('  [dry-run] Re-run without --dry-run to choose include/exclude + Realm and connect.');
}

export function printLoopStats(stats: LoopStats): void {
  log.info('loop:done', { ...stats } as Record<string, number>);
  console.log(
    `  Loop: captured=${stats.captured} events=${stats.events} quarantined=${stats.quarantined} ` +
      `parse_failures=${stats.parseFailures} ` +
      `classified=${stats.classified} candidates=${stats.candidates} merged=${stats.merged} ` +
      `abstract_failures=${stats.abstractFailures} consolidated=${stats.consolidated} rejected=${stats.rejected}`,
  );
}
