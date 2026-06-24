// Resolve the OUTPUT-layer LLM provider (ADR-0011): the natural-language renderer
// that sits strictly DOWNSTREAM of the Gate and only ever phrases post-Gate,
// secret-free, in-scope excerpts. This is a distinct role from the loop-layer
// `abstract()` provider (apps/cli/provider.ts, ADR-0002); it does NOT share or
// overload the MemoryProvider interface (interface freeze; ADR-0011 §6).
//
// Egress posture mirrors the loop layer (ADR-0003): LOCAL by default — a loopback
// endpoint (e.g. Ollama) needs no opt-in — and REMOTE stays default-OFF behind the
// same MEMORING_LLM_REMOTE_OPT_IN gate. The remote disclosure is CALIBRATED to this
// layer (what leaves is gated, secret-free excerpts, never raw history) and
// recommends a local model. Unlike the loop, there is NO rule-based fallback: a
// renderer cannot fabricate prose, so an unusable configuration returns null and the
// caller prints actionable guidance.
//
// Per-role config (ADR-0011 §6): the output role reads its own MEMORING_ASK_*
// namespace (BASE_URL / MODEL / API_KEY / EGRESS), falling back PER-VARIABLE to the
// loop's MEMORING_LLM_* and then Realm-local LLM config when unset, so ask/chat
// can use a different model than the loop MemoryProvider. The remote opt-in gate
// is SHARED and unchanged (MEMORING_LLM_REMOTE_OPT_IN); this split moves NO
// egress default.
import { OpenAiCompatibleBackend, isLoopback } from '@integrations/llm/openai-compatible';
import type { LlmBackend } from '@claim/llm-provider';
import { log } from '@core/log';
import type { RealmLlmConfig } from '@core/realm';

/** Output-layer role: turn a grounding prompt into prose. Distinct from
 *  MemoryProvider (which only `abstract()`s); never overloads it (ADR-0011 §6). */
export interface OutputProvider {
  id: string;
  egress: 'local' | 'remote';
  generate(prompt: string): Promise<string>;
}

/** Wraps an LlmBackend's chat/completion call as the output role's generate(). */
export class LlmOutputProvider implements OutputProvider {
  readonly id: string;
  readonly egress: 'local' | 'remote';

  constructor(private readonly backend: LlmBackend) {
    this.id = `output:${backend.id}:${backend.model}`;
    this.egress = backend.egress;
  }

  generate(prompt: string): Promise<string> {
    return this.backend.complete(prompt);
  }
}

/**
 * Resolve the output provider from MEMORING_LLM_* env, mirroring resolveProvider()'s
 * egress determination (isLoopback, the same remote-opt-in gate, and proxy handling).
 * Returns null — after printing actionable guidance — when no usable model is
 * configured or a remote model is refused for lack of opt-in. The renderer never
 * falls back to a non-generative provider (no fabricated prose; ADR-0011 §5/§6).
 */
export function resolveOutputProvider(config?: RealmLlmConfig): OutputProvider | null {
  // Per-role override with per-variable fallback to the loop's MEMORING_LLM_* (§6).
  const baseUrlFromEnv = process.env.MEMORING_ASK_BASE_URL ?? process.env.MEMORING_LLM_BASE_URL;
  const baseURL = baseUrlFromEnv ?? config?.base_url;
  const model = process.env.MEMORING_ASK_MODEL ?? process.env.MEMORING_LLM_MODEL ?? config?.model;
  if (!baseURL || !model) {
    warnNoOutputModel();
    return null;
  }

  const egressEnv =
    process.env.MEMORING_ASK_EGRESS ??
    process.env.MEMORING_LLM_EGRESS ??
    configEgressForBaseUrl(baseURL, baseUrlFromEnv, config);
  let egress: 'local' | 'remote' | undefined =
    egressEnv === 'local' ? 'local' : egressEnv === 'remote' ? 'remote' : undefined;

  if (isTruthy(process.env.MEMORING_LLM_PROXY)) {
    // A subscription-bridging proxy forwards text OFF the device, so it is `remote`
    // even on a loopback URL (mirrors resolveProvider) — force remote so the
    // default-off gate engages instead of a silent loopback→local bypass.
    warnOutputProxy();
    egress = 'remote';
  }

  // Resolve the effective egress the SAME way the backend would, so the default-off
  // gate also covers a cloud URL with no explicit MEMORING_LLM_EGRESS.
  const effectiveEgress: 'local' | 'remote' = egress ?? (isLoopback(baseURL) ? 'local' : 'remote');
  if (effectiveEgress === 'remote' && !isTruthy(process.env.MEMORING_LLM_REMOTE_OPT_IN)) {
    warnOutputRemoteDefaultOff();
    return null;
  }

  const backend = new OpenAiCompatibleBackend({
    baseURL,
    model,
    apiKey: process.env.MEMORING_ASK_API_KEY ?? process.env.MEMORING_LLM_API_KEY,
    egress: effectiveEgress,
    id: process.env.MEMORING_LLM_ID,
  });
  const provider = new LlmOutputProvider(backend);
  log.info('ask:output_provider', { id: provider.id, egress: provider.egress });
  return provider;
}

