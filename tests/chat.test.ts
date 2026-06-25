import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buildChatPrompt, chatTurn, cmdChat, type ChatTurn } from '../apps/cli/commands/chat';
import type { OutputProvider } from '../apps/cli/output-provider';
import { searchRealm, type SearchResult } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { textLooksContextInjected } from '@security/ouroboros';
import { basePath } from '@core/paths';
import { createReplicaAtRoot } from '../apps/cli/commands/init';
import { seedRealmFromFixture, type SeededRealm } from './seed';
import { createIndexedReplica, putIndexedClaimWithStates } from './helpers';

/** Output provider that records calls/prompts and returns a canned reply — never a
 *  network call (mirrors the MockOutputProvider in ask.test.ts). */
class MockOutputProvider implements OutputProvider {
  id = 'output:mock:m1';
  calls = 0;
  prompts: string[] = [];
  constructor(
    public egress: 'local' | 'remote' = 'local',
    private readonly reply = 'GROUNDED ANSWER',
  ) {}
  async generate(prompt: string): Promise<string> {
    this.calls += 1;
    this.prompts.push(prompt);
    return this.reply;
  }
}

/** A byte stream of `s` for driving the REPL without a TTY (one chunk, then EOF). */
function lineStream(s: string): Readable {
  const r = new Readable({ read() {} });
  r.push(s);
  r.push(null);
  return r;
}

