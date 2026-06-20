import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchRealm, rebuildIndex, indexEvent } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import { seedRealmFromFixture, type SeededRealm } from './seed';
import type { Assignment, MemEvent } from '@core/schema/entities';

let seeded: SeededRealm;
let active: string[];
beforeEach(async () => {
  seeded = await seedRealmFromFixture();
  active = resolveActiveLabelIds(seeded.realm.ctx, ['proj_test']);
});
afterEach(() => seeded.restore());

describe('search (FR-040..042, NFR-018)', () => {
  it('finds consolidated claims by exact substring', () => {
    const hits = searchRealm(seeded.realm.ctx, 'better-sqlite3', { activeLabelIds: active });
    expect(hits.some((h) => h.ref_type === 'claim')).toBe(true);
  });

  it('finds events via n-gram fallback (English substring ≥3 chars)', () => {
    const hits = searchRealm(seeded.realm.ctx, 'indentation', { activeLabelIds: active });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('never returns the secret text (G3 / CON-007)', () => {
    const hits = searchRealm(seeded.realm.ctx, 'sk-abc1234567890', { activeLabelIds: active });
    expect(hits.length).toBe(0);
  });

  it('fails closed: no active scope → no results (G4/FR-042)', () => {
    expect(searchRealm(seeded.realm.ctx, 'indentation').length).toBe(0);
    expect(searchRealm(seeded.realm.ctx, 'indentation', { activeLabelIds: [] }).length).toBe(0);
  });

  it('excludes out-of-scope items when a non-matching scope is given (FR-042)', () => {
    expect(searchRealm(seeded.realm.ctx, 'indentation', { activeLabelIds: ['lbl_does_not_exist'] }).length).toBe(0);
    expect(searchRealm(seeded.realm.ctx, 'indentation', { activeLabelIds: active }).length).toBeGreaterThan(0);
  });

  it('rebuilds deterministically from lower layers (NFR-006)', () => {
    const before = searchRealm(seeded.realm.ctx, 'better-sqlite3', { activeLabelIds: active }).length;
    rebuildIndex(seeded.realm.ctx);
    const after = searchRealm(seeded.realm.ctx, 'better-sqlite3', { activeLabelIds: active }).length;
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(0);
  });

  it('does not index events that have no passed SecretScanResult (fail closed)', () => {
    const ctx = seeded.realm.ctx;
    const src = sourceIdentity(ctx.realmKey, 'claude_code', 'missing-scan-src');
    const ses = sessionIdentity(ctx.realmKey, src, 'missing-scan-session');
    const eventId = newId('event');
    const textRef = ctx.objects.put(`${eventId}_text`, Buffer.from('UNSCANNED_DATABASE_PASSWORD=hunter2hunter2long', 'utf8')).ref;
    const event: MemEvent = {
      event_id: eventId,
      event_identity: eventIdentity(ctx.realmKey, src, ses, 'missing-scan-message', 'UNSCANNED_DATABASE_PASSWORD'),
      realm_id: ctx.realmId,
      occurrence_ids: [newId('occurrence')],
      session_id: 'ses_missing_scan',
      turn_id: null,
      event_type: 'message',
      role: 'user',
      origin: 'user',
      created_at: new Date().toISOString(),
      source_timestamp: null,
      timestamp_confidence: 'capture_observed',
      sequence: 999,
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
      label_ids: [active[0]!],
      project_ids: ['proj_test'],
      classification_state: 'inferred',
      assigned_by: 'rule:path_git_remote',
      confidence: 1,
      evidence: [event.occurrence_ids[0]!],
      created_by_derivation_id: null,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION.assignment,
    };
    ctx.store.putEvent(event);
    ctx.store.putAssignment(assignment);

    indexEvent(ctx, event);

    expect(searchRealm(ctx, 'UNSCANNED_DATABASE_PASSWORD', { activeLabelIds: active })).toEqual([]);
  });
});
