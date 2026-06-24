// Import orchestration (ADR-0007). Drives a pasted foreign-AI export through the
// SAME pipeline as every source — capture-raw-first (G1) → normalize (G2) — landing
// each entry as a non-authoritative host_memory Event, then stages a reviewable
// `candidate` Claim (handleAddCandidate precedent: created_by:'ai', NO evidence).
// Imported candidates never auto-consolidate (consolidatePending skips the import
// marker); the user explicitly promotes the ones they want, and that user decision
// is the only authority that makes a promoted claim recallable.
import type { RealmContext } from '@core/runtime';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { initialReinforcement } from '@claim/lifecycle';
import { getOrCreateLabel } from '@claim/classify';
import { scanText } from '@security/secret-scan';
import type { Assignment, Claim, ConnectorInstance, Source } from '@core/schema/entities';
import type { Sensitivity } from '@core/schema/enums';
import { capture } from './capture';
import { normalizeOccurrence } from './normalize';
import { eventIdentity, sessionIdentity, sourceIdentity } from './identity';
import {
  IMPORT_AI_CONNECTOR_ID,
  IMPORT_AI_SOURCE_STABLE_ID,
  importAiConnector,
  importClaimMetaKey,
  importEventClaimMetaKey,
  importMessageId,
  importOccurrenceInput,
  importSessionId,
  parseExport,
} from '@integrations/import-ai/index';

/** Declarable sensitivity for promotion / an import-time policy (never `unknown`/`secret`). */
export type DeclaredSensitivity = 'public' | 'internal' | 'confidential';

export interface ImportProvenance {
  provider: string;
  date: string | null;
  kind: Claim['kind'];
  source_event_identity: string;
}

export interface ImportResult {
  provider: string;
  events: number;
  deduped: number;
  quarantined: number;
  /** Candidate Claims created this run (new imported entries). */
  candidates: number;
  /** Entries skipped because their text tripped the secret scan (raw stays withheld). */
  secretSkipped: number;
  candidateIds: string[];
}

/** Find or create the singleton import Source (+ its ConnectorInstance). */
function ensureImportSource(ctx: RealmContext): Source {
  const existing = ctx.store.findSourceByStableId(ctx.realmId, IMPORT_AI_SOURCE_STABLE_ID);
  if (existing) return existing;
  let ci = ctx.store.listConnectorInstances(ctx.realmId).find((c) => c.connector_id === IMPORT_AI_CONNECTOR_ID);
  if (!ci) {
    const created: ConnectorInstance = {
      connector_instance_id: newId('connectorInstance'),
      realm_id: ctx.realmId,
      connector_id: IMPORT_AI_CONNECTOR_ID,
      config_ref: `connectors/${IMPORT_AI_CONNECTOR_ID}`,
      schema_version: SCHEMA_VERSION.connectorInstance,
    };
    ctx.store.putConnectorInstance(created);
    ci = created;
  }
  const source: Source = {
    source_id: newId('source'),
    realm_id: ctx.realmId,
    source_stable_key_hmac: sourceIdentity(ctx.realmKey, IMPORT_AI_CONNECTOR_ID, IMPORT_AI_SOURCE_STABLE_ID),
    source_stable_id: IMPORT_AI_SOURCE_STABLE_ID,
    connector_id: IMPORT_AI_CONNECTOR_ID,
    connector_instance_id: ci.connector_instance_id,
    source_type: 'artifact',
    schema_version: SCHEMA_VERSION.source,
  };
  ctx.store.putSource(source);
  return source;
}

export interface IngestOptions {
  providerHint?: string;
  /** Explicit sensitivity policy for the staged candidates (a §4.3 declaration). */
  defaultSensitivity?: DeclaredSensitivity;
  now?: Date;
}

