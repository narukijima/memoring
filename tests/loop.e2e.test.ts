import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { runLoop } from '@core/loop';
import { buildContext } from '@retrieval/context-pack';
import { claudeCodeConnector } from '@integrations/claude-code/index';
import { sourceIdentity } from '@intake/identity';
import type { ConnectorInstance, Source } from '@core/schema/entities';
import { makeTempRealm, type TempRealm } from './helpers';

// The fixture transcript records cwd=/tmp/memoring-proj; classify keys scope off
// the registered project, not this path, so the e2e project root is an
// independent temp dir used as the build CWD + output location.
const fixturesProjects = fileURLToPath(new URL('../fixtures/claude-code/projects', import.meta.url));

let realm: TempRealm;
let projectRoot: string;
let prevClaudeDir: string | undefined;

beforeEach(() => {
  prevClaudeDir = process.env.MEMORING_CLAUDE_DIR;
  process.env.MEMORING_CLAUDE_DIR = fixturesProjects;
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-proj-'));
  realm = makeTempRealm({
    projects: [
      {
        project_id: 'proj_test',
        name: 'memoring-proj',
        root_paths: [projectRoot],
        git_remotes: [],
        default_sensitivity: 'internal',
      },
    ],
  });
});
afterEach(() => {
  realm.cleanup();
  fs.rmSync(projectRoot, { recursive: true, force: true });
  if (prevClaudeDir === undefined) delete process.env.MEMORING_CLAUDE_DIR;
  else process.env.MEMORING_CLAUDE_DIR = prevClaudeDir;
});

async function wireConnector(): Promise<void> {
  const ctx = realm.ctx;
  const det = await claudeCodeConnector.detect();
  expect(det.sources.length).toBeGreaterThan(0);
  const ci: ConnectorInstance = {
    connector_instance_id: newId('connectorInstance'),
    realm_id: ctx.realmId,
    connector_id: 'claude_code',
    config_ref: 'connectors/claude_code',
    schema_version: SCHEMA_VERSION.connectorInstance,
  };
  ctx.store.putConnectorInstance(ci);
  const stableIds: string[] = [];
  for (const s of det.sources) {
    const source: Source = {
      source_id: newId('source'),
      realm_id: ctx.realmId,
      source_stable_key_hmac: sourceIdentity(ctx.realmKey, 'claude_code', s.source_stable_id),
      source_stable_id: s.source_stable_id,
      connector_id: 'claude_code',
      connector_instance_id: ci.connector_instance_id,
      source_type: 'append',
      schema_version: SCHEMA_VERSION.source,
    };
    ctx.store.putSource(source);
    ctx.store.setMeta(`source_project:${source.source_id}`, 'proj_test');
    stableIds.push(s.source_stable_id);
  }
  ctx.config.connectors.push({
    connector_instance_id: ci.connector_instance_id,
    connector_id: 'claude_code',
    source_stable_ids: stableIds,
  });
}

describe('loop end-to-end (gates 1–8, 11–13)', () => {
  it('captures, normalizes, classifies, abstracts, and consolidates from a real transcript', async () => {
    await wireConnector();
    const stats = await runLoop(realm.ctx, { method: 'backfill' });
    expect(stats.events).toBe(8);
    expect(stats.quarantined).toBe(0);
    expect(stats.consolidated).toBe(3); // constraint, preference, decision
    expect(stats.candidates).toBe(3);
  });

  it('is idempotent: a second run captures/consolidates nothing new (idle convergence, §4.13)', async () => {
    await wireConnector();
    await runLoop(realm.ctx, { method: 'backfill' });
    const second = await runLoop(realm.ctx, { method: 'backfill' });
    expect(second.events).toBe(0);
    expect(second.candidates).toBe(0);
  });

  it('builds a context.md that emits the 3 claims and never the secret or assistant text', async () => {
    await wireConnector();
    await runLoop(realm.ctx, { method: 'backfill' });
    const result = buildContext(realm.ctx, {
      cwd: projectRoot,
      outPath: path.join('.memoring', 'context.md'),
      aperture: 'standard',
      audience: 'ai_tool',
    });
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') return;
    expect(result.emitted).toBe(3);

    const doc = fs.readFileSync(path.join(projectRoot, '.memoring', 'context.md'), 'utf8');
    expect(doc).toContain('Always use TypeScript strict mode'); // constraint
    expect(doc).toContain('better-sqlite3'); // decision
    expect(doc).toContain('2-space indentation'); // preference
    // G3: the secret must never appear.
    expect(doc).not.toContain('sk-abc1234567890');
    // G8: assistant paraphrase must not be promoted to guidance.
    expect(doc).not.toContain('I will always enable strict mode and avoid any');
    // G6: safety header + Ouroboros marker present.
    expect(doc).toContain('untrusted historical evidence');
    expect(doc).toContain('memoring:ouroboros');
  });

  it('Silence: building from an unregistered CWD emits no context.md (G4/FR-055)', async () => {
    await wireConnector();
    await runLoop(realm.ctx, { method: 'backfill' });
    const result = buildContext(realm.ctx, {
      cwd: '/tmp/some-other-unregistered-dir',
      outPath: path.join(realm.root, 'out2', 'context.md'),
    });
    expect(result.kind).toBe('silence');
  });
});
