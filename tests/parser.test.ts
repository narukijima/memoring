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

  it('quarantines a non-JSONL payload without losing raw', () => {
    const bytes = Buffer.from('this is not json\nnor is this\n', 'utf8');
    const result = claudeCodeConnector.parse(dummyRaw, dummyOcc, bytes);
    expect(result.kind).toBe('quarantine');
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
