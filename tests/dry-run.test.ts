// connect/backfill --dry-run preview (Specification §1.1, G12). The flag was
// documented but unimplemented (backfill.ts even said "not yet implemented").
// These pin that --dry-run prints an Inventory/preview and persists NOTHING.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdInit } from '../apps/cli/commands/init';
import { cmdConnect } from '../apps/cli/commands/connect';
import { cmdBackfill } from '../apps/cli/commands/backfill';
import { openActiveRealm } from '@core/runtime';

const fixturesProjects = fileURLToPath(new URL('../fixtures/claude-code/projects', import.meta.url));
const noPass = async () => '';

describe('connect/backfill --dry-run', () => {
  const env = { ...process.env };
  let tmp: string;
  let logs: string[];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-dryrun-'));
    process.env.MEMORING_HOME = path.join(tmp, 'home');
    process.env.MEMORING_CLAUDE_DIR = fixturesProjects;
    delete process.env.MEMORING_PASSPHRASE; // passwordless (no prompt)
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...env };
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('connect --dry-run prints the Inventory and persists nothing', async () => {
    expect(await cmdInit([])).toBe(0);
    logs.length = 0;
    expect(await cmdConnect(['claude-code', '--dry-run'])).toBe(0);

    const out = logs.join('\n');
    expect(out).toContain('[dry-run]');
    expect(out).toContain('Inventory');
    expect(out).toMatch(/samples=\d+/);

    // Nothing persisted: no connectors, sources, projects, or claims.
    const ctx = await openActiveRealm(process.env.MEMORING_HOME, noPass);
    try {
      expect(ctx.config.connectors).toHaveLength(0);
      expect(ctx.config.projects).toHaveLength(0);
      expect(ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')).toHaveLength(0);
    } finally {
      ctx.close(false);
    }
  });

  it('backfill --dry-run previews registered sources and ingests nothing', async () => {
    expect(await cmdInit([])).toBe(0);
    // Really connect a source (so backfill has something to preview), but do not backfill.
    expect(await cmdConnect(['claude-code', '--all', '--default-sensitivity', 'internal'])).toBe(0);

    logs.length = 0;
    expect(await cmdBackfill(['--dry-run'])).toBe(0);

    const out = logs.join('\n');
    expect(out).toContain('[dry-run]');
    expect(out).toMatch(/registered source\(s\)/);
    expect(out).toMatch(/new_samples=\d+/);

    // No ingestion: nothing was captured/consolidated by the preview.
    const ctx = await openActiveRealm(process.env.MEMORING_HOME, noPass);
    try {
      expect(ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')).toHaveLength(0);
      expect(ctx.store.listClaimsByStatus(ctx.realmId, 'candidate')).toHaveLength(0);
    } finally {
      ctx.close(false);
    }
  });
});