describe('chat per-turn core — grounding, Silence, Ouroboros, continuity (ADR-0011 §2/§4/§5)', () => {
  let seeded: SeededRealm;
  let active: string[];
  beforeEach(async () => {
    seeded = await seedRealmFromFixture();
    active = resolveActiveLabelIds(seeded.realm.ctx, ['proj_test']);
  });
  afterEach(() => seeded.restore());

  it('buildChatPrompt embeds grounding + every excerpt; with history adds the continuity block', () => {
    const results: SearchResult[] = [
      { ref_id: 'clm_1', ref_type: 'claim', snippet: 'uses better-sqlite3', sensitivity: 'internal' },
    ];
    const first = buildChatPrompt([], 'which database?', results);
    expect(first).toContain('ONLY facts found in the excerpts'); // strict grounding
    expect(first).toContain('uses better-sqlite3'); // the gated excerpt is forwarded
    expect(first).toContain('which database?');
    expect(first).not.toContain('Conversation so far'); // no history yet

    const history: ChatTurn[] = [{ question: 'which database?', answer: 'It uses better-sqlite3.' }];
    const second = buildChatPrompt(history, 'and the indentation?', results);
    expect(second).toContain('Conversation so far'); // prior turns supplied for continuity
    expect(second).toContain('which database?'); // prior question
    expect(second).toContain('It uses better-sqlite3.'); // prior answer (clean prose)
    expect(second).toContain('continuity only'); // still answer from excerpts only
    expect(second).toContain('and the indentation?'); // this turn's question
  });

  it('0 retrieval results → grounded:false and the model is NEVER called (Silence)', async () => {
    const mock = new MockOutputProvider();
    const out = await chatTurn(seeded.realm.ctx, mock, [], 'zzzz-nothing-matches-this', { activeLabelIds: active });
    expect(out.grounded).toBe(false);
    expect(mock.calls).toBe(0); // no LLM call, no fabrication
  });

  it('fail-closed scope: an empty active scope yields no results and never calls the model', async () => {
    const mock = new MockOutputProvider();
    const out = await chatTurn(seeded.realm.ctx, mock, [], 'better-sqlite3', { activeLabelIds: [] });
    expect(out.grounded).toBe(false);
    expect(mock.calls).toBe(0);
  });

  it('with results → generate gets the gated snippets; answer carries the marker, reply stays clean', async () => {
    const mock = new MockOutputProvider('local', 'The project uses better-sqlite3.');
    const hits = searchRealm(seeded.realm.ctx, 'better-sqlite3', { activeLabelIds: active });
    expect(hits.length).toBeGreaterThan(0);

    const out = await chatTurn(seeded.realm.ctx, mock, [], 'better-sqlite3', { activeLabelIds: active });
    expect(out.grounded).toBe(true);
    expect(mock.calls).toBe(1);
    expect(mock.prompts[0]!).toContain('ONLY facts found in the excerpts'); // grounding instruction present
    expect(mock.prompts[0]!).toContain(hits[0]!.snippet); // the actual gated excerpt is forwarded

    if (out.grounded) {
      expect(out.answer).toContain('The project uses better-sqlite3.'); // the synthesized answer
      expect(textLooksContextInjected(out.answer)).toBe(true); // Ouroboros marker attached
      expect(textLooksContextInjected(out.reply)).toBe(false); // reply (history) stays marker-free
    }
  });

  it('natural prose with an embedded concrete term grounds in chat too', async () => {
    const mock = new MockOutputProvider('local', 'The project uses better-sqlite3.');
    const out = await chatTurn(seeded.realm.ctx, mock, [], 'better-sqlite3について何が分かっている？', {
      activeLabelIds: active,
    });
    expect(out.grounded).toBe(true);
    expect(mock.calls).toBe(1);
    expect(mock.prompts[0]!).toContain('better-sqlite3');
  });

  it('remote output retrieval uses the remote_ai_processing audience and withholds candidate scope', async () => {
    const statement = 'candidate scoped output only chat token';
    putIndexedClaimWithStates(seeded.realm.ctx, statement, active, ['proj_test']);

    const local = new MockOutputProvider('local', 'Local answer.');
    const localOut = await chatTurn(seeded.realm.ctx, local, [], statement, { activeLabelIds: active });
    expect(localOut.grounded).toBe(true);
    expect(local.calls).toBe(1);
    expect(local.prompts[0]!).toContain(statement);

    const remote = new MockOutputProvider('remote', 'Remote answer.');
    const remoteOut = await chatTurn(seeded.realm.ctx, remote, [], statement, { activeLabelIds: active });
    expect(remoteOut.grounded).toBe(false);
    expect(remote.calls).toBe(0);
  });

  it('multi-turn: prior turns thread into the next prompt, but each turn retrieves on its own', async () => {
    const mock = new MockOutputProvider('local', 'It uses better-sqlite3.');
    const history: ChatTurn[] = [];

    const t1 = await chatTurn(seeded.realm.ctx, mock, history, 'better-sqlite3', { activeLabelIds: active });
    expect(t1.grounded).toBe(true);
    if (t1.grounded) history.push({ question: 'better-sqlite3', answer: t1.reply });

    const t2 = await chatTurn(seeded.realm.ctx, mock, history, 'better-sqlite3', { activeLabelIds: active });
    expect(t2.grounded).toBe(true);
    expect(mock.calls).toBe(2); // each turn performs its OWN gated retrieval + call
    // The second prompt carries the first exchange for continuity.
    expect(mock.prompts[1]!).toContain('Conversation so far');
    expect(mock.prompts[1]!).toContain('It uses better-sqlite3.');
  });

  it('READ-ONLY: turns create no Events / Claims / candidates', async () => {
    const ctx = seeded.realm.ctx;
    const before = {
      events: ctx.store.listEvents(ctx.realmId).length,
      claims: ctx.store.listClaims(ctx.realmId).length,
      candidates: ctx.store.listClaimsByStatus(ctx.realmId, 'candidate').length,
    };
    const mock = new MockOutputProvider('local', 'It uses better-sqlite3.');
    const history: ChatTurn[] = [];
    for (let i = 0; i < 3; i++) {
      const out = await chatTurn(ctx, mock, history, 'better-sqlite3', { activeLabelIds: active });
      if (out.grounded) history.push({ question: 'better-sqlite3', answer: out.reply });
    }
    // Also exercise an unanswerable turn (no write either).
    await chatTurn(ctx, mock, history, 'zzzz-nothing-matches', { activeLabelIds: active });

    expect(ctx.store.listEvents(ctx.realmId).length).toBe(before.events);
    expect(ctx.store.listClaims(ctx.realmId).length).toBe(before.claims);
    expect(ctx.store.listClaimsByStatus(ctx.realmId, 'candidate').length).toBe(before.candidates);
  });
});

