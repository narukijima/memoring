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
import type { Claim, Derivation, MemEvent } from '@core/schema/entities';
import type { MemoryProvider } from './provider';

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
    model_provider: 'local',
    model_name: provider.id,
    model_version: provider.version,
    temperature: null,
    prompt_version: 'rule_based.v1',
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

export function abstractEvents(
  ctx: RealmContext,
  provider: MemoryProvider,
  events: MemEvent[],
  now = new Date(),
): AbstractResult {
  const newCandidates: Claim[] = [];
  let merged = 0;

  for (const event of events) {
    // Only events whose origin can be INDEPENDENT evidence feed abstraction, and
    // never context_injected assistant text (Ouroboros). user-origin text in a
    // context_injected session is still external_observation, hence allowed.
    if (!isIndependentEvidenceOrigin(event.origin)) continue;
    if (event.origin !== 'user') continue; // v0 heuristics target explicit user statements
    const text = readText(ctx, event);
    if (!text) continue;

    const candidates = provider.abstract([{ text, origin: event.origin, role: event.role }]);
    if (candidates.length === 0) continue;

    const assignmentIds = ctx.store
      .listAssignmentsForTarget('event', event.event_id)
      .map((a) => a.assignment_id);
    const projectIds = ctx.store
      .listAssignmentsForTarget('event', event.event_id)
      .flatMap((a) => a.project_ids);
    const evidenceSensitivity: Sensitivity = maxSensitivityOf([event.sensitivity]);

    for (const cand of candidates) {
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
        assignment_ids: assignmentIds,
        project_ids: [...new Set(projectIds)],
        abstraction_level: cand.kind === 'preference' || cand.kind === 'constraint' ? 4 : 2,
        status: 'candidate',
        conflict_reason: null,
        evidence_event_identities: [event.event_identity],
        evidence_occurrence_ids: [...event.occurrence_ids],
        created_by: 'rule',
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
