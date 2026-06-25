// Test helpers: build an ephemeral unlocked Realm in a temp dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { newId } from '@core/schema/ids';
import { replicaLayout } from '@core/paths';
import { attachRealm, openRealmLocal, type RealmContext } from '@core/runtime';
import { type RealmConfig, writeRealmConfig } from '@core/realm';
import { createLocalKeyMaterial } from '@security/key-lifecycle';
import { ensureDir, atomicWriteFile } from '@storage/fs-safety';
import { REPLICA_SUBDIRS } from '@core/paths';
import { createReplicaAtRoot } from '../apps/cli/commands/init';
import { indexClaim, indexEvent } from '@retrieval/search';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { normalizeLabel } from '@core/label-normalize';
import { realmHmac } from '@security/crypto-primitives';
import { runSecretScan } from '@security/secret-scan';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import type { ClassificationState } from '@core/schema/enums';
import type { Assignment, Claim, Label, MemEvent } from '@core/schema/entities';

export interface TempRealm {
  ctx: RealmContext;
  root: string;
  cleanup: () => void;
}

export function makeTempRealm(opts?: { projects?: RealmConfig['projects'] }): TempRealm {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-test-'));
  const layout = replicaLayout(root);
  ensureDir(layout.root, 0o700);
  for (const key of REPLICA_SUBDIRS) ensureDir(layout[key], 0o700);
  const { keyFile, keyring } = createLocalKeyMaterial();
  atomicWriteFile(layout.keyFile, JSON.stringify(keyFile), 0o600);
  const config: RealmConfig = {
    schema: 'realm.v1',
    realm_id: newId('realm'),
    name: 'test',
    created_at: new Date().toISOString(),
    projects: opts?.projects ?? [],
    connectors: [],
  };
  writeRealmConfig(layout.realmToml, config);
  const ctx = attachRealm(layout, config, keyring);
  ctx.store.setMeta('realm_id', config.realm_id);
  return {
    ctx,
    root,
    cleanup: () => {
      try {
        ctx.close(false);
      } catch {
        /* ignore */
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function randomText(): string {
  return randomBytes(8).toString('hex');
}

/** Persist a Realm at `root` with one classified, indexed, in-scope event — the
 *  minimal state the gated output-layer surfaces (`ask` / `chat`) need to resolve a
 *  scope from CWD and return a real `searchRealm` hit. Mirrors the createSearchRealm
 *  pattern used by the multi-Realm CLI tests. */
export function createIndexedReplica(root: string, name: string, projectRoot: string, text: string): void {
  createReplicaAtRoot({ root, name, usePassphrase: false });
  const ctx = openRealmLocal(root);
  try {
    const projectId = `proj_${name}`;
    const labelId = `lbl_${name}`;
    ctx.config.projects.push({
      project_id: projectId,
      name,
      root_paths: [projectRoot],
      git_remotes: [],
      default_sensitivity: 'internal',
    });
    const label: Label = {
      label_id: labelId,
      realm_id: ctx.realmId,
      canonical_name: name,
      normalized_key: realmHmac(ctx.realmKey, normalizeLabel(name)),
      aliases: [],
      state: 'active',
      merged_into: null,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION.label,
    };
    ctx.store.putLabel(label);

    const src = sourceIdentity(ctx.realmKey, 'test', `${name}-source`);
    const ses = sessionIdentity(ctx.realmKey, src, `${name}-session`);
    const eventId = newId('event');
    const textRef = ctx.objects.put(`${eventId}_text`, Buffer.from(text, 'utf8')).ref;
    const event: MemEvent = {
      event_id: eventId,
      event_identity: eventIdentity(ctx.realmKey, src, ses, `${name}-message`, text),
      realm_id: ctx.realmId,
      occurrence_ids: [newId('occurrence')],
      session_id: `ses_${name}`,
      turn_id: null,
      event_type: 'message',
      role: 'user',
      origin: 'user',
      created_at: new Date().toISOString(),
      source_timestamp: null,
      timestamp_confidence: 'capture_observed',
      sequence: 1,
      text_ref: textRef,
      source_extra_ref: null,
      sensitivity: 'internal',
      sensitivity_classification_state: 'inferred',
      context_injected: false,
      context_pack_digest: null,
      parser_version: 'test.v1',
      status: 'active',
      schema_version: SCHEMA_VERSION.event,
    };
    const assignment: Assignment = {
      assignment_id: newId('assignment'),
      realm_id: ctx.realmId,
      target_type: 'event',
      target_id: eventId,
      label_ids: [labelId],
      project_ids: [projectId],
      classification_state: 'inferred',
      assigned_by: 'rule:path_git_remote',
      confidence: 1,
      evidence: [event.occurrence_ids[0]!],
      created_by_derivation_id: null,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION.assignment,
    };
    ctx.store.putEvent(event);
    ctx.store.putSecretScan(runSecretScan(event.event_id, text));
    ctx.store.putAssignment(assignment);
    indexEvent(ctx, event);
    writeRealmConfig(ctx.layout.realmToml, ctx.config);
    ctx.flush();
  } finally {
    ctx.close(true);
  }
}

export function putIndexedClaimWithStates(
  ctx: RealmContext,
  statement: string,
  labelIds: string[],
  projectIds: string[],
  opts: { scopeState?: ClassificationState; sensitivityState?: ClassificationState } = {},
): Claim {
  const now = new Date().toISOString();
  const scopeState = opts.scopeState ?? 'candidate';
  const sensitivityState = opts.sensitivityState ?? 'inferred';
  const eventId = newId('event');
  const src = sourceIdentity(ctx.realmKey, 'test', `${eventId}-source`);
  const ses = sessionIdentity(ctx.realmKey, src, `${eventId}-session`);
  const event: MemEvent = {
    event_id: eventId,
    event_identity: eventIdentity(ctx.realmKey, src, ses, `${eventId}-message`, statement),
    realm_id: ctx.realmId,
    occurrence_ids: [newId('occurrence')],
    session_id: `ses_${eventId}`,
    turn_id: null,
    event_type: 'message',
    role: 'user',
    origin: 'user',
    created_at: now,
    source_timestamp: null,
    timestamp_confidence: 'capture_observed',
    sequence: 20_000,
    text_ref: null,
    source_extra_ref: null,
    sensitivity: 'internal',
    sensitivity_classification_state: sensitivityState,
    context_injected: false,
    context_pack_digest: null,
    parser_version: 'test.v1',
    status: 'active',
    schema_version: SCHEMA_VERSION.event,
  };
  ctx.store.putEvent(event);
  ctx.store.putAssignment({
    assignment_id: newId('assignment'),
    realm_id: ctx.realmId,
    target_type: 'event',
    target_id: eventId,
    label_ids: labelIds,
    project_ids: projectIds,
    classification_state: scopeState,
    assigned_by: scopeState === 'candidate' ? 'ai' : 'rule:path_git_remote',
    confidence: 0.6,
    evidence: event.occurrence_ids,
    created_by_derivation_id: null,
    created_at: now,
    schema_version: SCHEMA_VERSION.assignment,
  });
  const claim: Claim = {
    claim_id: newId('claim'),
    realm_id: ctx.realmId,
    kind: 'fact',
    statement_ref: ctx.objects.put(`${newId('claim')}_stmt`, Buffer.from(statement, 'utf8')).ref,
    structured_predicate_ref: null,
    assignment_ids: [],
    project_ids: projectIds,
    abstraction_level: 1,
    status: 'consolidated',
    conflict_reason: null,
    evidence_event_identities: [event.event_identity],
    evidence_occurrence_ids: event.occurrence_ids,
    created_by: 'ai',
    created_by_derivation_id: null,
    created_at: now,
    last_recalled_at: null,
    valid_from: now,
    valid_until: null,
    supersedes: [],
    evidence_count: 1,
    reinforcement_score: 0,
    confidence: 0.6,
    sensitivity: 'internal',
    sensitivity_classification_state: sensitivityState,
    schema_version: SCHEMA_VERSION.claim,
  };
  ctx.store.putClaim(claim);
  indexClaim(ctx, claim);
  return claim;
}
