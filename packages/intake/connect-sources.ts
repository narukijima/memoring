// Shared connect persistence (ADR-0010 §5). `memoring connect` (CLI) and the web
// panel both call this, so the connect audit lives HERE — one trail across both
// surfaces — rather than in either command. Selection (detect → include/exclude)
// stays in the caller; this only persists the user's explicit choice.
import path from 'node:path';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { writeRealmConfig, type RealmConnectorConfig, type RealmProjectConfig } from '@core/realm';
import type { RealmContext } from '@core/runtime';
import type { ConnectorInstance, Project, Source } from '@core/schema/entities';
import { sourceIdentity } from './identity';
import type { DetectedSource } from './types';

export type DeclaredSensitivity = 'public' | 'internal' | 'confidential';

export function projectNameFor(source: DetectedSource): { name: string; root: string | null } {
  if (source.project_root) return { name: path.basename(source.project_root), root: source.project_root };
  return { name: 'unscoped', root: null };
}

export interface ConnectResult {
  connector_instance_id: string;
  sources: number;
}

/** Persist the user's selected sources into the open Realm and audit the connect
 *  at the shared layer. Sensitivity is recorded only when explicitly declared. */
export function connectSources(
  ctx: RealmContext,
  connectorId: string,
  selected: DetectedSource[],
  defaultSensitivity?: DeclaredSensitivity,
): ConnectResult {
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
  ctx.audit('realm_connect', { connector: connectorId, sources: sourceStableIds.length });
  return { connector_instance_id: ci.connector_instance_id, sources: sourceStableIds.length };
}
