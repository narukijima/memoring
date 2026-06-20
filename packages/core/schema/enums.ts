// Canonical vocabulary (Final Design Glossary). These names are load-bearing:
// validator / gate / policy all key off them. Do not rename without an ADR.

// ── Provenance ────────────────────────────────────────────────────────────
/** Event.origin — fixed to exactly 10 values (Detailed Design §1.3.2). */
export const ORIGINS = [
  'user',
  'tool_result',
  'command_result',
  'file_diff',
  'external_artifact',
  'assistant',
  'host_summary',
  'host_memory',
  'system',
  'unknown',
] as const;
export type Origin = (typeof ORIGINS)[number];

/**
 * Origins that may count as *independent* evidence (= external observation).
 * Closing the host-memory laundering loop depends on this set being exact.
 */
export const INDEPENDENT_EVIDENCE_ORIGINS: ReadonlySet<Origin> = new Set([
  'user',
  'tool_result',
  'command_result',
  'file_diff',
  'external_artifact',
]);

/** Origins that cannot serve as evidence at all (derived / non-authoritative). */
export const NON_EVIDENCE_ORIGINS: ReadonlySet<Origin> = new Set([
  'host_summary',
  'host_memory',
  'system',
  'unknown',
]);

export function isIndependentEvidenceOrigin(o: Origin): boolean {
  return INDEPENDENT_EVIDENCE_ORIGINS.has(o);
}
export function canBeEvidenceAtAll(o: Origin): boolean {
  return !NON_EVIDENCE_ORIGINS.has(o);
}

// ── Safety / sensitivity ──────────────────────────────────────────────────
/** sensitivity — 5 values. `unclassified` is NOT here (it is a scope-axis notion). */
export const SENSITIVITIES = ['public', 'internal', 'confidential', 'secret', 'unknown'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

/** Order public < internal < confidential < secret. `unknown` is Silence (no rank). */
const SENSITIVITY_RANK: Record<Exclude<Sensitivity, 'unknown'>, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  secret: 3,
};

/** Returns the more-sensitive of two values; `unknown` dominates (Silence floor). */
export function maxSensitivity(a: Sensitivity, b: Sensitivity): Sensitivity {
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  return SENSITIVITY_RANK[a] >= SENSITIVITY_RANK[b] ? a : b;
}
export function maxSensitivityOf(values: Sensitivity[]): Sensitivity {
  return values.reduce<Sensitivity>((acc, v) => maxSensitivity(acc, v), 'public');
}

// ── Classification state (scope and sensitivity share this space) ───────────
export const CLASSIFICATION_STATES = [
  'candidate',
  'inferred',
  'confirmed',
  'conflicted',
  'rejected',
] as const;
export type ClassificationState = (typeof CLASSIFICATION_STATES)[number];

/** classified(x) considers these states "present" (rejected/absent are not). */
export const CLASSIFIED_STATES: ReadonlySet<ClassificationState> = new Set([
  'candidate',
  'inferred',
  'confirmed',
  'conflicted',
]);

// ── Claim ───────────────────────────────────────────────────────────────────
export const CLAIM_KINDS = [
  'preference',
  'constraint',
  'decision',
  'fact',
  'project_context',
  'procedure',
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CLAIM_STATES = [
  'candidate',
  'consolidated',
  'conflicted',
  'superseded',
  'rejected',
  'redacted',
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

// ── Output Gate axes ─────────────────────────────────────────────────────────
export const AUDIENCES = [
  'ai_tool',
  'remote_ai_processing',
  'export',
  'human_local_view',
] as const;
export type Audience = (typeof AUDIENCES)[number];

export const APERTURES = ['strict', 'standard', 'permissive', 'full_access'] as const;
export type Aperture = (typeof APERTURES)[number];

/** Egress purposes (Specification §7.3 table columns). */
export const EGRESS_PURPOSES = [
  'context_pack',
  'remote_ai',
  'redacted_export',
  'dataset_export',
  'backup_export',
  'mcp',
] as const;
export type EgressPurpose = (typeof EGRESS_PURPOSES)[number];

// ── Misc ─────────────────────────────────────────────────────────────────────
export const CAPTURE_METHODS = ['watch', 'backfill', 'manual'] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

export const CHRONICLE_OP_TYPES = [
  'capture',
  'normalize',
  'classify',
  'abstract',
  'consolidate',
  'scope_confirm',
  'redact',
  'delete',
  'seal',
  'reindex',
] as const;
export type ChronicleOpType = (typeof CHRONICLE_OP_TYPES)[number];

export const SECRET_SCAN_STATUSES = ['not_run', 'passed', 'failed', 'error'] as const;
export type SecretScanStatus = (typeof SECRET_SCAN_STATUSES)[number];
