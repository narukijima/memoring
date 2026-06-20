import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeContextFileSafely } from '@retrieval/context-pack';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-fs-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('context.md file safety (G7 / NFR-034)', () => {
  it('writes atomically with 0600 perms', () => {
    writeContextFileSafely(path.join('.memoring', 'context.md'), 'hello', dir);
    const out = path.join(dir, '.memoring', 'context.md');
    expect(fs.readFileSync(out, 'utf8')).toBe('hello');
    const mode = fs.statSync(out).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('refuses to write when .memoring is a symlink (default out)', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-elsewhere-'));
    fs.symlinkSync(elsewhere, path.join(dir, '.memoring'));
    expect(() => writeContextFileSafely(path.join('.memoring', 'context.md'), 'hello', dir)).toThrow(/symlink/);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });

  it('refuses the nested --out bypass when .memoring is a symlink and the subdir does not exist', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-elsewhere-'));
    fs.symlinkSync(elsewhere, path.join(dir, '.memoring'));
    // .memoring/sub does not exist yet; the immediate-parent-only check would miss this.
    expect(() => writeContextFileSafely(path.join('.memoring', 'sub', 'context.md'), 'hi', dir)).toThrow(/symlink/);
    // Nothing was written through the symlink.
    expect(fs.existsSync(path.join(elsewhere, 'sub', 'context.md'))).toBe(false);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });

  it('refuses even a DANGLING symlink (target does not exist) — lstat, not existsSync', () => {
    fs.symlinkSync(path.join(dir, 'nonexistent-target'), path.join(dir, '.memoring'));
    expect(() => writeContextFileSafely(path.join('.memoring', 'sub', 'context.md'), 'hi', dir)).toThrow(/symlink/);
  });
});
