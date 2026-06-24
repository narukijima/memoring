// Import-from-AI tests (ADR-0007). Exercises the floor: pasted foreign-AI exports
// land as non-authoritative host_memory Events + candidate Claims, never become
// independent evidence, never auto-consolidate, dedup on re-paste, quarantine on
// junk, run the secret scan, and only become recallable via an explicit user
// promotion targeting the active Realm.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runLoop } from '@core/loop';
import { isIndependentEvidenceOrigin } from '@core/schema/enums';
import { getOrCreateLabel } from '@claim/classify';
import { consolidatePending } from '@claim/consolidation';
import { searchRealm, indexClaim, rebuildIndex } from '@retrieval/search';
import {
  ingestImport,
  listImportedCandidates,
  promoteImportedClaim,
  rejectImportedClaim,
} from '@intake/import-from-ai';
import { exportPromptFor } from '@integrations/import-ai/index';
import { claimListStatement } from '../apps/cli/commands/claim';
import type { RealmContext } from '@core/runtime';
import { makeTempRealm, type TempRealm } from './helpers';

const SECRET = 'AKIAIOSFODNN7EXAMPLE'; // canonical AWS access key id (aws_access_key pattern)

const CLAUDE_EXPORT = [
  '```',
  '## Instructions',
  '[2024-01-05] - Always respond in English.',
  '[unknown] - Never use em-dashes in prose.',
  '',
  '## Identity',
  '[2023-11-02] - Name is Naru, based in Tokyo.',
  '',
  '## Preferences',
  '[2024-03-10] - Prefers 2-space indentation in all code.',
  '```',
  'This is the complete set.',
].join('\n');

const CLAUDE_WITH_SECRET = [
  '```',
  '## Identity',
  '[2024-04-01] - Personal API key is ' + SECRET + '.',
  '[2024-04-02] - Lives in Kyoto.',
  '```',
].join('\n');

const GEMINI_EXPORT = [
  '## ユーザー属性情報',
  '* ユーザーの名前は Naru です。',
  '    * 根拠: ユーザーは「Naru と呼んで」と言いました。日付: [2024-01-05]。',
  '* ユーザーの職業はソフトウェアエンジニアです。',
  '    * 根拠: ユーザーは「エンジニアをしています」と述べました。日付: [unknown]。',
  '',
  '## カスタム指示',
  '* 常に英語で応答してください。',
  '    * 根拠: ユーザーは「英語で答えて」と指示しました。日付: [2024-02-01]。',
  '',
  'インポート元は ChatGPT です。',
].join('\n');

// A Gemini export whose secret lives ONLY in the 根拠 quote, not the statement.
const GEMINI_SECRET_IN_QUOTE = [
  '## ユーザー属性情報',
  '* ユーザーの API キーが設定されています。',
  '    * 根拠: ユーザーは「私のキーは ' + SECRET + ' です」と言いました。日付: [2024-05-01]。',
  '',
  'インポート元は Gemini です。',
].join('\n');

/** Floor invariant: no consolidated claim may rest on an imported (host_memory) event. */
function noLaunderedEvidence(ctx: RealmContext): boolean {
  for (const c of ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')) {
    for (const eid of c.evidence_event_identities) {
      const e = ctx.store.findEventByIdentity(ctx.realmId, eid);
      if (e && !isIndependentEvidenceOrigin(e.origin)) return false;
    }
  }
  return true;
}