/** Ingest a pasted export blob into the active Realm. */
export function ingestImport(ctx: RealmContext, bytes: Buffer, opts: IngestOptions = {}): ImportResult {
  const now = opts.now ?? new Date();
  const source = ensureImportSource(ctx);

  // G1: capture raw FIRST, then G2: normalize → host_memory Events (or Quarantine).
  const cap = capture(ctx, source, importOccurrenceInput(bytes), now);
  const norm = normalizeOccurrence(ctx, source, cap.occurrence, cap.undiluted, importAiConnector, now);

  // The connector detects the provider WITHOUT the CLI hint, so identities here must
  // use the same (no-hint) provider to match the Events normalize just created.
  const parsed = parseExport(bytes);
  if (!parsed.ok) {
    return {
      provider: opts.providerHint ?? 'unknown',
      events: norm.events.length,
      deduped: norm.deduped,
      quarantined: norm.quarantined,
      candidates: 0,
      secretSkipped: 0,
      candidateIds: [],
    };
  }
  const idProvider = parsed.export.provider; // matches the connector's session/message ids
  const displayProvider = opts.providerHint?.trim() || idProvider;

  const srcIdentity = sourceIdentity(ctx.realmKey, IMPORT_AI_CONNECTOR_ID, source.source_stable_id);
  const sesIdentity = sessionIdentity(ctx.realmKey, srcIdentity, importSessionId(idProvider));

  const candidateIds: string[] = [];
  let secretSkipped = 0;
  for (const entry of parsed.export.entries) {
    const evIdentity = eventIdentity(
      ctx.realmKey,
      srcIdentity,
      sesIdentity,
      importMessageId(idProvider, entry),
      entry.statement,
      null,
    );
    // Idempotent across re-paste / duplicate entries: one candidate per imported entry.
    if (ctx.store.getMeta(importEventClaimMetaKey(evIdentity))) continue;
    // secret-scan the entry text independently of the Event (defense in depth): a
    // secret entry creates NO candidate; its raw stays withheld in the Undiluted.
    // Scan BOTH the statement AND the backing quote (Gemini 根拠) — a secret living
    // only in the quote must still suppress the candidate (the Event-level scan in
    // normalize already marks the whole Event secret, but the per-entry guarantee
    // "a secret entry creates no candidate" must hold here too).
    if (scanText(entry.statement).detected || (entry.quote !== null && scanText(entry.quote).detected)) {
      secretSkipped += 1;
      continue;
    }
    const claim = createImportedCandidate(ctx, entry.kind, entry.statement, opts.defaultSensitivity, entry.date, now);
    ctx.store.setMeta(importEventClaimMetaKey(evIdentity), claim.claim_id);
    const provenance: ImportProvenance = {
      provider: displayProvider,
      date: entry.date,
      kind: entry.kind,
      source_event_identity: evIdentity,
    };
    ctx.store.setMeta(importClaimMetaKey(claim.claim_id), JSON.stringify(provenance));
    candidateIds.push(claim.claim_id);
  }

  ctx.audit('import', { provider: displayProvider, events: norm.events.length, candidates: candidateIds.length });
  return {
    provider: displayProvider,
    events: norm.events.length,
    deduped: norm.deduped,
    quarantined: norm.quarantined,
    candidates: candidateIds.length,
    secretSkipped,
    candidateIds,
  };
}

/** A staged candidate, mirroring mcp.ts handleAddCandidate: no evidence authority. */
function createImportedCandidate(
  ctx: RealmContext,
  kind: Claim['kind'],
  statement: string,
  declared: DeclaredSensitivity | undefined,
  date: string | null,
  now: Date,
): Claim {
  const ref = ctx.objects.put(`${newId('claim', now.getTime())}_stmt`, Buffer.from(statement, 'utf8')).ref;
  const validFrom = date ? `${date}T00:00:00.000Z` : now.toISOString();
  const claim: Claim = {
    claim_id: newId('claim', now.getTime()),
    realm_id: ctx.realmId,
    kind,
    statement_ref: ref,
    structured_predicate_ref: null,
    assignment_ids: [],
    project_ids: [],
    abstraction_level: 1,
    status: 'candidate', // never consolidated without an explicit user promotion
    conflict_reason: null,
    evidence_event_identities: [], // NO evidence authority (laundering floor)
    evidence_occurrence_ids: [],
    created_by: 'ai', // off-device AI authorship — honest
    created_by_derivation_id: null,
    created_at: now.toISOString(),
    last_recalled_at: null,
    valid_from: validFrom,
    valid_until: null,
    supersedes: [],
    evidence_count: 0,
    reinforcement_score: 0,
    confidence: 0.5,
    sensitivity: declared ?? 'unknown',
    sensitivity_classification_state: declared ? 'inferred' : 'candidate',
    schema_version: SCHEMA_VERSION.claim,
  };
  ctx.store.putClaim(claim);
  return claim;
}

