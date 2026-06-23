import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  handleMcpLine,
  handleMcpRequest,
  MAX_CANDIDATE_STATEMENT_CHARS,
  MAX_JSON_RPC_LINE_BYTES,
} from '@retrieval/mcp';
import { makeTempRealm, type TempRealm } from './helpers';

let realm: TempRealm;
beforeEach(() => {
  realm = makeTempRealm();
});
afterEach(() => realm.cleanup());

describe('MCP resource bounds', () => {
  it('rejects oversized stdio JSON-RPC lines before parsing', () => {
    const resp = handleMcpLine(realm.ctx, 'x'.repeat(MAX_JSON_RPC_LINE_BYTES + 1));
    expect(resp).toBeTruthy();
    const parsed = JSON.parse(resp!);
    expect(parsed.error.code).toBe(-32600);
    expect(parsed.error.message).toMatch(/too large/);
  });

  it('rejects oversized add_memory_candidate statements before object writes', () => {
    const before = realm.ctx.store.listClaims(realm.ctx.realmId).length;
    const resp = handleMcpRequest(realm.ctx, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'memoring_add_memory_candidate',
        arguments: {
          kind: 'fact',
          statement: 'x'.repeat(MAX_CANDIDATE_STATEMENT_CHARS + 1),
        },
      },
    });
    const parsed = JSON.parse(resp!);
    expect(parsed.result.isError).toBe(true);
    expect(parsed.result.content[0].text).toMatch(/statement exceeds/);
    expect(realm.ctx.store.listClaims(realm.ctx.realmId).length).toBe(before);
  });
});
