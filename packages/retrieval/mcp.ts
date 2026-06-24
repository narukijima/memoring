// MCP read-only stdio server (Specification §4; v0 OPTIONAL, experimental).
// JSON-RPC 2.0 over newline-delimited stdio, no external dependency. Output goes
// through the same Gate as context.md: secret / unknown / confidential /
// unclassified are never emitted; scope is required; every request is audited.
// The only write is add_memory_candidate — candidate state, non-user origin, no
// evidence authority (prevents user-authority spoofing, FR-081).
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { packageVersion } from '@core/version';
import { CLAIM_KINDS } from '@core/schema/enums';
import { searchRealm } from './search';
import { resolveActiveLabelIds } from './active-scope';
import type { Claim } from '@core/schema/entities';
import type { RealmContext } from '@core/runtime';

const PROTOCOL_VERSION = '2024-11-05';
export const MAX_JSON_RPC_LINE_BYTES = 1024 * 1024;
export const MAX_CANDIDATE_STATEMENT_CHARS = 4000;

export interface RpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: 'memoring_search',
    description: 'Search consolidated memories and observations (gated: no secret/unknown/confidential/out-of-scope).',
    inputSchema: {
      type: 'object',
      required: ['query', 'scope'],
      properties: {
        query: { type: 'string' },
        scope: { type: 'string', description: 'Active scope label (required).' },
      },
    },
  },
  {
    name: 'memoring_add_memory_candidate',
    description: 'Add a candidate memory (candidate state only; non-user origin; no evidence authority; never auto-consolidates).',
    inputSchema: {
      type: 'object',
      required: ['kind', 'statement'],
      properties: {
        kind: { enum: ['preference', 'constraint', 'decision', 'fact', 'project_context', 'procedure'] },
        statement: { type: 'string' },
      },
    },
  },
];

function rpcResult(id: RpcRequest['id'], result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}
function rpcError(id: RpcRequest['id'], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}
function toolText(text: string, isError = false): unknown {
  return { content: [{ type: 'text', text }], isError };
}

function handleSearch(ctx: RealmContext, args: Record<string, unknown>): unknown {
  const query = String(args.query ?? '');
  const scope = args.scope ? String(args.scope) : undefined;
  if (!query) return toolText('error: query is required', true);
  if (!scope) return toolText('error: scope is required (MCP is scope-gated)', true);
  const activeLabelIds = resolveActiveLabelIds(ctx, [], scope);
  // searchRealm already excludes secret/unknown/confidential and Seal-suppressed
  // hits (Specification §4), so this surface inherits the §4 guarantee centrally.
  const hits = searchRealm(ctx, query, { activeLabelIds });
  ctx.audit('mcp_request', { tool: 'memoring_search', results: hits.length });
  if (hits.length === 0) return toolText('No matches.');
  return toolText(hits.map((h) => `${h.ref_id} [${h.ref_type}] ${h.snippet}`).join('\n'));
}

