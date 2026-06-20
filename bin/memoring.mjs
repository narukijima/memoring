#!/usr/bin/env node
// Thin launcher: run the TypeScript CLI through the local tsx runtime so that
// v0 stays source-only (no build step) while remaining runnable as a binary.
import { spawnSync } from 'node:child_process';
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
const res = spawnSync(tsxBin, ['--tsconfig', tsconfig, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig },
});
process.exit(res.status ?? 1);
