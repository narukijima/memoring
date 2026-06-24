// Single source of truth for the two version numbers Memoring reports.
//
// They are intentionally DIFFERENT numbers with different meanings:
//   - packageVersion (package.json "version"): the implementation / release
//     version (semver). This is what npm compares and what a future opt-in
//     update-notifier would check against the registry (see ADR-0008).
//   - specVersion (the VERSION file): the frozen specification baseline
//     (Spec Baseline v1.0). It moves only when the spec itself is re-frozen.
//
// Both are read DYNAMICALLY from the source tree so the CLI version line, the
// MCP serverInfo version, and these constants can never silently drift apart.
// Paths are resolved relative to THIS source file (never process.cwd()): the
// CLI is launched from an arbitrary working directory via bin/memoring.mjs →
// tsx, so cwd points at the user's project, not the Memoring repo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// <root>/packages/core/version.ts → up two directories is the repo root,
// mirroring how bin/memoring.mjs resolves root from its own location.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readPackageVersion(): string {
  const raw = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8');
  const version = (JSON.parse(raw) as { version?: unknown }).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('package.json is missing a "version" string');
  }
  return version;
}

function readSpecVersion(): string {
  return fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
}

/** Implementation / release version (package.json "version"; semver). */
export const packageVersion: string = readPackageVersion();

/** Frozen specification baseline (the VERSION file). */
export const specVersion: string = readSpecVersion();

/** The single line `memoring version` / `memoring --version` prints. */
export function versionLine(): string {
  return `memoring ${packageVersion} (spec ${specVersion})`;
}
