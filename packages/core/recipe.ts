// Recipe — versioned tunables (Detailed Design §10). These are NUMBERS, not
// invariants: they may change under version management but must never break a
// structural invariant (CON-016/017). Safety floors/ceilings can only move
// toward the safe side.
import type { ClaimKind } from './schema/enums';

export interface RecipeMeta {
  recipe_id: string;
  recipe_version: string;
  owner: string;
  reason: string;
}

export const CONSOLIDATION_RECIPE = {
  meta: {
    recipe_id: 'recipe_consolidation_v1',
    recipe_version: '1',
    owner: 'memoring',
    reason: 'initial values (Detailed Design §10.1)',
  } as RecipeMeta,
  tau_conf: {
    default: 0.8,
    preference: 0.8,
    decision: 0.85,
    ai_inferred_pattern: 0.85,
  },
  min_evidence_count: {
    default: 2,
    explicit_user_statement: 1,
    user_pinned: 1,
    constraint: 1,
    explicit_decision: 1,
    ai_inferred_pattern: 2,
  },
} as const;

type ThresholdKey = { tau: keyof typeof CONSOLIDATION_RECIPE.tau_conf; min: keyof typeof CONSOLIDATION_RECIPE.min_evidence_count };

/** Deterministic (kind, mode) → threshold-key lookup (Detailed Design §10.1). */
export function thresholdKey(kind: ClaimKind, mode: 'explicit' | 'inferred', userPinned = false): ThresholdKey {
  if (userPinned) return { tau: 'default', min: 'user_pinned' };
  if (mode === 'inferred') return { tau: 'ai_inferred_pattern', min: 'ai_inferred_pattern' };
  switch (kind) {
    case 'preference':
      return { tau: 'preference', min: 'explicit_user_statement' };
    case 'constraint':
      return { tau: 'default', min: 'constraint' };
    case 'decision':
      return { tau: 'decision', min: 'explicit_decision' };
    case 'fact':
    case 'project_context':
      return { tau: 'default', min: 'explicit_user_statement' };
    case 'procedure':
      return { tau: 'default', min: 'default' };
    default:
      return { tau: 'default', min: 'default' };
  }
}

export function tauConf(key: ThresholdKey): number {
  return CONSOLIDATION_RECIPE.tau_conf[key.tau];
}
export function minEvidenceCount(key: ThresholdKey): number {
  return CONSOLIDATION_RECIPE.min_evidence_count[key.min];
}

export const REINFORCEMENT_RECIPE = {
  meta: {
    recipe_id: 'recipe_reinforcement_v1',
    recipe_version: '1',
    owner: 'memoring',
    reason: 'initial values (Detailed Design §10.2)',
  } as RecipeMeta,
  alpha: 0.7,
  beta: 0.08,
  gamma: 0.2,
  delta: 0.06,
  epsilon: 0.15,
  zeta: 0.25,
  lambda: 0.05,
  k: 5,
} as const;

// The weighted-ranking model (RANKING_RECIPE: relevance/penalty weights + floors,
// Detailed Design §10.3) is NOT used in v0 — context.md ranks by reinforcement then
// recency (context-pack.ts), and v0 emits no raw excerpts, so the raw_excerpt_share
// ceiling has nothing to gate. It was dead code (imported nowhere). Per YAGNI it is
// removed here, not wired speculatively; v0.1 reintroduces it together with its
// consumer (weighted recall / raw-excerpt emission) under CON-017. The §3.6/§3.7
// "constraints/scope not pushed out" guarantee is enforced concretely by the token
// budget allocation in context-pack.ts (allocateSectionCaps).

export type ContextPurpose = 'coding_agent_session_start' | 'large_chat_session' | 'deep_research_context';

export const TOKEN_BUDGET_RECIPE = {
  meta: {
    recipe_id: 'recipe_context_budget_v1',
    recipe_version: '1',
    owner: 'memoring',
    reason: 'initial values (Detailed Design §10.4)',
  } as RecipeMeta,
  budgets: {
    coding_agent_session_start: 8000,
    large_chat_session: 16000,
    deep_research_context: 32000,
  } as Record<ContextPurpose, number>,
  /** Max claims rendered per context.md section (top-ranked kept; rest omitted
   *  with a count). A density ceiling so a rich corpus stays a usable primer —
   *  a versioned tunable (CON-016/017), raise it for a fuller dump. */
  max_items_per_section: 15,
  allocation: {
    safety_header_scope: 0.1,
    constraints: 0.15,
    project_facts: 0.2,
    consolidated_memories: 0.2,
    recent_decisions_tasks: 0.2,
    evidence_map: 0.1,
    undiluted_excerpts: 0.05,
  },
} as const;

export const PRUNE_RECIPE = {
  meta: {
    recipe_id: 'recipe_prune_v1',
    recipe_version: '1',
    owner: 'memoring',
    reason: 'initial values (Detailed Design §10.5)',
  } as RecipeMeta,
  merge_suggest_threshold: { embedding: 0.88, string: 0.92 },
  suggest_max_per_init: 20,
} as const;
