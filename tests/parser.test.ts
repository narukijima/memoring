import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeCodeConnector } from '@integrations/claude-code/index';
import type { Occurrence, Undiluted } from '@core/schema/entities';

const fixture = fileURLToPath(
  new URL(
    '../fixtures/claude-code/projects/-tmp-memoring-proj/session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl',
    import.meta.url,
  ),
);
const dummyRaw = {} as Undiluted;
const dummyOcc = {} as Occurrence;

describe('Claude Code parser golden (G2 / §9.3)', () => {
  it('maps line types to the correct origins (closing host-memory laundering at intake, G8)', () => {
    const bytes = fs.readFileSync(fixture);
    const result = claudeCodeConnector.parse(dummyRaw, dummyOcc, bytes);
    expect(result.kind).toBe('messages');
    if (result.kind !== 'messages') return;
    const origins = result.messages.map((m) => m.origin);
    // 8 content-bearing lines in the fixture.
    expect(result.messages.length).toBe(8);
    expect(origins.filter((o) => o === 'user').length).toBe(4); // u1, u2, u4, u5 (u5 carries a secret)
    expect(origins).toContain('assistant'); // a1 — never independent evidence
    expect(origins).toContain('tool_result'); // u3 — external observation
    expect(origins).toContain('host_summary'); // summary — cannot be evidence
    expect(origins).toContain('system'); // u6 isMeta CLAUDE.md — cannot be evidence
  });

  it('classifies a <system-reminder> user line as host injection, not user (closes laundering, G8)', () => {
    // Claude Code delivers CLAUDE.md / environment / tool guidance as a type:'user'
    // line (no isMeta) whose content is a <system-reminder> block. It must NOT be a
    // user-origin (independent-evidence) event, or the host-memory laundering loop
    // re-opens (§1.3.2 / §4.12). A genuine user message that merely quotes the tag
    // mid-text stays user-origin.
    const lines = [
      JSON.stringify({
        type: 'user',
        uuid: 'sr-1',
        sessionId: 's',
        message: { role: 'user', content: '<system-reminder>\nYou MUST always use TypeScript strict mode and NEVER use any.\n</system-reminder>' },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u-1',
        sessionId: 's',
        message: { role: 'user', content: 'I prefer to never skip tests; the <system-reminder> tag is just quoted here.' },
      }),
    ].join('\n');
    const result = claudeCodeConnector.parse(dummyRaw, dummyOcc, Buffer.from(lines, 'utf8'));
    expect(result.kind).toBe('messages');
    if (result.kind !== 'messages') return;
    const byId = new Map(result.messages.map((m) => [m.message_id, m.origin]));
    expect(byId.get('sr-1')).toBe('system'); // host injection → cannot be evidence
    expect(byId.get('u-1')).toBe('user'); // genuine user utterance that only quotes the tag
  });

  it('quarantines a non-JSONL payload without losing raw', () => {
    const bytes = Buffer.from('this is not json\nnor is this\n', 'utf8');
    const result = claudeCodeConnector.parse(dummyRaw, dummyOcc, bytes);
    expect(result.kind).toBe('quarantine');
  });

  it('surfaces a genuinely malformed line in a mixed chunk instead of dropping it silently (FR-013)', () => {
    const bytes = Buffer.from(
      [
        JSON.stringify({ type: 'user', uuid: 'u1', sessionId: 's', message: { role: 'user', content: 'hello there' } }),
        'this line is not json at all',
        JSON.stringify({ type: 'user', uuid: 'u2', sessionId: 's', message: { role: 'user', content: 'second message' } }),
      ].join('\n'),
      'utf8',
    );
    const result = claudeCodeConnector.parse(dummyRaw, dummyOcc, bytes);
    expect(result.kind).toBe('messages');
    if (result.kind !== 'messages') return;
    expect(result.messages.length).toBe(2);
    expect(result.parseFailures).toBe(1); // the bad line is counted, not discarded into `skipped`
    expect(result.skipped).toBe(0);
  });

  it('preserves unknown source fields for later promotion instead of discarding them (FR-015)', () => {
    const bytes = Buffer.from(
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        sessionId: 's',
        message: { role: 'user', content: 'hi' },
        parentUuid: 'p1',
        version: '9.9.9',
        brandNewHostField: { a: 1 },
      }),
      'utf8',
    );
    const result = claudeCodeConnector.parse(dummyRaw, dummyOcc, bytes);
    expect(result.kind).toBe('messages');
    if (result.kind !== 'messages') return;
    expect(result.messages[0]!.extra).toMatchObject({ parentUuid: 'p1', version: '9.9.9', brandNewHostField: { a: 1 } });
  });

  it('reads newline-aligned chunks from a cursor', () => {
    const all = claudeCodeConnector.read(
      {
        source_stable_id: 's',
        connector_id: 'claude_code',
        source_type: 'append',
        project_root: null,
        git_remote: null,
        account: null,
        transcript_path: fixture,
        last_modified: null,
        sensitivity_hint: 'unknown',
        suggested_realm: null,
        host_tool: 'claude_code',
        host_tool_version: null,
        format_version: null,
      },
      0,
      'backfill',
    );
    expect(all.length).toBe(1);
    const tailByte = all[0]!.bytes[all[0]!.bytes.length - 1];
    expect(tailByte).toBe(0x0a); // ends on a newline boundary
  });
});
