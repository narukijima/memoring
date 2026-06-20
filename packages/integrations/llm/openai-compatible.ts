// OpenAI-compatible chat-completions backend. One adapter covers OpenAI,
// DeepSeek, and any OpenAI-API server — including a local Ollama / llama.cpp
// endpoint — so "major cloud providers + others + local" need only this plus the
// Anthropic and Gemini adapters. Vendor wire format only; no provider/core logic.
//
// `egress` defaults to 'remote' unless the baseURL is a loopback host: local
// inference never leaves the device, so it inherits the on-device trust envelope
// and is exempt from the pre-egress gate. The API key is passed in by the caller
// (pulled from env / OS keychain) and is NEVER persisted in realm config.
import type { LlmBackend } from '@claim/llm-provider';

export interface OpenAiCompatibleOptions {
  /** e.g. https://api.openai.com/v1 · https://api.deepseek.com/v1 · http://127.0.0.1:11434/v1 */
  baseURL: string;
  model: string;
  apiKey?: string;
  /** Override the loopback-based egress inference (e.g. a remote host on a LAN). */
  egress?: 'local' | 'remote';
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Display id (e.g. 'openai', 'deepseek'); defaults to 'openai_compatible'. */
  id?: string;
  /** Per-request timeout (ms), default 120000. A hung call fails fast so the
   *  caller's batch-level catch can skip it and continue. */
  timeoutMs?: number;
}

function isLoopback(baseURL: string): boolean {
  try {
    const h = new URL(baseURL).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenAiCompatibleBackend implements LlmBackend {
  readonly id: string;
  readonly model: string;
  readonly egress: 'local' | 'remote';
  private readonly baseURL: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OpenAiCompatibleOptions) {
    this.baseURL = opts.baseURL.replace(/\/+$/, '');
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.egress = opts.egress ?? (isLoopback(opts.baseURL) ? 'local' : 'remote');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.id = opts.id ?? 'openai_compatible';
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async complete(prompt: string): Promise<string> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0, // deterministic extraction; pin output for reproducibility
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        throw new Error(`LLM backend ${this.id} returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as ChatCompletionResponse;
      return data.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }
}
