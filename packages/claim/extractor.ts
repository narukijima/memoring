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
import { allowedSensitivity, allowedSensitivityState } from '@core/policy';
import type { Claim, Derivation, MemEvent } from '@core/schema/entities';
import type { AbstractInput, MemoryProvider } from './provider';

/** Events per provider.abstract() call. An LLM round-trip costs ~the same for 1
 *  or N inputs, so batching cuts API calls ~N×; Mode A is unaffected by size. */
const ABSTRACT_BATCH_SIZE = 20;

function readText(ctx: RealmContext, event: MemEvent): string | null {
  if (!event.text_ref) return null;
  try {
    return ctx.objects.get(event.text_ref).toString('utf8');
  } catch {
    return null;
  }
}

function claimKey(kind: string, statement: string): string {
  return `${kind}\x1f${normalizeLabel(statement)}`;
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
}

export async function abstractEvents(
  ctx: RealmContext,
  provider: MemoryProvider,
  events: MemEvent[],
  now = new Date(),
): Promise<AbstractResult> {
  const newCandidates: Claim[] = [];
  let merged = 0;

  // Filter to eligible events and read their text once. Only user-origin events
  // (independent evidence; never context_injected assistant text, Ouroboros) feed
  // abstraction. The remote pre-egress gate withholds anything the output Gate
  // would block (secret / unknown / unconfirmed-confidential / candidate-state),
  // so a `remote` provider never receives raw text the Gate forbids.
  const eligible: { event: MemEvent; input: AbstractInput }[] = [];
  for (const event of events) {
    if (!isIndependentEvidenceOrigin(event.origin)) continue;
    if (event.origin !== 'user') continue; // v0 heuristics target explicit user statements
    if (
      provider.egress === 'remote' &&
      (!allowedSensitivity(event.sensitivity, 'remote_ai_processing', 'standard') ||
        !allowedSensitivityState(event.sensitivity_classification_state, 'remote_ai_processing', 'standard'))
    ) {
      continue; // mirror the output Gate exactly — value AND determination-state
    }
    const text = readText(ctx, event);
    if (!text) continue;
    eligible.push({ event, input: { text, origin: event.origin, role: event.role } });
  }

  // Abstract in batches; each candidate names the input event it came from.
  for (let start = 0; start < eligible.length; start += ABSTRACT_BATCH_SIZE) {
    const batch = eligible.slice(start, start + ABSTRACT_BATCH_SIZE);
    const candidates = await provider.abstract(batch.map((b) => b.input));

    for (const cand of candidates) {
      const src = batch[cand.sourceIndex];
      if (!src) continue; // candidate cites an out-of-range turn → cannot attribute, drop
      const event = src.event;
      const evidenceSensitivity: Sensitivity = maxSensitivityOf([event.sensitivity]);
      const key = claimKey(cand.kind, cand.statement);
      const keyHash = hmacHex(ctx.realmKey, key);
      const existingId = ctx.store.getMeta(`claimkey:${keyHash}`);

      if (existingId) {
        // Auto-merge: union evidence into the existing claim (FR-035).
        const existing = ctx.store.getClaim(existingId);
        if (existing && !existing.evidence_event_identities.includes(event.event_identity)) {
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

      const assignments = ctx.store.listAssignmentsForTarget('event', event.event_id);
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
        project_ids: [...new Set(assignments.flatMap((a) => a.project_ids))],
        abstraction_level: cand.kind === 'preference' || cand.kind === 'constraint' ? 4 : 2,
        status: 'candidate',
        conflict_reason: null,
        evidence_event_identities: [event.event_identity],
        evidence_occurrence_ids: [...event.occurrence_ids],
        // Provenance drives the validator's evidence bar (validator.ts): an
        // `inferred` candidate (default for LLM-derived patterns) is held to
        // ai_inferred_pattern (min_evidence=2, τ=0.85) and cannot consolidate from
        // a single event; an `explicit` user statement keeps the explicit bar.
        // RuleBasedProvider always emits explicit, so Mode A is unchanged.
        created_by: cand.mode === 'inferred' ? 'ai' : 'rule',
        created_by_derivation_id: derivation.derivation_id,
        created_at: now.toISOString(),
        last_recalled_at: null,
        valid_from: event.source_timestamp ?? event.created_at,
        valid_until: null,
        supersedes: [],
        evidence_count: 1,
        reinforcement_score: 0,
        confidence: cand.confidence,
        sensitivity: evidenceSensitivity,
        sensitivity_classification_state: event.sensitivity_classification_state,
        schema_version: SCHEMA_VERSION.claim,
      };
      ctx.store.putClaim(claim);
      ctx.store.setMeta(`claimkey:${keyHash}`, claim.claim_id);
      ctx.chronicler.append('abstract', claim.claim_id, now);
      newCandidates.push(claim);
    }
  }

  return { newCandidates, merged };
}

/** Read the (decrypted) statement text for a claim — used by context-pack. */
export function readClaimStatement(ctx: RealmContext, claim: Claim): string {
  try {
    return ctx.objects.get(claim.statement_ref).toString('utf8');
  } catch {
    return '';
  }
}
