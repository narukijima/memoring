import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cmdExport } from '../apps/cli/commands/export';

describe('export purpose parsing', () => {
  it('rejects positional derived export purposes instead of treating them as backup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-export-'));
    try {
      await expect(cmdExport(['redacted', dir])).resolves.toBe(1);
      expect(fs.existsSync(path.join(dir, 'backup-manifest.json'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
