// Logical data-model contracts (Detailed Design §1). The whole DB is encrypted
// at rest, so structural metadata lives as plaintext columns *inside* the
// encrypted container; large/sensitive payloads (raw bytes, normalized text,
// artifacts, statements) live as separately AEAD-encrypted object-store entries
// referenced by `*_ref`. `content_fingerprint` / `event_identity` /
// `normalized_key` / `target_signature` are realm_key HMACs and never expose
// plaintext.
import type {
  Aperture,
  Audience,
  CaptureMethod,
  ChronicleOpType,
  ClaimKind,
  ClaimState,
  ClassificationState,
  Origin,
  SecretScanStatus,
  Sensitivity,
} from './enums';

/** Layer 1 — immutable raw bytes before interpretation. */
export interface Undiluted {
  undiluted_id: string;
  realm_id: string;
  payload_format: string;
  encrypted_payload_ref: string; // object-store ref (AEAD), opaque
  content_fingerprint: string; // hmac(realm_key, payload)
  size_bytes: number;
  compression: 'none' | 'zstd';
  data_key_id: string;
  created_at: string; // ISO; inside the encrypted DB
  status: 'active' | 'redacted' | 'deleted';
  schema_version: string;
}

/** Layer 2 — one contact: when/which source/which cursor the raw was observed. */
export interface Occurrence {
  occurrence_id: string;
  undiluted_id: string;
  source_id: string;
  connector_id: string;
  connector_version: string;
  parser_hint: string;
  source_path_ref: string | null; // encrypted ref
  source_cursor: string | null; // stable cursor (offset / message id)
  captured_at: string;
  capture_method: CaptureMethod;
  status: 'captured' | 'tombstoned';
  schema_version: string;
}

/** Layer 3 — observed fact normalized onto a common timeline. */
export interface MemEvent {
  event_id: string;
  event_identity: string; // hmac(realm_key, source||session||(message_id|content_anchor))
  realm_id: string;
  occurrence_ids: string[];
  session_id: string;
  turn_id: string | null;
  event_type: string;
  role: string | null;
  origin: Origin;
  created_at: string;
  source_timestamp: string | null;
  timestamp_confidence: 'source_reported' | 'capture_observed';
  sequence: number; // Chronicle-aligned monotonic order within the Realm
  text_ref: string | null; // normalized text (object-store ref); null when redacted
  source_extra_ref: string | null; // unknown fields, encrypted, excluded from index
  sensitivity: Sensitivity;
  sensitivity_classification_state: ClassificationState;
  context_injected: boolean;
  context_pack_digest: string | null;
  parser_version: string;
  status: 'active' | 'redacted' | 'deleted';
  schema_version: string;
}

/** Deterministic event-level secret-scan result (Detailed Design §1.3.3). */
export interface SecretScanResult {
  secret_scan_id: string;
  event_id: string;
  secret_scan_status: SecretScanStatus;
  secret_scan_passed: boolean;
  secret_detected: boolean;
  secret_scan_version: string;
  created_at: string;
  schema_version: string;
}

/** A single label→target attachment. */
export interface Assignment {
  assignment_id: string;
  realm_id: string;
  target_type: 'event' | 'claim';
  target_id: string;
  label_ids: string[];
  project_ids: string[];
  classification_state: ClassificationState;
  assigned_by: 'ai' | 'rule:path_git_remote' | 'user_rule' | 'explicit_user';
  confidence: number;
  evidence: string[]; // occurrence ids
  created_by_derivation_id: string | null;
  created_at: string;
  schema_version: string;
}

/** The label vocabulary itself (split from Assignment). */
export interface Label {
  label_id: string;
  realm_id: string;
  canonical_name: string; // inside encrypted DB
  normalized_key: string; // hmac(realm_key, normalize(name))
  aliases: string[];
  state: 'active' | 'merged' | 'deprecated';
  merged_into: string | null;
  created_at: string;
  schema_version: string;
}

/** Layer 4 — versioned, evidence-backed assertion. */
export interface Claim {
  claim_id: string;
  realm_id: string;
  kind: ClaimKind;
  statement_ref: string; // object-store ref (encrypted natural language)
  structured_predicate_ref: string | null;
  assignment_ids: string[];
  project_ids: string[];
  abstraction_level: number;
  status: ClaimState;
  conflict_reason: string | null;
  evidence_event_identities: string[];
  evidence_occurrence_ids: string[];
  created_by: 'ai' | 'rule' | 'user' | 'validator';
  created_by_derivation_id: string | null;
  created_at: string;
  last_recalled_at: string | null;
  valid_from: string;
  valid_until: string | null;
  supersedes: string[];
  evidence_count: number;
  reinforcement_score: number;
  confidence: number;
  sensitivity: Sensitivity;
  sensitivity_classification_state: ClassificationState;
  schema_version: string;
}

/** Provenance of an AI/Recipe derivation (not itself evidence). */
export interface Derivation {
  derivation_id: string;
  realm_id: string;
  derivation_type:
    | 'scope_classify'
    | 'sensitivity_classify'
    | 'consolidate'
    | 'abstract'
    | 'label_suggest'
    | 'reflection_lane'
    | 'backfill_candidate'
    | 'shadow_trial';
  input_event_identities: string[];
  input_claim_ids: string[];
  model_provider: string;
  model_name: string;
  model_version: string;
  temperature: number | null;
  prompt_version: string;
  recipe_id: string;
  validator_version: string;
  output_digest: string;
  created_at: string;
  schema_version: string;
}

