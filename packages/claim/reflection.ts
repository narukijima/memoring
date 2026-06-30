// Reflection Lane — derivation-only diagnostics and grounded backfill support.
// Reports and evals are audit artifacts, never Claim evidence. The only path
// toward memory is promotion into an ordinary Claim candidate, then the existing
// validator decides.
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { hmacHex } from '@security/crypto-primitives';
import { NON_EVIDENCE_ORIGINS, isIndependentEvidenceOrigin, maxSensitivityOf, type ClaimKind } from '@core/schema/enums';
import { readClaimStatement } from './extractor';
import { statementSimilarity } from './consolidation';
import type {
  BackfillCandidate,
  Claim,
  Derivation,
  EvalReport,
  MemEvent,
  ReflectionEvidenceRef,
  ReflectionReport,
  ReflectionRiskFlag,
} from '@core/schema/entities';
import type { RealmContext } from '@core/runtime';

export interface BackfillCandidateInput {
  kind: ClaimKind;
  statement: string;
  eventIdentities: string[];
  surfacedReason: string;
  createdBy?: 'ai' | 'rule';
  confidence?: number;
}

export interface BackfillCandidateResult {
  candidate: BackfillCandidate;
  report: ReflectionReport;
}

export interface ShadowTrialInput {
  candidateId: string;
  baselineDigest: string;
  augmentedDigest: string;
  verdict: EvalReport['verdict'];
  reason: string;
  riskFlags?: ReflectionRiskFlag[];
}

function recordReflectionDerivation(
  ctx: RealmContext,
  type: Derivation['derivation_type'],
  eventIdentities: string[],
  claimIds: string[],
  outputSeed: string,
  now: Date,
): Derivation {
  const d: Derivation = {
    derivation_id: newId('derivation', now.getTime()),
    realm_id: ctx.realmId,
    derivation_type: type,
    input_event_identities: eventIdentities,
    input_claim_ids: claimIds,
    model_provider: 'local',
    model_name: 'reflection_lane',
    model_version: 'v1',
    temperature: null,
    prompt_version: 'reflection_lane.v1',
    recipe_id: 'recipe_reflection_lane_v1',
    validator_version: 'validator.v1',
    output_digest: hmacHex(ctx.realmKey, outputSeed),
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.derivation,
  };
  ctx.store.putDerivation(d);
  return d;
}

function classifyEvidence(ctx: RealmContext, eventIdentities: string[]): {
  accepted: ReflectionEvidenceRef[];
  rejected: ReflectionEvidenceRef[];
  events: MemEvent[];
  riskFlags: ReflectionRiskFlag[];
} {
  const accepted: ReflectionEvidenceRef[] = [];
  const rejected: ReflectionEvidenceRef[] = [];
  const events: MemEvent[] = [];
  const flags = new Set<ReflectionRiskFlag>();

  for (const event_identity of eventIdentities) {
    const event = ctx.store.findEventByIdentity(ctx.realmId, event_identity);
    if (!event) {
      rejected.push({ event_identity, reason: 'missing_event' });
      flags.add('weak_origin');
      continue;
    }
    if (event.status !== 'active') {
      rejected.push({ event_identity, reason: 'inactive_event' });
      flags.add('weak_origin');
      continue;
    }
    if (event.context_injected) {
      rejected.push({ event_identity, reason: 'self_generated_context' });
      flags.add('self_generated');
      continue;
    }
    if (NON_EVIDENCE_ORIGINS.has(event.origin) || !isIndependentEvidenceOrigin(event.origin)) {
      rejected.push({ event_identity, reason: `non_independent_origin:${event.origin}` });
      flags.add('weak_origin');
      continue;
    }
    if (event.sensitivity === 'unknown') flags.add('sensitivity_unknown');
    accepted.push({ event_identity });
    events.push(event);
  }

  return { accepted, rejected, events, riskFlags: [...flags] };
}

function suggestedAction(accepted: ReflectionEvidenceRef[], flags: ReflectionRiskFlag[]): ReflectionReport['suggested_action'] {
  if (accepted.length === 0) return 'reject';
  if (flags.includes('self_generated') || flags.includes('sensitivity_unknown') || flags.includes('weak_origin')) return 'defer';
  return 'keep_candidate';
}

