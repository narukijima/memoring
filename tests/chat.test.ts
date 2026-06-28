import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  bannerLines,
  CHAT_COMMANDS,
  cmdChat,
  helpLines,
  lastMemoryDetailLines,
  memoryInventoryLines,
  memoryList,
  parseChatInput,
  recentMemoryLines,
  scopeListLines,
  switchScopeLines,
  type DisplayedMemoryRow,
} from '../apps/cli/commands/chat';
import type { OutputProvider } from '../apps/cli/output-provider';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { textLooksContextInjected } from '@security/ouroboros';
import { basePath } from '@core/paths';
import { openRealmLocal } from '@core/runtime';
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

describe('chat local helpers — listing, scopes, last-memory detail (deterministic, gated)', () => {
  let seeded: SeededRealm;
  let active: string[];
  beforeEach(async () => {
    seeded = await seedRealmFromFixture();
    active = resolveActiveLabelIds(seeded.realm.ctx, ['proj_test']);
  });
  afterEach(() => seeded.restore());

  it('recentMemoryLines lists gated consolidated claims by recency', () => {
    const claim = putIndexedClaimWithStates(seeded.realm.ctx, 'newest visible memory token', active, ['proj_test'], {
      scopeState: 'inferred',
    });
    seeded.realm.ctx.store.putClaim({ ...claim, confidence: 1, created_by: 'user' });
    const lines = recentMemoryLines(seeded.realm.ctx, active, 10, 'ja').join('\n');
    expect(lines).toContain('最近の記憶');
    expect(lines).toContain('newest visible memory token');
  });

  it('memoryList can list oldest memories with the same gated row model', () => {
    const out = memoryList(seeded.realm.ctx, active, { order: 'oldest', limit: 1, lang: 'ja' });
    expect(out.lines.join('\n')).toContain('一番古い記憶');
    expect(out.rows.length).toBe(1);
  });

  it('memoryList renders in the requested surface language', () => {
    const ja = memoryList(seeded.realm.ctx, active, { order: 'recent', lang: 'ja' }).lines.join('\n');
    const en = memoryList(seeded.realm.ctx, active, { order: 'recent', lang: 'en' }).lines.join('\n');
    expect(ja).toContain('最近の記憶');
    expect(en).toContain('Recent memories');
    expect(en).not.toContain('最近の記憶');
  });

  it('memoryInventoryLines separates current scope count from realm-wide count', () => {
    const lines = memoryInventoryLines(seeded.realm.ctx, active, 'ja').join('\n');
    expect(lines).toContain('今のスコープ');
    expect(lines).toContain('Realm全体の記憶');
  });

  it('scopeListLines shows the active scope and available scopes without memory content', () => {
    const lines = scopeListLines(seeded.realm.ctx, active, 'ja').join('\n');
    expect(lines).toContain('現在のスコープ');
    expect(lines).toContain('利用可能なスコープ');
    expect(lines).not.toContain('better-sqlite3');
  });

  it('switchScopeLines changes the active scope by label name', () => {
    const scopeName = seeded.realm.ctx.store.getLabel(active[0]!)!.canonical_name;
    const switched = switchScopeLines(seeded.realm.ctx, scopeName, 'ja');
    expect(switched.activeLabelIds).toEqual(active);
    expect(switched.lines.join('\n')).toContain('スコープを切り替えました');
  });

  it('lastMemoryDetailLines answers from the displayed row, not a new search', async () => {
    const row: DisplayedMemoryRow = {
      createdAt: '2026-06-25T00:00:00.000Z',
      kind: 'constraint',
      statement: 'Use Claude Code to upload your components.',
    };
    await expect(lastMemoryDetailLines(new MockOutputProvider(), row, 'raw', '原文は？', 'ja')).resolves.toEqual([
      '記憶の原文:',
      'Use Claude Code to upload your components.',
    ]);
  });

  it('lastMemoryDetailLines degrades to the raw text when no model is available', async () => {
    const row: DisplayedMemoryRow = { createdAt: '2026-06-25T00:00:00.000Z', kind: 'constraint', statement: 'raw body only' };
    const lines = await lastMemoryDetailLines(null, row, 'translate', '日本語にして', 'ja');
    expect(lines.join('\n')).toContain('モデルが必要');
    expect(lines.join('\n')).toContain('raw body only');
  });
});

