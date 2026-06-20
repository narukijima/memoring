// lifecycle — reinforcement (bounded scalar 0..1, §4.8 / §10.2) and supersede
// ordering (capture order / Chronicle.sequence, never source timestamps, §4.16).
import { REINFORCEMENT_RECIPE } from '@core/recipe';
import type { Claim } from '@core/schema/entities';

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

const saturate = (n: number): number => n / (n + REINFORCEMENT_RECIPE.k);

export interface ReinforcementSignals {
  current: number;
  valid_recall_count: number; // external re-confirmation only; context.md inclusion NOT counted
  user_pin: 0 | 1;
  independent_evidence_count: number;
  correction_count: number;
  conflict_count: number;
  age_decay: number;
}

/** R_next = clamp01(αR + βsat(recall) + γpin + δsat(indep) − εcorr − ζconf − λage). */
export function reinforcement(s: ReinforcementSignals): number {
  const { alpha, beta, gamma, delta, epsilon, zeta, lambda } = REINFORCEMENT_RECIPE;
  return clamp01(
    alpha * s.current +
      beta * saturate(s.valid_recall_count) +
      gamma * s.user_pin +
      delta * saturate(s.independent_evidence_count) -
      epsilon * s.correction_count -
      zeta * s.conflict_count -
      lambda * s.age_decay,
  );
}

/** Reinforcement at first consolidation (no recalls / corrections / conflicts yet). */
export function initialReinforcement(claim: Claim): number {
  return reinforcement({
    current: claim.reinforcement_score,
    valid_recall_count: 0,
    user_pin: 0,
    independent_evidence_count: claim.evidence_count,
    correction_count: 0,
    conflict_count: 0,
    age_decay: 0,
  });
}