function handleAddCandidate(ctx: RealmContext, args: Record<string, unknown>): unknown {
  const kind = String(args.kind ?? '');
  const statement = String(args.statement ?? '');
  if (!kind || !statement) return toolText('error: kind and statement are required', true);
  if (statement.length > MAX_CANDIDATE_STATEMENT_CHARS) {
    ctx.audit('mcp_request', {
      tool: 'memoring_add_memory_candidate',
      state: 'rejected',
      reason: 'statement_too_large',
      chars: statement.length,
    });
    return toolText(`error: statement exceeds ${MAX_CANDIDATE_STATEMENT_CHARS} characters`, true);
  }
  // Enforce the advertised inputSchema enum at runtime (the hand-rolled dispatcher
  // does not validate inputSchema).
  if (!CLAIM_KINDS.includes(kind as Claim['kind'])) {
    return toolText(`error: kind must be one of ${CLAIM_KINDS.join(', ')}`, true);
  }
  const now = new Date();
  const ref = ctx.objects.put(`${newId('claim', now.getTime())}_stmt`, Buffer.from(statement, 'utf8')).ref;
  const claim: Claim = {
    claim_id: newId('claim', now.getTime()),
    realm_id: ctx.realmId,
    kind: kind as Claim['kind'],
    statement_ref: ref,
    structured_predicate_ref: null,
    assignment_ids: [],
    project_ids: [],
    abstraction_level: 1,
    status: 'candidate', // can only ever be candidate via MCP
    conflict_reason: null,
    evidence_event_identities: [], // no evidence authority — never consolidates
    evidence_occurrence_ids: [],
    created_by: 'ai', // non-user origin
    created_by_derivation_id: null,
    created_at: now.toISOString(),
    last_recalled_at: null,
    valid_from: now.toISOString(),
    valid_until: null,
    supersedes: [],
    evidence_count: 0,
    reinforcement_score: 0,
    confidence: 0.5,
    sensitivity: 'unknown',
    sensitivity_classification_state: 'candidate',
    schema_version: SCHEMA_VERSION.claim,
  };
  ctx.store.putClaim(claim);
  ctx.flush();
  ctx.audit('mcp_request', { tool: 'memoring_add_memory_candidate', claim_id: claim.claim_id });
  return toolText(`Added candidate ${claim.claim_id} (will not auto-consolidate without independent evidence).`);
}

/** Handle one JSON-RPC request and return the serialized response (or null for a
 *  notification). Exported so the MCP egress surface can be tested directly, not
 *  only through the stdio loop — every tools/call answer passes the same Gate. */
export function handleMcpRequest(ctx: RealmContext, req: RpcRequest): string | null {
  return dispatch(ctx, req);
}

function dispatch(ctx: RealmContext, req: RpcRequest): string | null {
  switch (req.method) {
    case 'initialize':
      return rpcResult(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'memoring', version: packageVersion },
      });
    case 'notifications/initialized':
      return null; // notification, no response
    case 'ping':
      return rpcResult(req.id, {});
    case 'tools/list':
      return rpcResult(req.id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(req.params?.name ?? '');
      const args = (req.params?.arguments as Record<string, unknown>) ?? {};
      if (name === 'memoring_search') return rpcResult(req.id, handleSearch(ctx, args));
      if (name === 'memoring_add_memory_candidate') return rpcResult(req.id, handleAddCandidate(ctx, args));
      return rpcError(req.id, -32601, `Unknown tool: ${name}`);
    }
    default:
      if (req.id === undefined) return null; // unknown notification
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export function handleMcpLine(ctx: RealmContext, line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_JSON_RPC_LINE_BYTES) {
    ctx.audit('mcp_request', { tool: 'stdio', state: 'rejected', reason: 'line_too_large', bytes: Buffer.byteLength(trimmed, 'utf8') });
    return rpcError(null, -32600, 'JSON-RPC line too large');
  }
  let req: RpcRequest;
  try {
    req = JSON.parse(trimmed) as RpcRequest;
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }
  try {
    return dispatch(ctx, req);
  } catch (e) {
    if (req.id === undefined) return null;
    return rpcError(req.id, -32603, (e as Error).message);
  }
}

/** Run the stdio JSON-RPC loop until stdin closes. stdout carries only protocol. */
export function runStdioMcp(ctx: RealmContext): Promise<void> {
  return new Promise((resolve) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_JSON_RPC_LINE_BYTES && !buffer.includes('\n')) {
        ctx.audit('mcp_request', { tool: 'stdio', state: 'rejected', reason: 'line_too_large', bytes: Buffer.byteLength(buffer, 'utf8') });
        process.stdout.write(rpcError(null, -32600, 'JSON-RPC line too large') + '\n');
        buffer = '';
        return;
      }
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const out = handleMcpLine(ctx, line);
        if (out) process.stdout.write(out + '\n');
      }
    });
    process.stdin.on('end', () => resolve());
    process.stdin.on('close', () => resolve());
  });
}
