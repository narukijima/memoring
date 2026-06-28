// The agent loop — the LLM is the OPERATOR (ADR/user model):
//   user → CLI → LLM → Memoring        (the LLM decides which tools to call)
//   Memoring → LLM → CLI → user        (the LLM reads tool results and answers)
// The user speaks natural language; the LLM drives Memoring through a small set of
// TOOLS, each of which runs strictly through the existing Gate (scope / secret / Seal),
// so the LLM orchestrates but can NEVER bypass the Gate. This replaces the old
// keyword-search-then-phrase path: conversational questions that share no literal
// tokens with the stored text now work because the LLM can `browse_memories` (no
// keyword needed) and `read_memory`, then answer — no embeddings required.
//
// The protocol is model-agnostic (works on any Ollama model, no native function
// calling): each step the model returns ONE JSON object — {"tool","args"} to act, or
// {"answer"} to finish. We parse, run the gated tool, feed the observation back, and
// loop. Grounding is enforced by the system prompt (answer ONLY from tool results) and
// by the tools (they only ever return gated, in-scope, secret-free memory).
import type { RealmContext } from '@core/runtime';
import type { Audience } from '@core/schema/enums';
import { browseRealm, readClaimById, searchRealm, type MemoryRecord } from '@retrieval/search';
import type { OutputProvider } from './output-provider';
import { memoryStatusLines } from './commands/status';

export interface AgentTurn {
  question: string;
  answer: string;
}

export interface AgentToolContext {
  ctx: RealmContext;
  /** The live active scope (read fresh each tool call, so a switch_scope mid-turn
   *  takes effect for the next browse/search in the SAME turn). */
  activeLabelIds: string[];
  audience: Audience;
  /** Bind a scope by name; returns a human message. Absent → switching unavailable.
   *  (Scope switching only changes which gated scope is read — it is not a write.) */
  switchScope?: (name: string) => string;
}

interface AgentTool {
  name: string;
  description: string;
  args: Record<string, string>;
  run(input: Record<string, unknown>, tc: AgentToolContext): string | Promise<string>;
}

function cap(text: string, max = 280): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

function recordLine(r: MemoryRecord, max = 280): string {
  return `- [${r.ref_id}] (${r.created_at.slice(0, 10)}) [${r.kind}] ${cap(r.statement, max)}`;
}

function scopeNames(tc: AgentToolContext): string[] {
  return tc.ctx.store
    .listLabels(tc.ctx.realmId)
    .filter((l) => l.state === 'active')
    .map((l) => l.canonical_name)
    .sort((a, b) => a.localeCompare(b));
}

function activeScopeNames(tc: AgentToolContext): string {
  const names = tc.activeLabelIds
    .map((id) => tc.ctx.store.getLabel(id)?.canonical_name)
    .filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(', ') : '(none)';
}

