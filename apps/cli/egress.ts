// Shared egress helpers — the single source of truth for the remote-default-OFF gate's
// building blocks, so the loop-layer resolver (provider.ts) and the output-layer
// resolver (output-provider.ts) cannot drift on safety-adjacent logic. The gate itself
// (effectiveEgress === 'remote' && !opt-in) stays inline in each resolver — they
// intentionally differ downstream (rule-based fallback vs null) — but the primitives it
// is built from live here once.
import { isLoopback } from '@integrations/llm/openai-compatible';
import type { Audience } from '@core/schema/enums';
import type { RealmLlmConfig } from '@core/realm';

/** Truthy env flag: only '1' / 'true' / 'yes' enable; anything else (incl. unset) is
 *  false, so the remote-default-OFF gate fails closed on an empty MEMORING_LLM_*. */
export function isTruthy(v: string | undefined): boolean {
  return v === '1' || v?.toLowerCase() === 'true' || v?.toLowerCase() === 'yes';
}

/** Realm-local egress default for a config-supplied base URL (env URL → no opinion, so
 *  the env path keeps full control). Mirrors how both resolvers read realm.toml. */
export function configEgressForBaseUrl(
  baseURL: string,
  baseUrlFromEnv: string | undefined,
  config: RealmLlmConfig | undefined,
): 'local' | 'remote' | undefined {
  if (baseUrlFromEnv !== undefined) return undefined;
  if (config?.egress === 'remote') return 'remote';
  if (config?.egress === 'local' && isLoopback(baseURL)) return 'local';
  return undefined;
}

/** The retrieval audience for a given output-egress posture: a remote renderer elevates
 *  to `remote_ai_processing` (which the Gate treats more strictly than local `ai_tool`),
 *  so off-device prose only ever sees the tighter scope/sensitivity floor (ADR-0011 §5a). */
export function searchAudienceFor(egress: 'local' | 'remote'): Audience {
  return egress === 'remote' ? 'remote_ai_processing' : 'ai_tool';
}
