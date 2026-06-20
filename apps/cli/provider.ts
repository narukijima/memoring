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

  const egressEnv = process.env.MEMORING_LLM_EGRESS;
  const backend = new OpenAiCompatibleBackend({
    baseURL,
    model,
    apiKey: process.env.MEMORING_LLM_API_KEY,
    egress: egressEnv === 'local' ? 'local' : egressEnv === 'remote' ? 'remote' : undefined,
    id: process.env.MEMORING_LLM_ID,
  });
  const provider = new LlmMemoryProvider(backend);
  log.info('provider:llm', { id: provider.id, egress: provider.egress });
  return provider;
}
