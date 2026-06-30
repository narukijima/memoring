// Local web control panel (ADR-0010). A localhost-only browser surface over the
// SAME core functions the CLI calls — no divergent business logic, no Gate bypass.
//
// Three independent layers gate EVERY request before routing (ADR-0010 §1):
//   1. Host allowlist (fail-closed)  — DNS-rebinding defense, ALL requests.
//   2. Origin allowlist (when present) — cross-site fetch defense, ALL requests.
//   3. Per-session capability token (constant-time) — required on EVERY /api/*
//      request (read AND write); GET / is token-exempt but still Host-checked.
//
// The token is the SOLE guard on the import-candidate plaintext surface (which has
// no Gate/audience filter), so that endpoint is dedicated and owner-only (§3).
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { basePath, replicaLayout } from '@core/paths';
import { readRealmConfig, writeRealmConfig } from '@core/realm';
import { fetchLoopbackModels, resolveModelStatus } from '@integrations/llm/model-config';
import {
  ensureLegacyRegistered,
  getCurrent,
  listRealms,
  type RealmRegistryEntry,
} from '@core/realm-registry';
import {
  isActiveRealmSilence,
  openActiveRealm,
  openResolvedRealm,
  type RealmContext,
} from '@core/runtime';
import { listMemoriesForView } from '@retrieval/browse';
import { indexClaim } from '@retrieval/search';
import { readClaimStatement } from '@claim/extractor';
import {
  deleteUndiluted,
  forgetByPattern,
  forgetClaim,
  redactEventById,
} from '@security/redaction';
import {
  ingestImport,
  listImportedCandidates,
  promoteImportedClaim,
  rejectImportedClaim,
  type DeclaredSensitivity,
} from '@intake/import-from-ai';
import { connectSources } from '@intake/connect-sources';
import { getConnector } from '@intake/registry';
import type { DetectedSource } from '@intake/types';
import { createRealm, deleteRealm, setActiveRealm, RealmActionError } from '../cli/realm-actions';
import { renderShell } from './shell';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const MEMORING_RING_SVG = fs.readFileSync(path.join(SERVER_DIR, 'assets', 'memoring-ring.svg'));
const MEMORING_RING_PNG = fs.readFileSync(path.join(SERVER_DIR, 'assets', 'memoring-ring.png'));

export const PANEL_HOST = '127.0.0.1';
export const PANEL_DEFAULT_PORT = 4319;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // import pastes can be large; bound memory.

export interface PanelOptions {
  /** Token required on every /api/* request. */
  token: string;
  /** Port the panel is (or will be) listening on — used by the Host/Origin gate. */
  port: number;
  /** Base replica root for the default view (MEMORING_HOME). undefined → ~/.memoring. */
  root?: string;
}

/** A routing error that maps to an HTTP status + machine code (no payload leak). */
class PanelError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'PanelError';
  }
}

// ── Security gate ──────────────────────────────────────────────────────────

function hostAllowed(host: string | undefined, port: number): boolean {
  // Fail-closed and unconditional: a rebound DNS name resolving to loopback
  // presents an attacker Host, so this must not depend on header presence.
  if (!host) return false;
  return host === `${PANEL_HOST}:${port}` || host === `localhost:${port}`;
}

function originAllowed(origin: string | undefined, port: number): boolean {
  // Absent Origin (simple / sub-resource / no-CORS) carries none — the token
  // carries the CSRF defense there. A present Origin must be exactly loopback.
  if (origin === undefined) return true;
  return origin === `http://${PANEL_HOST}:${port}` || origin === `http://localhost:${port}`;
}

/** Constant-time token compare; the token is fixed-length, so the length guard
 *  leaks nothing about the secret (timingSafeEqual requires equal lengths). */
