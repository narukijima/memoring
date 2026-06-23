// abstract — the leap that draws Claim candidates up from Events (FR-028). This
// is kept strictly separate from consolidate (validation). Synonymous claims are
// auto-merged with evidence unioned (FR-035); non-mergeable similars are left for
// consolidation to mark conflicted. Each candidate records a Derivation.
import type { RealmContext } from '@core/runtime';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { normalizeLabel } from '@core/label-normalize';
import { hmacHex } from '@security/crypto-primitives';
import { isIndependentEvidenceOrigin, maxSensitivityOf, type Sensitivity } from '@core/schema/enums';
import { allowedSensitivity, allowedSensitivityState, allowedScopeState, bestClassificationState } from '@core/policy';
import { eventSealSignature, matchesActivePatternSeal } from './seal';
import { log } from '@core/log';
import type { Claim, Derivation, MemEvent } from '@core/schema/entities';
import type { AbstractCandidate, AbstractInput, MemoryProvider } from './provider';

/** Events per provider.abstract() call. An LLM round-trip costs ~the same for 1
 *  or N inputs, so batching cuts API calls ~N×; Mode A is unaffected by size.
 *  Kept modest so a batch's prompt stays within a local model's context window. */
const ABSTRACT_BATCH_SIZE = 12;

function readText(ctx: RealmContext, event: MemEvent): string | null {
  if (!event.text_ref) return null;
  try {
    return ctx.objects.get(event.text_ref).toString('utf8');
  } catch {
    return null;
  }
}

/** Canonical scope identity for the dedup key: the project_ids set, deduped and
 *  sorted so order never affects the key. Empty (unscoped) is its own stable
 *  bucket. We key by the EXACT project set, not by `sameScope` overlap, because
 *  overlap is non-transitive ({A} overlaps {A,B} overlaps {B}, but {A}≠{B}) and a
 *  hash key needs an equivalence. Keying by the exact set never collapses
 *  non-overlapping scopes (the bug consolidation.sameScope guards against); the
 *  only residual — a `[A]` vs `[A,B]` near-duplicate — is caught downstream by
 *  consolidatePending's overlap-aware pass. */
function claimScopeKey(projectIds: readonly string[]): string {
  return [...new Set(projectIds)].sort().join(',');
}

/** The persistent dedup-map key for a (kind, statement, scope) triple. Shared by
 *  the abstractor (write/read), `claim correct`, and `forget` (clear) so the
 *  format never drifts across the call sites that must agree on it. Scope is part
 *  of the key so the same statement under unrelated projects stays separate
 *  Claims (consolidation.ts §sameScope), instead of the lower-layer auto-merge
 *  silently collapsing them into the first project's Claim. */
export function claimKeyMeta(
  realmKey: Buffer,
  kind: string,
  statement: string,
  projectIds: readonly string[],
): string {
  return `claimkey:${hmacHex(realmKey, `${kind}\x1f${normalizeLabel(statement)}\x1f${claimScopeKey(projectIds)}`)}`;
}

function recordDerivation(ctx: RealmContext, provider: MemoryProvider, event: MemEvent, now: Date): Derivation {
  const d: Derivation = {
    derivation_id: newId('derivation', now.getTime()),
    realm_id: ctx.realmId,
    derivation_type: 'abstract',
    input_event_identities: [event.event_identity],
    input_claim_ids: [],
    model_provider: provider.egress, // 'local' | 'remote' — records whether this derivation left the device
    model_name: provider.id,
    model_version: provider.version,
    temperature: null,
    prompt_version: provider.version, // rule_based.v1 / llm.v1 — provenance must name the actual prompt
    recipe_id: 'recipe_consolidation_v1',
    validator_version: 'validator.v1',
    output_digest: hmacHex(ctx.realmKey, event.event_identity),
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.derivation,
  };
  ctx.store.putDerivation(d);
  return d;
}

export interface AbstractResult {
  newCandidates: Claim[];
  merged: number;
  /** Batches whose provider.abstract() threw (e.g. a model/network error). The
   *  batch is skipped and the loop continues — never aborted — so one bad call
   *  does not lose the whole run; the count is surfaced (FR-013, no silent drop). */
  failed: number;
}

