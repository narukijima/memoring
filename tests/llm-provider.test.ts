import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import { abstractEvents } from '@claim/extractor';
import { consolidateClaim, consolidatePending, statementSimilarity } from '@claim/consolidation';
import { LlmMemoryProvider, parseCandidates, buildPrompt, type LlmBackend } from '@claim/llm-provider';
import { OpenAiCompatibleBackend } from '@integrations/llm/openai-compatible';
import { runSecretScan } from '@security/secret-scan';
import type { AbstractCandidate, AbstractInput, MemoryProvider } from '@claim/provider';
import type { MemEvent, SecretScanResult } from '@core/schema/entities';
import type { ClassificationState, Origin, Sensitivity } from '@core/schema/enums';
import { makeTempRealm, type TempRealm } from './helpers';

let realm: TempRealm;
beforeEach(() => {
  realm = makeTempRealm();
});
afterEach(() => realm.cleanup());

function putEvent(
  origin: Origin,
  text: string,
  sensitivity: Sensitivity,
  state: ClassificationState = 'inferred',
): MemEvent {
  const ctx = realm.ctx;
  const src = sourceIdentity(ctx.realmKey, 'claude_code', 'src-1');
  const ses = sessionIdentity(ctx.realmKey, src, 'host-ses-1');
  const id = newId('event');
  const ref = ctx.objects.put(`${id}_txt`, Buffer.from(text, 'utf8')).ref;
  const e: MemEvent = {
    event_id: id,
    event_identity: eventIdentity(ctx.realmKey, src, ses, id, text),
    realm_id: ctx.realmId,
    occurrence_ids: [newId('occurrence')],
    session_id: 'ses_x',
    turn_id: null,
    event_type: 'message',
    role: 'user',
    origin,
    created_at: new Date().toISOString(),
    source_timestamp: null,
    timestamp_confidence: 'capture_observed',
    sequence: 1,
    text_ref: ref,
    source_extra_ref: null,
    sensitivity,
    sensitivity_classification_state: state,
    context_injected: false,
    context_pack_digest: null,
    parser_version: 'test.v1',
    status: 'active',
    schema_version: SCHEMA_VERSION.event,
  };
  ctx.store.putEvent(e);
  return e;
}

/** Give an event the SCOPE assignment a classified event always carries in
 *  production (classify.ts) so the remote pre-egress scope-axis floor passes. */
function assignScope(event: MemEvent, state: ClassificationState = 'inferred'): MemEvent {
  const ctx = realm.ctx;
  ctx.store.putAssignment({
    assignment_id: newId('assignment'),
    realm_id: ctx.realmId,
    target_type: 'event',
    target_id: event.event_id,
    label_ids: [newId('label')],
    project_ids: ['proj_test'],
    classification_state: state,
    assigned_by: 'rule:path_git_remote',
    confidence: 0.9,
    evidence: event.occurrence_ids,
    created_by_derivation_id: null,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION.assignment,
  });
  return event;
}

/** Record a secret-scan result for an event (production: normalize always does). */
function putScan(event: MemEvent, passed: boolean): MemEvent {
  const base = runSecretScan(event.event_id, passed ? 'clean text' : null);
  const scan: SecretScanResult = passed
    ? base
    : { ...base, secret_scan_status: 'failed', secret_scan_passed: false };
  realm.ctx.store.putSecretScan(scan);
  return event;
}

/** Production-shaped classified event: scope assignment + passed secret scan. */
function classified(origin: Origin, text: string, sensitivity: Sensitivity, state: ClassificationState = 'inferred'): MemEvent {
  return putScan(assignScope(putEvent(origin, text, sensitivity, state)), true);
}

/** Records every input text it is asked to abstract; proposes nothing. */
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

/** Proposes one fixed candidate per call — used to pin the inferred/explicit bar. */
class FixedProvider implements MemoryProvider {
  id = 'fixed';
  name = 'fixed';
  version = 'fixed.v1';
  constructor(
    public egress: 'local' | 'remote',
    private readonly cand: AbstractCandidate,
  ) {}
  abstract(): AbstractCandidate[] {
    return [this.cand];
  }
}

