// capture — the only 1-to-2 verb (FR-007). It ingests the original without
// breaking it and simultaneously produces Undiluted (content) and Occurrence
// (when/where/how observed). If raw capture fails, derived processing must not
// proceed (gate 1) — but a later parse failure never loses raw, because the raw
// is stored here first (raw-only fallback, FR-011/FR-014).
import type { RealmContext } from '@core/runtime';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { realmHmac } from '@security/crypto-primitives';
import type { Occurrence, Source, Undiluted } from '@core/schema/entities';
import type { OccurrenceInput } from './types';

export class CaptureError extends Error {}

export interface CaptureOutput {
  undiluted: Undiluted;
  occurrence: Occurrence;
  deduped: boolean;
}

const cursorKey = (sourceId: string) => `cursor:${sourceId}`;

export function getSourceCursor(ctx: RealmContext, sourceId: string): number {
  const v = ctx.store.getMeta(cursorKey(sourceId));
  return v ? Number(v) : 0;
}

export function capture(ctx: RealmContext, source: Source, input: OccurrenceInput, now = new Date()): CaptureOutput {
  const fingerprint = realmHmac(ctx.realmKey, input.bytes);

  // Dedup raw within the Realm (content_fingerprint, realm_key HMAC).
  let undiluted = ctx.store.findUndilutedByFingerprint(ctx.realmId, fingerprint);
  let deduped = true;
  if (!undiluted) {
    deduped = false;
    const undilutedId = newId('undiluted', now.getTime());
    let ref: string;
    try {
      ref = ctx.objects.put(undilutedId, input.bytes).ref;
    } catch (e) {
      // Raw capture failed: do NOT proceed to derived processing (gate 1).
      throw new CaptureError(`raw capture failed: ${(e as Error).message}`);
    }
    undiluted = {
      undiluted_id: undilutedId,
      realm_id: ctx.realmId,
      payload_format: input.payload_format,
      encrypted_payload_ref: ref,
      content_fingerprint: fingerprint,
      size_bytes: input.bytes.length,
      compression: 'none',
      data_key_id: ctx.keyring.dekId,
      created_at: now.toISOString(),
      status: 'active',
      schema_version: SCHEMA_VERSION.undiluted,
    };
    ctx.store.putUndiluted(undiluted);
  }

  const occurrence: Occurrence = {
    occurrence_id: newId('occurrence', now.getTime()),
    undiluted_id: undiluted.undiluted_id,
    source_id: source.source_id,
    connector_id: source.connector_id,
    connector_version: 'Connector.v1',
    parser_hint: input.parser_hint,
    source_path_ref: null, // transcript path is sensitive; not stored in plaintext
    source_cursor: String(input.cursor_end),
    captured_at: now.toISOString(),
    capture_method: input.capture_method,
    status: 'captured',
    schema_version: SCHEMA_VERSION.occurrence,
  };
  ctx.store.putOccurrence(occurrence);
  ctx.store.setMeta(cursorKey(source.source_id), String(input.cursor_end));
  ctx.chronicler.append('capture', occurrence.occurrence_id, now);

  return { undiluted, occurrence, deduped };
}
