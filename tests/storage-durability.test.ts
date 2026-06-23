import { describe, expect, it } from 'vitest';
import { openRealmLocal } from '@core/runtime';
import { makeTempRealm } from './helpers';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import type { MemEvent } from '@core/schema/entities';

describe('encrypted DB durability', () => {
  it('rejects a second live opener so a stale snapshot cannot overwrite a Seal', () => {
    const prev = process.env.MEMORING_LOCK_MAX_WAIT_MS;
    process.env.MEMORING_LOCK_MAX_WAIT_MS = '0'; // fail fast instead of waiting through the retry window
    const realm = makeTempRealm();
    try {
      expect(() => openRealmLocal(realm.root)).toThrow(/already open/);

      realm.ctx.flush();
      realm.ctx.close(true);

      // After the holder releases the lock, the next open succeeds — this is the
      // basis for daemon (watch) + context build coexistence: the daemon holds
      // the lock only per tick, so a CLI command can interleave between ticks.
      const reopened = openRealmLocal(realm.root);
      try {
        expect(reopened.realmId).toBe(realm.ctx.realmId);
      } finally {
        reopened.close(false);
      }
    } finally {
      realm.cleanup();
      if (prev === undefined) delete process.env.MEMORING_LOCK_MAX_WAIT_MS;
      else process.env.MEMORING_LOCK_MAX_WAIT_MS = prev;
    }
  });

  it('repairs a crash window after object deletion but before DB flush', () => {
    const realm = makeTempRealm();
    const root = realm.root;
    try {
      const ctx = realm.ctx;
      const src = sourceIdentity(ctx.realmKey, 'test', 'src-crash');
      const ses = sessionIdentity(ctx.realmKey, src, 'ses-crash');
      const eventId = newId('event');
      const textRef = ctx.objects.put(`${eventId}_text`, Buffer.from('crash-window text', 'utf8')).ref;
      const orphanRef = ctx.objects.put('orphan_after_flush', Buffer.from('orphan payload', 'utf8')).ref;
      const event: MemEvent = {
        event_id: eventId,
        event_identity: eventIdentity(ctx.realmKey, src, ses, eventId, 'crash-window text'),
        realm_id: ctx.realmId,
        occurrence_ids: [newId('occurrence')],
        session_id: 'ses_crash',
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
      ctx.store.putEvent(event);
      ctx.flush();

      ctx.objects.delete(textRef);
      ctx.close(false);

      const reopened = openRealmLocal(root);
      try {
        const repaired = reopened.store.getEvent(eventId)!;
        expect(repaired.status).toBe('redacted');
        expect(repaired.text_ref).toBe(null);
        expect(reopened.objects.exists(orphanRef)).toBe(false);
      } finally {
        reopened.close(true);
      }
    } finally {
      realm.cleanup();
    }
  });

  it('rejects escaped object refs in object store APIs', () => {
    const realm = makeTempRealm();
    try {
      const bad = 'objects/../keys/key.json';
      expect(() => realm.ctx.objects.exists(bad)).toThrow(/Invalid object ref/);
      expect(() => realm.ctx.objects.get(bad)).toThrow(/Invalid object ref/);
      expect(() => realm.ctx.objects.delete(bad)).toThrow(/Invalid object ref/);
    } finally {
      realm.cleanup();
    }
  });

  it('refuses to reopen a persisted DB document containing an escaped object ref', () => {
    const realm = makeTempRealm();
    const root = realm.root;
    try {
      const ctx = realm.ctx;
      const src = sourceIdentity(ctx.realmKey, 'test', 'src-bad-ref');
      const ses = sessionIdentity(ctx.realmKey, src, 'ses-bad-ref');
      const eventId = newId('event');
      const event: MemEvent = {
        event_id: eventId,
        event_identity: eventIdentity(ctx.realmKey, src, ses, eventId, 'bad ref'),
        realm_id: ctx.realmId,
        occurrence_ids: [newId('occurrence')],
        session_id: 'ses_bad_ref',
        turn_id: null,
        event_type: 'message',
        role: 'user',
        origin: 'user',
        created_at: new Date().toISOString(),
        source_timestamp: null,
        timestamp_confidence: 'capture_observed',
        sequence: 1,
        text_ref: 'objects/../keys/key.json',
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
      ctx.flush();
      ctx.close(true);

      expect(() => openRealmLocal(root)).toThrow(/Invalid object ref/);
    } finally {
      realm.cleanup();
    }
  });
});