// The tools the LLM may call. Every memory-reading tool goes through the Gate via
// browseRealm / searchRealm / readClaimById (all enforce scope + secret + Seal for the
// provider's audience). NONE of them write or egress around the Gate.
export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'browse_memories',
    description: 'List memories in the active scope (no keyword needed). Use this first for open-ended questions.',
    args: { order: 'recent|oldest (default recent)', limit: 'max items, 1..50 (default 50)' },
    run(input, tc) {
      const order = input.order === 'oldest' ? 'oldest' : 'recent';
      // Clamp the model-supplied limit: a (remote) model must not request a huge dump,
      // and odd/negative values are normalized to a small positive range.
      const limit = Math.max(1, Math.min(50, typeof input.limit === 'number' ? Math.floor(input.limit) : 50));
      const rows = browseRealm(tc.ctx, { activeLabelIds: tc.activeLabelIds, audience: tc.audience, order, limit });
      if (rows.length === 0) return `No memories are visible in scope "${activeScopeNames(tc)}".`;
      return `${rows.length} memory(ies) in scope "${activeScopeNames(tc)}":\n${rows.map((r) => recordLine(r)).join('\n')}`;
    },
  },
  {
    name: 'search_memory',
    description: 'Keyword/substring search within the active scope. Use for a specific term, name, or code token.',
    args: { query: 'the search term' },
    run(input, tc) {
      const query = typeof input.query === 'string' ? input.query : '';
      if (!query.trim()) return 'No query provided.';
      const hits = searchRealm(tc.ctx, query, { activeLabelIds: tc.activeLabelIds, audience: tc.audience });
      if (hits.length === 0) return `No keyword hits for "${query}" in scope "${activeScopeNames(tc)}". Try browse_memories.`;
      return `${hits.length} hit(s):\n${hits.map((h) => `- [${h.ref_id}] ${cap(h.snippet)}`).join('\n')}`;
    },
  },
  {
    name: 'read_memory',
    description: 'Read the full text of one memory by its ref_id (from browse or search).',
    args: { ref_id: 'the memory id, e.g. clm_...' },
    run(input, tc) {
      const refId = typeof input.ref_id === 'string' ? input.ref_id : '';
      const rec = readClaimById(tc.ctx, refId, { activeLabelIds: tc.activeLabelIds, audience: tc.audience });
      if (!rec) return `No readable memory "${refId}" in the active scope.`;
      return `[${rec.ref_id}] (${rec.created_at.slice(0, 10)}) [${rec.kind}]\n${rec.statement}`;
    },
  },
  {
    name: 'list_scopes',
    description: 'List the available memory scopes and the currently active one.',
    args: {},
    run(_input, tc) {
      return `Active scope: ${activeScopeNames(tc)}\nAvailable: ${scopeNames(tc).join(', ') || '(none)'}`;
    },
  },
  {
    name: 'switch_scope',
    description: 'Bind the session to a named scope. Call this (after list_scopes) when no scope is active, or when the user asks about a different scope, BEFORE browsing/searching.',
    args: { name: 'the scope name to switch to' },
    run(input, tc) {
      if (!tc.switchScope) return 'Scope switching is not available in this session.';
      const name = typeof input.name === 'string' ? input.name : '';
      if (!name.trim()) return 'No scope name provided.';
      return tc.switchScope(name);
    },
  },
  {
    name: 'memory_status',
    description: 'Show the memory system status (counts and scopes).',
    args: {},
    run(_input, tc) {
      // Drop the model/endpoint line: the output model has no need for its own base_url,
      // and it must not be egressed to a remote provider as a tool observation.
      return memoryStatusLines(tc.ctx)
        .filter((l) => !/^Model:/.test(l))
        .join('\n');
    },
  },
  // NOTE: there is deliberately NO write tool here. Ingest (`/sync`) writes to memory and
  // may invoke loop-layer egress, so it stays a DETERMINISTIC, human-initiated slash
  // command — a prompt instruction is not an authorization boundary (review #3). The LLM
  // can still tell the user to run /sync in its answer.
];

const TOOL_BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

function toolCatalog(): string {
  return AGENT_TOOLS.map((t) => {
    const args = Object.entries(t.args).map(([k, v]) => `${k} (${v})`).join(', ') || 'none';
    return `- ${t.name}: ${t.description} | args: ${args}`;
  }).join('\n');
}

export function buildAgentSystemPrompt(activeScope: string): string {
  const noScope = !activeScope || activeScope === '(none)';
  return [
    "You are Memoring, the user's local-first memory assistant. Talk with the user naturally, in their language.",
    'You can look things up in their stored memory using the tools below. For memory questions, use a tool first',
    'and answer only from the tool results. Do not answer from outside knowledge.',
    '',
    noScope
      ? 'No scope is bound yet; call list_scopes then switch_scope for a memory question.'
      : `Active memory scope: "${activeScope}".`,
    '',
    'Tools:',
    toolCatalog(),
    '',
    'Reply with EXACTLY ONE JSON object per step:',
    '  {"tool":"<name>","args":{...}}   to use a tool',
    '  {"answer":"<reply>"}             to talk to the user',
  ].join('\n');
}

function buildStepPrompt(system: string, history: AgentTurn[], question: string, scratch: string[]): string {
  const convo = history.map((t) => `User: ${t.question}\nMemoring: ${t.answer}`).join('\n');
  return [
    system,
    history.length > 0 ? `\nConversation so far (continuity only):\n${convo}` : '',
    `\nUser: ${question}`,
    scratch.length > 0 ? `\nYour tool calls and results so far:\n${scratch.join('\n')}` : '',
    '\nRespond with the next single JSON object:',
  ]
    .filter(Boolean)
    .join('\n');
}

function unfence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstNewline = trimmed.indexOf('\n');
  const lastFence = trimmed.lastIndexOf('```');
  if (firstNewline < 0 || lastFence <= firstNewline) return trimmed;
  return trimmed.slice(firstNewline + 1, lastFence).trim();
}