/** Throws on its first call, then succeeds — used to pin batch-level resilience. */
class FlakyProvider implements MemoryProvider {
  id = 'flaky';
  name = 'flaky';
  version = 'flaky.v1';
  egress = 'local' as const;
  calls = 0;
  abstract(): AbstractCandidate[] {
    this.calls += 1;
    if (this.calls === 1) throw new Error('boom');
    return [{ kind: 'fact', statement: 'survived', confidence: 0.9, mode: 'explicit', sourceIndex: 0 }];
  }
}

describe('LLM provider response parsing', () => {
  it('parses a bare JSON array of candidates without inventing a source attribution', () => {
    const out = parseCandidates(
      '[{"kind":"preference","statement":"use tabs","confidence":0.9,"mode":"explicit"}]',
    );
    expect(out).toEqual([{ kind: 'preference', statement: 'use tabs', confidence: 0.9, mode: 'explicit', sourceIndex: -1 }]);
  });

  it('maps the 1-based [#N] source turn to a 0-based sourceIndex', () => {
    const out = parseCandidates('[{"kind":"fact","statement":"repo is TS","source":3}]');
    expect(out[0]!.sourceIndex).toBe(2);
  });

  it('tolerates ```json code fences and a {candidates:[...]} wrapper', () => {
    const fenced = '```json\n{"candidates":[{"kind":"constraint","statement":"never force-push","confidence":1}]}\n```';
    const out = parseCandidates(fenced);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('constraint');
    expect(out[0]!.mode).toBe('inferred'); // default when unspecified
  });

  it('drops unknown kinds, empty statements, and clamps confidence; garbage → []', () => {
    const out = parseCandidates(
      '[{"kind":"vibe","statement":"x"},{"kind":"fact","statement":""},{"kind":"fact","statement":"repo is TS","confidence":5}]',
    );
    expect(out).toEqual([{ kind: 'fact', statement: 'repo is TS', confidence: 1, mode: 'inferred', sourceIndex: -1 }]);
    expect(parseCandidates('not json at all')).toEqual([]);
  });

  it('asks the model to reject pasted role prompts (instruction is language-agnostic)', () => {
    const prompt = buildPrompt([{ text: 'あなたはレビュアーです', origin: 'user', role: 'user' }]);
    expect(prompt).toContain('DURABLE');
    expect(prompt).toContain('pasted role/mission/agent prompts');
    expect(prompt).toContain('あなたはレビュアーです');
  });

  it('caps per-turn text so an oversized paste cannot overflow the model context', () => {
    const prompt = buildPrompt([{ text: 'x'.repeat(50_000), origin: 'user', role: 'user' }]);
    expect(prompt).toContain('…[truncated]');
    expect(prompt.length).toBeLessThan(10_000); // instruction + one ~4K-char turn, not 50K
  });

  it('LlmMemoryProvider forwards backend output and inherits its egress class', async () => {
    const backend: LlmBackend = {
      id: 'mock',
      model: 'm1',
      egress: 'remote',
      complete: async () => '[{"kind":"decision","statement":"adopt pnpm","confidence":0.8,"mode":"explicit","source":1}]',
    };
    const provider = new LlmMemoryProvider(backend);
    expect(provider.egress).toBe('remote');
    expect(provider.id).toBe('llm:mock:m1');
    const out = await provider.abstract([{ text: 'we will use pnpm', origin: 'user', role: 'user' }]);
    expect(out).toEqual([{ kind: 'decision', statement: 'adopt pnpm', confidence: 0.8, mode: 'explicit', sourceIndex: 0 }]);
  });
});