describe('cmdChat end-to-end (dispatch → scope gate → REPL)', () => {
  const env = { ...process.env };
  const cwd = process.cwd();
  const LLM_KEYS = [
    'MEMORING_LLM_BASE_URL',
    'MEMORING_LLM_MODEL',
    'MEMORING_LLM_REMOTE_OPT_IN',
    'MEMORING_LLM_PROXY',
    'MEMORING_ASK_BASE_URL',
    'MEMORING_ASK_MODEL',
    'MEMORING_ASK_EGRESS',
    'MEMORING_ASK_API_KEY',
  ];
  let tmp: string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-chat-'));
    process.env.MEMORING_HOME = path.join(tmp, 'home');
    delete process.env.MEMORING_PASSPHRASE;
    for (const k of LLM_KEYS) delete process.env[k];
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.map(String).join(' '));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...env };
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('ambiguous scope → Silence, returning BEFORE provider resolution (no LLM path)', async () => {
    const base = basePath();
    createReplicaAtRoot({ root: base, name: 'default', usePassphrase: false }); // no projects → CWD is ambiguous
    // A remote model with NO opt-in is configured: if cmdChat reached provider
    // resolution it would warn + exit 1. It must not — the scope gate Silences first.
    process.env.MEMORING_LLM_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_LLM_MODEL = 'deepseek-chat';
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    process.chdir(outside);

    expect(await cmdChat([], lineStream('better-sqlite3\n:exit\n'))).toBe(0);
    expect(errors.join('\n')).toContain('Silence');
    expect(errors.join('\n')).not.toContain('MEMORING_LLM_REMOTE_OPT_IN'); // provider never resolved
    expect(logs.join('\n')).not.toContain('memoring:ouroboros'); // nothing rendered
  });

  it('grounded turn → prints a marked answer via a stubbed LOCAL model, then ":exit" ends', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1'; // loopback → local, no opt-in
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'You use better-sqlite3.' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('better-sqlite3\n:exit\n'))).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs.join('\n')).toContain('You use better-sqlite3.');
    expect(textLooksContextInjected(logs.join('\n'))).toBe(true); // Ouroboros marker printed
  });

  it('an unanswerable turn prints "No grounded answer" and the session continues to the next turn', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'You use better-sqlite3.' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    // First turn matches nothing (Silence, no call); second turn is grounded (one call).
    expect(await cmdChat([], lineStream('zzzz-nothing-matches\nbetter-sqlite3\n:exit\n'))).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the grounded turn called the model
    expect(logs.join('\n')).toContain('No grounded answer'); // the unanswerable turn
    expect(logs.join('\n')).toContain('You use better-sqlite3.'); // the grounded turn after it
  });

  it('resolved scope but a remote model without opt-in → exit 1, REPL never starts, model not called', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    // Scope RESOLVES (we are inside the project), so the run reaches provider
    // resolution — which refuses the remote model for lack of opt-in (null) and
    // exits 1 BEFORE reading any turn.
    process.env.MEMORING_LLM_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_LLM_MODEL = 'deepseek-chat';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('better-sqlite3\n:exit\n'))).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled(); // REPL never started → no model call
    expect(errors.join('\n')).toContain('MEMORING_LLM_REMOTE_OPT_IN'); // calibrated refusal
    expect(logs.join('\n')).not.toContain('memoring:ouroboros'); // nothing rendered
  });

  it('EOF (no ":exit") ends the session cleanly with exit 0', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'You use better-sqlite3.' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('better-sqlite3\n'))).toBe(0); // stream ends, no :exit
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
