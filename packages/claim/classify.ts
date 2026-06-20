// classify — assign scope (Label/Assignment) and sensitivity per Event. v0 is
// rule/policy-driven (Mode A): scope is INFERRED from the project the source
// belongs to (a deterministic path/project signal), and sensitivity is set from
// the project's explicit default_sensitivity policy (a non-AI Declassify
// authority, §4.3). AI scope labels would be `candidate`; here we have a
// deterministic signal, hence `inferred`. secret is never lowered (Escalate-only).
import type { RealmContext } from '@core/runtime';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { normalizeLabel } from '@core/label-normalize';
import { realmHmac } from '@security/crypto-primitives';
import { maxSensitivity, type Sensitivity } from '@core/schema/enums';
import type { Assignment, Label, MemEvent } from '@core/schema/entities';

function getOrCreateLabel(ctx: RealmContext, name: string, now: Date): Label {
  const normalized = normalizeLabel(name);
  const key = realmHmac(ctx.realmKey, normalized);
  const existing = ctx.store.findLabelByNormalizedKey(ctx.realmId, key);
  if (existing) return existing;
  const label: Label = {
    label_id: newId('label', now.getTime()),
    realm_id: ctx.realmId,
    canonical_name: name,
    normalized_key: key,
    aliases: [],
    state: 'active',
    merged_into: null,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.label,
  };
  ctx.store.putLabel(label);
  return label;
}

export interface ClassifyContext {
  projectId: string;
  projectName: string;
  defaultSensitivity: Sensitivity; // from project policy (explicit authority)
}

/** Resolve the project a given event belongs to, via session → source mapping. */
export function projectForEvent(ctx: RealmContext, event: MemEvent): ClassifyContext | null {
  const session = ctx.store.getSession(event.session_id);
  if (!session) return null;
  const projectId = ctx.store.getMeta(`source_project:${session.source_id}`);
  if (!projectId) return null;
  const project = ctx.config.projects.find((p) => p.project_id === projectId);
  if (!project) return null;
  return {
    projectId,
    projectName: project.name,
    defaultSensitivity: project.default_sensitivity ?? 'internal',
  };
}

export function classifyEvent(ctx: RealmContext, event: MemEvent, now = new Date()): Assignment | null {
  // Skip if already classified.
  const existing = ctx.store.listAssignmentsForTarget('event', event.event_id);
  if (existing.length > 0) return existing[0]!;

  const pc = projectForEvent(ctx, event);
  if (!pc) return null; // no project → no deterministic scope signal → stays unclassified (Silence)

  const label = getOrCreateLabel(ctx, pc.projectName, now);
  const assignment: Assignment = {
    assignment_id: newId('assignment', now.getTime()),
    realm_id: ctx.realmId,
    target_type: 'event',
    target_id: event.event_id,
    label_ids: [label.label_id],
    project_ids: [pc.projectId],
    classification_state: 'inferred', // deterministic project/path signal
    assigned_by: 'rule:path_git_remote',
    confidence: 0.9,
    evidence: event.occurrence_ids,
    created_by_derivation_id: null,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.assignment,
  };
  ctx.store.putAssignment(assignment);

  // Sensitivity: raise to the project default unless the event is already more
  // sensitive (Escalate-only; secret is never lowered). unknown → default is a
  // Declassify authorized by the explicit project policy.
  const target = pc.defaultSensitivity;
  let nextSensitivity = event.sensitivity;
  let nextState = event.sensitivity_classification_state;
  if (event.sensitivity === 'unknown') {
    nextSensitivity = target;
    nextState = 'inferred'; // authorized by project policy
  } else {
    // never lower; keep the max (Escalate-only direction)
    nextSensitivity = maxSensitivity(event.sensitivity, target);
  }
  if (nextSensitivity !== event.sensitivity || nextState !== event.sensitivity_classification_state) {
    const updated: MemEvent = {
      ...event,
      sensitivity: nextSensitivity,
      sensitivity_classification_state: nextState,
    };
    ctx.store.putEvent(updated);
  }

  ctx.chronicler.append('classify', event.event_id, now);
  return assignment;
}
