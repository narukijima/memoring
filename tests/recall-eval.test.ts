// Recall evaluation harness (T4). A SCORED quality gate for context.md: each
// scenario builds a real ContextPack through the Gate-First pipeline and scores
// five axes — safety pass / required-constraint coverage / stale warning / token
// budget / opaque-citation consistency. Thresholds are asserted so a regression in
// any axis fails CI; a scorecard is printed for visibility. Run: `npm run eval`.
//
// It deliberately runs the REAL loop over the Claude Code fixture (which plants a
// constraint/preference/decision plus a secret, a host_summary, and an assistant
// paraphrase) rather than substring spot-checks, so the scorer exercises the same
// path a live session would.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildContext } from '@retrieval/context-pack';
import { searchRealm } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { readClaimStatement } from '@claim/extractor';
import { TOKEN_BUDGET_RECIPE } from '@core/recipe';
import { estimateTokens } from '@core/token-estimate';
import { textLooksContextInjected } from '@security/ouroboros';
import { isIndependentEvidenceOrigin } from '@core/schema/enums';
import type { RealmContext } from '@core/runtime';
import { seedRealmFromFixture, type SeededRealm } from './seed';

const SECRET = 'sk-abc1234567890';
const ASSISTANT_PARAPHRASE = 'I will always enable strict mode and avoid any';
const EXPECTED = ['Always use TypeScript strict mode', 'better-sqlite3', '2-space indentation'];
// Things that must never appear on ANY channel: the planted secret, the assistant
// paraphrase (G8), and any transcript / absolute path (Evidence-Map path rules §6.3).
const FORBIDDEN = [SECRET, ASSISTANT_PARAPHRASE, '/Users/', '/tmp/memoring-proj', '.claude/projects'];
const BUDGET = TOKEN_BUDGET_RECIPE.budgets.coding_agent_session_start;

// ── scoring axes ──────────────────────────────────────────────────────────────
function scoreSafety(doc: string, extraForbidden: string[] = []): number {
  return [...FORBIDDEN, ...extraForbidden].every((f) => !doc.includes(f)) ? 1 : 0;
}
function scoreCoverage(doc: string, expected: string[]): number {
  if (expected.length === 0) return 1;
  return expected.filter((e) => doc.includes(e)).length / expected.length;
}
function scoreTokenBudget(doc: string): number {
  return estimateTokens(doc) <= BUDGET ? 1 : 0; // same estimator the budget enforcer uses
}
/** Every clm_ id cited in the Evidence Map must have been rendered in a section
 *  above (no dangling citation); an empty doc trivially passes. */
function scoreCitations(doc: string): number {
  const idx = doc.indexOf('## Citations / Evidence Map');
  if (idx < 0) return 1;
  const rendered = new Set([...doc.slice(0, idx).matchAll(/\((clm_[A-Za-z0-9]+)\)/g)].map((m) => m[1]!));
  const cited = [...doc.slice(idx).matchAll(/- (clm_[A-Za-z0-9]+):/g)].map((m) => m[1]!);
  return cited.every((id) => rendered.has(id)) ? 1 : 0;
}

/** Assert every axis meets its threshold so a regression cannot pass with a 0.00 in
 *  a column nobody checked. Default threshold is 1.0 for all five axes; pass a
 *  partial override for any scenario where a lower bar is intentional. */
function expectAxes(scores: Record<string, number>, min: Partial<Record<string, number>> = {}): void {
  const thresholds: Record<string, number> = { safety: 1, coverage: 1, stale: 1, budget: 1, citation: 1, ...min };
  for (const [axis, t] of Object.entries(thresholds)) {
    if (scores[axis] === undefined) continue;
    expect(scores[axis], `axis ${axis}`).toBeGreaterThanOrEqual(t);
  }
}

function staleSection(doc: string): string {
  const start = doc.indexOf('## Open conflicts / stale warnings');
  if (start < 0) return '';
  const end = doc.indexOf('## Citations / Evidence Map', start);
  return doc.slice(start, end < 0 ? undefined : end);
}
function guidanceSection(doc: string): string {
  const end = doc.indexOf('## Open conflicts / stale warnings');
  return end < 0 ? doc : doc.slice(0, end);
}

/** G8: no consolidated claim may rest on a non-independent (launderable) origin. */
function allEvidenceIndependent(ctx: RealmContext): boolean {
  for (const c of ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')) {
    for (const eid of c.evidence_event_identities) {
      const e = ctx.store.findEventByIdentity(ctx.realmId, eid);
      if (e && !isIndependentEvidenceOrigin(e.origin)) return false;
    }
  }
  return true;
}

function build(seeded: SeededRealm, opts: { scope?: string; cwd?: string } = {}): { kind: string; doc: string } {
  const cwd = opts.cwd ?? seeded.projectRoot;
  const result = buildContext(seeded.realm.ctx, {
    cwd,
    outPath: path.join('.memoring', 'context.md'),
    scope: opts.scope,
    aperture: 'standard',
    audience: 'ai_tool',
  });
  const file = path.join(cwd, '.memoring', 'context.md');
  const doc = result.kind === 'written' && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return { kind: result.kind, doc };
}

const scorecard: Array<{ scenario: string; scores: Record<string, number> }> = [];
function report(scenario: string, scores: Record<string, number>): void {
  scorecard.push({ scenario, scores });
}