describe('slash-command parsing (deterministic, no model)', () => {
  it('classifies prose, slash commands, exit, and empty input', () => {
    expect(parseChatInput('what did we decide?')).toEqual({ kind: 'prose', text: 'what did we decide?' });
    expect(parseChatInput('   ')).toEqual({ kind: 'empty' });
    expect(parseChatInput(':exit')).toEqual({ kind: 'exit' });
    expect(parseChatInput(':quit')).toEqual({ kind: 'exit' });
    expect(parseChatInput('/status')).toEqual({ kind: 'command', name: 'status', arg: '' });
    expect(parseChatInput('/STATUS')).toEqual({ kind: 'command', name: 'status', arg: '' }); // name is case-insensitive
    expect(parseChatInput('/scope Memoring')).toEqual({ kind: 'command', name: 'scope', arg: 'Memoring' });
    expect(parseChatInput('/scope  My Project ')).toEqual({ kind: 'command', name: 'scope', arg: 'My Project' });
    expect(parseChatInput('/')).toEqual({ kind: 'command', name: '', arg: '' }); // bare slash → help
  });

  it('helpLines lists every command from the single CHAT_COMMANDS source of truth', () => {
    const help = helpLines('en').join('\n');
    for (const cmd of CHAT_COMMANDS) expect(help).toContain(`/${cmd.name}`);
    expect(help).toContain('/scope <name>'); // command with an argument hint
    expect(help).toContain('natural-language question'); // prose path is advertised
  });

  it('helpLines and bannerLines follow the surface language', () => {
    expect(helpLines('ja').join('\n')).toContain('コマンド:');
    expect(helpLines('en').join('\n')).toContain('Commands:');
    expect(bannerLines('default', 'proj_x', 'm', 'ja').join('\n')).toContain('ローカル記憶');
    expect(bannerLines('default', 'proj_x', 'm', 'en').join('\n')).toContain('local memory');
  });

  it('bannerLines surfaces realm, scope, and model and points at /help and /exit', () => {
    const banner = bannerLines('default', 'proj_x', 'qwen2.5:3b (local)', 'en').join('\n');
    expect(banner).toContain('default');
    expect(banner).toContain('proj_x');
    expect(banner).toContain('qwen2.5:3b (local)');
    expect(banner).toContain('/help');
    expect(banner).toContain('/exit');
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
    process.env.MEMORING_LANG = 'ja'; // pin the surface language so output assertions are deterministic
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

  it('no resolvable scope → REPL opens with a no-scope notice (not an exit); local ops still work', async () => {
    const base = basePath();
    createReplicaAtRoot({ root: base, name: 'default', usePassphrase: false }); // no projects → CWD is ambiguous
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    process.chdir(outside);

    // /scopes needs no model; the REPL must be usable with no scope bound, and a
    // memory listing must refuse (fail-closed) rather than do a Realm-wide read.
    expect(await cmdChat([], lineStream('/recent\n/scopes\n:exit\n'))).toBe(0);
    expect(errors.join('\n')).toContain('スコープが未選択'); // no-scope notice (MEMORING_LANG=ja)
    expect(logs.join('\n')).toContain('先にスコープを選んでください'); // /recent fails closed, asks to pick
    expect(fetchMock).not.toHaveBeenCalled(); // no model touched
    expect(logs.join('\n')).not.toContain('memoring:ouroboros'); // nothing rendered
  });

  it('grounded prose → prints a plain answer by default via a stubbed LOCAL model, then ":exit" ends', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1'; // loopback → local, no opt-in
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    let call = 0;
    const fetchMock = vi.fn(async () => {
      const content = call++ === 0 ? '{"tool":"browse_memories","args":{}}' : '{"answer":"You use better-sqlite3."}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('better-sqlite3\n:exit\n'))).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2); // tool observation + grounded answer
    expect(logs.join('\n')).toContain('You use better-sqlite3.');
    expect(textLooksContextInjected(logs.join('\n'))).toBe(false); // human CLI default hides the marker
  });

  it('grounded prose with --show-marker prints the Ouroboros marker', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const content = call++ === 0 ? '{"tool":"browse_memories","args":{}}' : '{"answer":"You use better-sqlite3."}';
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    process.chdir(projectRoot);

    expect(await cmdChat(['--show-marker'], lineStream('better-sqlite3\n:exit\n'))).toBe(0);
    expect(textLooksContextInjected(logs.join('\n'))).toBe(true);
  });

  it('/marker on turns the marker back on mid-session', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const content = call++ === 0 ? '{"tool":"browse_memories","args":{}}' : '{"answer":"You use better-sqlite3."}';
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('/marker on\nbetter-sqlite3\n:exit\n'))).toBe(0);
    expect(logs.join('\n')).toContain('マーカー: 表示'); // localized (MEMORING_LANG=ja)
    expect(textLooksContextInjected(logs.join('\n'))).toBe(true); // marker shown after /marker on
  });

  it('the agent answers each prose turn only after a gated tool observation', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    let call = 0;
    const fetchMock = vi.fn(async () => {
      const content = call++ % 2 === 0 ? '{"tool":"browse_memories","args":{}}' : '{"answer":"You use better-sqlite3."}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    // Two prose turns; each turn must first observe gated memory, then answer.
    expect(await cmdChat([], lineStream('first question\nsecond question\n:exit\n'))).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(4); // browse+answer per prose turn
    expect(logs.join('\n')).toContain('You use better-sqlite3.');
    expect(logs.join('\n')).not.toContain('No grounded answer'); // the canned path is gone
  });

  it('a model error on one turn is caught; the REPL survives and later turns still work', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    // The model REJECTS on the prose turn (e.g. Ollama down / network blip). Without the
    // per-turn error boundary this would unwind through the realm-closing finally and
    // exit the whole session; with it, the turn is reported and the REPL keeps going.
    const fetchMock = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    });
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    // prose turn fails → /status (local) must still run afterward → clean exit.
    expect(await cmdChat([], lineStream('better-sqlite3\n/status\n:exit\n'))).toBe(0);
    expect(fetchMock).toHaveBeenCalled(); // the prose turn did try the model and threw
    expect(logs.join('\n')).toContain('エラーが発生しました'); // turnError shown (ja), session continued
    expect(logs.join('\n')).toContain('記憶: default'); // /status ran AFTER the failure → REPL survived
  });

  it('the agent can call a tool, then answer from the result (multi-step)', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    let call = 0;
    const fetchMock = vi.fn(async () => {
      // Step 1: the model calls a tool. Step 2: it answers from the observation.
      const content = call++ === 0 ? '{"tool":"browse_memories","args":{}}' : '{"answer":"The project uses better-sqlite3."}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('what database do we use?\n:exit\n'))).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2); // tool step + answer step
    expect(logs.join('\n')).toContain('The project uses better-sqlite3.');
  });

  it('/status prints setup status locally without calling the model', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('/status\n:exit\n'))).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled(); // status is local state; no model resolution needed
    expect(logs.join('\n')).toContain('記憶: default'); // in-chat /status follows the session language (ja)
    expect(logs.join('\n')).toContain('保存済み:');
    expect(logs.join('\n')).not.toContain('No grounded answer');
  });

  it('/help lists the slash commands without touching memory or the model', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('/help\n:exit\n'))).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('/status');
    expect(logs.join('\n')).toContain('/scope');
    expect(logs.join('\n')).not.toContain('No grounded answer');
  });

  it('the surface language follows MEMORING_LANG end-to-end (en)', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LANG = 'en'; // override the ja default for this test
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('/help\n/recent\n:exit\n'))).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Commands:'); // English help heading
    expect(logs.join('\n')).toContain('No memories are visible'); // English empty-list line
    expect(logs.join('\n')).not.toContain('最近の記憶'); // no Japanese leaking through
  });

  it('an unknown slash command is reported, not searched or sent to the model', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('/nope\n:exit\n'))).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('不明なコマンド: /nope'); // localized (MEMORING_LANG=ja)
    expect(logs.join('\n')).not.toContain('No grounded answer');
  });

  it('/recent prints the latest gated memories locally instead of a no-grounded miss', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'seed event');
    const ctx = openRealmLocal(base);
    try {
      const claim = putIndexedClaimWithStates(ctx, 'recent memory from chat route', ['lbl_default'], ['proj_default'], {
        scopeState: 'inferred',
      });
      ctx.store.putClaim({ ...claim, confidence: 1, created_by: 'user' });
      ctx.flush();
    } finally {
      ctx.close(true);
    }
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('/recent\n:exit\n'))).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('最近の記憶');
    expect(logs.join('\n')).toContain('recent memory from chat route');
    expect(logs.join('\n')).not.toContain('No grounded answer');
  });

  it('/raw after /recent shows the last listed memory verbatim with no model call', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'seed event');
    const ctx = openRealmLocal(base);
    try {
      const claim = putIndexedClaimWithStates(ctx, 'follow-up memory raw text', ['lbl_default'], ['proj_default'], {
        scopeState: 'inferred',
      });
      ctx.store.putClaim({ ...claim, confidence: 1, created_by: 'user' });
      ctx.flush();
    } finally {
      ctx.close(true);
    }
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('/recent\n/raw\n:exit\n'))).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled(); // both /recent and /raw are local
    expect(logs.join('\n')).toContain('follow-up memory raw text');
    expect(logs.join('\n')).toContain('記憶の原文');
    expect(logs.join('\n')).not.toContain('No grounded answer');
  });

  it('/inventory after /recent reports current-scope vs realm-wide counts', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'seed event');
    const ctx = openRealmLocal(base);
    try {
      const claim = putIndexedClaimWithStates(ctx, 'single current-scope memory', ['lbl_default'], ['proj_default'], {
        scopeState: 'inferred',
      });
      ctx.store.putClaim({ ...claim, confidence: 1, created_by: 'user' });
      ctx.flush();
    } finally {
      ctx.close(true);
    }
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('/recent\n/inventory\n:exit\n'))).toBe(0);
    expect(logs.join('\n')).toContain('single current-scope memory');
    expect(logs.join('\n')).toContain('今のスコープ');
    expect(logs.join('\n')).toContain('Realm全体の記憶');
  });

  it('resolved scope but a remote model without opt-in: REPL runs; prose is refused at generation (no egress)', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    // Scope RESOLVES (we are inside the project), so the REPL starts. /status is local
    // and works. The prose turn lazily resolves the output model, which refuses the
    // remote endpoint for lack of opt-in (no fetch, no egress) — the session keeps going.
    process.env.MEMORING_LLM_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_LLM_MODEL = 'deepseek-chat';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('/status\nbetter-sqlite3\n:exit\n'))).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled(); // remote refused before any call → no egress
    expect(logs.join('\n')).toContain('記憶: default'); // /status still worked without a model (ja)
    expect(errors.join('\n')).toContain('MEMORING_LLM_REMOTE_OPT_IN'); // calibrated refusal at generation time
    expect(logs.join('\n')).not.toContain('memoring:ouroboros'); // nothing rendered
  });

  it('EOF (no ":exit") ends the session cleanly with exit 0', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    let call = 0;
    const fetchMock = vi.fn(async () => {
      const content = call++ === 0 ? '{"tool":"browse_memories","args":{}}' : '{"answer":"You use better-sqlite3."}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdChat([], lineStream('better-sqlite3\n'))).toBe(0); // stream ends, no :exit
    expect(fetchMock).toHaveBeenCalledTimes(2); // tool observation + grounded answer
  });
});
