import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askRealm, buildAskPrompt, cmdAsk, saveAskArtifact } from '../apps/cli/commands/ask';
import { resolveOutputProvider, type OutputProvider } from '../apps/cli/output-provider';
import { createReplicaAtRoot } from '../apps/cli/commands/init';
import { searchRealm, type SearchResult } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { textLooksContextInjected } from '@security/ouroboros';
import { basePath } from '@core/paths';
import { seedRealmFromFixture, type SeededRealm } from './seed';
import { createIndexedReplica, putIndexedClaimWithStates } from './helpers';

/** Output provider that records calls/prompts and returns a canned reply — never a
 *  network call (mirrors the RecordingProvider pattern in llm-provider.test.ts). */
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

describe('ask renderer core — grounding, Silence, Ouroboros (ADR-0011 §4/§5)', () => {
  let seeded: SeededRealm;
  let active: string[];
  beforeEach(async () => {
    seeded = await seedRealmFromFixture();
    active = resolveActiveLabelIds(seeded.realm.ctx, ['proj_test']);
  });
  afterEach(() => seeded.restore());

  it('buildAskPrompt embeds the grounding instruction and every gated excerpt', () => {
    const results: SearchResult[] = [
      { ref_id: 'clm_1', ref_type: 'claim', snippet: 'uses better-sqlite3', sensitivity: 'internal' },
      { ref_id: 'evt_1', ref_type: 'event', snippet: 'indentation is tabs', sensitivity: 'internal' },
    ];
    const prompt = buildAskPrompt('which database?', results);
    expect(prompt).toContain('uses better-sqlite3');
    expect(prompt).toContain('indentation is tabs');
    expect(prompt).toContain('ONLY facts found in the excerpts'); // strict grounding
    expect(prompt).toContain('cannot answer from the stored memory'); // refusal clause
    expect(prompt).toContain('same language as the question'); // user's language
    expect(prompt).toContain('which database?');
  });

  it('0 retrieval results → grounded:false and the model is NEVER called (Silence)', async () => {
    const mock = new MockOutputProvider();
    const out = await askRealm(seeded.realm.ctx, mock, 'zzzz-nothing-matches-this', { activeLabelIds: active });
    expect(out.grounded).toBe(false);
    expect(mock.calls).toBe(0); // no LLM call, no fabrication
  });

  it('fail-closed scope: an empty active scope yields no results and never calls the model', async () => {
    const mock = new MockOutputProvider();
    const out = await askRealm(seeded.realm.ctx, mock, 'better-sqlite3', { activeLabelIds: [] });
    expect(out.grounded).toBe(false);
    expect(mock.calls).toBe(0);
  });

  it('with results → generate gets the gated snippets + grounding instruction; answer carries them + marker', async () => {
    const mock = new MockOutputProvider('local', 'The project uses better-sqlite3.');
    const hits = searchRealm(seeded.realm.ctx, 'better-sqlite3', { activeLabelIds: active });
    expect(hits.length).toBeGreaterThan(0);

    const out = await askRealm(seeded.realm.ctx, mock, 'better-sqlite3', { activeLabelIds: active });
    expect(out.grounded).toBe(true);
    expect(mock.calls).toBe(1);

    const prompt = mock.prompts[0]!;
    expect(prompt).toContain('ONLY facts found in the excerpts'); // grounding instruction present
    expect(prompt).toContain(hits[0]!.snippet); // the actual gated excerpt is forwarded

    if (out.grounded) {
      expect(out.answer).toContain('The project uses better-sqlite3.'); // the synthesized answer
      expect(textLooksContextInjected(out.answer)).toBe(true); // Ouroboros marker attached
    }
  });

  it('saveAskArtifact writes a derived non-evidence artifact without creating Claims', async () => {
    const mock = new MockOutputProvider('local', 'The project uses better-sqlite3.');
    const beforeClaims = seeded.realm.ctx.store.listClaims(seeded.realm.ctx.realmId).length;
    const out = await askRealm(seeded.realm.ctx, mock, 'better-sqlite3', { activeLabelIds: active });
    expect(out.grounded).toBe(true);
    if (!out.grounded) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-ask-artifact-'));
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const target = saveAskArtifact(seeded.realm.ctx, 'better-sqlite3', out, new Date('2026-06-28T00:00:00.000Z'));
      const body = fs.readFileSync(target, 'utf8');
      expect(body).toContain('authority: derived');
      expect(body).toContain('can_be_evidence: false');
      expect(body).toContain('source: post-gate synthesis');
      expect(body).toContain('cited_ids:');
      expect(body).toContain(out.citations[0]!);
      expect(textLooksContextInjected(body)).toBe(true);
      expect(seeded.realm.ctx.store.listClaims(seeded.realm.ctx.realmId)).toHaveLength(beforeClaims);
    } finally {
      process.chdir(prev);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('natural prose with an embedded concrete term still grounds instead of requiring exact search syntax', async () => {
    const mock = new MockOutputProvider('local', 'The project uses better-sqlite3.');
    const out = await askRealm(seeded.realm.ctx, mock, 'better-sqlite3について何が分かっている？', {
      activeLabelIds: active,
    });
    expect(out.grounded).toBe(true);
    expect(mock.calls).toBe(1);
    expect(mock.prompts[0]!).toContain('better-sqlite3');
  });

  it('remote output retrieval uses the remote_ai_processing audience and withholds candidate scope', async () => {
    const statement = 'candidate scoped output only ask token';
    putIndexedClaimWithStates(seeded.realm.ctx, statement, active, ['proj_test']);

    const local = new MockOutputProvider('local', 'Local answer.');
    const localOut = await askRealm(seeded.realm.ctx, local, statement, { activeLabelIds: active });
    expect(localOut.grounded).toBe(true);
    expect(local.calls).toBe(1);
    expect(local.prompts[0]!).toContain(statement);

    const remote = new MockOutputProvider('remote', 'Remote answer.');
    const remoteOut = await askRealm(seeded.realm.ctx, remote, statement, { activeLabelIds: active });
    expect(remoteOut.grounded).toBe(false);
    expect(remote.calls).toBe(0);
  });
});

describe('resolveOutputProvider egress posture (local default / remote opt-in; ADR-0011 §5)', () => {
  const KEYS = [
    'MEMORING_LLM_BASE_URL',
    'MEMORING_LLM_MODEL',
    'MEMORING_LLM_API_KEY',
    'MEMORING_LLM_EGRESS',
    'MEMORING_LLM_REMOTE_OPT_IN',
    'MEMORING_LLM_PROXY',
    'MEMORING_LLM_ID',
    'MEMORING_ASK_BASE_URL',
    'MEMORING_ASK_MODEL',
    'MEMORING_ASK_API_KEY',
    'MEMORING_ASK_EGRESS',
  ];
  const saved: Record<string, string | undefined> = {};
  let errors: string[];

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.map(String).join(' '));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('a loopback (local) endpoint is allowed WITHOUT opt-in', () => {
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const provider = resolveOutputProvider();
    expect(provider).not.toBeNull();
    expect(provider!.egress).toBe('local');
  });

  it('a remote endpoint WITHOUT opt-in is refused (null) with a calibrated disclosure', () => {
    process.env.MEMORING_LLM_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_LLM_MODEL = 'deepseek-chat';
    const provider = resolveOutputProvider();
    expect(provider).toBeNull(); // refused → no remote call can happen
    const text = errors.join('\n');
    expect(text).toContain('MEMORING_LLM_REMOTE_OPT_IN'); // names the opt-in
    expect(text).toMatch(/gated/i); // calibrated: gated excerpts, not raw history
    expect(text).toMatch(/never raw history/i);
  });

  it('a remote endpoint WITH opt-in is allowed (egress remote)', () => {
    process.env.MEMORING_LLM_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_LLM_MODEL = 'deepseek-chat';
    process.env.MEMORING_LLM_REMOTE_OPT_IN = '1';
    const provider = resolveOutputProvider();
    expect(provider).not.toBeNull();
    expect(provider!.egress).toBe('remote');
  });

  it('no model configured → null + actionable guidance (never fabricate, no rule-based fallback)', () => {
    const provider = resolveOutputProvider();
    expect(provider).toBeNull();
    expect(errors.join('\n')).toContain('MEMORING_LLM_BASE_URL');
  });

  // Per-role config split (ADR-0011 §6): the output role reads its own MEMORING_ASK_*
  // namespace, falling back PER-VARIABLE to MEMORING_LLM_* — so ask/chat can use a
  // different model than the loop without touching the egress posture.
  it('falls back to MEMORING_LLM_* when no MEMORING_ASK_* is set', () => {
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'loop-model';
    const provider = resolveOutputProvider();
    expect(provider).not.toBeNull();
    expect(provider!.id).toContain('loop-model'); // the loop's model is reused
  });

  it('falls back to Realm-local LLM config when no env provider is set', () => {
    const provider = resolveOutputProvider({
      base_url: 'http://127.0.0.1:11434/v1',
      model: 'realm-local-model',
      egress: 'local',
    });
    expect(provider).not.toBeNull();
    expect(provider!.id).toContain('realm-local-model');
    expect(provider!.egress).toBe('local');
  });

  it('does not reuse Realm-local local egress when env overrides the output base URL', () => {
    process.env.MEMORING_ASK_BASE_URL = 'https://api.deepseek.com/v1';
    const config = {
      base_url: 'http://127.0.0.1:11434/v1',
      model: 'realm-local-model',
      egress: 'local' as const,
    };

    expect(resolveOutputProvider(config)).toBeNull();
    expect(errors.join('\n')).toContain('MEMORING_LLM_REMOTE_OPT_IN');

    process.env.MEMORING_LLM_REMOTE_OPT_IN = '1';
    const provider = resolveOutputProvider(config);
    expect(provider).not.toBeNull();
    expect(provider!.egress).toBe('remote');
  });

  it('does not trust Realm-local local egress for a non-loopback config URL', () => {
    const config = {
      base_url: 'https://api.deepseek.com/v1',
      model: 'realm-local-model',
      egress: 'local' as const,
    };

    expect(resolveOutputProvider(config)).toBeNull();
    expect(errors.join('\n')).toContain('MEMORING_LLM_REMOTE_OPT_IN');

    process.env.MEMORING_LLM_REMOTE_OPT_IN = '1';
    const provider = resolveOutputProvider(config);
    expect(provider).not.toBeNull();
    expect(provider!.egress).toBe('remote');
  });

  it('MEMORING_ASK_* overrides MEMORING_LLM_* for the output role (different model)', () => {
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'loop-model';
    process.env.MEMORING_ASK_MODEL = 'output-model'; // base URL still falls back
    const provider = resolveOutputProvider();
    expect(provider).not.toBeNull();
    expect(provider!.id).toContain('output-model'); // the override wins
    expect(provider!.id).not.toContain('loop-model');
    expect(provider!.egress).toBe('local'); // base URL fell back to the loopback loop URL
  });

  it('MEMORING_ASK_BASE_URL alone (loopback) resolves the output role on-device', () => {
    process.env.MEMORING_ASK_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_ASK_MODEL = 'output-model';
    const provider = resolveOutputProvider();
    expect(provider).not.toBeNull();
    expect(provider!.egress).toBe('local');
  });

  it('a remote MEMORING_ASK_BASE_URL still rides the shared default-OFF gate (refused without opt-in)', () => {
    process.env.MEMORING_ASK_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_ASK_MODEL = 'deepseek-chat';
    const provider = resolveOutputProvider();
    expect(provider).toBeNull(); // the per-role split moves NO egress default
    expect(errors.join('\n')).toContain('MEMORING_LLM_REMOTE_OPT_IN');
  });

  it('MEMORING_ASK_EGRESS overrides the loop egress; opt-in still permits remote', () => {
    process.env.MEMORING_ASK_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_ASK_MODEL = 'deepseek-chat';
    process.env.MEMORING_ASK_EGRESS = 'remote';
    process.env.MEMORING_LLM_REMOTE_OPT_IN = '1';
    const provider = resolveOutputProvider();
    expect(provider).not.toBeNull();
    expect(provider!.egress).toBe('remote');
  });
});

describe('cmdAsk end-to-end (dispatch → scope gate → render)', () => {
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
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-ask-'));
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

  it('unsupported --save value is rejected before opening a Realm or model path', async () => {
    process.env.MEMORING_LLM_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_LLM_MODEL = 'deepseek-chat';

    expect(await cmdAsk(['better-sqlite3', '--save', 'claim'])).toBe(1);
    expect(errors.join('\n')).toContain('Unsupported --save value');
    expect(errors.join('\n')).not.toContain('MEMORING_LLM_REMOTE_OPT_IN');
    expect(logs).toEqual([]);
  });

  it('ambiguous scope → Silence, returning BEFORE provider resolution (no LLM path)', async () => {
    const base = basePath();
    createReplicaAtRoot({ root: base, name: 'default', usePassphrase: false }); // no projects → CWD is ambiguous
    // A remote model with NO opt-in is configured: if cmdAsk reached provider
    // resolution it would print the remote-default-off warning and exit 1. It must
    // NOT — the scope gate runs first and Silences.
    process.env.MEMORING_LLM_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_LLM_MODEL = 'deepseek-chat';
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    process.chdir(outside);

    expect(await cmdAsk(['what', 'do', 'I', 'use'])).toBe(0);
    expect(errors.join('\n')).toContain('Silence');
    expect(errors.join('\n')).not.toContain('MEMORING_LLM_REMOTE_OPT_IN'); // provider never resolved
    expect(logs.join('\n')).not.toContain('memoring:ouroboros'); // nothing rendered
  });

  it('grounded question → prints a plain answer by default via a stubbed LOCAL model (no network)', async () => {
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

    expect(await cmdAsk(['better-sqlite3'])).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs.join('\n')).toContain('You use better-sqlite3.');
    expect(textLooksContextInjected(logs.join('\n'))).toBe(false); // human CLI default hides the marker
  });

  it('grounded question with --show-marker prints the Ouroboros marker', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: 'You use better-sqlite3.' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    process.chdir(projectRoot);

    expect(await cmdAsk(['better-sqlite3', '--show-marker'])).toBe(0);
    expect(textLooksContextInjected(logs.join('\n'))).toBe(true);
  });

  it('grounded scope but no matching memory → "No grounded answer", model NOT called', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createIndexedReplica(base, 'default', projectRoot, 'the project database is better-sqlite3');
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.chdir(projectRoot);

    expect(await cmdAsk(['zzzz-nothing-matches'])).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled(); // 0 results → no LLM call
    expect(logs.join('\n')).toContain('No grounded answer');
  });

});
