// The output Gate — the SOLE safety mechanism (Detailed Design §3.4, egress
// table Specification §7.3). Decided by Audience × Aperture only; "being a local
// file" is never a basis for safety. Gate runs strictly before ranking
// (Gate First, §3.5): ¬gate(x,r) ⇒ score undefined.
import {
  CLASSIFIED_STATES,
  type Aperture,
  type Audience,
  type ClassificationState,
  type Sensitivity,
} from './schema/enums';

export interface GateRequest {
  audience: Audience;
  aperture: Aperture;
  activeLabelIds: string[];
  /** One-shot explicit confirmation for confidential under permissive (§7.3 note6). */
  confidentialConfirmed?: boolean;
  /** Crossing permission (default deny in v0). */
  crossScopeAllowed?: boolean;
}

export interface GateItem {
  kind: 'claim' | 'event';
  id: string;
  captured: boolean;
  deleted: boolean;
  redacted: boolean;
  suppressed: boolean;
  conflicted: boolean;
  /** label ids attached via assignments with a classified state. */
  labelIds: string[];
  /** Best classification state among assignments placing the item in active scope. */
  scopeState: ClassificationState | null;
  sensitivity: Sensitivity;
  sensitivityState: ClassificationState;
  hasRequiredProvenance: boolean;
  selfGeneratedContext: boolean;
}

export interface GateResult {
  pass: boolean;
  failed: string[];
}

const STATE_RANK: Record<ClassificationState, number> = {
  confirmed: 4,
  inferred: 3,
  candidate: 2,
  conflicted: 1,
  rejected: 0,
};

export function bestClassificationState(states: ClassificationState[]): ClassificationState | null {
  let best: ClassificationState | null = null;
  for (const s of states) {
    if (best === null || STATE_RANK[s] > STATE_RANK[best]) best = s;
  }
  return best;
}

/** classified(x): has an Assignment with state ∈ {candidate,inferred,confirmed,conflicted}. */
export function classified(item: GateItem): boolean {
  return item.scopeState !== null && CLASSIFIED_STATES.has(item.scopeState);
}

export function activeScopeMatch(item: GateItem, req: GateRequest): boolean {
  if (req.crossScopeAllowed) return true;
  if (req.activeLabelIds.length === 0) return false;
  const active = new Set(req.activeLabelIds);
  return item.labelIds.some((l) => active.has(l));
}

export function activeScopeContainsAll(labelIds: string[], activeLabelIds: string[]): boolean {
  if (labelIds.length === 0 || activeLabelIds.length === 0) return false;
  const active = new Set(activeLabelIds);
  return labelIds.every((l) => active.has(l));
}

/** allowed_scope_state — whether a candidate scope may be emitted (§3.4). */
export function allowedScopeState(state: ClassificationState | null, audience: Audience, aperture: Aperture): boolean {
  if (state === null) return false;
  if (audience === 'remote_ai_processing' || audience === 'export') {
    return state === 'inferred' || state === 'confirmed';
  }
  // ai_tool / human_local_view
  if (aperture === 'strict') return state === 'inferred' || state === 'confirmed';
  if (aperture === 'full_access') return true; // human_local_view only
  // standard / permissive
  return state === 'candidate' || state === 'inferred' || state === 'confirmed';
}

/**
 * allowed_sensitivity — which class may be RAW-emitted under audience/aperture.
 * Hard floor: secret(raw)/unknown are never allowed here (backup_export is a
 * different purpose, not adjudicated by this gate).
 */
export function allowedSensitivity(
  sensitivity: Sensitivity,
  audience: Audience,
  aperture: Aperture,
  confidentialConfirmed = false,
): boolean {
  if (sensitivity === 'secret' || sensitivity === 'unknown') return false; // hard floor
  if (audience === 'human_local_view' && aperture === 'full_access') {
    return true; // public/internal/confidential (secret already excluded above)
  }
  switch (aperture) {
    case 'strict':
    case 'standard':
      return sensitivity === 'public' || sensitivity === 'internal';
    case 'permissive':
      if (sensitivity === 'public' || sensitivity === 'internal') return true;
      return sensitivity === 'confidential' && confidentialConfirmed;
    case 'full_access':
      // full_access is human_local_view-only; for any other audience treat as deny.
      return false;
  }
}

/** allowed_sensitivity_state — determination-state requirement (§3.4). */
export function allowedSensitivityState(state: ClassificationState, audience: Audience, aperture: Aperture): boolean {
  if (audience === 'remote_ai_processing' || audience === 'export') {
    return state === 'inferred' || state === 'confirmed';
  }
  if (aperture === 'strict') return state === 'inferred' || state === 'confirmed';
  return state === 'candidate' || state === 'inferred' || state === 'confirmed';
}

/** The full Gate predicate. Order mirrors Detailed Design §3.4. */
export function gate(item: GateItem, req: GateRequest): GateResult {
  const failed: string[] = [];
  const check = (name: string, cond: boolean) => {
    if (!cond) failed.push(name);
  };

  check('captured', item.captured);
  check('not_deleted', !item.deleted);
  check('not_redacted', !item.redacted);
  check('not_suppressed', !item.suppressed);
  check('classified', classified(item)); // before sensitivity judgment
  check('active_scope_match', activeScopeMatch(item, req));
  check('allowed_scope_state', allowedScopeState(item.scopeState, req.audience, req.aperture));
  check(
    'allowed_sensitivity',
    allowedSensitivity(item.sensitivity, req.audience, req.aperture, req.confidentialConfirmed ?? false),
  );
  check('allowed_sensitivity_state', allowedSensitivityState(item.sensitivityState, req.audience, req.aperture));
  check('not_conflicted_for_request', !item.conflicted);
  check('cross_scope_allowed', activeScopeMatch(item, req) || (req.crossScopeAllowed ?? false));
  check('has_required_provenance', item.hasRequiredProvenance);
  check('not_self_generated_context_as_evidence', !item.selfGeneratedContext);

  return { pass: failed.length === 0, failed };
}
