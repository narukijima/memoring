// Web control panel security + write-surface tests (ADR-0010). Exercises the
// transport gate (Host / Origin / token), the no-setCurrent view-switch
// invariant, and the dedicated owner-only candidate egress surface. Requests use
// the low-level http client so arbitrary Host/Origin headers can be set (fetch
// forbids them).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRealmLocal } from '@core/runtime';
import { readRegistry } from '@core/realm-registry';
import { ingestImport } from '@intake/import-from-ai';
import { getOrCreateLabel } from '@claim/classify';
import { searchRealm } from '@retrieval/search';
import { createReplicaAtRoot } from '../apps/cli/commands/init';
import { createRealm } from '../apps/cli/realm-actions';
import { startPanelServer, type RunningPanel } from '../apps/server/panel';

const TOKEN = 'a'.repeat(64); // a fixed, valid-length test token
const CLAUDE_EXPORT = [
  '```',
  '## Instructions',
  '[2024-01-05] - Always respond in English.',
  '## Preferences',
  '[2024-03-10] - Prefers 2-space indentation in all code.',
  '```',
].join('\n');
const CANDIDATE_TEXT = 'Always respond in English.';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  raw: Buffer;
  text: string;
}

function request(opts: {
  port: number;
  method?: string;
  path: string;
  host?: string;
  origin?: string;
  token?: string;
  body?: unknown;
}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.host !== undefined) headers.host = opts.host;
    if (opts.origin !== undefined) headers.origin = opts.origin;
    if (opts.token !== undefined) headers['x-memoring-token'] = opts.token;
    let payload: string | undefined;
    if (opts.body !== undefined) {
      payload = JSON.stringify(opts.body);
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }
    const req = http.request(
      { host: '127.0.0.1', port: opts.port, path: opts.path, method: opts.method ?? 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, raw, text: raw.toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Concatenate every audit.log under `dir` — both the registry-level log and each
 *  Realm's own — so a secret leak into any trail is caught (NFR-004). */
function readAllAudit(dir: string): string {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(readAllAudit(full));
    else if (entry.name === 'audit.log') out.push(fs.readFileSync(full, 'utf8'));
  }
  return out.join('\n');
}

describe('web control panel — security gate + owner write surface', () => {
  let home: string;
  let prevHome: string | undefined;
  let baseRealmId: string;
  let panel: RunningPanel;

  beforeEach(async () => {
    prevHome = process.env.MEMORING_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-panel-'));
    process.env.MEMORING_HOME = home;
    const created = createReplicaAtRoot({ root: home, name: 'default', usePassphrase: false });
    baseRealmId = created.config.realm_id;
    panel = await startPanelServer({ token: TOKEN, port: 0, root: home });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => panel.server.close(() => resolve()));
    fs.rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.MEMORING_HOME;
    else process.env.MEMORING_HOME = prevHome;
  });

  // ── Host / Origin / token gate ──────────────────────────────────────────

  it('rejects a non-loopback Host on EVERY request, including GET / (DNS-rebinding)', async () => {
    const shell = await request({ port: panel.port, path: '/', host: 'evil.example.com' });
    expect(shell.status).toBe(403);
    const api = await request({ port: panel.port, path: '/api/realms', host: 'evil.example.com', token: TOKEN });
    expect(api.status).toBe(403);
  });

  it('rejects a cross-site Origin when present', async () => {
    const r = await request({ port: panel.port, path: '/api/realms', origin: 'http://attacker.example', token: TOKEN });
    expect(r.status).toBe(403);
  });

  it('serves the GET / shell token-exempt, with a CSP and a script nonce', async () => {
    const r = await request({ port: panel.port, path: '/' }); // no token
    expect(r.status).toBe(200);
    const csp = r.headers['content-security-policy'];
    expect(typeof csp).toBe('string');
    expect(csp).toContain("default-src 'self'");
    const nonce = /script-src 'nonce-([^']+)'/.exec(String(csp))?.[1];
    expect(nonce).toBeTruthy();
    expect(r.text).toContain(`<script nonce="${nonce}">`);
  });

  it('serves the bundled Memoring logo as a token-exempt static asset', async () => {
    const r = await request({ port: panel.port, path: '/assets/memoring-ring.svg' }); // no token
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('image/svg+xml');
    expect(r.text).toContain('<circle');

    const png = await request({ port: panel.port, path: '/assets/memoring-ring.png' }); // no token
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toContain('image/png');
    expect(png.raw.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('requires a valid token on EVERY /api/* request — read AND write', async () => {
    expect((await request({ port: panel.port, path: '/api/realms' })).status).toBe(401);
    expect((await request({ port: panel.port, path: '/api/scopes' })).status).toBe(401);
    expect((await request({ port: panel.port, path: '/api/memories' })).status).toBe(401);
    expect((await request({ port: panel.port, path: '/api/import/candidates' })).status).toBe(401);
    expect((await request({ port: panel.port, method: 'POST', path: '/api/realms', body: { name: 'x' } })).status).toBe(401);
    // A wrong token is also 401 (constant-time compare).
    expect((await request({ port: panel.port, path: '/api/realms', token: 'b'.repeat(64) })).status).toBe(401);
    // The valid token passes.
    expect((await request({ port: panel.port, path: '/api/realms', token: TOKEN })).status).toBe(200);
  });

  // ── Realm selector + no-setCurrent view-switch ────────────────────────────

  it('lists Realms with active + locked markers', async () => {
    createRealm({ name: 'second', usePassphrase: true, passphrase: 'correct horse battery' });
    const r = await request({ port: panel.port, path: '/api/realms', token: TOKEN });
    expect(r.status).toBe(200);
    const realms = JSON.parse(r.text) as Array<{ name: string; key_mode: string; active: boolean; locked: boolean }>;
    const second = realms.find((x) => x.name === 'second');
    expect(second).toMatchObject({ key_mode: 'passphrase', active: true, locked: true });
    expect(realms.some((x) => x.name === 'default' && !x.locked)).toBe(true);
  });

  it('switches the VIEW by explicit Realm id without mutating the current pointer', async () => {
    // `second` becomes current on create; viewing `default` must not move it.
    createRealm({ name: 'second', usePassphrase: false });
    const before = readRegistry(home).current;
    expect(before).toBeTruthy();

    const view = await request({ port: panel.port, path: `/api/scopes?realm=${baseRealmId}`, token: TOKEN });
    expect(view.status).toBe(200);

    const after = readRegistry(home).current;
    expect(after).toBe(before); // view-switch performed NO setCurrent write
  });

  // ── Dedicated owner-only candidate egress surface (§3) ─────────────────────

  it('keeps imported-candidate plaintext owner-only: tokenless GET is 401 and leaks nothing', async () => {
    const ctx = openRealmLocal(home);
    ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    ctx.close(true);

    const tokenless = await request({ port: panel.port, path: '/api/import/candidates' });
    expect(tokenless.status).toBe(401);
    expect(tokenless.text).not.toContain(CANDIDATE_TEXT);

    const owner = await request({ port: panel.port, path: '/api/import/candidates', token: TOKEN });
    expect(owner.status).toBe(200);
    expect(owner.text).toContain(CANDIDATE_TEXT);
  });

  it('never surfaces an imported candidate through the consolidated /api/memories pane', async () => {
    const ctx = openRealmLocal(home);
    ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    ctx.close(true);

    const mem = await request({ port: panel.port, path: '/api/memories?scope=default&project=default', token: TOKEN });
    expect(mem.status).toBe(200);
    expect(mem.text).not.toContain(CANDIDATE_TEXT);
  });

  // ── Owner writes behind the gate ───────────────────────────────────────────

  it('creates a Realm via POST behind the token gate', async () => {
    const r = await request({ port: panel.port, method: 'POST', path: '/api/realms', token: TOKEN, body: { name: 'made-by-panel' } });
    expect(r.status).toBe(201);
    const body = JSON.parse(r.text) as { name: string; realm_id: string };
    expect(body.name).toBe('made-by-panel');
    const list = await request({ port: panel.port, path: '/api/realms', token: TOKEN });
    expect(list.text).toContain('made-by-panel');
  });

  it('refuses a destructive Realm delete without an explicit confirm', async () => {
    createRealm({ name: 'second', usePassphrase: false });
    const r = await request({ port: panel.port, method: 'DELETE', path: '/api/realms', token: TOKEN, body: { realm: 'second' } });
    expect(r.status).toBe(400);
    expect(r.text).toContain('confirm_required');
    // Still present after the refused delete.
    expect(readRegistry(home).realms.some((x) => x.name === 'second')).toBe(true);
  });

  // ── Unlock passphrase / recovery code never leak (NFR-004) ─────────────────

  it('never persists, logs, or audits the unlock passphrase or the recovery code', async () => {
    const PASSPHRASE = 'correct horse battery staple';
    const captured: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => captured.push(a.map(String).join(' ')));
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => captured.push(a.map(String).join(' ')));
    try {
      // Create a passphrase Realm through the panel; the recovery code is returned ONCE.
      const created = await request({
        port: panel.port,
        method: 'POST',
        path: '/api/realms',
        token: TOKEN,
        body: { name: 'locked', mode: 'passphrase', passphrase: PASSPHRASE },
      });
      expect(created.status).toBe(201);
      const { realm_id: realmId, recovery_code: recoveryCode } = JSON.parse(created.text) as {
        realm_id: string;
        recovery_code: string;
      };
      expect(typeof recoveryCode).toBe('string');
      expect(recoveryCode.length).toBeGreaterThan(0);

      // A write that unlocks with the passphrase succeeds (the provider holds it for
      // the unlock only).
      const wrote = await request({
        port: panel.port,
        method: 'POST',
        path: `/api/import?realm=${realmId}`,
        token: TOKEN,
        body: { text: CLAUDE_EXPORT, provider: 'claude', passphrase: PASSPHRASE },
      });
      expect(wrote.status).toBe(200);

      // Neither secret may appear in any audit log or in captured stdout/stderr.
      const sinks = [readAllAudit(home), captured.join('\n')];
      for (const sink of sinks) {
        expect(sink).not.toContain(PASSPHRASE);
        expect(sink).not.toContain(recoveryCode);
      }
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('returns 423 realm_locked for a passphrase-required write with no passphrase', async () => {
    const created = await request({
      port: panel.port,
      method: 'POST',
      path: '/api/realms',
      token: TOKEN,
      body: { name: 'locked', mode: 'passphrase', passphrase: 'correct horse battery staple' },
    });
    expect(created.status).toBe(201);
    const { realm_id: realmId } = JSON.parse(created.text) as { realm_id: string };

    const wrote = await request({
      port: panel.port,
      method: 'POST',
      path: `/api/import?realm=${realmId}`,
      token: TOKEN,
      body: { text: CLAUDE_EXPORT, provider: 'claude' },
    });
    expect(wrote.status).toBe(423);
    expect(wrote.text).toContain('realm_locked');
  });

  // ── Panel write-route wiring (HTTP-layer coverage) ─────────────────────────

  it('forget gates on confirm and dispatches the clm_ seal path', async () => {
    const ctx = openRealmLocal(home);
    ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    ctx.close(true);

    const cands = JSON.parse(
      (await request({ port: panel.port, path: '/api/import/candidates', token: TOKEN })).text,
    ) as Array<{ claim_id: string; statement: string }>;
    const claimId = cands.find((c) => c.statement.includes(CANDIDATE_TEXT))?.claim_id;
    expect(claimId).toMatch(/^clm_/);

    // confirm omitted → refused (the destructive-action gate).
    const refused = await request({ port: panel.port, method: 'POST', path: '/api/forget', token: TOKEN, body: { id: claimId } });
    expect(refused.status).toBe(400);
    expect(refused.text).toContain('confirm_required');

    // confirm: true → the clm_ branch seals and forgets exactly one Claim.
    const forgot = await request({ port: panel.port, method: 'POST', path: '/api/forget', token: TOKEN, body: { id: claimId, confirm: true } });
    expect(forgot.status).toBe(200);
    expect(JSON.parse(forgot.text)).toMatchObject({ forgotten: 1 });
  });

  it('promotes an imported candidate so the post-promote indexClaim makes it recallable', async () => {
    const ctx = openRealmLocal(home);
    ingestImport(ctx, Buffer.from(CLAUDE_EXPORT, 'utf8'), { providerHint: 'claude' });
    ctx.close(true);

    const cands = JSON.parse(
      (await request({ port: panel.port, path: '/api/import/candidates', token: TOKEN })).text,
    ) as Array<{ claim_id: string; statement: string }>;
    const claimId = cands.find((c) => c.statement.includes(CANDIDATE_TEXT))?.claim_id;
    expect(claimId).toBeTruthy();

    const promote = await request({
      port: panel.port,
      method: 'POST',
      path: '/api/import/promote',
      token: TOKEN,
      body: { claim_id: claimId, scope: 'panel-scope', sensitivity: 'internal' },
    });
    expect(promote.status).toBe(200);

    // A promoted candidate is evidence-less (laundering closed), so it is NOT a
    // browse-pane row — the /api/memories view is evidence-scoped. Its recall path
    // is the search index the handler rebuilds via indexClaim (panel.ts ~409,
    // ADR-0007). Verify that index hit under the chosen scope label.
    const verify = openRealmLocal(home);
    try {
      const label = getOrCreateLabel(verify, 'panel-scope', new Date());
      const hits = searchRealm(verify, 'english', { activeLabelIds: [label.label_id] });
      expect(hits.some((h) => h.ref_type === 'claim')).toBe(true);
    } finally {
      verify.close(false);
    }
  });
});
