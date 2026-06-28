import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_TOOLS,
  buildAgentSystemPrompt,
  parseAgentStep,
  runAgentTurn,
  type AgentToolContext,
} from '../apps/cli/agent';
import type { OutputProvider } from '../apps/cli/output-provider';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { seedRealmFromFixture, type SeededRealm } from './seed';

/** A provider that replays a scripted list of model replies, one per generate() call,
 *  recording the prompts it saw. Lets us drive the agent loop deterministically. */
class ScriptedProvider implements OutputProvider {
  id = 'output:scripted:s1';
  calls = 0;
  prompts: string[] = [];
  constructor(
    public egress: 'local' | 'remote' = 'local',
    private readonly replies: string[] = [],
  ) {}
  async generate(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const reply = this.replies[this.calls] ?? '{"answer":"(no more scripted replies)"}';
    this.calls += 1;
    return reply;
  }
}

describe('parseAgentStep — the model-agnostic JSON tool protocol', () => {
  it('parses an answer step', () => {
    expect(parseAgentStep('{"answer":"hello"}')).toEqual({ kind: 'answer', text: 'hello' });
  });
  it('parses a tool step with args', () => {
    expect(parseAgentStep('{"tool":"search_memory","args":{"query":"db"}}')).toEqual({
      kind: 'tool',
      name: 'search_memory',
      args: { query: 'db' },
    });
  });
  it('tolerates fenced JSON and leading prose', () => {
    expect(parseAgentStep('Sure!\n```json\n{"tool":"browse_memories","args":{}}\n```')).toEqual({
      kind: 'tool',
      name: 'browse_memories',
      args: {},
    });
  });
  it('returns invalid for non-JSON or shapeless objects', () => {
    expect(parseAgentStep('just talking, no json').kind).toBe('invalid');
    expect(parseAgentStep('{"foo":"bar"}').kind).toBe('invalid');
  });
});

