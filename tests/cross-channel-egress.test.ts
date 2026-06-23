// Cross-channel egress lock (T2). The project memory warns of a failure mode where
// "green tests" only checked context.md, so a leak on search / MCP / remote stayed
// invisible. This test drives ONE seeded realm (with a planted secret) through ALL
// FOUR raw-text egress channels and asserts the same forbidden content is blocked on
// every one — so the channels can never drift apart silently.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildContext, toScopedClaim } from '@retrieval/context-pack';
import { proposeNeighbors } from '@retrieval/associate';
import { searchRealm } from '@retrieval/search';
import { handleMcpRequest } from '@retrieval/mcp';
import { abstractEvents } from '@claim/extractor';
import { getRecallCount } from '@claim/recall';
import { forgetClaim } from '@security/redaction';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import { runSecretScan } from '@security/secret-scan';
import type { AbstractCandidate, AbstractInput, MemoryProvider } from '@claim/provider';
import type { ClassificationState, Sensitivity } from '@core/schema/enums';
import type { Claim, MemEvent } from '@core/schema/entities';
import { seedRealmFromFixture, type SeededRealm } from './seed';

const SECRET = 'sk-abc1234567890';
const SCOPE = 'memoring-proj'; // the fixture project's label name

class RecordingProvider implements MemoryProvider {
  id = 'recording';
  name = 'recording';
  version = 'recording.v1';
  seen: string[] = [];
  constructor(public egress: 'local' | 'remote') {}
  abstract(inputs: AbstractInput[]): AbstractCandidate[] {
    this.seen.push(...inputs.map((i) => i.text));
    return [];
  }
}

function mcpSearch(seeded: SeededRealm, query: string, scope: string): string {
  const resp = handleMcpRequest(seeded.realm.ctx, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'memoring_search', arguments: { query, scope } },
  });
  const parsed = JSON.parse(resp!);
  return parsed.result.content.map((c: { text: string }) => c.text).join('\n');
}

function contextDoc(seeded: SeededRealm, scope?: string): string {
  const cwd = seeded.projectRoot;
  const r = buildContext(seeded.realm.ctx, { cwd, outPath: path.join('.memoring', 'context.md'), scope, audience: 'ai_tool', aperture: 'standard' });
  const file = path.join(cwd, '.memoring', 'context.md');
  return r.kind === 'written' && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function putScopedClaim(
  seeded: SeededRealm,
  base: Claim,
  statement: string,
  labelIds: string[],
  sensitivity: Sensitivity = 'internal',
): Claim {
  const ctx = seeded.realm.ctx;
  const eventId = newId('event');
  const event: MemEvent = {
    event_id: eventId,
    event_identity: `evt_assoc_${eventId}`,
    realm_id: ctx.realmId,
    occurrence_ids: [newId('occurrence')],
    session_id: 'ses_assoc',
    turn_id: null,
    event_type: 'message',
    role: 'user',
    origin: 'user',
    created_at: '2026-01-01T00:00:00.000Z',
    source_timestamp: null,
    timestamp_confidence: 'capture_observed',
    sequence: 20_000,
    text_ref: null,
    source_extra_ref: null,
    sensitivity,
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
    label_ids: labelIds,
    project_ids: ['proj_assoc'],
    classification_state: 'inferred',
    assigned_by: 'rule:path_git_remote',
    confidence: 0.9,
    evidence: event.occurrence_ids,
    created_by_derivation_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    schema_version: SCHEMA_VERSION.assignment,
  });

  const claim: Claim = {
    ...base,
    claim_id: newId('claim'),
    kind: 'fact',
    statement_ref: ctx.objects.put(`${newId('claim')}_stmt`, Buffer.from(statement, 'utf8')).ref,
    status: 'consolidated',
    conflict_reason: null,
    evidence_event_identities: [event.event_identity],
    evidence_occurrence_ids: event.occurrence_ids,
    evidence_count: 1,
    last_recalled_at: null,
    valid_from: '2026-01-01T00:00:00.000Z',
    valid_until: null,
    supersedes: [],
    sensitivity,
    sensitivity_classification_state: 'inferred',
  };
  ctx.store.putClaim(claim);
  return claim;
}

