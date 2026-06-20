// Shared seeding: build a temp Realm wired to the Claude Code fixture and run
// the loop once, so search/governance tests start from real consolidated state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { runLoop } from '@core/loop';
import { claudeCodeConnector } from '@integrations/claude-code/index';
import { sourceIdentity } from '@intake/identity';
import type { ConnectorInstance, Source } from '@core/schema/entities';
import { makeTempRealm, type TempRealm } from './helpers';

const fixturesProjects = fileURLToPath(new URL('../fixtures/claude-code/projects', import.meta.url));

export interface SeededRealm {
  realm: TempRealm;
  projectRoot: string;
  restore: () => void;
}

export async function seedRealmFromFixture(): Promise<SeededRealm> {
  const prev = process.env.MEMORING_CLAUDE_DIR;
  process.env.MEMORING_CLAUDE_DIR = fixturesProjects;
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-proj-'));
  const realm = makeTempRealm({
    projects: [
      { project_id: 'proj_test', name: 'memoring-proj', root_paths: [projectRoot], git_remotes: [], default_sensitivity: 'internal' },
    ],
  });
  const ctx = realm.ctx;

  const det = await claudeCodeConnector.detect();
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

  await runLoop(ctx, { method: 'backfill' });

  return {
    realm,
    projectRoot,
    restore: () => {
      realm.cleanup();
      fs.rmSync(projectRoot, { recursive: true, force: true });
      if (prev === undefined) delete process.env.MEMORING_CLAUDE_DIR;
      else process.env.MEMORING_CLAUDE_DIR = prev;
    },
  };
}
