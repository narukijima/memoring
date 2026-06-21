import { afterEach, describe, expect, it } from 'vitest';
import { resolveProvider } from '../apps/cli/provider';
import { RuleBasedProvider } from '@claim/provider';
import { LlmMemoryProvider } from '@claim/llm-provider';

const LLM_ENV = [
  'MEMORING_LLM_BASE_URL',
  'MEMORING_LLM_MODEL',
  'MEMORING_LLM_API_KEY',
  'MEMORING_LLM_EGRESS',
  'MEMORING_LLM_ID',
  'MEMORING_LLM_PROXY',
  'MEMORING_LLM_REMOTE_OPT_IN',
];
function clearLlmEnv(): void {
  for (const k of LLM_ENV) delete process.env[k];
}
afterEach(clearLlmEnv);

describe('resolveProvider (env-driven provider selection)', () => {
  it('defaults to the deterministic rule-based provider when no LLM env is set', () => {
    clearLlmEnv();
    expect(resolveProvider()).toBeInstanceOf(RuleBasedProvider);
  });

  it('builds a remote LLM provider for a cloud endpoint ONLY with an explicit opt-in', () => {
    clearLlmEnv();
    process.env.MEMORING_LLM_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_LLM_MODEL = 'deepseek-chat';
    process.env.MEMORING_LLM_REMOTE_OPT_IN = '1'; // §7.3 remote-ai-default-off
    const p = resolveProvider();
    expect(p).toBeInstanceOf(LlmMemoryProvider);
    expect(p.egress).toBe('remote'); // off-device → pre-egress gate applies
    expect(p.id).toBe('llm:openai_compatible:deepseek-chat');
  });

  it('refuses remote egress without the opt-in (default-off), falling back to rule-based', () => {
    clearLlmEnv();
    process.env.MEMORING_LLM_BASE_URL = 'https://api.deepseek.com/v1';
    process.env.MEMORING_LLM_MODEL = 'deepseek-chat';
    // No MEMORING_LLM_REMOTE_OPT_IN → off-device egress is denied by default.
    expect(resolveProvider()).toBeInstanceOf(RuleBasedProvider);
  });

  it('infers local egress (gate-exempt) for a loopback Ollama endpoint', () => {
    clearLlmEnv();
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.MEMORING_LLM_MODEL = 'qwen2.5:3b';
    expect(resolveProvider().egress).toBe('local');
  });

  it('falls back to rule-based (never a half-configured LLM) when the model is missing', () => {
    clearLlmEnv();
    process.env.MEMORING_LLM_BASE_URL = 'https://api.deepseek.com/v1';
    expect(resolveProvider()).toBeInstanceOf(RuleBasedProvider);
  });

  it('forces remote egress for a subscription-bridging proxy, even on a loopback URL', () => {
    // The bridge forwards raw text off-device, so the loopback→local heuristic
    // must NOT silently exempt it from the pre-egress gate — and, being remote, it
    // is also subject to the default-off opt-in.
    clearLlmEnv();
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:8787/v1';
    process.env.MEMORING_LLM_MODEL = 'claude-via-proxy';
    process.env.MEMORING_LLM_PROXY = '1';
    process.env.MEMORING_LLM_REMOTE_OPT_IN = '1';
    const p = resolveProvider();
    expect(p).toBeInstanceOf(LlmMemoryProvider);
    expect(p.egress).toBe('remote'); // gate stays engaged despite the loopback host
  });

  it('a proxy without the remote opt-in is refused (default-off), falling back to rule-based', () => {
    clearLlmEnv();
    process.env.MEMORING_LLM_BASE_URL = 'http://127.0.0.1:8787/v1';
    process.env.MEMORING_LLM_MODEL = 'claude-via-proxy';
    process.env.MEMORING_LLM_PROXY = '1';
    expect(resolveProvider()).toBeInstanceOf(RuleBasedProvider);
  });
});