export function createBackfillCandidate(
  ctx: RealmContext,
  input: BackfillCandidateInput,
  now = new Date(),
): BackfillCandidateResult {
  const evidence = classifyEvidence(ctx, input.eventIdentities);
  const derivation = recordReflectionDerivation(
    ctx,
    'backfill_candidate',
    input.eventIdentities,
    [],
    `${input.kind}\n${input.statement}\n${input.eventIdentities.join('\n')}`,
    now,
  );
  const statementRef = ctx.objects.put(
    `${newId('backfillCandidate', now.getTime())}_stmt`,
    Buffer.from(input.statement, 'utf8'),
  ).ref;
  const riskFlags = evidence.riskFlags;
  const candidate: BackfillCandidate = {
    backfill_candidate_id: newId('backfillCandidate', now.getTime()),
    realm_id: ctx.realmId,
    kind: input.kind,
    statement_ref: statementRef,
    status: evidence.accepted.length === 0 ? 'quarantined' : 'candidate',
    created_by: input.createdBy ?? 'ai',
    confidence: input.confidence ?? 0.9,
    source_event_identities: input.eventIdentities,
    accepted_evidence_refs: evidence.accepted,
    rejected_evidence_refs: evidence.rejected,
    risk_flags: riskFlags,
    created_by_derivation_id: derivation.derivation_id,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.backfillCandidate,
  };
  ctx.store.putBackfillCandidate(candidate);

  const report: ReflectionReport = {
    reflection_report_id: newId('reflectionReport', now.getTime()),
    realm_id: ctx.realmId,
    candidate_id: candidate.backfill_candidate_id,
    surfaced_reason: input.surfacedReason,
    accepted_evidence_refs: evidence.accepted,
    rejected_evidence_refs: evidence.rejected,
    risk_flags: riskFlags,
    suggested_action: suggestedAction(evidence.accepted, riskFlags),
    created_by_derivation_id: derivation.derivation_id,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.reflectionReport,
  };
  ctx.store.putReflectionReport(report);
  ctx.flush();
  return { candidate, report };
}

export function readBackfillCandidateStatement(ctx: RealmContext, candidate: BackfillCandidate): string {
  try {
    return ctx.objects.get(candidate.statement_ref).toString('utf8');
  } catch {
    return '';
  }
}

export function reflectionArtifactCanPromote(kind: 'backfill_candidate' | 'reflection_report' | 'eval_report'): boolean {
  return kind === 'backfill_candidate';
}

export function promoteBackfillCandidateToClaim(
  ctx: RealmContext,
  candidateId: string,
  now = new Date(),
): { kind: 'promoted'; claim: Claim } | { kind: 'rejected'; reasons: string[] } {
  const candidate = ctx.store.getBackfillCandidate(candidateId);
  if (!candidate) return { kind: 'rejected', reasons: ['candidate:not_found'] };
  if (candidate.status !== 'candidate') return { kind: 'rejected', reasons: [`candidate:${candidate.status}`] };
  if (candidate.accepted_evidence_refs.length === 0) return { kind: 'rejected', reasons: ['evidence:none'] };

  const events = candidate.accepted_evidence_refs
    .map((r) => ctx.store.findEventByIdentity(ctx.realmId, r.event_identity))
    .filter((e): e is MemEvent => Boolean(e));
  if (events.length === 0) return { kind: 'rejected', reasons: ['evidence:none'] };

  const assignments = events.flatMap((e) => ctx.store.listAssignmentsForTarget('event', e.event_id));
  const statement = readBackfillCandidateStatement(ctx, candidate);
  const claim: Claim = {
    claim_id: newId('claim', now.getTime()),
    realm_id: ctx.realmId,
    kind: candidate.kind,
    statement_ref: ctx.objects.put(`${newId('claim', now.getTime())}_stmt`, Buffer.from(statement, 'utf8')).ref,
    structured_predicate_ref: null,
    assignment_ids: [...new Set(assignments.map((a) => a.assignment_id))],
    project_ids: [...new Set(assignments.flatMap((a) => a.project_ids))],
    abstraction_level: candidate.kind === 'preference' || candidate.kind === 'constraint' ? 4 : 2,
    status: 'candidate',
    conflict_reason: null,
    evidence_event_identities: events.map((e) => e.event_identity),
    evidence_occurrence_ids: [...new Set(events.flatMap((e) => e.occurrence_ids))],
    created_by: candidate.created_by,
    created_by_derivation_id: candidate.created_by_derivation_id,
    created_at: now.toISOString(),
    last_recalled_at: null,
    valid_from: events[0]?.source_timestamp ?? events[0]?.created_at ?? now.toISOString(),
    valid_until: null,
    supersedes: [],
    evidence_count: candidate.accepted_evidence_refs.length,
    reinforcement_score: 0,
    confidence: candidate.confidence,
    sensitivity: maxSensitivityOf(events.map((e) => e.sensitivity)),
    sensitivity_classification_state: events.some((e) => e.sensitivity_classification_state === 'candidate')
      ? 'candidate'
      : 'inferred',
    schema_version: SCHEMA_VERSION.claim,
  };
  ctx.store.putClaim(claim);
  ctx.store.putBackfillCandidate({ ...candidate, status: 'promoted' });
  ctx.chronicler.append('abstract', claim.claim_id, now);
  ctx.flush();
  return { kind: 'promoted', claim };
}