export type ReflectionRiskFlag =
  | 'stale'
  | 'cross_scope'
  | 'weak_origin'
  | 'conflict'
  | 'sensitivity_unknown'
  | 'self_generated';

export type ReflectionSuggestedAction = 'keep_candidate' | 'defer' | 'reject';

export interface ReflectionEvidenceRef {
  event_identity: string;
  reason?: string;
}

export interface BackfillCandidate {
  backfill_candidate_id: string;
  realm_id: string;
  kind: ClaimKind;
  statement_ref: string;
  status: 'candidate' | 'quarantined' | 'rejected' | 'promoted';
  created_by: 'ai' | 'rule';
  confidence: number;
  source_event_identities: string[];
  accepted_evidence_refs: ReflectionEvidenceRef[];
  rejected_evidence_refs: ReflectionEvidenceRef[];
  risk_flags: ReflectionRiskFlag[];
  created_by_derivation_id: string;
  created_at: string;
  schema_version: string;
}

export interface ReflectionReport {
  reflection_report_id: string;
  realm_id: string;
  candidate_id: string;
  surfaced_reason: string;
  accepted_evidence_refs: ReflectionEvidenceRef[];
  rejected_evidence_refs: ReflectionEvidenceRef[];
  risk_flags: ReflectionRiskFlag[];
  suggested_action: ReflectionSuggestedAction;
  created_by_derivation_id: string;
  created_at: string;
  schema_version: string;
}

export interface EvalReport {
  eval_report_id: string;
  realm_id: string;
  candidate_id: string;
  verdict: 'helpful' | 'neutral' | 'harmful';
  reason: string;
  risk_flags: ReflectionRiskFlag[];
  evidence_refs: ReflectionEvidenceRef[];
  created_by_derivation_id: string;
  created_at: string;
  schema_version: string;
}

export interface RankingMetadata {
  ranking_metadata_id: string;
  realm_id: string;
  target_type: 'claim';
  target_id: string;
  recall_count: number;
  distinct_query_count: number;
  distinct_day_count: number;
  correction_count: number;
  conflict_count: number;
  stale_signal: boolean;
  score: number;
  computed_after_gate: true;
  created_at: string;
  schema_version: string;
}

/** Output projection. By default stores only the manifest (no body). */
export interface ContextPack {
  context_pack_id: string;
  realm_id: string;
  purpose: string;
  audience: Audience;
  aperture: Aperture;
  active_label_ids: string[];
  active_project_ids: string[];
  resolution_basis: 'cli_scope' | 'cli_project' | 'cwd_project_match';
  context_budget_recipe_id: string;
  token_budget: number;
  generated_at: string;
  policy_applied: string[];
  policy_digest: string;
  manifest_only: boolean;
  body_ref: string | null;
  self_ingestion_marker_digest: string;
  evidence_ids: string[];
  schema_version: string;
}

export interface Artifact {
  artifact_id: string;
  realm_id: string;
  kind: 'stdout' | 'stderr' | 'diff' | 'attachment';
  encrypted_ref: string;
  content_fingerprint: string;
  filename_ref: string | null;
  mime_type: string;
  size_bytes: number;
  schema_version: string;
}

/** Append-only operation log; lower layers rebuild deterministically from here. */
export interface Chronicle {
  chronicle_id: string;
  realm_id: string;
  sequence: number;
  prev_chronicle_id: string | null;
  op_type: ChronicleOpType;
  target_ref: string;
  payload_digest: string;
  created_at: string;
  schema_version: string;
}

/** Durable suppression (Seal). created_by/release are user-only. */
export interface SealRule {
  suppression_id: string;
  realm_id: string;
  match_type: 'event_identity' | 'content_signature' | 'pattern';
  target_signature: string; // hmac(realm_key, ...)
  scope: 'Realm' | 'label' | 'project';
  scope_ref: string | null;
  reason_ref: string | null;
  created_by: 'user';
  active: boolean;
  created_at: string;
  schema_version: string;
}

export interface Session {
  session_id: string;
  realm_id: string;
  source_id: string;
  connector_instance_id: string;
  host_tool: string;
  host_tool_version: string | null;
  format_version: string | null;
  cwd_ref: string | null;
  project_ids: string[];
  git_remote_ref: string | null;
  source_account_ref: string | null;
  transcript_path_ref: string | null;
  started_at: string | null;
  ended_at: string | null;
  context_injected: boolean;
  context_pack_digest: string | null;
  schema_version: string;
}

export interface Source {
  source_id: string;
  realm_id: string;
  source_stable_key_hmac: string; // = source_identity
  source_stable_id: string;
  connector_id: string;
  connector_instance_id: string;
  source_type: 'append' | 'snapshot' | 'event' | 'artifact';
  schema_version: string;
}

export interface Project {
  project_id: string;
  realm_id: string;
  name: string;
  root_paths: string[];
  git_remotes: string[];
  schema_version: string;
}

export interface ConnectorInstance {
  connector_instance_id: string;
  realm_id: string;
  connector_id: string;
  config_ref: string;
  schema_version: string;
}

export interface QuarantineRecord {
  quarantine_id: string;
  realm_id: string;
  occurrence_id: string;
  undiluted_id: string;
  reason: string;
  parser_version: string;
  created_at: string;
  schema_version: string;
}

export interface Tombstone {
  tombstone_id: string;
  realm_id: string;
  deleted_ref: string;
  minimal_range: string;
  created_at: string;
  schema_version: string;
}
