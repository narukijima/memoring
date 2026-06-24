#!/usr/bin/env node
// Thin launcher: run the TypeScript CLI through the local tsx runtime so that
// v0 stays source-only (no build step) while remaining runnable as a binary.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tsxBin = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);
const entry = path.join(root, 'apps', 'cli', 'main.ts');
const tsconfig = path.join(root, 'tsconfig.json');

// Pass --tsconfig explicitly so the repo's path aliases (@core/* …) resolve even
// when the CLI is launched from an arbitrary project directory (the child keeps
// the caller's cwd, which context build needs for active-scope resolution).
// Fail loudly when dependencies are not installed, rather than exiting silently:
// a missing tsx means `npm install` did not complete (often a native
// better-sqlite3 build failure on a too-new Node — use Node 20 or 22 LTS).
if (!fs.existsSync(tsxBin)) {
  console.error(`memoring: dependencies are not installed (missing ${path.relative(root, tsxBin)}).`);
  console.error('Run `npm install` in the Memoring repository root first.');
  console.error('Node.js 20 or 22 LTS is recommended; the native better-sqlite3 build can fail on newer Node (e.g. 26).');
  process.exit(1);
}

const res = spawnSync(tsxBin, ['--tsconfig', tsconfig, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig },
});
if (res.error) {
  console.error(`memoring: failed to launch the TypeScript runtime (${res.error.message}).`);
  console.error('Reinstall dependencies with `npm install` on Node.js 20 or 22 LTS.');
  process.exit(1);
}
process.exit(res.status ?? 1);