export function createShadowTrialReport(ctx: RealmContext, input: ShadowTrialInput, now = new Date()): EvalReport {
  const candidate = ctx.store.getBackfillCandidate(input.candidateId);
  const evidenceRefs = candidate?.accepted_evidence_refs ?? [];
  const derivation = recordReflectionDerivation(
    ctx,
    'shadow_trial',
    evidenceRefs.map((r) => r.event_identity),
    [],
    `${input.candidateId}\n${input.baselineDigest}\n${input.augmentedDigest}\n${input.verdict}\n${input.reason}`,
    now,
  );
  const report: EvalReport = {
    eval_report_id: newId('evalReport', now.getTime()),
    realm_id: ctx.realmId,
    candidate_id: input.candidateId,
    verdict: input.verdict,
    reason: input.reason,
    risk_flags: input.riskFlags ?? candidate?.risk_flags ?? [],
    evidence_refs: evidenceRefs,
    created_by_derivation_id: derivation.derivation_id,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.evalReport,
  };
  ctx.store.putEvalReport(report);
  ctx.flush();
  return report;
}

function createContextShadowTrialReport(
  ctx: RealmContext,
  candidate: BackfillCandidate,
  report: ReflectionReport,
  statement: string,
  now = new Date(),
): EvalReport {
  const baselineClaims = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated');
  const baselineSeed = baselineClaims.map((c) => c.claim_id).sort().join('|');
  const duplicate = baselineClaims.some(
    (claim) => claim.kind === candidate.kind && statementSimilarity(readClaimStatement(ctx, claim), statement) >= 0.92,
  );
  const verdict: EvalReport['verdict'] =
    report.suggested_action === 'reject'
      ? 'harmful'
      : report.suggested_action === 'defer' || duplicate
        ? 'neutral'
        : 'helpful';
  const reason =
    report.suggested_action === 'reject'
      ? 'candidate would add no independently grounded context'
      : duplicate
        ? 'candidate-augmented context is materially duplicate of baseline context'
        : report.suggested_action === 'defer'
          ? 'candidate-augmented context has risk flags and is diagnostic only'
          : 'candidate-augmented context adds a grounded non-duplicate candidate to the baseline context';

  return createShadowTrialReport(
    ctx,
    {
      candidateId: candidate.backfill_candidate_id,
      baselineDigest: hmacHex(ctx.realmKey, `baseline:${baselineSeed}`),
      augmentedDigest: hmacHex(
        ctx.realmKey,
        `augmented:${baselineSeed}|${candidate.backfill_candidate_id}|${statement}|${candidate.accepted_evidence_refs
          .map((r) => r.event_identity)
          .sort()
          .join('|')}`,
      ),
      verdict,
      reason,
      riskFlags: candidate.risk_flags,
    },
    now,
  );
}

export function recordReflectionForClaimCandidate(
  ctx: RealmContext,
  claim: Claim,
  statement: string,
  now = new Date(),
): { candidate: BackfillCandidate; report: ReflectionReport; evalReport: EvalReport } {
  const { candidate, report } = createBackfillCandidate(
    ctx,
    {
      kind: claim.kind,
      statement,
      eventIdentities: claim.evidence_event_identities,
      surfacedReason: `abstracted_claim_candidate:${claim.claim_id}`,
      createdBy: claim.created_by === 'rule' ? 'rule' : 'ai',
      confidence: claim.confidence,
    },
    now,
  );
  const evalReport = createContextShadowTrialReport(ctx, candidate, report, statement, now);
  return { candidate, report, evalReport };
}