function remoteTestEvent(seeded: SeededRealm, text: string, scopeState?: ClassificationState): MemEvent {
  const ctx = seeded.realm.ctx;
  const src = sourceIdentity(ctx.realmKey, 'test', `src-${text}`);
  const ses = sessionIdentity(ctx.realmKey, src, `ses-${text}`);
  const eventId = newId('event');
  const ref = ctx.objects.put(`${eventId}_text`, Buffer.from(text, 'utf8')).ref;
  const event: MemEvent = {
    event_id: eventId,
    event_identity: eventIdentity(ctx.realmKey, src, ses, eventId, text),
    realm_id: ctx.realmId,
    occurrence_ids: [newId('occurrence')],
    session_id: `ses_${eventId}`,
    turn_id: null,
    event_type: 'message',
    role: 'user',
    origin: 'user',
    created_at: new Date().toISOString(),
    source_timestamp: null,
    timestamp_confidence: 'capture_observed',
    sequence: 10_000,
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
  ctx.store.putSecretScan(runSecretScan(event.event_id, text));
  if (scopeState) {
    const labels = resolveActiveLabelIds(ctx, ['proj_test']);
    ctx.store.putAssignment({
      assignment_id: newId('assignment'),
      realm_id: ctx.realmId,
      target_type: 'event',
      target_id: event.event_id,
      label_ids: [labels[0]!],
      project_ids: ['proj_test'],
      classification_state: scopeState,
      assigned_by: 'rule:path_git_remote',
      confidence: 0.9,
      evidence: event.occurrence_ids,
      created_by_derivation_id: null,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION.assignment,
    });
  }
  return event;
}

describe('cross-channel egress parity (G3/G4/G5 across context.md + search + MCP + remote)', () => {
  let seeded: SeededRealm;
  beforeEach(async () => {
    seeded = await seedRealmFromFixture();
  });
  afterEach(() => seeded.restore());

  it('the planted secret is blocked on every channel', async () => {
    const ctx = seeded.realm.ctx;
    const labels = resolveActiveLabelIds(ctx, ['proj_test'], undefined);

    // 1. context.md
    expect(contextDoc(seeded)).not.toContain(SECRET);
    // 2. search
    expect(searchRealm(ctx, 'sk-abc', { activeLabelIds: labels })).toHaveLength(0);
    // 3. MCP (rides on the same searchRealm, but lock the actual request surface)
    expect(mcpSearch(seeded, 'sk-abc', SCOPE)).not.toContain(SECRET);
    // 4. remote pre-egress: a secret-sensitivity event is never forwarded off-device
    const secretEvent = ctx.store.listEvents(ctx.realmId).find((e) => e.sensitivity === 'secret');
    expect(secretEvent).toBeTruthy();
    const remote = new RecordingProvider('remote');
    await abstractEvents(ctx, remote, [secretEvent!]);
    expect(remote.seen).toHaveLength(0);
  });

  it('remote pre-egress checks the same floor predicates as the local Gate', async () => {
    const ctx = seeded.realm.ctx;
    const secretEvent = ctx.store.listEvents(ctx.realmId).find((e) => e.sensitivity === 'secret')!;
    const unclassified = remoteTestEvent(seeded, 'unclassified remote leak');
    const candidateScope = remoteTestEvent(seeded, 'candidate-scope remote leak', 'candidate');
    const safe = remoteTestEvent(seeded, 'remote floor parity safe event', 'inferred');

    const remote = new RecordingProvider('remote');
    await abstractEvents(ctx, remote, [secretEvent, unclassified, candidateScope, safe]);

    expect(remote.seen).toEqual(['remote floor parity safe event']);
    expect(remote.seen).not.toContain(SECRET);
    expect(remote.seen).not.toContain('unclassified remote leak');
    expect(remote.seen).not.toContain('candidate-scope remote leak');
  });

  it('out-of-active-scope content is fail-closed on every query channel', () => {
    const ctx = seeded.realm.ctx;
    const wrongLabels = resolveActiveLabelIds(ctx, [], 'no-such-scope-label'); // resolves to []

    // 1. context.md scoped to a non-existent label emits no in-scope claim.
    const doc = contextDoc(seeded, 'no-such-scope-label');
    for (const known of ['Always use TypeScript strict mode', 'better-sqlite3', '2-space indentation']) {
      expect(doc).not.toContain(known);
    }
    // 2. search fails closed on an empty/mismatched scope (no Realm-wide fallback).
    expect(searchRealm(ctx, 'better-sqlite3', { activeLabelIds: wrongLabels })).toHaveLength(0);
    // 3. MCP with a non-existent scope returns no matches.
    expect(mcpSearch(seeded, 'better-sqlite3', 'no-such-scope-label')).toContain('No matches.');
  });

  it('blocks a secret/out-of-scope neighbor reached by a supersede association edge', () => {
    const ctx = seeded.realm.ctx;
    const activeLabels = resolveActiveLabelIds(ctx, ['proj_test'], undefined);
    const seed = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')[0]!;
    const unsafe = putScopedClaim(
      seeded,
      seed,
      `Association traversal must not leak ${SECRET}`,
      ['lbl_outside_association'],
      'secret',
    );
    ctx.store.putClaim({ ...seed, supersedes: [unsafe.claim_id] });

    const proposals = proposeNeighbors(ctx, [toScopedClaim(ctx, ctx.store.getClaim(seed.claim_id)!)], {
      audience: 'ai_tool',
      aperture: 'standard',
      activeLabelIds: activeLabels,
      crossScopeAllowed: false,
    });

    expect(proposals.map((p) => p.claim.claim_id)).not.toContain(unsafe.claim_id);
    expect(contextDoc(seeded)).not.toContain(SECRET);
    expect(getRecallCount(ctx, unsafe.claim_id)).toBe(0);
  });

  it('makes a supersede association edge inert when either endpoint is forgotten', () => {
    const ctx = seeded.realm.ctx;
    const activeLabels = resolveActiveLabelIds(ctx, ['proj_test'], undefined);
    const seed = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')[0]!;
    const neighbor = putScopedClaim(seeded, seed, 'Association neighbor should not revive after forget', activeLabels);
    ctx.store.putClaim({ ...seed, supersedes: [neighbor.claim_id] });
    const req = {
      audience: 'ai_tool' as const,
      aperture: 'standard' as const,
      activeLabelIds: activeLabels,
      crossScopeAllowed: false,
    };

    expect(proposeNeighbors(ctx, [toScopedClaim(ctx, ctx.store.getClaim(seed.claim_id)!)], req)).toHaveLength(1);

    forgetClaim(ctx, neighbor.claim_id, { seal: true });

    expect(proposeNeighbors(ctx, [toScopedClaim(ctx, ctx.store.getClaim(seed.claim_id)!)], req)).toHaveLength(0);
    expect(contextDoc(seeded)).not.toContain('Association neighbor should not revive after forget');
    const latestPack = ctx.store.listContextPacks(ctx.realmId).at(-1);
    expect(latestPack?.evidence_ids).not.toContain(neighbor.claim_id);
  });
});