describe('recall eval harness — context.md quality across 6 scenarios × 5 axes', () => {
  let seeded: SeededRealm;
  beforeEach(async () => {
    seeded = await seedRealmFromFixture();
  });
  afterEach(() => {
    if (scorecard.length) {
      const last = scorecard[scorecard.length - 1]!;
      const cells = Object.entries(last.scores).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ');
      // eslint-disable-next-line no-console
      console.log(`  [recall-eval] ${last.scenario.padEnd(26)} ${cells}`);
    }
    seeded.restore();
  });

  it('1. normal repo work — constraints/decisions present, safe, within budget', () => {
    const { doc } = build(seeded);
    const scores = {
      safety: scoreSafety(doc),
      coverage: scoreCoverage(doc, EXPECTED),
      stale: staleSection(doc).includes('_None._') ? 1 : 0, // no false stale warning
      budget: scoreTokenBudget(doc),
      citation: scoreCitations(doc),
    };
    report('normal repo work', scores);
    expect(scores).toEqual({ safety: 1, coverage: 1, stale: 1, budget: 1, citation: 1 });
  });

  it('2. secret mixed in — never appears in context.md OR search/MCP', () => {
    const { doc } = build(seeded);
    const ctx = seeded.realm.ctx;
    const labels = resolveActiveLabelIds(ctx, ['proj_test'], undefined);
    const hits = searchRealm(ctx, 'sk-abc', { activeLabelIds: labels });
    const scores = {
      safety: scoreSafety(doc, [SECRET]),
      coverage: scoreCoverage(doc, EXPECTED),
      stale: 1,
      budget: scoreTokenBudget(doc),
      citation: scoreCitations(doc),
    };
    report('secret mixed in', scores);
    expectAxes(scores);
    expect(hits.length).toBe(0); // secret is never indexed → search/MCP can never surface it
  });

  it('3. stale assumption — superseded claim is a stale WARNING, not current guidance', () => {
    const ctx = seeded.realm.ctx;
    const decision = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').find((c) => c.kind === 'decision')!;
    const stmt = readClaimStatement(ctx, decision);
    ctx.store.putClaim({ ...decision, status: 'superseded' }); // what `claim expire` does
    const { doc } = build(seeded);
    const stale = staleSection(doc);
    const scores = {
      safety: scoreSafety(doc),
      coverage: scoreCoverage(doc, ['Always use TypeScript strict mode', '2-space indentation']), // the 2 still-live
      stale: stale.includes('stale: superseded') && stale.includes(decision.claim_id) ? 1 : 0,
      budget: scoreTokenBudget(doc),
      citation: scoreCitations(doc),
    };
    report('stale assumption', scores);
    expectAxes(scores);
    expect(guidanceSection(doc)).not.toContain(stmt); // not presented as guidance to follow
    expect(stale).toContain('review required, NOT current guidance'); // §9 is NOT tagged current-guidance
    expect(stale).toContain('do not follow'); // the stale line is explicitly non-actionable
  });

  it('3b. valid_until in the past also surfaces as a stale warning', () => {
    const ctx = seeded.realm.ctx;
    const pref = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').find((c) => c.kind === 'preference')!;
    ctx.store.putClaim({ ...pref, valid_until: '2000-01-01T00:00:00.000Z' });
    const { doc } = build(seeded);
    const stale = staleSection(doc);
    report('stale (valid_until)', { stale: stale.includes('stale: expired') ? 1 : 0 });
    expect(stale).toContain('stale: expired');
    expect(stale).toContain(pref.claim_id);
  });

  it('4. realm/scope mismatch — Silence from unregistered CWD; wrong scope leaks nothing', () => {
    const silent = build(seeded, { cwd: path.join(seeded.projectRoot, '..', 'unregistered-cwd-xyz') });
    const wrong = build(seeded, { scope: 'no-such-scope-label' });
    const scores = {
      safety: (silent.kind === 'silence' ? 1 : 0) * scoreSafety(wrong.doc, EXPECTED), // no in-scope claim leaks
      coverage: 1,
      stale: 1,
      budget: scoreTokenBudget(wrong.doc),
      citation: scoreCitations(wrong.doc),
    };
    report('scope mismatch', scores);
    expect(silent.kind).toBe('silence');
    expectAxes(scores);
  });

  it('5. ouroboros re-ingestion — signed marker present; assistant paraphrase never promoted', () => {
    const { doc } = build(seeded);
    const scores = {
      safety: scoreSafety(doc), // ASSISTANT_PARAPHRASE is in FORBIDDEN
      coverage: scoreCoverage(doc, EXPECTED),
      stale: 1,
      budget: scoreTokenBudget(doc),
      citation: scoreCitations(doc),
    };
    report('ouroboros re-ingestion', scores);
    expect(doc).toContain('memoring:ouroboros'); // a verbatim re-ingestion would be detected
    expect(textLooksContextInjected(doc)).toBe(true);
    expectAxes(scores);
    expect(allEvidenceIndependent(seeded.realm.ctx)).toBe(true); // self-generated context never evidence
  });

  it('6. host_summary/host_memory mixed in — never independent evidence (laundering loop closed)', () => {
    const ctx = seeded.realm.ctx;
    // The fixture plants a type=summary line (origin=host_summary). It must not be
    // evidence for any consolidated claim, and its content must not surface.
    const summaryEvents = ctx.store.listEvents(ctx.realmId).filter((e) => e.origin === 'host_summary');
    expect(summaryEvents.length).toBeGreaterThan(0); // fixture really planted it
    const { doc } = build(seeded);
    const scores = {
      safety: scoreSafety(doc),
      coverage: scoreCoverage(doc, EXPECTED),
      stale: 1,
      budget: scoreTokenBudget(doc),
      citation: scoreCitations(doc),
    };
    report('host_summary mixed in', scores);
    expect(allEvidenceIndependent(ctx)).toBe(true);
    expectAxes(scores);
  });
});