export async function abstractEvents(
  ctx: RealmContext,
  provider: MemoryProvider,
  events: MemEvent[],
  now = new Date(),
): Promise<AbstractResult> {
  const newCandidates: Claim[] = [];
  let merged = 0;
  let failed = 0;

  // Filter to eligible events and read their text once. Only user-origin events
  // (independent evidence; never context_injected assistant text, Ouroboros) feed
  // abstraction. For an off-device (`remote`) provider the prompt itself is an
  // egress, so each event must clear the SAME floor the output Gate enforces for
  // the remote_ai_processing audience — checked on every channel, not just here
  // (egress parity: context.md runs gate(); search.ts re-checks independently):
  //   • sensitivity value floor + determination-state (secret/unknown/candidate withheld)
  //   • SCOPE axis: a classified assignment at inferred/confirmed (allowedScopeState) —
  //     so an unclassified / candidate-scope event never leaves the device even if a
  //     policy raised its sensitivity. Mirrors policy.ts classified + allowed_scope_state.
  //   • secret_scan_passed re-check (the independent guard search.ts uses) — a failed
  //     scan withholds the raw text rather than trusting an upstream null text_ref.
  //   • suppression: active status, event-identity Seal, pattern Seal — a
  //     forgotten/sealed/redacted event's raw text is never sent off-device.
  // Remote default-off is enforced at provider resolution (apps/cli/provider.ts,
  // docs/adr/0003); the realm-granularity remote opt-in there authorizes all
  // connected (classified) scopes — a per-label active-scope allow-list is v0.1
  // (ADR-0003 Deferred). A `local` provider stays on-device and is exempt.
  const eligible: { event: MemEvent; input: AbstractInput }[] = [];
  for (const event of events) {
    if (!isIndependentEvidenceOrigin(event.origin)) continue;
    if (event.origin !== 'user') continue; // v0 heuristics target explicit user statements
    if (event.context_injected) continue; // Ouroboros: marker-bearing sessions are not abstraction evidence in v0
    if (provider.egress === 'remote') {
      if (!allowedSensitivity(event.sensitivity, 'remote_ai_processing', 'standard')) continue;
      if (!allowedSensitivityState(event.sensitivity_classification_state, 'remote_ai_processing', 'standard')) continue;
      const scopeState = bestClassificationState(
        ctx.store.listAssignmentsForTarget('event', event.event_id).map((a) => a.classification_state),
      );
      if (!allowedScopeState(scopeState, 'remote_ai_processing', 'standard')) continue; // scope-axis floor
      if (!ctx.store.getSecretScanForEvent(event.event_id)?.secret_scan_passed) continue; // scan parity with search.ts
      if (event.status !== 'active') continue; // redacted/deleted text never egresses
      const sealed =
        ctx.store.activeSealRulesBySignature(ctx.realmId, eventSealSignature(ctx.realmKey, event.event_identity)).length > 0;
      if (sealed) continue; // a forgotten/sealed event_identity must not reach an external model
    }
    const text = readText(ctx, event);
    if (!text) continue;
    if (provider.egress === 'remote' && matchesActivePatternSeal(ctx, text)) continue; // pattern Seal
    eligible.push({ event, input: { text, origin: event.origin, role: event.role } });
  }

  // Abstract in batches; each candidate names the input event it came from.
  for (let start = 0; start < eligible.length; start += ABSTRACT_BATCH_SIZE) {
    const batch = eligible.slice(start, start + ABSTRACT_BATCH_SIZE);
    let candidates: AbstractCandidate[];
    try {
      candidates = await provider.abstract(batch.map((b) => b.input));
    } catch (e) {
      // One bad batch (model error / network / timeout) must not abort the whole
      // run and lose every other event. Skip it, count it, keep going.
      failed += 1;
      log.warn('abstract:batch_failed', { size: batch.length, msg: (e as Error).message });
      continue;
    }

    for (const cand of candidates) {
      const src = batch[cand.sourceIndex];
      if (!src) continue; // candidate cites an out-of-range turn → cannot attribute, drop
      const event = src.event;
      const evidenceSensitivity: Sensitivity = maxSensitivityOf([event.sensitivity]);
      // Scope identity must be known BEFORE the dedup lookup so the same statement
      // under unrelated projects keys to a different Claim (not silently merged into
      // the first project's). Assignments are read once here and reused below.
      const assignments = ctx.store.listAssignmentsForTarget('event', event.event_id);
      const projectIds = [...new Set(assignments.flatMap((a) => a.project_ids))];
      const metaKey = claimKeyMeta(ctx.realmKey, cand.kind, cand.statement, projectIds);
      const existingId = ctx.store.getMeta(metaKey);
      const existing = existingId ? ctx.store.getClaim(existingId) : undefined;
      // A redacted/rejected/superseded claim is dead: never accrete evidence into a
      // tombstone. Treat it as absent, clear the stale mapping, and fall through to
      // create a fresh candidate that re-enters validation (content Seal rejects it
      // if still sealed). (durability/correctness — forget/correct keep the map clean)
      const existingLive =
        existing && existing.status !== 'redacted' && existing.status !== 'rejected' && existing.status !== 'superseded';

      if (existing && existingLive) {
        // Auto-merge: union evidence into the existing claim (FR-035).
        if (!existing.evidence_event_identities.includes(event.event_identity)) {
          const updated: Claim = {
            ...existing,
            evidence_event_identities: [...existing.evidence_event_identities, event.event_identity],
            evidence_occurrence_ids: [...new Set([...existing.evidence_occurrence_ids, ...event.occurrence_ids])],
            evidence_count: existing.evidence_count + 1,
            sensitivity: maxSensitivityOf([existing.sensitivity, evidenceSensitivity]),
          };
          ctx.store.putClaim(updated);
          merged += 1;
        }
        continue;
      }
      if (existingId && !existingLive) ctx.store.deleteMeta(metaKey);
      const supersedes = existing && existing.status === 'superseded' ? [existing.claim_id] : [];

      const derivation = recordDerivation(ctx, provider, event, now);
      const statementRef = ctx.objects.put(
        `${newId('claim', now.getTime())}_stmt`,
        Buffer.from(cand.statement, 'utf8'),
      ).ref;
      const claim: Claim = {
        claim_id: newId('claim', now.getTime()),
        realm_id: ctx.realmId,
        kind: cand.kind,
        statement_ref: statementRef,
        structured_predicate_ref: null,
        assignment_ids: assignments.map((a) => a.assignment_id),
        project_ids: projectIds,
        abstraction_level: cand.kind === 'preference' || cand.kind === 'constraint' ? 4 : 2,
        status: 'candidate',
        conflict_reason: null,
        evidence_event_identities: [event.event_identity],
        evidence_occurrence_ids: [...event.occurrence_ids],
        // Only the trusted deterministic extractor can claim rule authority.
        // Model output is proposal-only metadata, even when it says
        // mode=explicit; the validator must hold it to the AI/inferred bar.
        created_by: provider.id === 'rule_based' && cand.mode === 'explicit' ? 'rule' : 'ai',
        created_by_derivation_id: derivation.derivation_id,
        created_at: now.toISOString(),
        last_recalled_at: null,
        valid_from: event.source_timestamp ?? event.created_at,
        valid_until: null,
        supersedes,
        evidence_count: 1,
        reinforcement_score: 0,
        confidence: cand.confidence,
        sensitivity: evidenceSensitivity,
        sensitivity_classification_state: event.sensitivity_classification_state,
        schema_version: SCHEMA_VERSION.claim,
      };
      ctx.store.putClaim(claim);
      ctx.store.setMeta(metaKey, claim.claim_id);
      ctx.chronicler.append('abstract', claim.claim_id, now);
      newCandidates.push(claim);
    }
  }

  return { newCandidates, merged, failed };
}

/** Read the (decrypted) statement text for a claim — used by context-pack. */
export function readClaimStatement(ctx: RealmContext, claim: Claim): string {
  try {
    return ctx.objects.get(claim.statement_ref).toString('utf8');
  } catch {
    return '';
  }
}