describe('import from AI — non-authoritative intake + user promotion', () => {
  let realm: TempRealm;
  let ctx: RealmContext;
  beforeEach(() => {
    realm = makeTempRealm();
    ctx = realm.ctx;
  });
  afterEach(() => realm.cleanup());

  it('Claude export → host_memory events + candidate claims with mapped kinds', () => {
    const r = ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    expect(r.candidates).toBe(4);
    expect(r.events).toBe(4);

    // Every imported Event is origin=host_memory (never independent evidence) and Silenced.
    const events = ctx.store.listEvents(ctx.realmId);
    expect(events.length).toBe(4);
    expect(events.every((e) => e.origin === 'host_memory')).toBe(true);
    expect(events.every((e) => e.sensitivity === 'unknown')).toBe(true);

    // Candidate kinds came from the category headers.
    const kinds = listImportedCandidates(ctx).map((c) => c.claim.kind).sort();
    expect(kinds).toEqual(['constraint', 'constraint', 'fact', 'preference']);

    // Candidates carry NO evidence authority and are created_by:'ai'.
    for (const { claim } of listImportedCandidates(ctx)) {
      expect(claim.status).toBe('candidate');
      expect(claim.created_by).toBe('ai');
      expect(claim.evidence_event_identities).toEqual([]);
    }
  });

  it('Gemini export → provider detected, quote preserved (encrypted extra), kinds mapped', () => {
    const r = ingestImport(ctx, Buffer.from(GEMINI_EXPORT, 'utf8'));
    expect(r.provider).toBe('ChatGPT'); // from the trailing インポート元 line
    expect(r.candidates).toBe(3);

    const pending = listImportedCandidates(ctx);
    expect(pending.map((c) => c.claim.kind).sort()).toEqual(['constraint', 'fact', 'fact']);

    // The verbatim 根拠 quote is preserved in the Event's encrypted extra, never indexed.
    const ev = ctx.store.listEvents(ctx.realmId).find((e) => e.source_extra_ref);
    expect(ev?.source_extra_ref).toBeTruthy();
    const extra = JSON.parse(ctx.objects.get(ev!.source_extra_ref!).toString('utf8'));
    expect(extra.import_provider).toBe('ChatGPT');
    expect(String(extra.import_quote)).toContain('Naru'); // verbatim 根拠 preserved
  });

  it('malformed input quarantines with no raw loss (G2)', () => {
    const r = ingestImport(ctx, Buffer.from('just random words, no structure whatsoever', 'utf8'));
    expect(r.candidates).toBe(0);
    expect(r.events).toBe(0);
    expect(r.quarantined).toBe(1);
    expect(ctx.store.countQuarantine(ctx.realmId)).toBe(1);
    // Raw is preserved (captured before parse) — the Undiluted exists.
    expect(ctx.store.listEvents(ctx.realmId).length).toBe(0);
  });

  it('re-pasting the same export dedups (no duplicate events or candidates)', () => {
    const bytes = Buffer.from(CLAUDE_EXPORT, 'utf8');
    const first = ingestImport(ctx, bytes, { providerHint: 'claude' });
    const second = ingestImport(ctx, bytes, { providerHint: 'claude' });
    expect(first.candidates).toBe(4);
    expect(second.candidates).toBe(0); // already imported
    expect(second.events).toBe(0);
    expect(second.deduped).toBeGreaterThan(0);
    expect(listImportedCandidates(ctx).length).toBe(4);
  });

  it('dedups unchanged entries across a re-export with cosmetic drift (not just byte-identical)', () => {
    // A realistic re-run of the export prompt: the foreign AI returns the same entries
    // but a different trailing comment AND one new entry. The 4 unchanged entries must
    // dedup despite the byte-different blob; only the new entry stages.
    const v2 = CLAUDE_EXPORT.replace('This is the complete set.', 'Some entries may remain.').replace(
      '[2024-03-10] - Prefers 2-space indentation in all code.',
      '[2024-03-10] - Prefers 2-space indentation in all code.\n[2024-05-01] - Likes dark mode.',
    );
    const first = ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    const second = ingestImport(ctx, Buffer.from(v2, 'utf8'), { providerHint: 'claude' });
    expect(first.candidates).toBe(4);
    expect(second.candidates).toBe(1); // only "Likes dark mode" is new
    expect(second.deduped).toBeGreaterThan(0);
    expect(listImportedCandidates(ctx).length).toBe(5);
  });

  it('an imported candidate never leaks its statement via `claim list` (even with declared sensitivity)', () => {
    // Regression: claim list is a sibling egress surface. A candidate carrying an
    // explicit internal/public sensitivity must still be suppressed there — only
    // consolidated claims are Gate-cleared output.
    ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude', defaultSensitivity: 'internal' });
    for (const { claim } of listImportedCandidates(ctx)) {
      expect(claim.sensitivity).toBe('internal'); // the declared policy was applied
      expect(claimListStatement(ctx, claim)).toBe('[suppressed:candidate]'); // but never printed
    }
  });

  it('secret in imported text → no candidate; event marked secret; never indexed', () => {
    const r = ingestImport(ctx, Buffer.from(CLAUDE_WITH_SECRET, 'utf8'), { providerHint: 'claude' });
    expect(r.secretSkipped).toBe(1);
    expect(r.candidates).toBe(1); // only the non-secret "Lives in Kyoto" entry

    // No candidate statement leaks the secret.
    for (const { claim } of listImportedCandidates(ctx)) {
      expect(ctx.objects.get(claim.statement_ref).toString('utf8')).not.toContain(SECRET);
    }
    // The secret Event exists but is sensitivity=secret and never indexed.
    const secretEvent = ctx.store.listEvents(ctx.realmId).find((e) => e.sensitivity === 'secret');
    expect(secretEvent).toBeTruthy();
    rebuildIndex(ctx);
    expect(searchRealm(ctx, 'akiaiosfodnn', { activeLabelIds: [] }).length).toBe(0);
  });

  it('secret only in the Gemini 根拠 quote → no candidate (per-entry scan covers the quote)', () => {
    const r = ingestImport(ctx, Buffer.from(GEMINI_SECRET_IN_QUOTE, 'utf8'));
    expect(r.secretSkipped).toBe(1);
    expect(r.candidates).toBe(0); // statement is clean but the quote carries the secret
    // No candidate exists, so nothing in the review pool leaks the key.
    expect(listImportedCandidates(ctx)).toHaveLength(0);
    // The backing Event still exists, marked secret, never indexed.
    const secretEvent = ctx.store.listEvents(ctx.realmId).find((e) => e.sensitivity === 'secret');
    expect(secretEvent).toBeTruthy();
  });

  it('imported candidates never auto-consolidate AND never auto-reject (loop guard)', () => {
    ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    const before = listImportedCandidates(ctx).map((c) => c.claim.claim_id).sort();

    consolidatePending(ctx); // the loop's auto-consolidation pass
    const stillCandidate = ctx.store
      .listClaimsByStatus(ctx.realmId, 'candidate')
      .map((c) => c.claim_id)
      .sort();
    expect(stillCandidate).toEqual(before); // not consolidated, not rejected — held for review
    expect(ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').length).toBe(0);
    expect(ctx.store.listClaimsByStatus(ctx.realmId, 'rejected').length).toBe(0);
    expect(noLaunderedEvidence(ctx)).toBe(true);
  });

  it('full loop never promotes imported content to evidence (laundering closed)', async () => {
    ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    await runLoop(ctx, { method: 'backfill' });
    expect(noLaunderedEvidence(ctx)).toBe(true);
    expect(listImportedCandidates(ctx).length).toBe(4); // survived the loop, still candidates
  });

  it('candidates are invisible to recall until promoted', () => {
    ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    rebuildIndex(ctx);
    // Neither the candidate claim nor the host_memory event is indexed.
    const label = getOrCreateLabel(ctx, 'mystuff', new Date());
    expect(searchRealm(ctx, 'indentation', { activeLabelIds: [label.label_id] }).length).toBe(0);
  });

  it('user promotion makes a candidate recallable; reject drops it', () => {
    ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    const pref = listImportedCandidates(ctx).find((c) => c.claim.kind === 'preference')!;
    const outcome = promoteImportedClaim(ctx, pref.claim.claim_id, { scope: 'mystuff', sensitivity: 'internal' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.claim.status).toBe('consolidated');
    expect(outcome.claim.created_by).toBe('user'); // the USER now asserts it
    expect(outcome.claim.sensitivity).toBe('internal');
    // Still carries NO evidence events — never re-exported as first-party evidence.
    expect(outcome.claim.evidence_event_identities).toEqual([]);
    expect(noLaunderedEvidence(ctx)).toBe(true);

    indexClaim(ctx, outcome.claim);
    const label = getOrCreateLabel(ctx, 'mystuff', new Date());
    const hits = searchRealm(ctx, 'indentation', { activeLabelIds: [label.label_id] });
    expect(hits.length).toBe(1);
    expect(hits[0]!.ref_type).toBe('claim');

    // reject a different candidate → settles to rejected, drops from review.
    const ident = listImportedCandidates(ctx).find((c) => c.claim.kind === 'fact')!;
    expect(rejectImportedClaim(ctx, ident.claim.claim_id).ok).toBe(true);
    expect(ctx.store.getClaim(ident.claim.claim_id)?.status).toBe('rejected');
  });

  it('promotion without a declared sensitivity is refused (no synthesized Declassify)', () => {
    ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    const c = listImportedCandidates(ctx)[0]!;
    const outcome = promoteImportedClaim(ctx, c.claim.claim_id, { scope: 'mystuff' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('sensitivity_required');
  });

  it('imports target the active Realm (events/claims carry its realm_id)', () => {
    const r = ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    expect(r.candidateIds.length).toBe(4);
    expect(ctx.store.listEvents(ctx.realmId).every((e) => e.realm_id === ctx.realmId)).toBe(true);
    expect(listImportedCandidates(ctx).every((c) => c.claim.realm_id === ctx.realmId)).toBe(true);
  });

  it('(g) prints an export prompt for each known provider', () => {
    expect(exportPromptFor('claude')).toContain('Export all of my stored memories');
    expect(exportPromptFor('gemini')).toContain('インポート元は');
    expect(exportPromptFor('chatgpt')).toContain('Export all of my stored memories');
    expect(exportPromptFor('nope')).toBeNull();
  });
});
