import { isLoopback } from './openai-compatible';
import type { RealmLlmConfig } from '@core/realm';

export type ModelRole = 'loop' | 'output';

export interface ModelStatus {
  role: ModelRole;
  label: string;
  configured: boolean;
  baseURL?: string;
  model?: string;
  baseSource: string;
  modelSource: string;
  config?: RealmLlmConfig;
  egress?: 'local' | 'remote';
  egressSource: string;
  loopback: boolean;
  remoteOptIn: boolean;
  proxy: boolean;
  usable: boolean;
  issue?: string;
}

export interface EndpointModelsResult {
  queried: boolean;
  models: string[];
  error?: string;
  skippedReason?: 'not_loopback' | 'proxy_remote';
}

export function truthyEnv(v: string | undefined): boolean {
  return v === '1' || v?.toLowerCase() === 'true' || v?.toLowerCase() === 'yes';
}

export function resolveModelStatus(role: ModelRole, config?: RealmLlmConfig): ModelStatus {
  if (role === 'loop') return resolveLoopStatus(config);
  return resolveOutputStatus(config);
}

export async function fetchLoopbackModels(
  baseURL: string | undefined,
  opts: { fetchImpl?: typeof fetch; apiKey?: string; timeoutMs?: number } = {},
): Promise<EndpointModelsResult> {
  if (!baseURL || !isLoopback(baseURL)) return { queried: false, models: [], skippedReason: 'not_loopback' };
  if (truthyEnv(process.env.MEMORING_LLM_PROXY)) {
    return { queried: false, models: [], skippedReason: 'proxy_remote' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 1500);
  try {
    const headers: Record<string, string> = {};
    if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
    const r = await (opts.fetchImpl ?? fetch)(baseURL.replace(/\/+$/, '') + '/models', {
      headers,
      signal: controller.signal,
    });
    if (!r.ok) return { queried: true, models: [], error: `HTTP ${r.status}` };
    const body = (await r.json()) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(body.data)) return { queried: true, models: [], error: 'invalid response' };
    return {
      queried: true,
      models: body.data
        .map((m) => (typeof m.id === 'string' ? m.id : ''))
        .filter((id): id is string => id.length > 0)
        .sort((a, b) => a.localeCompare(b)),
    };
  } catch (e) {
    return { queried: true, models: [], error: (e as Error).name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

function resolveLoopStatus(config?: RealmLlmConfig): ModelStatus {
  const baseFromEnv = process.env.MEMORING_LLM_BASE_URL;
  const modelFromEnv = process.env.MEMORING_LLM_MODEL;
  const baseURL = baseFromEnv ?? config?.base_url;
  const model = modelFromEnv ?? config?.model;
  return finishStatus({
    role: 'loop',
    label: 'loop/classifier',
    baseURL,
    model,
    baseSource: baseFromEnv !== undefined ? 'MEMORING_LLM_BASE_URL' : config?.base_url ? 'realm.toml [llm]' : 'unset',
    modelSource: modelFromEnv !== undefined ? 'MEMORING_LLM_MODEL' : config?.model ? 'realm.toml [llm]' : 'unset',
    egressEnv: process.env.MEMORING_LLM_EGRESS,
    egressEnvSource: 'MEMORING_LLM_EGRESS',
    baseFromEnv,
    config,
  });
}

function resolveOutputStatus(config?: RealmLlmConfig): ModelStatus {
  const askBase = process.env.MEMORING_ASK_BASE_URL;
  const loopBase = process.env.MEMORING_LLM_BASE_URL;
  const askModel = process.env.MEMORING_ASK_MODEL;
  const loopModel = process.env.MEMORING_LLM_MODEL;
  const baseURL = askBase ?? loopBase ?? config?.base_url;
  const model = askModel ?? loopModel ?? config?.model;
  const askEgress = process.env.MEMORING_ASK_EGRESS;
  const loopEgress = process.env.MEMORING_LLM_EGRESS;
  return finishStatus({
    role: 'output',
    label: 'ask/chat/output',
    baseURL,
    model,
    baseSource:
      askBase !== undefined
        ? 'MEMORING_ASK_BASE_URL'
        : loopBase !== undefined
          ? 'MEMORING_LLM_BASE_URL'
          : config?.base_url
            ? 'realm.toml [llm]'
            : 'unset',
    modelSource:
      askModel !== undefined
        ? 'MEMORING_ASK_MODEL'
        : loopModel !== undefined
          ? 'MEMORING_LLM_MODEL'
          : config?.model
            ? 'realm.toml [llm]'
            : 'unset',
    egressEnv: askEgress ?? loopEgress,
    egressEnvSource: askEgress !== undefined ? 'MEMORING_ASK_EGRESS' : loopEgress !== undefined ? 'MEMORING_LLM_EGRESS' : undefined,
    baseFromEnv: askBase ?? loopBase,
    config,
  });
}

function finishStatus(opts: {
  role: ModelRole;
  label: string;
  baseURL?: string;
  model?: string;
  baseSource: string;
  modelSource: string;
  egressEnv?: string;
  egressEnvSource?: string;
  baseFromEnv?: string;
  config?: RealmLlmConfig;
}): ModelStatus {
  const proxy = truthyEnv(process.env.MEMORING_LLM_PROXY);
  let egress: 'local' | 'remote' | undefined =
    opts.egressEnv === 'local' ? 'local' : opts.egressEnv === 'remote' ? 'remote' : undefined;
  let egressSource = egress ? (opts.egressEnvSource ?? 'env') : 'auto';
  if (!egress && opts.baseFromEnv === undefined && opts.config?.egress === 'remote') {
    egress = 'remote';
    egressSource = 'realm.toml [llm].egress';
  } else if (!egress && opts.baseFromEnv === undefined && opts.config?.egress === 'local' && opts.baseURL && isLoopback(opts.baseURL)) {
    egress = 'local';
    egressSource = 'realm.toml [llm].egress';
  }
  if (proxy) {
    egress = 'remote';
    egressSource = 'MEMORING_LLM_PROXY';
  }
  const loopback = Boolean(opts.baseURL && isLoopback(opts.baseURL));
  const effective = egress ?? (opts.baseURL ? (loopback ? 'local' : 'remote') : undefined);
  const configured = Boolean(opts.baseURL && opts.model);
  const remoteOptIn = truthyEnv(process.env.MEMORING_LLM_REMOTE_OPT_IN);
  const issue =
    !opts.baseURL
      ? 'base_url unset'
      : !opts.model
        ? 'model unset'
        : effective === 'remote' && !remoteOptIn
          ? 'remote default-off'
          : undefined;
  return {
    role: opts.role,
    label: opts.label,
    configured,
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    baseSource: opts.baseSource,
    modelSource: opts.modelSource,
    ...(opts.config ? { config: opts.config } : {}),
    ...(effective ? { egress: effective } : {}),
    egressSource,
    loopback,
    remoteOptIn,
    proxy,
    usable: configured && !(effective === 'remote' && !remoteOptIn),
    ...(issue ? { issue } : {}),
  };
}