describe('OpenAI-compatible backend', () => {
  it('builds a correct chat-completions request and parses the reply', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const backend = new OpenAiCompatibleBackend({
      baseURL: 'https://api.deepseek.com/v1/',
      model: 'deepseek-chat',
      apiKey: 'k-test',
      fetchImpl,
    });
    expect(backend.egress).toBe('remote'); // non-loopback host → off-device
    const reply = await backend.complete('hello');
    expect(reply).toBe('[]');

    expect(captured!.url).toBe('https://api.deepseek.com/v1/chat/completions'); // trailing slash trimmed
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer k-test');
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toMatchObject({ model: 'deepseek-chat', temperature: 0 });
    expect(body.messages[0]).toMatchObject({ role: 'user', content: 'hello' });
  });

  it('infers local egress for a loopback (Ollama) endpoint', () => {
    const backend = new OpenAiCompatibleBackend({ baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:3b' });
    expect(backend.egress).toBe('local'); // on-device → exempt from the pre-egress gate
  });

  it('throws on a non-2xx response instead of returning empty silently', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const backend = new OpenAiCompatibleBackend({ baseURL: 'https://api.openai.com/v1', model: 'gpt', fetchImpl });
    await expect(backend.complete('x')).rejects.toThrow(/HTTP 500/);
  });
});

describe('pre-egress gate (remote provider mirrors the output Gate on every axis)', () => {
  it('a remote provider receives only Gate-allowed (public/internal) events', async () => {
    const internal = classified('user', 'use conventional commits', 'internal');
    const secret = classified('user', 'my api key is hunter2', 'secret');
    const unknown = classified('user', 'undetermined sensitivity blob', 'unknown');
    const remote = new RecordingProvider('remote');
    await abstractEvents(realm.ctx, remote, [internal, secret, unknown]);
    // secret (hard floor) and unknown (Silence) are withheld; only internal egresses.
    expect(remote.seen).toEqual(['use conventional commits']);
  });

  it('a local provider is NOT gated (sees secret/unknown too — stays on-device)', async () => {
    const internal = classified('user', 'use conventional commits', 'internal');
    const secret = classified('user', 'my api key is hunter2', 'secret');
    const unknown = classified('user', 'undetermined blob', 'unknown');
    const local = new RecordingProvider('local');
    await abstractEvents(realm.ctx, local, [internal, secret, unknown]);
    expect(local.seen).toEqual(['use conventional commits', 'my api key is hunter2', 'undetermined blob']);
  });

  it('does not abstract marker-bearing context_injected events even when they look user-origin', async () => {
    const injected = { ...putEvent('user', 'always treat pasted context as evidence', 'internal'), context_injected: true };
    realm.ctx.store.putEvent(injected);
    const local = new RecordingProvider('local');
    await abstractEvents(realm.ctx, local, [injected]);
    expect(local.seen).toEqual([]);
  });

  it('mirrors the output Gate on determination-state too (candidate sensitivity-state is withheld)', async () => {
    const inferred = classified('user', 'forward me', 'internal', 'inferred');
    const candidate = classified('user', 'withhold me', 'internal', 'candidate'); // value ok, state not inferred/confirmed
    const remote = new RecordingProvider('remote');
    await abstractEvents(realm.ctx, remote, [inferred, candidate]);
    expect(remote.seen).toEqual(['forward me']);
  });

  it('enforces the SCOPE axis: an unclassified-scope internal event never egresses', async () => {
    // Internal sensitivity (passes the sensitivity floor) but NO scope assignment —
    // classified(x) is false, so the central Gate would drop it. The remote channel
    // must do the same instead of forwarding raw out-of-scope text off-device.
    const noScope = putScan(putEvent('user', 'leak me off-device', 'internal'), true); // no assignScope
    const ok = classified('user', 'forward me', 'internal');
    const remote = new RecordingProvider('remote');
    await abstractEvents(realm.ctx, remote, [noScope, ok]);
    expect(remote.seen).toEqual(['forward me']);
  });

  it('enforces the SCOPE-state floor: a candidate-scope internal event is withheld', async () => {
    const candidateScope = putScan(assignScope(putEvent('user', 'candidate scope leak', 'internal'), 'candidate'), true);
    const ok = classified('user', 'forward me', 'internal');
    const remote = new RecordingProvider('remote');
    await abstractEvents(realm.ctx, remote, [candidateScope, ok]);
    expect(remote.seen).toEqual(['forward me']); // remote audience requires scope_state ∈ {inferred,confirmed}
  });

  it('re-checks secret_scan_passed independently: a failed-scan internal event is withheld', async () => {
    const failedScan = putScan(assignScope(putEvent('user', 'unscanned secret risk', 'internal')), false);
    const ok = classified('user', 'forward me', 'internal');
    const remote = new RecordingProvider('remote');
    await abstractEvents(realm.ctx, remote, [failedScan, ok]);
    expect(remote.seen).toEqual(['forward me']); // parity with search.ts:24 — no passed scan ⇒ no egress
  });

  it('withholds confidential from a remote provider (deny under standard)', async () => {
    const conf = classified('user', 'customer contract terms', 'confidential');
    const ok = classified('user', 'forward me', 'internal');
    const remote = new RecordingProvider('remote');
    await abstractEvents(realm.ctx, remote, [conf, ok]);
    expect(remote.seen).toEqual(['forward me']); // confidential is deny on remote (Specification §7.3)
  });
});