function tokenValid(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function presentedToken(req: IncomingMessage): string | undefined {
  const raw = req.headers['x-memoring-token'];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

// ── Realm resolution (NEVER setCurrent — avoids the unlocked-setCurrent race) ─

function realmViews(base: string): Array<RealmRegistryEntry & { active: boolean; locked: boolean }> {
  ensureLegacyRegistered(base);
  const current = getCurrent(base);
  return listRealms(base).map((r) => ({
    ...r,
    active: current?.realm_id === r.realm_id,
    locked: r.key_mode === 'passphrase',
  }));
}

/**
 * Open the target Realm for a single request. View-switching passes an explicit
 * Realm id, which short-circuits before any CWD / `current`-pointer logic in
 * resolveActiveReplicaRoot (ADR-0006) — so NO setCurrent write happens. A
 * passphrase Realm opens only when a passphrase is supplied via the POST body
 * (Phase 2); the provider holds it for the unlock only and never persists/logs
 * it. A passphrase Realm with no passphrase resolves to a `realm_locked` 423.
 */
async function openRealmForRequest(
  opts: PanelOptions,
  realmId: string | undefined,
  passphrase: string | undefined,
): Promise<RealmContext> {
  const provider = async (): Promise<string> => {
    if (typeof passphrase === 'string' && passphrase.length > 0) return passphrase;
    throw new PanelError(423, 'realm_locked');
  };
  if (!realmId) {
    // Default view: the base replica (preserves the read-only server's behavior).
    return openActiveRealm(opts.root, provider);
  }
  const opened = await openResolvedRealm({ realm: realmId }, provider, 'recall');
  if (isActiveRealmSilence(opened)) throw new PanelError(404, 'realm_unresolved');
  return opened;
}

async function withRealmRead<T>(
  opts: PanelOptions,
  realmId: string | undefined,
  fn: (ctx: RealmContext) => T,
): Promise<T> {
  const ctx = await openRealmForRequest(opts, realmId, undefined);
  try {
    return fn(ctx);
  } finally {
    ctx.close(false);
  }
}

async function withRealmWrite<T>(
  opts: PanelOptions,
  realmId: string | undefined,
  passphrase: string | undefined,
  fn: (ctx: RealmContext) => T,
): Promise<T> {
  const ctx = await openRealmForRequest(opts, realmId, passphrase);
  let persist = false;
  try {
    const result = fn(ctx);
    persist = true; // the in-memory mutation only reaches disk on close(true).
    return result;
  } finally {
    ctx.close(persist);
  }
}

// Serialize mutating requests so two concurrent writes can never interleave a
// registry read-modify-write or a Realm DB flush ("set active for CLI" included).
let writeChain: Promise<unknown> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => undefined);
  return next;
}

// ── I/O helpers ──────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendShell(res: ServerResponse, nonce: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    // Bound the same-origin-XSS token-theft path the candidate/import render
    // introduces: only the nonce'd bootstrap script may run (the Origin check
    // does NOT stop same-origin XSS). Inline styles stay allowed (no script risk).
    'content-security-policy':
      "default-src 'self'; " +
      `script-src 'nonce-${nonce}'; ` +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(renderShell(nonce));
}

function sendSvg(res: ServerResponse, body: Buffer): void {
  res.writeHead(200, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendPng(res: ServerResponse, body: Buffer): void {
  res.writeHead(200, {
    'content-type': 'image/png',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new PanelError(413, 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim().length === 0) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
      } catch {
        reject(new PanelError(400, 'invalid_json'));
      }
    });
    req.on('error', () => reject(new PanelError(400, 'bad_request')));
  });
}

