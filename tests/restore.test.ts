// backup_export → restore round-trip (NFR-032 local restore). Proves the
// encrypted replica moves verbatim and re-opens with the same realm_id (no
// re-egress / re-derivation), and that restore refuses to clobber or to read a
// non-backup directory.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cmdInit } from '../apps/cli/commands/init';
import { cmdExport } from '../apps/cli/commands/export';
import { cmdRestore } from '../apps/cli/commands/restore';
import { openActiveRealm } from '@core/runtime';
import { readRealmConfig } from '@core/realm';
import { replicaLayout } from '@core/paths';

const passphrase = async () => '';

describe('backup → restore round-trip', () => {
  const env = { ...process.env };
  let tmp: string;
  let emptyClaude: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-restore-'));
    emptyClaude = path.join(tmp, 'claude-empty');
    fs.mkdirSync(emptyClaude, { recursive: true });
    process.env.MEMORING_CLAUDE_DIR = emptyClaude; // no host transcripts during init
    delete process.env.MEMORING_PASSPHRASE;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...env };
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('restores a passwordless replica into a fresh MEMORING_HOME with the same realm_id', async () => {
    const homeA = path.join(tmp, 'homeA');
    const backup = path.join(tmp, 'backup');
    const homeB = path.join(tmp, 'homeB');

    process.env.MEMORING_HOME = homeA;
    expect(await cmdInit([])).toBe(0);
    const realmId = readRealmConfig(replicaLayout(homeA).realmToml).realm_id;
    expect(await cmdExport(['backup', backup])).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(backup, 'backup-manifest.json'), 'utf8')).kind).toBe('memoring-backup');

    // Restore into a different, empty home.
    process.env.MEMORING_HOME = homeB;
    expect(await cmdRestore([backup])).toBe(0);
    expect(fs.existsSync(replicaLayout(homeB).dbBlob)).toBe(true);

    // The restored replica decrypts and carries the same realm_id.
    const ctx = await openActiveRealm(homeB, passphrase);
    try {
      expect(ctx.realmId).toBe(realmId);
    } finally {
      ctx.close(false);
    }
  });

  it('refuses to overwrite a non-empty MEMORING_HOME', async () => {
    const homeA = path.join(tmp, 'homeA2');
    const backup = path.join(tmp, 'backup2');
    process.env.MEMORING_HOME = homeA;
    expect(await cmdInit([])).toBe(0);
    expect(await cmdExport(['backup', backup])).toBe(0);

    // Restoring on top of the live vault must refuse (no clobber).
    expect(await cmdRestore([backup])).toBe(1);
  });

  it('refuses a directory that is not a Memoring backup', async () => {
    process.env.MEMORING_HOME = path.join(tmp, 'homeB3');
    const notBackup = path.join(tmp, 'not-a-backup');
    fs.mkdirSync(notBackup, { recursive: true });
    fs.writeFileSync(path.join(notBackup, 'random.txt'), 'hi');
    expect(await cmdRestore([notBackup])).toBe(1);
  });

  it('refuses a manifest that is not a same-user backup_export', async () => {
    const homeA = path.join(tmp, 'homeA4');
    const backup = path.join(tmp, 'backup4');
    process.env.MEMORING_HOME = homeA;
    expect(await cmdInit([])).toBe(0);
    expect(await cmdExport(['backup', backup])).toBe(0);
    const manifestPath = path.join(backup, 'backup-manifest.json');
    const base = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    process.env.MEMORING_HOME = path.join(tmp, 'homeB4'); // fresh target each time

    // same_user: false → refuse
    fs.writeFileSync(manifestPath, JSON.stringify({ ...base, same_user: false }));
    expect(await cmdRestore([backup])).toBe(1);
    // purpose missing → refuse (only a full backup_export is restorable)
    fs.writeFileSync(manifestPath, JSON.stringify({ ...base, purpose: undefined }));
    expect(await cmdRestore([backup])).toBe(1);
    // unknown (non-client-side) encryption → refuse
    fs.writeFileSync(manifestPath, JSON.stringify({ ...base, encryption: 'server_side' }));
    expect(await cmdRestore([backup])).toBe(1);
    // nothing was restored into the target
    expect(fs.existsSync(replicaLayout(path.join(tmp, 'homeB4')).dbBlob)).toBe(false);

    // the unmodified manifest still restores (control)
    fs.writeFileSync(manifestPath, JSON.stringify(base));
    expect(await cmdRestore([backup])).toBe(0);
  });
});