describe('evidence_count counts only independent origins (G8 — the invariant lifecycle.ts relies on)', () => {
  it('a non-independent origin restating the same thing never accretes evidence', async () => {
    // lifecycle.ts uses independent_evidence_count = claim.evidence_count; that only
    // holds because abstraction never counts a non-independent origin. Pin it so a
    // future change to the origin filter cannot silently turn the alias into a
    // host-memory laundering bug.
    const user = putEvent('user', 'adopt pnpm', 'internal');
    const assistant = putEvent('assistant', 'adopt pnpm', 'internal'); // laundering attempt: same statement
    const hostSummary = putEvent('host_summary', 'adopt pnpm', 'internal');
    const provider = new FixedProvider('local', {
      kind: 'decision',
      statement: 'adopt pnpm',
      confidence: 0.9,
      mode: 'explicit',
      sourceIndex: 0,
    });
    const res = await abstractEvents(realm.ctx, provider, [user, assistant, hostSummary]);
    expect(res.newCandidates).toHaveLength(1); // only the user event was abstracted
    const claim = res.newCandidates[0]!;
    expect(claim.evidence_count).toBe(1);
    const origins = claim.evidence_event_identities.map(
      (eid) => realm.ctx.store.findEventByIdentity(realm.ctx.realmId, eid)!.origin,
    );
    expect(origins.every((o) => INDEPENDENT.has(o))).toBe(true); // evidence_count == independent count
  });
});

const INDEPENDENT = new Set<Origin>(['user', 'tool_result', 'command_result', 'file_diff', 'external_artifact']);

describe('provider mode drives the validator evidence bar', () => {
  it('an LLM inferred candidate is held to ai_inferred_pattern (cannot consolidate from one event)', async () => {
    const ev = putEvent('user', 'use tabs everywhere', 'internal');
    const provider = new FixedProvider('local', {
      kind: 'preference',
      statement: 'use tabs',
      confidence: 0.9,
      mode: 'inferred',
      sourceIndex: 0,
    });
    const res = await abstractEvents(realm.ctx, provider, [ev]);
    expect(res.newCandidates).toHaveLength(1);
    expect(res.newCandidates[0]!.created_by).toBe('ai'); // inferred → ai → higher validator bar
    const outcome = consolidateClaim(realm.ctx, res.newCandidates[0]!);
    expect(outcome.status).toBe('rejected'); // min_evidence 1/2 for ai_inferred_pattern
    expect(outcome.reasons.join()).toMatch(/insufficient/);
  });

  it('an LLM explicit candidate is still held to the AI/inferred bar', async () => {
    const ev = putEvent('user', 'always run the linter', 'internal');
    const provider = new FixedProvider('local', {
      kind: 'constraint',
      statement: 'always run the linter',
      confidence: 0.9,
      mode: 'explicit',
      sourceIndex: 0,
    });
    const res = await abstractEvents(realm.ctx, provider, [ev]);
    expect(res.newCandidates[0]!.created_by).toBe('ai');
    const outcome = consolidateClaim(realm.ctx, res.newCandidates[0]!);
    expect(outcome.status).toBe('rejected');
    expect(outcome.reasons.join()).toMatch(/insufficient/);
  });

  it('a trusted rule-based explicit candidate keeps the explicit bar', async () => {
    const ev = putEvent('user', 'always run the linter', 'internal');
    const provider: MemoryProvider = {
      id: 'rule_based',
      name: 'rule-based',
      version: 'rule_based.v1',
      egress: 'local',
      abstract: () => [
        { kind: 'constraint', statement: 'always run the linter', confidence: 0.9, mode: 'explicit', sourceIndex: 0 },
      ],
    };
    const res = await abstractEvents(realm.ctx, provider, [ev]);
    expect(res.newCandidates[0]!.created_by).toBe('rule');
    expect(consolidateClaim(realm.ctx, res.newCandidates[0]!).status).toBe('consolidated');
  });
});

