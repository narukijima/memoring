// Resolve the memory provider from environment (CLI-side configuration; provider
// choice never enters core). Default is the deterministic RuleBasedProvider
// (Mode A). When MEMORING_LLM_BASE_URL is set, build an OpenAI-compatible LLM
// provider (Mode B local / Mode C remote) — one adapter covers OpenAI, DeepSeek,
// and a local Ollama endpoint. The API key comes from env and is never persisted
// in realm config. A remote provider's raw-text egress is gated upstream
// (extractor.ts pre-egress gate); see docs/adr/0002.
import { RuleBasedProvider, type MemoryProvider } from '@claim/provider';
import { LlmMemoryProvider } from '@claim/llm-provider';
import { OpenAiCompatibleBackend } from '@integrations/llm/openai-compatible';
import { log } from '@core/log';

export function resolveProvider(): MemoryProvider {
  const baseURL = process.env.MEMORING_LLM_BASE_URL;
  if (!baseURL) return new RuleBasedProvider();

  const model = process.env.MEMORING_LLM_MODEL;
  if (!model) {
    log.warn('provider:llm_missing_model', { hint: 'set MEMORING_LLM_MODEL' });
    return new RuleBasedProvider();
  }

  const proxy = isTruthy(process.env.MEMORING_LLM_PROXY);
  let egress: 'local' | 'remote' | undefined =
    process.env.MEMORING_LLM_EGRESS === 'local'
      ? 'local'
      : process.env.MEMORING_LLM_EGRESS === 'remote'
        ? 'remote'
        : undefined;

  if (proxy) {
    warnSubscriptionProxy();
    // A subscription-bridging proxy forwards raw Event text OFF the device, so it
    // is `remote` egress even on a loopback URL. Default to remote so the
    // pre-egress gate (extractor.ts) stays engaged; the loopback→local heuristic
    // would otherwise be a silent bypass. An explicit MEMORING_LLM_EGRESS=local
    // here tells the gate the data stays on-device when it does not — allow, but
    // flag it loudly.
    if (egress === undefined) egress = 'remote';
    else if (egress === 'local') {
      console.error(
        '  [warn] MEMORING_LLM_EGRESS=local with a forwarding proxy bypasses the pre-egress gate — raw text still leaves the device.',
      );
    }
  }

  const backend = new OpenAiCompatibleBackend({
    baseURL,
    model,
    apiKey: process.env.MEMORING_LLM_API_KEY,
    egress,
    id: process.env.MEMORING_LLM_ID,
  });
  const provider = new LlmMemoryProvider(backend);
  log.info('provider:llm', { id: provider.id, egress: provider.egress, proxy });
  return provider;
}

function isTruthy(v: string | undefined): boolean {
  return v === '1' || v?.toLowerCase() === 'true' || v?.toLowerCase() === 'yes';
}

/** Loud, unmissable notice for the unsupported subscription-bridging proxy path. */
function warnSubscriptionProxy(): void {
  const lines = [
    'MEMORING_LLM_PROXY is set — routing through a first-party subscription proxy (e.g. a local',
    'bridge to a Claude Code / Codex / ChatGPT session). This is UNSUPPORTED and HIGH RISK:',
    "  - It likely violates the provider's Terms of Service and can get your subscription account",
    '    rate-limited, suspended, or banned.',
    '  - The bridge is undocumented and fragile; it can break without notice.',
    '  - Egress is treated as REMOTE (the pre-egress gate stays on) because your raw history still',
    '    leaves this device via the proxy. Do NOT set MEMORING_LLM_EGRESS=local here.',
    'For a keyless, no-cost, fully on-device path with none of these risks, run a local model',
    '(e.g. Ollama) and point MEMORING_LLM_BASE_URL at its loopback endpoint WITHOUT MEMORING_LLM_PROXY.',
  ];
  for (const l of lines) console.error(`  [warn] ${l}`);
  log.warn('provider:subscription_proxy', { unsupported: true, risk: 'tos_account_egress' });
}