/** True iff a candidate Claim was created by import (carries the pending marker). */
export function isImportedCandidate(ctx: RealmContext, claimId: string): boolean {
  return ctx.store.getMeta(importClaimMetaKey(claimId)) !== undefined;
}

export interface ImportedCandidate {
  claim: Claim;
  provenance: ImportProvenance | null;
}

/** All pending imported candidates awaiting a user decision. */
export function listImportedCandidates(ctx: RealmContext): ImportedCandidate[] {
  const out: ImportedCandidate[] = [];
  for (const claim of ctx.store.listClaimsByStatus(ctx.realmId, 'candidate')) {
    const raw = ctx.store.getMeta(importClaimMetaKey(claim.claim_id));
    if (raw === undefined) continue;
    out.push({ claim, provenance: parseProvenance(raw) });
  }
  return out;
}

function parseProvenance(raw: string): ImportProvenance | null {
  try {
    return JSON.parse(raw) as ImportProvenance;
  } catch {
    return null;
  }
}

export type PromoteOutcome =
  | { ok: true; claim: Claim }
  | { ok: false; reason: 'not_found' | 'not_imported' | 'not_candidate' | 'sensitivity_required' };

export interface PromoteOptions {
  sensitivity?: DeclaredSensitivity;
  scope: string;
  now?: Date;
}

/** Promote an imported candidate to a confirmed, recallable memory — the USER's
 *  explicit authority (§5.2). Sets created_by:'user', attaches an explicit_user
 *  scope Assignment, and settles to `consolidated`. */
export function promoteImportedClaim(ctx: RealmContext, claimId: string, opts: PromoteOptions): PromoteOutcome {
  const now = opts.now ?? new Date();
  const claim = ctx.store.getClaim(claimId);
  if (!claim) return { ok: false, reason: 'not_found' };
  if (!isImportedCandidate(ctx, claimId)) return { ok: false, reason: 'not_imported' };
  if (claim.status !== 'candidate') return { ok: false, reason: 'not_candidate' };

  // Sensitivity must be explicit — a user Declassify, never a synthesized default.
  const sensitivity: Sensitivity | undefined =
    opts.sensitivity ?? (claim.sensitivity !== 'unknown' ? claim.sensitivity : undefined);
  if (!sensitivity) return { ok: false, reason: 'sensitivity_required' };

  // Attach an explicit_user scope label so the promoted (evidence-less) claim is
  // recallable (indexClaim falls back to the claim's own Assignment, ADR-0007).
  const label = getOrCreateLabel(ctx, opts.scope, now);
  const assignment: Assignment = {
    assignment_id: newId('assignment', now.getTime()),
    realm_id: ctx.realmId,
    target_type: 'claim',
    target_id: claim.claim_id,
    label_ids: [label.label_id],
    project_ids: [],
    classification_state: 'confirmed',
    assigned_by: 'explicit_user',
    confidence: 1,
    evidence: [],
    created_by_derivation_id: null,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.assignment,
  };
  ctx.store.putAssignment(assignment);

  const promoted: Claim = {
    ...claim,
    status: 'consolidated',
    created_by: 'user', // the user now asserts it; it is no longer the AI's summary
    assignment_ids: [...claim.assignment_ids, assignment.assignment_id],
    sensitivity,
    sensitivity_classification_state: 'confirmed',
    reinforcement_score: initialReinforcement({ ...claim, status: 'consolidated' }),
    valid_from: claim.valid_from,
  };
  ctx.store.putClaim(promoted);
  ctx.chronicler.append('consolidate', promoted.claim_id, now);
  ctx.audit('import_promote', { claim_id: promoted.claim_id, sensitivity });
  return { ok: true, claim: promoted };
}

export type RejectOutcome = { ok: true } | { ok: false; reason: 'not_found' | 'not_imported' | 'not_candidate' };

/** Reject an imported candidate (settles to `rejected`; drops from review). */
export function rejectImportedClaim(ctx: RealmContext, claimId: string): RejectOutcome {
  const claim = ctx.store.getClaim(claimId);
  if (!claim) return { ok: false, reason: 'not_found' };
  if (!isImportedCandidate(ctx, claimId)) return { ok: false, reason: 'not_imported' };
  if (claim.status !== 'candidate') return { ok: false, reason: 'not_candidate' };
  ctx.store.putClaim({ ...claim, status: 'rejected' });
  ctx.audit('import_reject', { claim_id: claimId });
  return { ok: true };
}