describe('batched abstraction attributes each candidate to its source event', () => {
  it('sends events in one call and maps candidates back via sourceIndex', async () => {
    const e0 = putEvent('user', 'first turn', 'internal');
    const e1 = putEvent('user', 'second turn', 'internal');
    const e2 = putEvent('user', 'third turn', 'internal');
    const provider: MemoryProvider = {
      id: 'batch',
      name: 'batch',
      version: 'batch.v1',
      egress: 'local',
      abstract: (inputs) => {
        expect(inputs).toHaveLength(3); // all three sent in ONE call (batched, not per-event)
        return [
          { kind: 'decision', statement: 'from second', confidence: 0.9, mode: 'explicit', sourceIndex: 1 },
          { kind: 'fact', statement: 'from third', confidence: 0.9, mode: 'explicit', sourceIndex: 2 },
        ];
      },
    };
    const res = await abstractEvents(realm.ctx, provider, [e0, e1, e2]);
    expect(res.newCandidates).toHaveLength(2);
    const dec = res.newCandidates.find((c) => c.kind === 'decision')!;
    const fact = res.newCandidates.find((c) => c.kind === 'fact')!;
    expect(dec.evidence_event_identities).toEqual([e1.event_identity]); // turn #2 → e1
    expect(fact.evidence_event_identities).toEqual([e2.event_identity]); // turn #3 → e2
  });

  it('drops a candidate that cites an out-of-range turn (cannot attribute evidence)', async () => {
    const e0 = putEvent('user', 'only turn', 'internal');
    const provider: MemoryProvider = {
      id: 'oob',
      name: 'oob',
      version: 'oob.v1',
      egress: 'local',
      abstract: () => [{ kind: 'fact', statement: 'ghost', confidence: 0.9, mode: 'explicit', sourceIndex: 5 }],
    };
    const res = await abstractEvents(realm.ctx, provider, [e0]);
    expect(res.newCandidates).toHaveLength(0);
  });

  it('skips a failed abstraction batch and keeps going (one bad call never aborts the run)', async () => {
    const events = [];
    for (let i = 0; i < 13; i++) events.push(putEvent('user', `turn ${i}`, 'internal'));
    const provider = new FlakyProvider(); // throws on batch 1 (12 events), succeeds on batch 2 (1 event)
    const res = await abstractEvents(realm.ctx, provider, events);
    expect(provider.calls).toBe(2); // both batches attempted despite the first throwing
    expect(res.failed).toBe(1); // the failure is counted, not swallowed
    expect(res.newCandidates).toHaveLength(1); // the surviving batch's candidate is still recorded
  });
});

describe('near-duplicate suppression at consolidation (§1.5)', () => {
  it('scores near-identical statements high and unrelated ones low', () => {
    expect(statementSimilarity('Use PostgreSQL as the database', 'Use PostgreSQL as the database.')).toBeGreaterThan(
      0.92,
    );
    expect(statementSimilarity('Use pnpm not npm', 'The deploy runs on Cloudflare Workers')).toBeLessThan(0.3);
  });

  it('keeps the canonical claim and conflicts the near-duplicate (duplicate_candidate)', async () => {
    const e1 = putEvent('user', 'turn a', 'internal');
    const e2 = putEvent('user', 'turn b', 'internal');
    const provider: MemoryProvider = {
      id: 'rule_based',
      name: 'dup',
      version: 'dup.v1',
      egress: 'local',
      abstract: (inputs) =>
        inputs.map((_, i) => ({
          kind: 'decision' as const,
          // near-identical (period only) → not exact-merged upstream, but >0.92 similar
          statement: i === 0 ? 'Use PostgreSQL as the project database' : 'Use PostgreSQL as the project database.',
          confidence: 0.9,
          mode: 'explicit' as const,
          sourceIndex: i,
        })),
    };
    const ab = await abstractEvents(realm.ctx, provider, [e1, e2]);
    expect(ab.newCandidates).toHaveLength(2); // two distinct candidate claims (no exact-merge)

    const outcomes = consolidatePending(realm.ctx);
    expect(outcomes.map((o) => o.status).sort()).toEqual(['conflicted', 'consolidated']);
    expect(outcomes.find((o) => o.status === 'conflicted')?.reasons).toContain('duplicate_candidate');
  });
});

