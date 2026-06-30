import { describe, expect, it } from 'vitest';
import { gate, type GateItem, type GateRequest } from '@core/policy';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { normalizeLabel } from '@core/label-normalize';
import { realmHmac } from '@security/crypto-primitives';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import { createBackfillCandidate, createShadowTrialReport, promoteBackfillCandidateToClaim } from '@claim/reflection';
import { consolidateClaim } from '@claim/consolidation';
import { validateClaim } from '@claim/validator';
import { rankingMetadataAfterGate } from '@retrieval/ranking';
import { getCorrectionCount, getDistinctDayCount, getDistinctQueryCount, incrementCorrectionCount } from '@retrieval/ranking-signals';
import { recordRecall } from '@claim/recall';
import { indexClaim, searchRealm } from '@retrieval/search';
import { makeTempRealm } from './helpers';
import type { Assignment, Claim, Label, MemEvent } from '@core/schema/entities';
import type { Origin, Sensitivity } from '@core/schema/enums';
import type { RealmContext } from '@core/runtime';

function addLabel(ctx: RealmContext): { labelId: string; projectId: string } {
  const labelId = newId('label');
  const projectId = newId('project');
  const label: Label = {
    label_id: labelId,
    realm_id: ctx.realmId,
    canonical_name: 'test',
    normalized_key: realmHmac(ctx.realmKey, normalizeLabel('test')),
    aliases: [],
    state: 'active',
    merged_into: null,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION.label,
  };
  ctx.store.putLabel(label);
  return { labelId, projectId };
}

function addEvent(
  ctx: RealmContext,
  opts: { origin?: Origin; sensitivity?: Sensitivity; contextInjected?: boolean; labelId?: string; projectId?: string } = {},
): MemEvent {
  const now = new Date().toISOString();
  const eventId = newId('event');
  const src = sourceIdentity(ctx.realmKey, 'test', `${eventId}-source`);
  const ses = sessionIdentity(ctx.realmKey, src, `${eventId}-session`);
  const event: MemEvent = {
    event_id: eventId,
    event_identity: eventIdentity(ctx.realmKey, src, ses, `${eventId}-message`, eventId),
    realm_id: ctx.realmId,
    occurrence_ids: [newId('occurrence')],
    session_id: `ses_${eventId}`,
    turn_id: null,
    event_type: 'message',
    role: opts.origin === 'assistant' ? 'assistant' : 'user',
    origin: opts.origin ?? 'user',
    created_at: now,
    source_timestamp: null,
    timestamp_confidence: 'capture_observed',
    sequence: 1,
    text_ref: null,
    source_extra_ref: null,
    sensitivity: opts.sensitivity ?? 'internal',
    sensitivity_classification_state: 'inferred',
    context_injected: opts.contextInjected ?? false,
    context_pack_digest: null,
    parser_version: 'test.v1',
    status: 'active',
    schema_version: SCHEMA_VERSION.event,
  };
  ctx.store.putEvent(event);
  if (opts.labelId && opts.projectId) {
    const assignment: Assignment = {
      assignment_id: newId('assignment'),
      realm_id: ctx.realmId,
      target_type: 'event',
      target_id: event.event_id,
      label_ids: [opts.labelId],
      project_ids: [opts.projectId],
      classification_state: 'inferred',
      assigned_by: 'rule:path_git_remote',
      confidence: 1,
      evidence: event.occurrence_ids,
      created_by_derivation_id: null,
      created_at: now,
      schema_version: SCHEMA_VERSION.assignment,
    };
    ctx.store.putAssignment(assignment);
  }
  return event;
}

function reportEvidenceClaim(ctx: RealmContext, reportId: string): Claim {
  const now = new Date().toISOString();
  return {
    claim_id: newId('claim'),
    realm_id: ctx.realmId,
    kind: 'fact',
    statement_ref: ctx.objects.put(`${newId('claim')}_stmt`, Buffer.from('report says this is useful', 'utf8')).ref,
    structured_predicate_ref: null,
    assignment_ids: [],
    project_ids: [],
    abstraction_level: 1,
    status: 'candidate',
    conflict_reason: null,
    evidence_event_identities: [reportId],
    evidence_occurrence_ids: [],
    created_by: 'ai',
    created_by_derivation_id: null,
    created_at: now,
    last_recalled_at: null,
    valid_from: now,
    valid_until: null,
    supersedes: [],
    evidence_count: 1,
    reinforcement_score: 0,
    confidence: 0.95,
    sensitivity: 'internal',
    sensitivity_classification_state: 'inferred',
    schema_version: SCHEMA_VERSION.claim,
  };
}

