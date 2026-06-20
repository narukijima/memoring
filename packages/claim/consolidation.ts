// consolidate — pass candidates through the validator and settle them as
// consolidated / conflicted / rejected (FR-030). Fully automatic: no review
// queue (OUT-006). Safety is enforced at the output Gate, not by withholding
// consolidation — high-risk Claims still consolidate (§4.7).
import type { RealmContext } from '@core/runtime';
import type { Claim } from '@core/schema/entities';
import { normalizeLabel } from '@core/label-normalize';
import { PRUNE_RECIPE } from '@core/recipe';
import { readClaimStatement } from './extractor';
import { initialReinforcement } from './lifecycle';
import { validateClaim } from './validator';

/** Deterministic trigram-Jaccard similarity over normalized text (casefold +
 *  width-fold + whitespace-collapse). CJK-friendly (char trigrams) and needs no
 *  model — it catches LEXICAL near-duplicates; semantic paraphrase (different
 *  wording, same meaning) needs embeddings and is out of v0 scope. */
function trigrams(s: string): Set<string> {
  const n = normalizeLabel(s);
  const set = new Set<string>();
  if (n.length < 3) {
    if (n) set.add(n);
    return set;
  }
  for (let i = 0; i + 3 <= n.length; i += 1) set.add(n.slice(i, i + 3));
  return set;
}

export function statementSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return normalizeLabel(a) === normalizeLabel(b) ? 1 : 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

const DUP_THRESHOLD = PRUNE_RECIPE.merge_suggest_threshold.string; // 0.92

/** Two claims are in the same scope if they share a project (or either is
 *  unscoped). Dedup must not collapse same-worded facts across unrelated projects. */
function sameScope(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const sb = new Set(b);
  return a.some((p) => sb.has(p));
}

export interface ConsolidateOutcome {
  claim_id: string;
  status: Claim['status'];
  reasons: string[];
}

export function consolidateClaim(ctx: RealmContext, claim: Claim, now = new Date()): ConsolidateOutcome {
  if (claim.status !== 'candidate') {
    return { claim_id: claim.claim_id, status: claim.status, reasons: ['not_candidate'] };
  }
  const statement = readClaimStatement(ctx, claim);
  const result = validateClaim(ctx, claim, statement);

  const updated: Claim = {
    ...claim,
    status: result.decision,
    conflict_reason: result.decision === 'conflicted' ? (result.reasons[0] ?? 'conflict') : null,
    reinforcement_score:
      result.decision === 'consolidated' ? initialReinforcement(claim) : claim.reinforcement_score,
  };
  ctx.store.putClaim(updated);
  if (result.decision === 'consolidated') {
    ctx.chronicler.append('consolidate', claim.claim_id, now);
  }
  return { claim_id: claim.claim_id, status: result.decision, reasons: result.reasons };
}

/** Consolidate all candidate Claims in the Realm (used by the loop). Before
 *  validating a candidate, suppress it if it is a near-duplicate of an
 *  already-consolidated claim in the same scope (§1.5): a non-mergeable similar
 *  Claim becomes `conflicted` + `conflict_reason='duplicate_candidate'` — kept
 *  for audit, dropped from normal recall — so a rich LLM run does not flood
 *  context.md with the same fact reworded. The canonical (first) claim stays. */
export function consolidatePending(ctx: RealmContext, now = new Date()): ConsolidateOutcome[] {
  const candidates = ctx.store.listClaimsByStatus(ctx.realmId, 'candidate');
  // Canonical set to dedup against: already-consolidated claims, grown as this
  // run consolidates fresh ones (so intra-run duplicates are caught too).
  const canonical = ctx.store
    .listClaimsByStatus(ctx.realmId, 'consolidated')
    .map((c) => ({ kind: c.kind, statement: readClaimStatement(ctx, c), projectIds: c.project_ids }));

  const outcomes: ConsolidateOutcome[] = [];
  for (const c of candidates) {
    const statement = readClaimStatement(ctx, c);
    const isDuplicate = canonical.some(
      (k) =>
        k.kind === c.kind &&
        sameScope(k.projectIds, c.project_ids) &&
        statementSimilarity(k.statement, statement) >= DUP_THRESHOLD,
    );
    if (isDuplicate) {
      ctx.store.putClaim({ ...c, status: 'conflicted', conflict_reason: 'duplicate_candidate' });
      ctx.chronicler.append('consolidate', c.claim_id, now);
      outcomes.push({ claim_id: c.claim_id, status: 'conflicted', reasons: ['duplicate_candidate'] });
      continue;
    }
    const outcome = consolidateClaim(ctx, c, now);
    if (outcome.status === 'consolidated') {
      canonical.push({ kind: c.kind, statement, projectIds: c.project_ids });
    }
    outcomes.push(outcome);
  }
  return outcomes;
}