describe('cross-project exact-merge isolation — scope is part of the dedup key', () => {
  // Give an event a single project scope, mirroring the production classify.ts shape.
  function assignProject(event: MemEvent, projectId: string): MemEvent {
    realm.ctx.store.putAssignment({
      assignment_id: newId('assignment'),
      realm_id: realm.ctx.realmId,
      target_type: 'event',
      target_id: event.event_id,
      label_ids: [newId('label')],
      project_ids: [projectId],
      classification_state: 'inferred',
      assigned_by: 'rule:path_git_remote',
      confidence: 0.9,
      evidence: event.occurrence_ids,
      created_by_derivation_id: null,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION.assignment,
    });
    return event;
  }

  // Abstracts every input to the SAME (kind, statement) — the exact collision that,
  // pre-fix, the scope-blind dedup key merged into the first project's Claim.
  const sameStatement: MemoryProvider = {
    id: 'same',
    name: 'same',
    version: 'same.v1',
    egress: 'local',
    abstract: (inputs: AbstractInput[]): AbstractCandidate[] =>
      inputs.map((_, i) => ({
        kind: 'preference' as const,
        statement: 'Always use TypeScript',
        confidence: 0.9,
        mode: 'explicit' as const,
        sourceIndex: i,
      })),
  };

  it('keeps the same statement under unrelated projects as TWO separate, uncontaminated Claims', async () => {
    const eA = assignProject(putEvent('user', 'turn a', 'internal'), 'proj_a');
    const eB = assignProject(putEvent('user', 'turn b', 'internal'), 'proj_b');

    const ab = await abstractEvents(realm.ctx, sameStatement, [eA, eB]);

    // Core fix: the lower-layer auto-merge no longer collapses across scopes,
    // honoring consolidation.ts §sameScope ("must not collapse across projects").
    expect(ab.newCandidates).toHaveLength(2);
    expect(ab.merged).toBe(0);

    const cA = ab.newCandidates.find((c) => c.project_ids.includes('proj_a'));
    const cB = ab.newCandidates.find((c) => c.project_ids.includes('proj_b'));
    expect(cA).toBeDefined();
    expect(cB).toBeDefined();
    expect(cA!.claim_id).not.toBe(cB!.claim_id);

    // Scope is not cross-attributed and evidence is not cross-merged.
    expect(cA!.project_ids).toEqual(['proj_a']);
    expect(cB!.project_ids).toEqual(['proj_b']);
    expect(cA!.evidence_event_identities).toEqual([eA.event_identity]);
    expect(cB!.evidence_event_identities).toEqual([eB.event_identity]);
    expect(cA!.evidence_count).toBe(1);
    expect(cB!.evidence_count).toBe(1);
  });

  it('still exact-merges the same statement WITHIN one project (intra-scope dedup intact)', async () => {
    const e1 = assignProject(putEvent('user', 'turn a', 'internal'), 'proj_a');
    const first = await abstractEvents(realm.ctx, sameStatement, [e1]);
    expect(first.newCandidates).toHaveLength(1);

    const e2 = assignProject(putEvent('user', 'turn b', 'internal'), 'proj_a');
    const second = await abstractEvents(realm.ctx, sameStatement, [e2]);

    // Same project + same statement → union evidence into the existing Claim.
    expect(second.newCandidates).toHaveLength(0);
    expect(second.merged).toBe(1);
    const merged = realm.ctx.store.getClaim(first.newCandidates[0]!.claim_id)!;
    expect(merged.evidence_count).toBe(2);
    expect(merged.evidence_event_identities).toEqual([e1.event_identity, e2.event_identity]);
  });
});
