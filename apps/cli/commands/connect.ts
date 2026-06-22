// `memoring connect <connector>` — detect, present the Inventory (enumerated
// sources, NOT one lump), and let the user choose include/exclude + Realm
// assignment (FR-001..006, gate 12). Whole-tool watch is never the default:
// nothing is captured unless a source is explicitly selected.
import path from 'node:path';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { replicaLayout } from '@core/paths';
import { openActiveRealm } from '@core/runtime';
import { writeRealmConfig, type RealmConnectorConfig, type RealmProjectConfig } from '@core/realm';
import { getConnector } from '@intake/registry';
import { sourceIdentity } from '@intake/identity';
import { runLoop, type LoopStats } from '@core/loop';
import type { Connector, DetectedSource } from '@intake/types';
import type { ConnectorInstance, Project, Source } from '@core/schema/entities';
import { log } from '@core/log';
import { ask, getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { resolveProvider } from '../provider';

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

function projectNameFor(source: DetectedSource): { name: string; root: string | null } {
  if (source.project_root) return { name: path.basename(source.project_root), root: source.project_root };
  return { name: 'unscoped', root: null };
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

  const ctx = await openActiveRealm(replicaLayout().root, getPassphrase);
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

    const ci: ConnectorInstance = {
      connector_instance_id: newId('connectorInstance'),
      realm_id: ctx.realmId,
      connector_id: connectorId,
      config_ref: 'connectors/' + connectorId,
      schema_version: SCHEMA_VERSION.connectorInstance,
    };
    const sourceStableIds: string[] = [];

    // Group selected sources into projects by project_root.
    const projectByRoot = new Map<string, RealmProjectConfig>();
    for (const existing of ctx.config.projects) {
      for (const r of existing.root_paths) projectByRoot.set(r, existing);
      if (existing.root_paths.length === 0) projectByRoot.set(`__name__:${existing.name}`, existing);
    }

    for (const src of selected) {
      const { name, root } = projectNameFor(src);
      const rootKey = root ?? `__name__:${name}`;
      let projectCfg = projectByRoot.get(rootKey);
      if (!projectCfg) {
        const project: Project = {
          project_id: newId('project'),
          realm_id: ctx.realmId,
          name,
          root_paths: root ? [root] : [],
          git_remotes: src.git_remote ? [src.git_remote] : [],
          schema_version: SCHEMA_VERSION.project,
        };
        ctx.store.putProject(project);
        projectCfg = {
          project_id: project.project_id,
          name,
          root_paths: project.root_paths,
          git_remotes: project.git_remotes,
          // Only record the policy when explicitly declared (omit otherwise).
          ...(defaultSensitivity ? { default_sensitivity: defaultSensitivity } : {}),
        };
        ctx.config.projects.push(projectCfg);
        projectByRoot.set(rootKey, projectCfg);
      }

      const source: Source = {
        source_id: newId('source'),
        realm_id: ctx.realmId,
        source_stable_key_hmac: sourceIdentity(ctx.realmKey, connectorId, src.source_stable_id),
        source_stable_id: src.source_stable_id,
        connector_id: connectorId,
        connector_instance_id: ci.connector_instance_id,
        source_type: src.source_type,
        schema_version: SCHEMA_VERSION.source,
      };
      ctx.store.putSource(source);
      ctx.store.setMeta(`source_project:${source.source_id}`, projectCfg.project_id);
      sourceStableIds.push(src.source_stable_id);
    }

    ctx.store.putConnectorInstance(ci);
    const connCfg: RealmConnectorConfig = {
      connector_instance_id: ci.connector_instance_id,
      connector_id: connectorId,
      source_stable_ids: sourceStableIds,
    };
    ctx.config.connectors.push(connCfg);
    writeRealmConfig(ctx.layout.realmToml, ctx.config);
    ctx.flush();

    console.log(`  Connected ${sourceStableIds.length} source(s) to realm ${ctx.realmId}.`);
    console.log('  Whole-tool watch is NOT enabled; only the selected sources are tracked.');

    if (flags.backfill === true) {
      console.log('  Running backfill loop...');
      const stats = await runLoop(ctx, { method: 'backfill', provider: resolveProvider() });
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
