// Regression guard for main()'s command dispatch. main.ts self-invokes on import,
// so the in-process command tests (ask.test.ts / chat.test.ts) call cmdAsk/cmdChat
// directly and CANNOT catch a command that is documented + imported but missing its
// `case` in the switch — exactly how `memoring chat` once fell through to
// "Unknown command". This drives the real CLI entry point in a subprocess to assert
// the output-layer commands are wired.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const mainTs = fileURLToPath(new URL('../apps/cli/main.ts', import.meta.url));

let home: string;
beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-dispatch-'));
});
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

/** Run the CLI entry point; return combined stdout+stderr and the exit code. The
 *  Silence message is on stderr (exit 0), so both streams must be captured. */
function runCli(args: string[]): { out: string; code: number } {
  const r = spawnSync(tsx, [mainTs, ...args], {
    input: '',
    encoding: 'utf8',
    env: { ...process.env, MEMORING_HOME: home, MEMORING_PASSPHRASE: '' },
  });
  if (r.error) throw r.error;
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status ?? 0 };
}

describe('CLI dispatch wiring (subprocess)', () => {
  // No Realm resolves under the empty MEMORING_HOME, so the output-layer commands
  // reach the active-Realm Silence (exit 0) — the point is they are DISPATCHED, not
  // rejected as unknown.
  it('`chat` is dispatched (not "Unknown command")', () => {
    const { out, code } = runCli(['chat']);
    expect(out).not.toContain('Unknown command');
    expect(out).toContain('Active Realm unresolved'); // reached cmdChat → realm resolution
    expect(code).toBe(0);
  }, 30000);

  it('`ask` is dispatched (not "Unknown command")', () => {
    const { out } = runCli(['ask', 'anything']);
    expect(out).not.toContain('Unknown command');
    expect(out).toContain('Active Realm unresolved'); // reached cmdAsk → realm resolution
  }, 30000);

  it('`config` is dispatched (not "Unknown command")', () => {
    const { out } = runCli(['config', 'show']);
    expect(out).not.toContain('Unknown command');
    expect(out).toContain('Active Realm unresolved'); // reached cmdConfig → realm resolution
  }, 30000);

  it('an unknown command DOES report "Unknown command" (the guard is meaningful)', () => {
    const { out, code } = runCli(['definitely-not-a-command']);
    expect(out).toContain('Unknown command');
    expect(code).toBe(1);
  }, 30000);
});
