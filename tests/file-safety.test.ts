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
    const out = path.join(dir, '.memoring', 'context.md');
    writeContextFileSafely(out, 'hello', dir);
    expect(fs.readFileSync(out, 'utf8')).toBe('hello');
    const mode = fs.statSync(out).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('refuses to write when .memoring is a symlink', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-elsewhere-'));
    const link = path.join(dir, '.memoring');
    fs.symlinkSync(elsewhere, link);
    const out = path.join(link, 'context.md');
    expect(() => writeContextFileSafely(out, 'hello', dir)).toThrow(/symlink/);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });
});