function str(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function declared(value: unknown): DeclaredSensitivity | undefined {
  return value === 'public' || value === 'internal' || value === 'confidential' ? value : undefined;
}

// ── Read routes ──────────────────────────────────────────────────────────────

async function handleRealms(res: ServerResponse): Promise<void> {
  const base = basePath();
  const realms = realmViews(base).map((r) => ({
    realm_id: r.realm_id,
    name: r.name,
    key_mode: r.key_mode,
    active: r.active,
    locked: r.locked,
  }));
  sendJson(res, 200, realms);
}

async function handleScopes(res: ServerResponse, opts: PanelOptions, realmId: string | undefined): Promise<void> {
  const scopes = await withRealmRead(opts, realmId, (ctx) =>
    ctx.config.projects.map((project) => ({ project_id: project.project_id, name: project.name })),
  );
  sendJson(res, 200, scopes);
}

async function handleMemories(res: ServerResponse, opts: PanelOptions, url: URL): Promise<void> {
  const rows = await withRealmRead(opts, url.searchParams.get('realm') ?? undefined, (ctx) =>
    listMemoriesForView(ctx, {
      scope: url.searchParams.get('scope') ?? undefined,
      project: url.searchParams.get('project') ?? undefined,
    }),
  );
  sendJson(res, 200, rows);
}

/**
 * DEDICATED owner-only candidate review surface (ADR-0010 §3). Imported-candidate
 * plaintext has NO Gate/audience filter (import-from-ai.ts) — the token is its SOLE
 * guard. This MUST stay off the /api/memories (consolidated) pane and is never an
 * AI/MCP audience or remote egress. The egress test asserts a tokenless GET here
 * returns 401 and leaks no statement text.
 */
async function handleImportCandidates(res: ServerResponse, opts: PanelOptions, realmId: string | undefined): Promise<void> {
  const candidates = await withRealmRead(opts, realmId, (ctx) =>
    listImportedCandidates(ctx).map(({ claim, provenance }) => ({
      claim_id: claim.claim_id,
      kind: claim.kind,
      statement: readClaimStatement(ctx, claim),
      sensitivity: claim.sensitivity,
      provider: provenance?.provider ?? 'unknown',
      date: provenance?.date ?? null,
    })),
  );
  sendJson(res, 200, candidates);
}

async function handleConnectDetect(res: ServerResponse, url: URL): Promise<void> {
  const connector = getConnector(normalizeConnectorId(url.searchParams.get('connector')));
  if (!connector) throw new PanelError(404, 'unknown_connector');
  const detection = await connector.detect();
  sendJson(res, 200, {
    connector_id: detection.connector_id,
    notes: detection.notes,
    sources: detection.sources.map((s) => ({
      source_stable_id: s.source_stable_id,
      project_root: s.project_root,
      sensitivity_hint: s.sensitivity_hint,
      last_modified: s.last_modified,
    })),
  });
}

function normalizeConnectorId(raw: string | null): string {
  return (raw ?? 'claude-code').replace(/-/g, '_');
}

// ── LLM model config (mirrors `memoring config` on the SAME realm.toml) ───────

/** The active Realm's plaintext realm.toml — the SAME file the CLI `config`
 *  command edits, so a model picked in the panel is the model the CLI uses. No
 *  encrypted DB is opened: only non-secret provider coordinates live here. */
function activeRealmToml(opts: PanelOptions): string {
  return replicaLayout(opts.root).realmToml;
}

async function handleLlm(res: ServerResponse, opts: PanelOptions): Promise<void> {
  const llm = readRealmConfig(activeRealmToml(opts)).llm;
  const status = resolveModelStatus('output', llm);
  if (!llm) {
    sendJson(res, 200, {
      configured: false,
      model: null,
      base_url: null,
      egress: null,
      effective_egress: status.egress ?? null,
      loopback: false,
      models: [],
      model_source: status.modelSource,
      base_url_source: status.baseSource,
      remote_opt_in: status.remoteOptIn,
      usable: false,
      issue: status.issue ?? 'model unset',
    });
    return;
  }
  const modelResult = await fetchLoopbackModels(llm.base_url, { apiKey: process.env.MEMORING_LLM_API_KEY });
  const models = modelResult.models;
  // Always surface the configured model even if discovery returned nothing
  // (endpoint down, or a remote endpoint the panel does not query).
  const merged = models.includes(llm.model) ? models : [llm.model, ...models];
  sendJson(res, 200, {
    configured: true,
    model: llm.model,
    base_url: llm.base_url,
    egress: llm.egress ?? null,
    effective_egress: status.egress ?? null,
    loopback: status.loopback,
    model_source: status.modelSource,
    base_url_source: status.baseSource,
    remote_opt_in: status.remoteOptIn,
    usable: status.usable,
    issue: status.issue ?? null,
    models_query: modelResult.queried ? (modelResult.error ? 'error' : 'ok') : 'skipped',
    models_error: modelResult.error ?? null,
    models_skip_reason: modelResult.skippedReason ?? null,
    models: merged,
  });
}

async function handleLlmSetModel(res: ServerResponse, opts: PanelOptions, body: Record<string, unknown>): Promise<void> {
  const model = str(body, 'model');
  if (!model) throw new PanelError(400, 'model_required');
  const tomlPath = activeRealmToml(opts);
  const config = readRealmConfig(tomlPath);
  if (!config.llm) throw new PanelError(409, 'llm_not_configured');
  const models = await fetchLoopbackModels(config.llm.base_url, { apiKey: process.env.MEMORING_LLM_API_KEY });
  if (!models.queried) throw new PanelError(409, models.skippedReason === 'proxy_remote' ? 'llm_proxy_remote' : 'llm_not_loopback');
  if (models.error) throw new PanelError(409, 'llm_models_unavailable');
  if (!models.models.includes(model)) throw new PanelError(400, 'model_not_offered');
  // Switch ONLY among models returned by the already-configured loopback endpoint;
  // base_url/egress are preserved so the panel cannot change egress posture.
  config.llm = { ...config.llm, model };
  writeRealmConfig(tomlPath, config);
  sendJson(res, 200, { model });
}

// ── Write routes (Phase 2) ─────────────────────────────────────────────────

async function handleCreateRealm(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const name = str(body, 'name');
  if (!name) throw new PanelError(400, 'name_required');
  const usePassphrase = body.mode === 'passphrase';
  const passphrase = str(body, 'passphrase');
  if (usePassphrase && (!passphrase || passphrase.length < 8)) throw new PanelError(400, 'passphrase_too_short');
  try {
    const created = createRealm({ name, usePassphrase, passphrase });
    // The recovery code is returned ONCE to the owner over the token-gated channel
    // and is never logged or audited (audit stores ids/counts only, NFR-004).
    sendJson(res, 201, {
      realm_id: created.config.realm_id,
      name: created.config.name,
      root: created.layout.root,
      key_mode: created.keyMode,
      ...(created.recoveryCode ? { recovery_code: created.recoveryCode } : {}),
    });
  } catch (e) {
    if (e instanceof RealmActionError) throw new PanelError(409, 'realm_conflict');
    throw e;
  }
}

async function handleSetActiveRealm(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const realm = str(body, 'realm');
  if (!realm) throw new PanelError(400, 'realm_required');
  try {
    const entry = setActiveRealm(realm);
    sendJson(res, 200, { realm_id: entry.realm_id, name: entry.name });
  } catch {
    throw new PanelError(404, 'realm_not_found');
  }
}

async function handleDeleteRealm(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const realm = str(body, 'realm');
  if (!realm) throw new PanelError(400, 'realm_required');
  if (body.confirm !== true) throw new PanelError(400, 'confirm_required');
  try {
    const { removed, current } = deleteRealm(realm);
    sendJson(res, 200, {
      removed: removed.realm_id,
      current: current ? { realm_id: current.realm_id, name: current.name } : null,
    });
  } catch (e) {
    if (e instanceof RealmActionError) throw new PanelError(409, 'realm_protected');
    throw new PanelError(404, 'realm_not_found');
  }
}

async function handleConnect(res: ServerResponse, opts: PanelOptions, body: Record<string, unknown>): Promise<void> {
  const connector = getConnector(normalizeConnectorId(str(body, 'connector') ?? null));
  if (!connector) throw new PanelError(404, 'unknown_connector');
  const wanted = new Set(Array.isArray(body.sources) ? (body.sources as unknown[]).filter((s): s is string => typeof s === 'string') : []);
  if (wanted.size === 0) throw new PanelError(400, 'sources_required');
  const detection = await connector.detect();
  const selected: DetectedSource[] = detection.sources.filter((s) => wanted.has(s.source_stable_id));
  if (selected.length === 0) throw new PanelError(404, 'no_matching_sources');
  const result = await withRealmWrite(opts, str(body, 'realm'), str(body, 'passphrase'), (ctx) => {
    const r = connectSources(ctx, connector.id, selected, declared(body.default_sensitivity));
    ctx.flush();
    return r;
  });
  sendJson(res, 200, { connected: result.sources });
}

async function handleImport(res: ServerResponse, opts: PanelOptions, url: URL, body: Record<string, unknown>): Promise<void> {
  const text = str(body, 'text');
  if (!text) throw new PanelError(400, 'text_required');
  const result = await withRealmWrite(opts, url.searchParams.get('realm') ?? undefined, str(body, 'passphrase'), (ctx) =>
    ingestImport(ctx, Buffer.from(text, 'utf8'), {
      providerHint: str(body, 'provider'),
      defaultSensitivity: declared(body.default_sensitivity),
    }),
  );
  sendJson(res, 200, {
    provider: result.provider,
    events: result.events,
    candidates: result.candidates,
    deduped: result.deduped,
    quarantined: result.quarantined,
    secret_skipped: result.secretSkipped,
  });
}

async function handlePromote(res: ServerResponse, opts: PanelOptions, url: URL, body: Record<string, unknown>): Promise<void> {
  const claimId = str(body, 'claim_id');
  const scope = str(body, 'scope');
  if (!claimId || !scope) throw new PanelError(400, 'claim_and_scope_required');
  const outcome = await withRealmWrite(opts, url.searchParams.get('realm') ?? undefined, str(body, 'passphrase'), (ctx) => {
    const o = promoteImportedClaim(ctx, claimId, { scope, sensitivity: declared(body.sensitivity) });
    if (o.ok) indexClaim(ctx, o.claim); // now recallable under the chosen scope
    return o;
  });
  if (!outcome.ok) throw new PanelError(outcome.reason === 'sensitivity_required' ? 400 : 409, outcome.reason);
  sendJson(res, 200, { claim_id: outcome.claim.claim_id, sensitivity: outcome.claim.sensitivity });
}

async function handleReject(res: ServerResponse, opts: PanelOptions, url: URL, body: Record<string, unknown>): Promise<void> {
  const claimId = str(body, 'claim_id');
  if (!claimId) throw new PanelError(400, 'claim_required');
  const outcome = await withRealmWrite(opts, url.searchParams.get('realm') ?? undefined, str(body, 'passphrase'), (ctx) =>
    rejectImportedClaim(ctx, claimId),
  );
  if (!outcome.ok) throw new PanelError(409, outcome.reason);
  sendJson(res, 200, { claim_id: claimId, rejected: true });
}

async function handleForget(res: ServerResponse, opts: PanelOptions, url: URL, body: Record<string, unknown>): Promise<void> {
  if (body.confirm !== true) throw new PanelError(400, 'confirm_required');
  const pattern = str(body, 'pattern');
  const id = str(body, 'id');
  if (!pattern && !id) throw new PanelError(400, 'id_or_pattern_required');
  const result = await withRealmWrite(opts, url.searchParams.get('realm') ?? undefined, str(body, 'passphrase'), (ctx) => {
    if (pattern) return { kind: 'pattern' as const, count: forgetByPattern(ctx, pattern) };
    const target = id as string;
    let found = false;
    if (target.startsWith('clm_')) found = forgetClaim(ctx, target, { seal: true });
    else if (target.startsWith('evt_')) found = redactEventById(ctx, target, { seal: true });
    else if (target.startsWith('und_')) found = deleteUndiluted(ctx, target, { seal: true }).found;
    return { kind: 'id' as const, found };
  });
  if (result.kind === 'pattern') return sendJson(res, 200, { forgotten: result.count });
  if (!result.found) throw new PanelError(404, 'not_found');
  sendJson(res, 200, { forgotten: 1 });
}

async function handleRedact(res: ServerResponse, opts: PanelOptions, url: URL, body: Record<string, unknown>): Promise<void> {
  if (body.confirm !== true) throw new PanelError(400, 'confirm_required');
  const id = str(body, 'id');
  if (!id) throw new PanelError(400, 'id_required');
  const found = await withRealmWrite(opts, url.searchParams.get('realm') ?? undefined, str(body, 'passphrase'), (ctx) => {
    if (id.startsWith('evt_')) return redactEventById(ctx, id, { seal: false });
    if (id.startsWith('clm_')) return forgetClaim(ctx, id, { seal: false });
    return false;
  });
  if (!found) throw new PanelError(404, 'not_found');
  sendJson(res, 200, { redacted: id });
}

// ── Router + handler factory ─────────────────────────────────────────────────

async function route(req: IncomingMessage, res: ServerResponse, opts: PanelOptions, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const p = url.pathname;

  if (method === 'GET') {
    if (p === '/api/realms') return handleRealms(res);
    if (p === '/api/scopes') return handleScopes(res, opts, url.searchParams.get('realm') ?? undefined);
    if (p === '/api/memories') return handleMemories(res, opts, url);
    if (p === '/api/import/candidates') return handleImportCandidates(res, opts, url.searchParams.get('realm') ?? undefined);
    if (p === '/api/connect/detect') return handleConnectDetect(res, url);
    if (p === '/api/llm') return handleLlm(res, opts);
    throw new PanelError(404, 'not_found');
  }

  // Mutations are serialized and read a JSON body.
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    const body = await readJsonBody(req);
    return withWriteLock(async () => {
      if (p === '/api/realms' && method === 'POST') return handleCreateRealm(res, body);
      if (p === '/api/realms' && method === 'DELETE') return handleDeleteRealm(res, body);
      if (p === '/api/realms/active' && method === 'POST') return handleSetActiveRealm(res, body);
      if (p === '/api/connect' && method === 'POST') return handleConnect(res, opts, body);
      if (p === '/api/llm/model' && method === 'POST') return handleLlmSetModel(res, opts, body);
      if (p === '/api/import' && method === 'POST') return handleImport(res, opts, url, body);
      if (p === '/api/import/promote' && method === 'POST') return handlePromote(res, opts, url, body);
      if (p === '/api/import/reject' && method === 'POST') return handleReject(res, opts, url, body);
      if (p === '/api/forget' && method === 'POST') return handleForget(res, opts, url, body);
      if (p === '/api/redact' && method === 'POST') return handleRedact(res, opts, url, body);
      throw new PanelError(404, 'not_found');
    });
  }

  throw new PanelError(405, 'method_not_allowed');
}

