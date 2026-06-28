import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHealthReport } from '@retrieval/health';
import { newId } from '@core/schema/ids';
import { renderHealthReport } from '../apps/cli/commands/health';
import { seedRealmFromFixture, type SeededRealm } from './seed';

describe('memoring health — read-only advisory diagnostics', () => {
  let seeded: SeededRealm;

  beforeEach(async () => {
    seeded = await seedRealmFromFixture();
  });

  afterEach(() => seeded.restore());

  it('summarizes state without mutating claims or events', () => {
    const ctx = seeded.realm.ctx;
    const before = {
      claims: ctx.store.listClaims(ctx.realmId).map((c) => `${c.claim_id}:${c.status}`).join('|'),
      events: ctx.store.listEvents(ctx.realmId).map((e) => `${e.event_id}:${e.status}`).join('|'),
    };

    const report = buildHealthReport(ctx);

    expect(report.realmId).toBe(ctx.realmId);
    expect(report.counts.claims.consolidated).toBeGreaterThan(0);
    expect(ctx.store.listClaims(ctx.realmId).map((c) => `${c.claim_id}:${c.status}`).join('|')).toBe(before.claims);
    expect(ctx.store.listEvents(ctx.realmId).map((e) => `${e.event_id}:${e.status}`).join('|')).toBe(before.events);
  });

  it('surfaces conflicts, stale claims, weak evidence, orphan labels, and weak scope assignments', () => {
    const ctx = seeded.realm.ctx;
    const claim = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')[0]!;
    ctx.store.putClaim({ ...claim, status: 'conflicted', conflict_reason: 'counter_evidence' });
    ctx.store.putClaim({
      ...claim,
      claim_id: newId('claim'),
      status: 'superseded',
      conflict_reason: null,
      valid_until: '2000-01-01T00:00:00.000Z',
    });
    ctx.store.putClaim({
      ...claim,
      claim_id: newId('claim'),
      evidence_event_identities: [],
      evidence_occurrence_ids: [],
    });
    ctx.store.putLabel({
      label_id: newId('label'),
      realm_id: ctx.realmId,
      canonical_name: 'unused-health-label',
      normalized_key: 'unused-health-label',
      aliases: [],
      state: 'active',
      merged_into: null,
      created_at: new Date().toISOString(),
      schema_version: 'label.v1',
    });

    const report = buildHealthReport(ctx);

    expect(report.conflictingClaims.length).toBeGreaterThan(0);
    expect(report.staleClaims.length).toBeGreaterThan(0);
    expect(report.weakEvidence.length).toBeGreaterThan(0);
    expect(report.orphanLabels.some((i) => i.message === 'unused-health-label')).toBe(true);
    expect(report.weakScopeAssignments.length).toBeGreaterThan(0);
    expect(report.unsafeOutputCandidates).toEqual([]);
  });

  it('does not include claim statement text in health issue messages or rendered output', () => {
    const ctx = seeded.realm.ctx;
    const base = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')[0]!;
    const sentinel = 'HEALTH_SECRET_SHOULD_NOT_LEAK_12345';
    const secretLike = 'sk-proj-health-secret-span-should-not-leak-12345';
    const now = new Date().toISOString();

    const cases = [
      { suffix: 'secret-conflict', sensitivity: 'secret' as const, status: 'conflicted' as const, conflict_reason: 'counter_evidence' },
      {
        suffix: 'confidential-stale',
        sensitivity: 'confidential' as const,
        status: 'superseded' as const,
        valid_until: '2000-01-01T00:00:00.000Z',
      },
      { suffix: 'unknown-weak-evidence', sensitivity: 'unknown' as const, status: 'consolidated' as const, clearEvidence: true },
      {
        suffix: 'secret-span-conflict',
        sensitivity: 'internal' as const,
        status: 'conflicted' as const,
        conflict_reason: 'counter_evidence',
        statementSuffix: secretLike,
      },
    ];

    for (const item of cases) {
      const claimId = newId('claim');
      const statementRef = ctx.objects.put(
        `${claimId}_stmt`,
        Buffer.from(`${sentinel} ${item.suffix} ${item.statementSuffix ?? ''}`, 'utf8'),
      ).ref;
      ctx.store.putClaim({
        ...base,
        claim_id: claimId,
        statement_ref: statementRef,
        status: item.status,
        conflict_reason: item.conflict_reason ?? null,
        evidence_event_identities: item.clearEvidence ? [] : base.evidence_event_identities,
        evidence_occurrence_ids: item.clearEvidence ? [] : base.evidence_occurrence_ids,
        evidence_count: item.clearEvidence ? 0 : base.evidence_count,
        sensitivity: item.sensitivity,
        valid_until: item.valid_until ?? null,
        created_at: now,
      });
    }

    const report = buildHealthReport(ctx);
    const issueMessages = [
      ...report.conflictingClaims,
      ...report.staleClaims,
      ...report.weakEvidence,
      ...report.weakScopeAssignments,
      ...report.unsafeOutputCandidates,
    ]
      .map((issue) => issue.message)
      .join('\n');
    const rendered = renderHealthReport(report).join('\n');

    expect(issueMessages).not.toContain(sentinel);
    expect(issueMessages).not.toContain(secretLike);
    expect(rendered).not.toContain(sentinel);
    expect(rendered).not.toContain(secretLike);
    expect(issueMessages).toContain('sensitivity=secret');
    expect(issueMessages).toContain('sensitivity=confidential');
    expect(issueMessages).toContain('sensitivity=unknown');
  });
});
