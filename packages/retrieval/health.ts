import { validateClaim } from '@claim/validator';
import { gate, type GateRequest } from '@core/policy';
import type { Claim, Label, MemEvent } from '@core/schema/entities';
import type { ClassificationState } from '@core/schema/enums';
import type { RealmContext } from '@core/runtime';
import { readClaimStatement } from '@claim/extractor';
import { claimScope } from './claim-scope';
import { toGateItem, toScopedClaim } from './context-pack';

export interface HealthIssue {
  id: string;
  message: string;
}

export interface HealthReport {
  realmId: string;
  counts: {
    claims: Record<string, number>;
    scopeStates: Record<string, number>;
    sensitivity: Record<string, number>;
  };
  conflictingClaims: HealthIssue[];
  staleClaims: HealthIssue[];
  weakEvidence: HealthIssue[];
  orphanLabels: HealthIssue[];
  weakScopeAssignments: HealthIssue[];
  unsafeOutputCandidates: HealthIssue[];
}

function bump(map: Record<string, number>, key: string | null | undefined): void {
  map[key ?? 'missing'] = (map[key ?? 'missing'] ?? 0) + 1;
}

function expired(claim: Claim, now: Date): boolean {
  return claim.valid_until !== null && Date.parse(claim.valid_until) <= now.getTime();
}

function statement(ctx: RealmContext, claim: Claim): string {
  return readClaimStatement(ctx, claim).replace(/\s+/g, ' ').trim();
}

function short(value: string, max = 100): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

function eventScopeState(ctx: RealmContext, event: MemEvent): ClassificationState | null {
  const assignments = ctx.store.listAssignmentsForTarget('event', event.event_id);
  if (assignments.length === 0) return null;
  if (assignments.some((a) => a.classification_state === 'confirmed')) return 'confirmed';
  if (assignments.some((a) => a.classification_state === 'inferred')) return 'inferred';
  if (assignments.some((a) => a.classification_state === 'candidate')) return 'candidate';
  if (assignments.some((a) => a.classification_state === 'conflicted')) return 'conflicted';
  return 'rejected';
}

function labelIsReferenced(ctx: RealmContext, label: Label, claims: Claim[], events: MemEvent[]): boolean {
  for (const claim of claims) {
    if (ctx.store.listAssignmentsForTarget('claim', claim.claim_id).some((a) => a.label_ids.includes(label.label_id))) {
      return true;
    }
  }
  for (const event of events) {
    if (ctx.store.listAssignmentsForTarget('event', event.event_id).some((a) => a.label_ids.includes(label.label_id))) {
      return true;
    }
  }
  return false;
}

export function buildHealthReport(ctx: RealmContext, now = new Date()): HealthReport {
  const claims = ctx.store.listClaims(ctx.realmId);
  const events = ctx.store.listEvents(ctx.realmId);
  const labels = ctx.store.listLabels(ctx.realmId);
  const report: HealthReport = {
    realmId: ctx.realmId,
    counts: { claims: {}, scopeStates: {}, sensitivity: {} },
    conflictingClaims: [],
    staleClaims: [],
    weakEvidence: [],
    orphanLabels: [],
    weakScopeAssignments: [],
    unsafeOutputCandidates: [],
  };

  for (const claim of claims) {
    bump(report.counts.claims, claim.status);
    bump(report.counts.sensitivity, claim.sensitivity);
    const scope = claimScope(ctx, claim);
    bump(report.counts.scopeStates, scope.scopeState);

    const text = statement(ctx, claim);
    if (claim.status === 'conflicted') {
      report.conflictingClaims.push({ id: claim.claim_id, message: `${claim.conflict_reason ?? 'conflicted'}: ${short(text)}` });
    }
    if (claim.status === 'superseded' || expired(claim, now)) {
      report.staleClaims.push({ id: claim.claim_id, message: `${claim.status}${expired(claim, now) ? ' expired' : ''}: ${short(text)}` });
    }
    if (claim.status === 'consolidated' && validateClaim(ctx, claim, text).decision !== 'consolidated') {
      report.weakEvidence.push({ id: claim.claim_id, message: `provenance/evidence no longer validates: ${short(text)}` });
    }
    if (claim.status === 'consolidated' && (scope.labelIds.length === 0 || scope.scopeState === null || scope.scopeState === 'candidate')) {
      report.weakScopeAssignments.push({
        id: claim.claim_id,
        message: `scope=${scope.scopeState ?? 'missing'} labels=${scope.labelIds.length}: ${short(text)}`,
      });
    }
  }

  for (const event of events) {
    bump(report.counts.sensitivity, event.sensitivity);
    const state = eventScopeState(ctx, event);
    bump(report.counts.scopeStates, state);
    if (state === null || state === 'candidate' || state === 'rejected') {
      report.weakScopeAssignments.push({
        id: event.event_id,
        message: `event scope=${state ?? 'missing'} sensitivity=${event.sensitivity}`,
      });
    }
  }

  for (const label of labels.filter((l) => l.state === 'active')) {
    if (!labelIsReferenced(ctx, label, claims, events)) {
      report.orphanLabels.push({ id: label.label_id, message: label.canonical_name });
    }
  }

  const req: GateRequest = {
    audience: 'human_local_view',
    aperture: 'standard',
    activeLabelIds: labels.filter((l) => l.state === 'active').map((l) => l.label_id),
    crossScopeAllowed: false,
  };
  for (const claim of claims.filter((c) => c.status === 'consolidated')) {
    const scoped = toScopedClaim(ctx, claim);
    const result = gate(toGateItem(ctx, scoped), req);
    if (result.pass && (claim.sensitivity === 'secret' || claim.sensitivity === 'unknown' || scoped.labelIds.length === 0)) {
      report.unsafeOutputCandidates.push({
        id: claim.claim_id,
        message: `unsafe class passed diagnostic gate: sensitivity=${claim.sensitivity} labels=${scoped.labelIds.length}`,
      });
    }
  }

  return report;
}