export function createRequestHandler(opts: PanelOptions): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handle(req, res, opts).catch((err: unknown) => {
      console.error('[memoring serve] unhandled: ' + (err instanceof Error ? err.message : String(err)));
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' });
      else res.end();
    });
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: PanelOptions): Promise<void> {
  // Layer 1 + 2: Host (always) then Origin (when present), before token/routing.
  if (!hostAllowed(req.headers.host, opts.port)) {
    sendJson(res, 403, { error: 'host_forbidden' });
    return;
  }
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  if (!originAllowed(origin, opts.port)) {
    sendJson(res, 403, { error: 'origin_forbidden' });
    return;
  }

  const url = new URL(req.url ?? '/', `http://${PANEL_HOST}:${opts.port}`);

  // GET /, favicon, and bundled assets are token-EXEMPT (static, data-free) but Host-checked.
  if (req.method === 'GET' && url.pathname === '/') {
    sendShell(res, generateNonce());
    return;
  }
  if (req.method === 'GET' && url.pathname === '/assets/memoring-ring.svg') {
    sendSvg(res, MEMORING_RING_SVG);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/assets/memoring-ring.png') {
    sendPng(res, MEMORING_RING_PNG);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return;
  }

  // Layer 3: every /api/* request — read AND write — requires a valid token.
  if (url.pathname.startsWith('/api/') && !tokenValid(presentedToken(req), opts.token)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  try {
    await route(req, res, opts, url);
  } catch (error) {
    if (error instanceof PanelError) {
      sendJson(res, error.status, { error: error.code });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[memoring serve] request failed: ' + message);
    sendJson(res, 500, { error: 'internal_error' });
  }
}

function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

export interface RunningPanel {
  server: http.Server;
  port: number;
  token: string;
  url: string;
}

/** Start the panel on `opts.port` (0 = an ephemeral port, for tests) and resolve
 *  with the chosen port, token, and the fragment URL that delivers the token. */
export function startPanelServer(opts: PanelOptions): Promise<RunningPanel> {
  return new Promise((resolve, reject) => {
    // The Host/Origin gate compares against the bound port; for an ephemeral port
    // (0) the real port is only known after listen, so the handler reads it lazily.
    const state: PanelOptions = { ...opts };
    const server = http.createServer(createRequestHandler(state));
    server.once('error', reject);
    server.listen(opts.port, PANEL_HOST, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      state.port = port;
      resolve({
        server,
        port,
        token: opts.token,
        url: `http://${PANEL_HOST}:${port}/#t=${opts.token}`,
      });
    });
  });
}
