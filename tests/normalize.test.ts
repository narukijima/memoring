import { describe, expect, it } from 'vitest';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { sourceIdentity } from '@intake/identity';
import { capture } from '@intake/capture';
import { normalizeOccurrence } from '@intake/normalize';
import { OUROBOROS_TOKEN } from '@security/ouroboros';
import { makeTempRealm } from './helpers';
import type { Connector, DetectedSource, DetectionResult, OccurrenceInput, ParsedMessage } from '@intake/types';
import type { Source } from '@core/schema/entities';

function makeSource(ctx: ReturnType<typeof makeTempRealm>['ctx']): Source {
  const source: Source = {
    source_id: newId('source'),
    realm_id: ctx.realmId,
    source_stable_key_hmac: sourceIdentity(ctx.realmKey, 'test_connector', 'source-1'),
    source_stable_id: 'source-1',
    connector_id: 'test_connector',
    connector_instance_id: 'ci_test',
    source_type: 'append',
    schema_version: SCHEMA_VERSION.source,
  };
  ctx.store.putSource(source);
  return source;
}

function input(bytes: Buffer, start: number): OccurrenceInput {
  return {
    source_stable_id: 'source-1',
    payload_format: 'jsonl',
    parser_hint: 'test.v1',
    bytes,
    cursor_start: start,
    cursor_end: start + bytes.length,
    capture_method: 'backfill',
    source_path: '/tmp/test.jsonl',
  };
}

function connector(messagesRef: { messages: ParsedMessage[] }): Connector {
  return {
    id: 'test_connector',
    displayName: 'Test Connector',
    sourceType: 'append',
    async detect(): Promise<DetectionResult> {
      return { connector_id: 'test_connector', host_tool: 'test', sources: [], notes: [] };
    },
    read(_source: DetectedSource, _fromCursor: number): OccurrenceInput[] {
      return [];
    },
    parse() {
      return { kind: 'messages', messages: messagesRef.messages, skipped: 0, parseFailures: 0 };
    },
  };
}

function msg(overrides: Partial<ParsedMessage>): ParsedMessage {
  return {
    message_id: null,
    source_position: '0',
    host_session_stable_id: 'session-1',
    origin: 'user',
    role: 'user',
    event_type: 'message',
    text: 'hello',
    source_timestamp: null,
    cwd: null,
    git_branch: null,
    extra: null,
    ...overrides,
  };
}

describe('normalizeOccurrence', () => {
  it('keeps repeated id-less append messages distinct by source position', () => {
    const realm = makeTempRealm();
    try {
      const source = makeSource(realm.ctx);
      const messagesRef = {
        messages: [
          msg({ text: 'same text', source_position: '10' }),
          msg({ text: 'same text', source_position: '20' }),
        ],
      };
      const captured = capture(realm.ctx, source, input(Buffer.from('chunk1'), 0));

      const result = normalizeOccurrence(realm.ctx, source, captured.occurrence, captured.undiluted, connector(messagesRef));

      expect(result.events.length).toBe(2);
      expect(new Set(result.events.map((e) => e.event_identity)).size).toBe(2);
    } finally {
      realm.cleanup();
    }
  });

  it('retroactively marks earlier events in the same session as context_injected', () => {
    const realm = makeTempRealm();
    try {
      const source = makeSource(realm.ctx);
      const messagesRef = { messages: [msg({ text: 'before marker', source_position: '10' })] };
      const testConnector = connector(messagesRef);
      const first = capture(realm.ctx, source, input(Buffer.from('first'), 0));
      const firstResult = normalizeOccurrence(realm.ctx, source, first.occurrence, first.undiluted, testConnector);
      expect(firstResult.events[0]?.context_injected).toBe(false);

      messagesRef.messages = [msg({ text: `later ${OUROBOROS_TOKEN}`, source_position: '20', origin: 'assistant' })];
      const second = capture(realm.ctx, source, input(Buffer.from('second'), 10));
      normalizeOccurrence(realm.ctx, source, second.occurrence, second.undiluted, testConnector);

      const earlier = realm.ctx.store.getEvent(firstResult.events[0]!.event_id);
      expect(earlier?.context_injected).toBe(true);
    } finally {
      realm.cleanup();
    }
  });
});
