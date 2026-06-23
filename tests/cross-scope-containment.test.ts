import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activeScopeContainsAll } from '@core/policy';
import { normalizeLabel } from '@core/label-normalize';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { realmHmac } from '@security/crypto-primitives';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import { abstractEvents, claimKeyMeta } from '@claim/extractor';
import { consolidateClaim } from '@claim/consolidation';
import { indexClaim, searchRealm } from '@retrieval/search';
import { buildContext } from '@retrieval/context-pack';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { runSecretScan } from '@security/secret-scan';
import { makeTempRealm, type TempRealm } from './helpers';
import type { AbstractCandidate, AbstractInput, MemoryProvider } from '@claim/provider';
import type { Label, MemEvent } from '@core/schema/entities';

class SameStatementProvider implements MemoryProvider {
  id = 'rule_based';
  name = 'same';
  version = 'same.v1';
  egress = 'local' as const;

  constructor(private readonly statement: string) {}

  abstract(inputs: AbstractInput[]): AbstractCandidate[] {
    return inputs.map((_, i) => ({
      kind: 'fact',
      statement: this.statement,
      confidence: 0.9,
      mode: 'explicit',
      sourceIndex: i,
    }));
  }
}

function putLabel(realm: TempRealm, projectId: string, name: string): Label {
  const label: Label = {
    label_id: `lbl_${projectId}`,
    realm_id: realm.ctx.realmId,
    canonical_name: name,
    normalized_key: realmHmac(realm.ctx.realmKey, normalizeLabel(name)),
    aliases: [],
    state: 'active',
    merged_into: null,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION.label,
  };
  realm.ctx.store.putLabel(label);
  return label;
}

function putScopedEvent(realm: TempRealm, label: Label, projectId: string, text: string): MemEvent {
  const ctx = realm.ctx;
  const src = sourceIdentity(ctx.realmKey, 'test', `src-${projectId}`);
  const ses = sessionIdentity(ctx.realmKey, src, `ses-${projectId}`);
  const eventId = newId('event');
  const ref = ctx.objects.put(`${eventId}_text`, Buffer.from(text, 'utf8')).ref;
  const event: MemEvent = {
    event_id: eventId,
    event_identity: eventIdentity(ctx.realmKey, src, ses, eventId, text),
    realm_id: ctx.realmId,
    occurrence_ids: [newId('occurrence')],
    session_id: `ses_${projectId}`,
    turn_id: null,
    event_type: 'message',
    role: 'user',
    origin: 'user',
    created_at: new Date().toISOString(),
    source_timestamp: null,
    timestamp_confidence: 'capture_observed',
    sequence: 1,
    text_ref: ref,
    source_extra_ref: null,
    sensitivity: 'internal',
    sensitivity_classification_state: 'inferred',
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
    target_id: event.event_id,
    label_ids: [label.label_id],
    project_ids: [projectId],
    classification_state: 'inferred',
    assigned_by: 'rule:path_git_remote',
    confidence: 0.9,
    evidence: event.occurrence_ids,
    created_by_derivation_id: null,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION.assignment,
  });
  ctx.store.putSecretScan(runSecretScan(event.event_id, text));
  return event;
}

describe('cross-scope bridge containment', () => {
  let realm: TempRealm;
  let projectRootA: string;
  let projectRootB: string;

  beforeEach(() => {
    projectRootA = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-scope-a-'));
    projectRootB = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-scope-b-'));
    realm = makeTempRealm({
      projects: [
        { project_id: 'proj_a', name: 'project-a', root_paths: [projectRootA], git_remotes: [], default_sensitivity: 'internal' },
        { project_id: 'proj_b', name: 'project-b', root_paths: [projectRootB], git_remotes: [], default_sensitivity: 'internal' },
      ],
    });
  });

  afterEach(() => {
    realm.cleanup();
    fs.rmSync(projectRootA, { recursive: true, force: true });
    fs.rmSync(projectRootB, { recursive: true, force: true });
  });

  it('requires every bridge-claim scope to be active before the bridged body can surface', async () => {
    const labelA = putLabel(realm, 'proj_a', 'project-a');
    const labelB = putLabel(realm, 'proj_b', 'project-b');
    const statement = 'B-only bridge body must not surface under A alone';
    const provider = new SameStatementProvider(statement);

    const eventA = putScopedEvent(realm, labelA, 'proj_a', 'A evidence');
    const first = await abstractEvents(realm.ctx, provider, [eventA]);
    expect(first.newCandidates).toHaveLength(1);
    expect(consolidateClaim(realm.ctx, first.newCandidates[0]!).status).toBe('consolidated');

    const eventB = putScopedEvent(realm, labelB, 'proj_b', 'B evidence');
    realm.ctx.store.setMeta(claimKeyMeta(realm.ctx.realmKey, 'fact', statement, ['proj_b']), first.newCandidates[0]!.claim_id);
    const second = await abstractEvents(realm.ctx, provider, [eventB]);
    expect(second.merged).toBe(1);

    const bridged = realm.ctx.store.getClaim(first.newCandidates[0]!.claim_id)!;
    indexClaim(realm.ctx, bridged);

    const activeA = resolveActiveLabelIds(realm.ctx, ['proj_a']);
    const activeBoth = resolveActiveLabelIds(realm.ctx, ['proj_a', 'proj_b']);
    expect(activeScopeContainsAll([labelA.label_id, labelB.label_id], activeA)).toBe(false);
    expect(activeScopeContainsAll([labelA.label_id, labelB.label_id], activeBoth)).toBe(true);

    const result = buildContext(realm.ctx, {
      cwd: projectRootA,
      outPath: path.join('.memoring', 'context.md'),
    });
    expect(result.kind).toBe('written');
    expect(fs.readFileSync(path.join(projectRootA, '.memoring', 'context.md'), 'utf8')).not.toContain(statement);
    expect(searchRealm(realm.ctx, 'B-only bridge', { activeLabelIds: activeA })).toEqual([]);
    expect(searchRealm(realm.ctx, 'B-only bridge', { activeLabelIds: activeBoth })).toHaveLength(1);
  });
});
