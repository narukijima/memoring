// Pins the single source of truth for Memoring's version strings: the CLI
// version line, package.json "version", and the VERSION file must never silently
// drift apart. The two numbers are intentionally different (package = release,
// VERSION = frozen spec baseline); this only asserts each is reported faithfully.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packageVersion, specVersion, versionLine } from '@core/version';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgVersion = (
  JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string }
).version;
const fileSpecVersion = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();

describe('version', () => {
  it('reads package.json "version" and the VERSION file dynamically', () => {
    expect(packageVersion).toBe(pkgVersion);
    expect(specVersion).toBe(fileSpecVersion);
  });

  it('the version line carries both numbers, clearly labelled', () => {
    const line = versionLine();
    expect(line).toContain(pkgVersion);
    expect(line).toContain(fileSpecVersion);
    expect(line).toBe(`memoring ${pkgVersion} (spec ${fileSpecVersion})`);
  });
});
