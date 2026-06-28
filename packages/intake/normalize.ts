// normalize — translate a source-specific format into common-timeline Events
// (FR-012). Each Event gets a rotation-invariant event_identity, a deterministic
// Secret Scan (forcing secret on detection, CON-007), and session provenance
// (context_injected). Parse failure → Quarantine, never data loss (FR-013).
import type { RealmContext } from '@core/runtime';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { textLooksContextInjected } from '@security/ouroboros';
import { runSecretScan } from '@security/secret-scan';
import { eventSealSignature, matchesActivePatternSeal } from '@claim/seal';
import type { Connector } from './types';
import type { MemEvent, Occurrence, Session, Source, Undiluted } from '@core/schema/entities';
import { eventIdentity, sessionIdentity, sourceIdentity } from './identity';

export interface NormalizeResult {
  events: MemEvent[];
  quarantined: number;
  /** Genuine per-line JSON parse failures surfaced from the Parser (FR-013). */
  parseFailures: number;
  deduped: number;
}

function getOrCreateSession(
  ctx: RealmContext,
  source: Source,
  sesIdentity: string,
  hostTool: string,
  now: Date,
): Session {
  const key = `ses:${sesIdentity}`;
  const existingId = ctx.store.getMeta(key);
  if (existingId) {
    const s = ctx.store.getSession(existingId);
    if (s) return s;
  }
  const session: Session = {
    session_id: newId('session', now.getTime()),
    realm_id: ctx.realmId,
    source_id: source.source_id,
    connector_instance_id: source.connector_instance_id,
    host_tool: hostTool,
    host_tool_version: null,
    format_version: null,
    cwd_ref: null,
    project_ids: [],
    git_remote_ref: null,
    source_account_ref: null,
    transcript_path_ref: null,
    started_at: now.toISOString(),
    ended_at: null,
    context_injected: false,
    context_pack_digest: null,
    schema_version: SCHEMA_VERSION.session,
  };
  ctx.store.putSession(session);
  ctx.store.setMeta(key, session.session_id);
  return session;
}

export function normalizeOccurrence(
  ctx: RealmContext,
  source: Source,
  occurrence: Occurrence,
  undiluted: Undiluted,
  connector: Connector,
  now = new Date(),
): NormalizeResult {
  const rawBytes = ctx.objects.get(undiluted.encrypted_payload_ref);
  const parsed = connector.parse(undiluted, occurrence, rawBytes);

  if (parsed.kind === 'quarantine') {
    ctx.store.putQuarantine({
      quarantine_id: newId('quarantine', now.getTime()),
      realm_id: ctx.realmId,
      occurrence_id: occurrence.occurrence_id,
      undiluted_id: undiluted.undiluted_id,
      reason: parsed.reason,
      parser_version: occurrence.parser_hint,
      created_at: now.toISOString(),
      schema_version: SCHEMA_VERSION.quarantine,
    });
    return { events: [], quarantined: 1, parseFailures: 0, deduped: 0 };
  }

  const srcIdentity = sourceIdentity(ctx.realmKey, source.connector_id, source.source_stable_id);
  const created: MemEvent[] = [];
  let deduped = 0;

  // Determine context_injected per session up front (batch-global), so EVERY event
  // of a marker-tripped session inherits it regardless of message order within the
  // batch (§1.3 "session-level provenance" / §3.4 whole-session over-exclusion).
  const injectedBySession = new Set<string>();
  for (const msg of parsed.messages) {
    if (textLooksContextInjected(msg.text)) {
      injectedBySession.add(sessionIdentity(ctx.realmKey, srcIdentity, msg.host_session_stable_id));
    }
  }

  for (const msg of parsed.messages) {
    const sesIdentity = sessionIdentity(ctx.realmKey, srcIdentity, msg.host_session_stable_id);
    const session = getOrCreateSession(ctx, source, sesIdentity, connector.displayName, now);
    const evIdentity = eventIdentity(
      ctx.realmKey,
      srcIdentity,
      sesIdentity,
      msg.message_id,
      msg.text,
      msg.source_position,
    );

    if (ctx.store.findEventByIdentity(ctx.realmId, evIdentity)) {
      deduped += 1; // idempotent reprocess / overlap
      continue;
    }

    // Forget durability: a Sealed event_identity (or a pattern Seal matching the
    // text) must not revive on reprocess / re-capture (§4.15). Raw remains
    // captured in the Undiluted.
    if (ctx.store.activeSealRulesBySignature(ctx.realmId, eventSealSignature(ctx.realmKey, evIdentity)).length > 0) {
      deduped += 1;
      continue;
    }
    if (matchesActivePatternSeal(ctx, msg.text)) {
      deduped += 1;
      continue;
    }

    // Scan the normalized text AND any preserved unknown fields — a secret in an
    // unknown field is also subject to the event-level Secret Scan (§5.3).
    const scanInput = msg.extra ? `${msg.text}\n${JSON.stringify(msg.extra)}` : msg.text;
    const scan = runSecretScan('', scanInput, now); // event id filled below
    const isSecret = scan.secret_detected;
    const scanUsable = scan.secret_scan_passed;

    // context_injected provenance: a marker anywhere in the session falls the
    // whole session to the safe side (over-exclusion; span-level is v0.1).
    const injected = injectedBySession.has(sesIdentity) || session.context_injected;
    if (injected && !session.context_injected) {
      session.context_injected = true;
      ctx.store.putSession(session);
      for (const ev of ctx.store.listActiveEventsForSession(ctx.realmId, session.session_id)) {
        if (!ev.context_injected) ctx.store.putEvent({ ...ev, context_injected: true });
      }
    }

    const sequence = ctx.chronicler.nextSequence();
    const eventId = newId('event', now.getTime());

    // secret / unusable-scan text is never stored as normalized text (raw stays
    // encrypted in Undiluted); the index/context never see it (CON-007).
    let textRef: string | null = null;
    if (!isSecret && scanUsable && msg.text) {
      textRef = ctx.objects.put(`${eventId}_text`, Buffer.from(msg.text, 'utf8')).ref;
    }
    // Preserve unknown fields encrypted (never indexed / egressed) so a host
    // format change is not silently discarded (FR-015, §5.3).
    const extraRef = msg.extra
      ? ctx.objects.put(`${eventId}_extra`, Buffer.from(JSON.stringify(msg.extra), 'utf8')).ref
      : null;

    const event: MemEvent = {
      event_id: eventId,
      event_identity: evIdentity,
      realm_id: ctx.realmId,
      occurrence_ids: [occurrence.occurrence_id],
      session_id: session.session_id,
      turn_id: null,
      event_type: msg.event_type,
      role: msg.role,
      origin: msg.origin,
      created_at: now.toISOString(),
      source_timestamp: msg.source_timestamp,
      timestamp_confidence: msg.source_timestamp ? 'source_reported' : 'capture_observed',
      sequence,
      text_ref: textRef,
      source_extra_ref: extraRef,
      sensitivity: isSecret ? 'secret' : 'unknown',
      sensitivity_classification_state: isSecret ? 'inferred' : 'candidate',
      context_injected: injected,
      context_pack_digest: null,
      parser_version: occurrence.parser_hint,
      status: 'active',
      schema_version: SCHEMA_VERSION.event,
    };
    ctx.store.putEvent(event);
    ctx.store.putSecretScan({ ...scan, secret_scan_id: scan.secret_scan_id, event_id: eventId });
    ctx.chronicler.append('normalize', eventId, now);
    created.push(event);
  }

  return { events: created, quarantined: 0, parseFailures: parsed.parseFailures, deduped };
}
