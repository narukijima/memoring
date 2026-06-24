import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askRealm, buildAskPrompt, cmdAsk } from '../apps/cli/commands/ask';
import { resolveOutputProvider, type OutputProvider } from '../apps/cli/output-provider';
import { createReplicaAtRoot } from '../apps/cli/commands/init';
import { searchRealm, indexEvent, type SearchResult } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { textLooksContextInjected } from '@security/ouroboros';
import { openRealmLocal } from '@core/runtime';
import { basePath } from '@core/paths';
import { writeRealmConfig } from '@core/realm';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { normalizeLabel } from '@core/label-normalize';
import { realmHmac } from '@security/crypto-primitives';
import { runSecretScan } from '@security/secret-scan';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import type { Assignment, Label, MemEvent } from '@core/schema/entities';
import { seedRealmFromFixture, type SeededRealm } from './seed';

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
});

describe('cmdAsk end-to-end (dispatch → scope gate → render)', () => {
  const env = { ...process.env };
  const cwd = process.cwd();
  const LLM_KEYS = ['MEMORING_LLM_BASE_URL', 'MEMORING_LLM_MODEL', 'MEMORING_LLM_REMOTE_OPT_IN', 'MEMORING_LLM_PROXY'];
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

  it('grounded question → prints a marked answer via a stubbed LOCAL model (no network)', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createAskRealm(base, 'default', projectRoot, 'the project database is better-sqlite3');
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
    expect(textLooksContextInjected(logs.join('\n'))).toBe(true); // Ouroboros marker printed
  });

  it('grounded scope but no matching memory → "No grounded answer", model NOT called', async () => {
    const base = basePath();
    const projectRoot = path.join(tmp, 'proj');
    fs.mkdirSync(projectRoot, { recursive: true });
    createAskRealm(base, 'default', projectRoot, 'the project database is better-sqlite3');
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

/** Persist a Realm at `root` with one classified, indexed, in-scope event (mirrors
 *  the createSearchRealm helper used by the multi-Realm CLI tests). */
function createAskRealm(root: string, name: string, projectRoot: string, text: string): void {
  createReplicaAtRoot({ root, name, usePassphrase: false });
  const ctx = openRealmLocal(root);
  try {
    const projectId = `proj_${name}`;
    const labelId = `lbl_${name}`;
    ctx.config.projects.push({
      project_id: projectId,
      name,
      root_paths: [projectRoot],
      git_remotes: [],
      default_sensitivity: 'internal',
    });
    const label: Label = {
      label_id: labelId,
      realm_id: ctx.realmId,
      canonical_name: name,
      normalized_key: realmHmac(ctx.realmKey, normalizeLabel(name)),
      aliases: [],
      state: 'active',
      merged_into: null,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION.label,
    };
    ctx.store.putLabel(label);

    const src = sourceIdentity(ctx.realmKey, 'test', `${name}-source`);
    const ses = sessionIdentity(ctx.realmKey, src, `${name}-session`);
    const eventId = newId('event');
    const textRef = ctx.objects.put(`${eventId}_text`, Buffer.from(text, 'utf8')).ref;
    const event: MemEvent = {
      event_id: eventId,
      event_identity: eventIdentity(ctx.realmKey, src, ses, `${name}-message`, text),
      realm_id: ctx.realmId,
      occurrence_ids: [newId('occurrence')],
      session_id: `ses_${name}`,
      turn_id: null,
      event_type: 'message',
      role: 'user',
      origin: 'user',
      created_at: new Date().toISOString(),
      source_timestamp: null,
      timestamp_confidence: 'capture_observed',
      sequence: 1,
      text_ref: textRef,
      source_extra_ref: null,
      sensitivity: 'internal',
      sensitivity_classification_state: 'inferred',
      context_injected: false,
      context_pack_digest: null,
      parser_version: 'test.v1',
      status: 'active',
      schema_version: SCHEMA_VERSION.event,
    };
    const assignment: Assignment = {
      assignment_id: newId('assignment'),
      realm_id: ctx.realmId,
      target_type: 'event',
      target_id: eventId,
      label_ids: [labelId],
      project_ids: [projectId],
      classification_state: 'inferred',
      assigned_by: 'rule:path_git_remote',
      confidence: 1,
      evidence: [event.occurrence_ids[0]!],
      created_by_derivation_id: null,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION.assignment,
    };
    ctx.store.putEvent(event);
    ctx.store.putSecretScan(runSecretScan(event.event_id, text));
    ctx.store.putAssignment(assignment);
    indexEvent(ctx, event);
    writeRealmConfig(ctx.layout.realmToml, ctx.config);
    ctx.flush();
  } finally {
    ctx.close(true);
  }
}