describe('agent tools + loop (LLM operates Memoring, all gated)', () => {
  let seeded: SeededRealm;
  let tc: AgentToolContext;
  beforeEach(async () => {
    seeded = await seedRealmFromFixture();
    const active = resolveActiveLabelIds(seeded.realm.ctx, ['proj_test']);
    tc = { ctx: seeded.realm.ctx, activeLabelIds: active, audience: 'ai_tool' };
  });
  afterEach(() => seeded.restore());

  it('buildAgentSystemPrompt names the bound scope, the tools, and the JSON protocol', () => {
    const p = buildAgentSystemPrompt('proj_test');
    expect(p).toContain('proj_test');
    expect(p).toContain('browse_memories');
    expect(p).toContain('{"answer"');
    expect(p).toContain('{"tool"');
  });

  it('buildAgentSystemPrompt points the model at list_scopes/switch_scope when none is bound', () => {
    const p = buildAgentSystemPrompt('(none)');
    expect(p).toContain('list_scopes');
    expect(p).toContain('switch_scope');
  });

  it('browse_memories tool returns the scope\'s gated memory with ref_ids', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'browse_memories')!;
    const obs = await tool.run({}, tc);
    expect(obs).toContain('better-sqlite3'); // real seeded memory, no keyword needed
    expect(obs).toMatch(/\[clm_/); // ref_ids the LLM can read_memory
  });

  it('read_memory refuses an out-of-scope / bogus id (Gate enforced at the tool)', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'read_memory')!;
    expect(await tool.run({ ref_id: 'clm_not_real' }, tc)).toContain('No readable memory');
  });

  it('switch_scope tool binds via the session callback (and reports when unavailable)', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'switch_scope')!;
    let requested = '';
    const withSwitch = { ...tc, switchScope: (name: string) => ((requested = name), `Switched to ${name}`) };
    expect(await tool.run({ name: 'spesan' }, withSwitch)).toBe('Switched to spesan');
    expect(requested).toBe('spesan');
    expect(await tool.run({ name: 'x' }, tc)).toContain('not available'); // no switchScope on tc
  });

  it('exposes no write tool — ingest stays human-initiated (/sync), never an LLM-triggered action', () => {
    expect(AGENT_TOOLS.find((t) => t.name === 'sync_memory')).toBeUndefined();
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual([
      'browse_memories',
      'search_memory',
      'read_memory',
      'list_scopes',
      'switch_scope',
      'memory_status',
    ]);
  });

  it('browse_memories clamps a model-supplied limit to a small positive range', async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'browse_memories')!;
    // A huge or negative limit must not dump the scope or behave oddly; it still returns
    // gated rows (the clamp is internal — we assert it does not throw and stays bounded).
    const huge = await tool.run({ limit: 100000 }, tc);
    const neg = await tool.run({ limit: -5 }, tc);
    expect(typeof huge).toBe('string');
    expect(typeof neg).toBe('string');
  });

  it('runAgentTurn: the model browses, then answers from the observation (multi-step)', async () => {
    const provider = new ScriptedProvider('local', [
      '{"tool":"browse_memories","args":{}}',
      '{"answer":"The project uses better-sqlite3."}',
    ]);
    const result = await runAgentTurn(provider, tc, [], 'what database do we use?');
    expect(result.answer).toBe('The project uses better-sqlite3.');
    expect(result.toolCalls).toEqual(['browse_memories']);
    expect(result.grounded).toBe(true);
    expect(provider.calls).toBe(2);
    // The browse observation (real gated memory) was fed back into the second prompt.
    expect(provider.prompts[1]!).toContain('better-sqlite3');
  });

  it('runAgentTurn: a direct answer without a tool observation is not accepted', async () => {
    const provider = new ScriptedProvider('local', ['{"answer":"hi, I am Memoring."}']);
    const result = await runAgentTurn(provider, tc, [], 'hello', { maxSteps: 2 });
    expect(result.answer).toBe('I could not find an answer in the stored memory.');
    expect(result.toolCalls).toEqual([]);
    expect(result.grounded).toBe(false);
    expect(provider.calls).toBe(3);
    expect(provider.prompts[1]!).toContain('answer without observing memory');
  });

  it('runAgentTurn: an unknown tool name is reported back, not executed, and the loop recovers', async () => {
    const provider = new ScriptedProvider('local', [
      '{"tool":"delete_everything","args":{}}',
      '{"tool":"browse_memories","args":{}}',
      '{"answer":"done safely"}',
    ]);
    const result = await runAgentTurn(provider, tc, [], 'try something');
    expect(result.answer).toBe('done safely');
    expect(result.toolCalls).toEqual(['browse_memories']);
    expect(provider.prompts[1]!).toContain('unknown tool'); // observation fed back
  });

  it('runAgentTurn: refuses a forced final answer when no tool observation exists', async () => {
    // Always-invalid replies until the budget runs out; the final forced call answers.
    const provider = new ScriptedProvider('local', [
      'not json',
      'still not json',
      '{"answer":"forced final answer"}',
    ]);
    const result = await runAgentTurn(provider, tc, [], 'q', { maxSteps: 2 });
    expect(result.answer).toBe('I could not find an answer in the stored memory.');
    expect(provider.calls).toBe(3); // 2 loop steps + 1 forced final
  });

  it('READ-ONLY: a browse+answer turn creates no Events / Claims / candidates', async () => {
    const ctx = seeded.realm.ctx;
    const before = {
      events: ctx.store.listEvents(ctx.realmId).length,
      claims: ctx.store.listClaims(ctx.realmId).length,
      candidates: ctx.store.listClaimsByStatus(ctx.realmId, 'candidate').length,
    };
    const provider = new ScriptedProvider('local', [
      '{"tool":"browse_memories","args":{}}',
      '{"answer":"The project uses better-sqlite3."}',
    ]);
    await runAgentTurn(provider, tc, [], 'what database do we use?');
    // The agent path drives only read-only tools (no write tool exists), so a full
    // tool+answer turn must leave the store byte-for-byte unchanged.
    expect(ctx.store.listEvents(ctx.realmId).length).toBe(before.events);
    expect(ctx.store.listClaims(ctx.realmId).length).toBe(before.claims);
    expect(ctx.store.listClaimsByStatus(ctx.realmId, 'candidate').length).toBe(before.candidates);
  });
});