function configEgressForBaseUrl(
  baseURL: string,
  baseUrlFromEnv: string | undefined,
  config: RealmLlmConfig | undefined,
): 'local' | 'remote' | undefined {
  if (baseUrlFromEnv !== undefined) return undefined;
  if (config?.egress === 'remote') return 'remote';
  if (config?.egress === 'local' && isLoopback(baseURL)) return 'local';
  return undefined;
}

function isTruthy(v: string | undefined): boolean {
  return v === '1' || v?.toLowerCase() === 'true' || v?.toLowerCase() === 'yes';
}

/** No usable output model. `memoring ask` cannot fabricate prose, so guide the owner
 *  to a model — recommending a keyless, on-device local endpoint. */
function warnNoOutputModel(): void {
  const lines = [
    '`memoring ask` / `memoring chat` need a generative model and will not fabricate an answer without one.',
    'Set MEMORING_LLM_BASE_URL and MEMORING_LLM_MODEL to a model (or the per-role MEMORING_ASK_BASE_URL /',
    'MEMORING_ASK_MODEL to use a different model than the loop). For a keyless, on-device path, run a local',
    'model (e.g. Ollama) and point the base URL at its loopback endpoint:',
    '    MEMORING_LLM_BASE_URL=http://127.0.0.1:11434/v1  MEMORING_LLM_MODEL=qwen2.5:3b',
  ];
  for (const l of lines) console.error(`  [warn] ${l}`);
  log.warn('ask:no_output_model', {});
}

/** Remote AI is default-off (§7.3). Refuse off-device output egress unless the owner
 *  opted in. CALIBRATED to the output layer: what would leave is gated, secret-free,
 *  in-scope excerpts (NOT raw history like the loop) — a milder, clear disclosure. */
function warnOutputRemoteDefaultOff(): void {
  const lines = [
    'A REMOTE (off-device) output model is configured, but remote AI is default-OFF (§7.3).',
    '`memoring ask` would send GATED, secret-free, in-scope excerpts (never raw history) to a',
    'third party. They will NOT be sent until you explicitly opt in:',
    '    set MEMORING_LLM_REMOTE_OPT_IN=1',
    'Recommended: run a LOCAL model (e.g. Ollama on a loopback URL) — keyless, on-device, no opt-in.',
  ];
  for (const l of lines) console.error(`  [warn] ${l}`);
  log.warn('ask:remote_default_off', { opted_in: false });
}

/** Concise notice for the unsupported subscription-bridging proxy on the output path.
 *  The loop layer (provider.ts) owns the full raw-history warning, left untouched. */
function warnOutputProxy(): void {
  const lines = [
    'MEMORING_LLM_PROXY is set: `memoring ask` would route gated excerpts through an UNSUPPORTED',
    'subscription-bridging proxy (likely violates the provider ToS; fragile). Egress is treated as',
    'REMOTE. Prefer a local model (e.g. Ollama on a loopback URL) — keyless, on-device, no opt-in.',
  ];
  for (const l of lines) console.error(`  [warn] ${l}`);
  log.warn('ask:subscription_proxy', { unsupported: true });
}
