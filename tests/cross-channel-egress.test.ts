// Cross-channel egress lock (T2). The project memory warns of a failure mode where
// "green tests" only checked context.md, so a leak on search / MCP / remote stayed
// invisible. This test drives ONE seeded realm (with a planted secret) through ALL
// FOUR raw-text egress channels and asserts the same forbidden content is blocked on
// every one — so the channels can never drift apart silently.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildContext } from '@retrieval/context-pack';
import { searchRealm } from '@retrieval/search';
import { handleMcpRequest } from '@retrieval/mcp';
import { abstractEvents } from '@claim/extractor';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import type { AbstractCandidate, AbstractInput, MemoryProvider } from '@claim/provider';
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
});