/** Extract the first balanced JSON object from model text (tolerant of preamble). */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const unfenced = unfence(text);
  const start = unfenced.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < unfenced.length; i++) {
    const c = unfenced[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(unfenced.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

export type AgentStep =
  | { kind: 'answer'; text: string }
  | { kind: 'tool'; name: string; args: Record<string, unknown> }
  | { kind: 'invalid' };

export function parseAgentStep(raw: string): AgentStep {
  const obj = parseJsonObject(raw);
  if (!obj) return { kind: 'invalid' };
  if (typeof obj.answer === 'string') {
    const text = obj.answer.trim();
    return text ? { kind: 'answer', text } : { kind: 'invalid' }; // a blank answer is not terminal
  }
  if (typeof obj.tool === 'string') {
    const args = obj.args && typeof obj.args === 'object' ? (obj.args as Record<string, unknown>) : {};
    return { kind: 'tool', name: obj.tool, args };
  }
  return { kind: 'invalid' };
}

export interface AgentResult {
  answer: string;
  toolCalls: string[];
  grounded: boolean;
}

/**
 * Run one agent turn: the LLM drives tools until it produces an answer (or the step
 * budget is hit, after which we force a final answer from the observations gathered).
 * READ-ONLY: every tool reads gated memory only; nothing here writes or egresses
 * around the Gate. `onTool` is an optional progress hook for the CLI.
 */
export async function runAgentTurn(
  provider: OutputProvider,
  tc: AgentToolContext,
  history: AgentTurn[],
  question: string,
  opts: { maxSteps?: number; onTool?: (name: string, args: Record<string, unknown>) => void; fallbackAnswer?: string } = {},
): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? 6;
  const scratch: string[] = [];
  const toolCalls: string[] = [];
  let usedTool = false;

  for (let step = 0; step < maxSteps; step++) {
    // Rebuild the system prompt each step from the LIVE scope, so a switch_scope
    // mid-turn correctly re-binds the prompt for the rest of the turn.
    const system = buildAgentSystemPrompt(activeScopeNames(tc));
    const raw = await provider.generate(buildStepPrompt(system, history, question, scratch));
    const parsed = parseAgentStep(raw);
    if (parsed.kind === 'answer') {
      if (usedTool) return { answer: parsed.text, toolCalls, grounded: true };
      scratch.push(
        '(You tried to answer without observing memory. Use list_scopes/switch_scope/browse_memories/search_memory first; if no memory is visible, say that from the tool result.)',
      );
      continue;
    }
    if (parsed.kind === 'tool') {
      const tool = TOOL_BY_NAME.get(parsed.name);
      if (!tool) {
        scratch.push(`Tool "${parsed.name}" → error: unknown tool. Available: ${AGENT_TOOLS.map((t) => t.name).join(', ')}.`);
        continue;
      }
      opts.onTool?.(parsed.name, parsed.args);
      toolCalls.push(parsed.name);
      let observation: string;
      try {
        observation = await tool.run(parsed.args, tc);
      } catch (err) {
        observation = `error: ${(err as Error).message}`;
      }
      usedTool = true;
      scratch.push(`Tool ${parsed.name}(${JSON.stringify(parsed.args)}) → ${observation}`);
      continue;
    }
    // Unparseable step: nudge once with the protocol, then keep going.
    scratch.push('(Your last reply was not a single JSON object. Reply with {"tool",...} or {"answer",...} only.)');
  }

  // Step budget exhausted → force a final grounded answer from what was gathered.
  const finalPrompt = [
    buildAgentSystemPrompt(activeScopeNames(tc)),
    `\nUser: ${question}`,
    scratch.length > 0 ? `\nTool results gathered:\n${scratch.join('\n')}` : '',
    '\nNow answer the user ONLY from the tool results above, in their language. Reply with {"answer":"..."}.',
  ]
    .filter(Boolean)
    .join('\n');
  const parsed = parseAgentStep(await provider.generate(finalPrompt));
  // If the model still won't produce a clean answer, return a safe fallback rather
  // than echoing raw tool-call JSON / garbage to the user (and into history).
  const answer =
    parsed.kind === 'answer' && usedTool
      ? parsed.text
      : opts.fallbackAnswer ?? 'I could not find an answer in the stored memory.';
  return { answer, toolCalls, grounded: usedTool };
}