const req: GateRequest = {
  audience: 'ai_tool',
  aperture: 'standard',
  activeLabelIds: ['lbl_a'],
};

function gateItem(overrides: Partial<GateItem> = {}): GateItem {
  return {
    kind: 'claim',
    id: 'clm_x',
    captured: true,
    deleted: false,
    redacted: false,
    suppressed: false,
    conflicted: false,
    labelIds: ['lbl_a'],
    scopeState: 'inferred',
    sensitivity: 'internal',
    sensitivityState: 'inferred',
    hasRequiredProvenance: true,
    selfGeneratedContext: false,
    ...overrides,
  };
}

describe('Reflection Lane boundaries', () => {
  it('does not allow a ReflectionReport to become Claim evidence', () => {
    const tmp = makeTempRealm();
    try {
      const event = addEvent(tmp.ctx);
      const { report } = createBackfillCandidate(tmp.ctx, {
        kind: 'fact',
        statement: 'Historical logs indicate the project uses local-first storage.',
        eventIdentities: [event.event_identity],
        surfacedReason: 'historical pattern',
      });
      const claim = reportEvidenceClaim(tmp.ctx, report.reflection_report_id);
      expect(validateClaim(tmp.ctx, claim, 'report says this is useful').decision).toBe('rejected');
    } finally {
      tmp.cleanup();
    }
  });

  it('quarantines a BackfillCandidate without a valid event_identity', () => {
    const tmp = makeTempRealm();
    try {
      const { candidate, report } = createBackfillCandidate(tmp.ctx, {
        kind: 'fact',
        statement: 'Ungrounded historical note.',
        eventIdentities: ['rpt_not_an_event'],
        surfacedReason: 'ungrounded input',
      });
      expect(candidate.status).toBe('quarantined');
      expect(report.suggested_action).toBe('reject');
      expect(promoteBackfillCandidateToClaim(tmp.ctx, candidate.backfill_candidate_id).kind).toBe('rejected');
    } finally {
      tmp.cleanup();
    }
  });

  it('does not let assistant/host-memory reflection increase independent evidence', () => {
    const tmp = makeTempRealm();
    try {
      const assistant = addEvent(tmp.ctx, { origin: 'assistant' });
      const memory = addEvent(tmp.ctx, { origin: 'host_memory' });
      const { candidate } = createBackfillCandidate(tmp.ctx, {
        kind: 'fact',
        statement: 'Assistant-derived reflection is true.',
        eventIdentities: [assistant.event_identity, memory.event_identity],
        surfacedReason: 'reflection summary',
      });
      expect(candidate.status).toBe('quarantined');
      const promoted = promoteBackfillCandidateToClaim(tmp.ctx, candidate.backfill_candidate_id);
      expect(promoted.kind).toBe('rejected');
    } finally {
      tmp.cleanup();
    }
  });

  it('keeps ranking score undefined when Gate is false', () => {
    const tmp = makeTempRealm();
    try {
      const claim = reportEvidenceClaim(tmp.ctx, 'evt_missing');
      expect(gate(gateItem({ sensitivity: 'secret' }), req).pass).toBe(false);
      expect(rankingMetadataAfterGate(tmp.ctx, claim, gateItem({ sensitivity: 'secret' }), req)).toBeUndefined();
      expect(rankingMetadataAfterGate(tmp.ctx, claim, gateItem({ labelIds: ['lbl_other'] }), req)).toBeUndefined();
    } finally {
      tmp.cleanup();
    }
  });

  it('does not let a helpful Shadow Trial verdict confirm or consolidate a Claim', () => {
    const tmp = makeTempRealm();
    try {
      const event = addEvent(tmp.ctx);
      const { candidate } = createBackfillCandidate(tmp.ctx, {
        kind: 'fact',
        statement: 'Candidate may improve answer quality.',
        eventIdentities: [event.event_identity],
        surfacedReason: 'shadow trial input',
      });
      const evalReport = createShadowTrialReport(tmp.ctx, {
        candidateId: candidate.backfill_candidate_id,
        baselineDigest: 'base',
        augmentedDigest: 'augmented',
        verdict: 'helpful',
        reason: 'more specific',
      });
      expect(evalReport.verdict).toBe('helpful');
      expect(tmp.ctx.store.getBackfillCandidate(candidate.backfill_candidate_id)?.status).toBe('candidate');
      expect(tmp.ctx.store.listClaims(tmp.ctx.realmId)).toHaveLength(0);
    } finally {
      tmp.cleanup();
    }
  });

  it('allows grounded candidates to proceed only through existing evidence validation', () => {
    const tmp = makeTempRealm();
    try {
      const { labelId, projectId } = addLabel(tmp.ctx);
      const e1 = addEvent(tmp.ctx, { origin: 'tool_result', labelId, projectId });
      const e2 = addEvent(tmp.ctx, { origin: 'command_result', labelId, projectId });
      const { candidate } = createBackfillCandidate(tmp.ctx, {
        kind: 'fact',
        statement: 'The project has two independent grounded observations.',
        eventIdentities: [e1.event_identity, e2.event_identity],
        surfacedReason: 'grounded backfill',
      });
      const promoted = promoteBackfillCandidateToClaim(tmp.ctx, candidate.backfill_candidate_id);
      expect(promoted.kind).toBe('promoted');
      if (promoted.kind === 'promoted') {
        expect(promoted.claim.status).toBe('candidate');
        const outcome = consolidateClaim(tmp.ctx, promoted.claim);
        expect(outcome.status).toBe('consolidated');
      }
    } finally {
      tmp.cleanup();
    }
  });

  it('keeps secret and out-of-scope candidates non-rankable regardless of high reinforcement', () => {
    const tmp = makeTempRealm();
    try {
      const claim = { ...reportEvidenceClaim(tmp.ctx, 'evt_missing'), reinforcement_score: 1 };
      expect(rankingMetadataAfterGate(tmp.ctx, claim, gateItem({ sensitivity: 'secret' }), req)).toBeUndefined();
      expect(rankingMetadataAfterGate(tmp.ctx, claim, gateItem({ sensitivity: 'unknown' }), req)).toBeUndefined();
      expect(rankingMetadataAfterGate(tmp.ctx, claim, gateItem({ labelIds: ['lbl_other'] }), req)).toBeUndefined();
    } finally {
      tmp.cleanup();
    }
  });

  it('records ranking signals from actual search, recall, and correction paths', () => {
    const tmp = makeTempRealm();
    try {
      const { labelId, projectId } = addLabel(tmp.ctx);
      const e1 = addEvent(tmp.ctx, { origin: 'tool_result', labelId, projectId });
      const e2 = addEvent(tmp.ctx, { origin: 'command_result', labelId, projectId });
      const { candidate } = createBackfillCandidate(tmp.ctx, {
        kind: 'fact',
        statement: 'Searchable grounded ranking signal.',
        eventIdentities: [e1.event_identity, e2.event_identity],
        surfacedReason: 'ranking signal fixture',
      });
      const promoted = promoteBackfillCandidateToClaim(tmp.ctx, candidate.backfill_candidate_id);
      expect(promoted.kind).toBe('promoted');
      if (promoted.kind !== 'promoted') return;
      expect(consolidateClaim(tmp.ctx, promoted.claim).status).toBe('consolidated');
      const claim = tmp.ctx.store.getClaim(promoted.claim.claim_id)!;
      indexClaim(tmp.ctx, claim);

      expect(searchRealm(tmp.ctx, 'ranking signal', { activeLabelIds: [labelId] })).toHaveLength(1);
      expect(searchRealm(tmp.ctx, 'grounded ranking', { activeLabelIds: [labelId] })).toHaveLength(1);
      expect(getDistinctQueryCount(tmp.ctx, claim.claim_id)).toBe(2);

      recordRecall(tmp.ctx, [claim.claim_id], new Date('2026-01-02T00:00:00.000Z'));
      recordRecall(tmp.ctx, [claim.claim_id], new Date('2026-01-03T00:00:00.000Z'));
      expect(getDistinctDayCount(tmp.ctx, claim.claim_id)).toBe(2);

      incrementCorrectionCount(tmp.ctx, claim.claim_id);
      expect(getCorrectionCount(tmp.ctx, claim.claim_id)).toBe(1);
      const metadata = rankingMetadataAfterGate(tmp.ctx, claim, gateItem(), req);
      expect(metadata?.distinct_query_count).toBe(2);
      expect(metadata?.distinct_day_count).toBe(2);
      expect(metadata?.correction_count).toBe(1);
    } finally {
      tmp.cleanup();
    }
  });
});
