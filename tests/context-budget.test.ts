// Token-budget hard ceiling (§3.6). The allocator is approximate, so the real
// guarantee comes from a measure-and-trim loop on the ACTUAL emitted document (body
// + prefixes + omitted lines + Evidence Map + Ouroboros marker). This stresses it
// with many LONG stale claims (the PR-review case) and asserts the file never exceeds
// token_budget, the trim engaged, and the constraints safety-floor survived.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { newId } from '@core/schema/ids';
import { buildContext } from '@retrieval/context-pack';
import { TOKEN_BUDGET_RECIPE } from '@core/recipe';
import { estimateTokens } from '@core/token-estimate';
import { seedRealmFromFixture, type SeededRealm } from './seed';

const BUDGET = TOKEN_BUDGET_RECIPE.budgets.coding_agent_session_start;

describe('context.md token budget (§3.6) holds on the real emitted document', () => {
  let seeded: SeededRealm;
  beforeEach(async () => {
    seeded = await seedRealmFromFixture();
  });
  afterEach(() => seeded.restore());

  it('stays under token_budget with many long stale claims; trims low-priority, keeps constraints', () => {
    const ctx = seeded.realm.ctx;
    // Clone the consolidated decision (valid evidence + in-scope assignment) into many
    // SUPERSEDED claims with long statements, so §9 (stale) alone would blow the budget.
    const base = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').find((c) => c.kind === 'decision')!;
    const long = 'This is a deliberately long superseded policy statement that eats tokens. '.repeat(70); // ~5k chars
    for (let i = 0; i < 30; i++) {
      const ref = ctx.objects.put(`stale_${i}_stmt`, Buffer.from(`#${i} ${long}`, 'utf8')).ref;
      ctx.store.putClaim({ ...base, claim_id: newId('claim'), status: 'superseded', statement_ref: ref });
    }

    const r = buildContext(ctx, {
      cwd: seeded.projectRoot,
      outPath: path.join('.memoring', 'context.md'),
      audience: 'ai_tool',
      aperture: 'standard',
    });
    expect(r.kind).toBe('written');
    const doc = fs.readFileSync(path.join(seeded.projectRoot, '.memoring', 'context.md'), 'utf8');

    expect(estimateTokens(doc)).toBeLessThanOrEqual(BUDGET); // §3.6: the file does not exceed budget
    expect(doc).toContain('omitted to fit the context budget'); // the trim actually engaged
    expect(doc).toContain('Always use TypeScript strict mode'); // constraints (safety floor) survived
    expect(doc).toContain('memoring:ouroboros'); // marker still present and counted
  });

  it('allocator never truncates the constraints safety floor, even when constraints alone exceed budget', () => {
    const ctx = seeded.realm.ctx;
    // Clone the passing consolidated decision into a handful of CONSTRAINTS whose
    // combined cost alone exceeds the budget. (Synthetic: production caps statements at
    // 280 chars, so the allocator's truncation branch is unreachable in practice — this
    // exercises it directly.) Kept at 6 ≤ max_items_per_section=15 so the ONLY thing
    // that could drop one is the budget, not the density cap.
    const base = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').find((c) => c.kind === 'decision')!;
    const long = 'Never disable the audit log or bypass the egress gate. '.repeat(100); // ~5.4k chars ≈ 1.35k est-tokens
    for (let i = 0; i < 6; i++) {
      const ref = ctx.objects.put(`con_${i}_stmt`, Buffer.from(`Constraint#${i}:: ${long}`, 'utf8')).ref;
      ctx.store.putClaim({ ...base, claim_id: newId('claim'), kind: 'constraint', status: 'consolidated', statement_ref: ref });
    }

    const r = buildContext(ctx, {
      cwd: seeded.projectRoot,
      outPath: path.join('.memoring', 'context.md'),
      audience: 'ai_tool',
      aperture: 'standard',
    });
    expect(r.kind).toBe('written');
    const doc = fs.readFileSync(path.join(seeded.projectRoot, '.memoring', 'context.md'), 'utf8');

    // Every injected constraint renders — the allocator did NOT truncate the floor.
    for (let i = 0; i < 6; i++) expect(doc).toContain(`Constraint#${i}::`);
    // The constraints section carries no budget-omitted line (only recall sections may).
    const section = doc.slice(doc.indexOf('## Constraints / do_not_do'), doc.indexOf('## Open conflicts'));
    expect(section).not.toContain('omitted to fit the context budget');
    // Deliberate §3.6/§3.7 trade-off: constraints alone exceed the budget, so the doc is
    // allowed OVER the ceiling rather than dropping a do_not_do rule (vs the stale case
    // above, where low-priority recall absorbs the trim and the file stays under budget).
    expect(estimateTokens(doc)).toBeGreaterThan(BUDGET);
  });
});
