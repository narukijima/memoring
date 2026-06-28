// Distribution ethos guards (ADR-0009, "Distribution must not erode the ethos").
// Shipping Memoring to npm must not smuggle in install-time side effects or
// telemetry. An installer "places a binary on PATH and nothing more": it MUST NOT
// run `memoring init`, touch ~/.memoring, or phone home. These assertions fail the
// build the moment either guarantee regresses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  bin?: Record<string, string>;
};

// npm runs these on the consumer's machine during `npm install`. Memoring ships none,
// so a global install can never auto-init a Realm or write to disk.
const INSTALL_LIFECYCLE = ['preinstall', 'install', 'postinstall'];

// Telemetry / analytics SDK name prefixes that have no place in a local-first,
// no-egress tool. Matched as a package-name prefix (`posthog`, `posthog-node`,
// `@sentry/node` …) so the legitimate remote-LLM egress path (`memoring ask`,
// ADR-0011) and ethos comments do not trip the guard.
const TELEMETRY_MODULES = [
  'posthog',
  'mixpanel',
  '@segment',
  'amplitude',
  '@amplitude',
  'sentry',
  '@sentry',
  'bugsnag',
  '@bugsnag',
  '@datadog',
  'dd-trace',
  '@google-analytics',
  'analytics',
];

// A bare import specifier is telemetry if its package name equals a listed token or
// extends it as a name segment (`token-...`) or subpath (`token/...`). This catches
// `posthog-node` / `@sentry/node` while leaving relative (`./analytics-x`) and
// aliased (`@core/...`) imports alone.
const isTelemetryPkg = (name: string): boolean =>
  TELEMETRY_MODULES.some((m) => name === m || name.startsWith(`${m}-`) || name.startsWith(`${m}/`));

// Shipped source directories — the executable code that reaches an end user's machine.
// (The "files" allowlist also ships schemas/, but those are JSON reference artifacts, not source.)
const SHIPPED_DIRS = ['apps', 'packages', 'bin'];
const SOURCE_EXT = new Set(['.ts', '.mjs', '.js']);

function shippedSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_EXT.has(path.extname(entry.name))) out.push(full);
    }
  };
  for (const dir of SHIPPED_DIRS) walk(path.join(repoRoot, dir));
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('distribution ethos guards (ADR-0009)', () => {
  it('declares no npm install lifecycle scripts', () => {
    const scripts = pkg.scripts ?? {};
    for (const hook of INSTALL_LIFECYCLE) {
      expect(scripts[hook], `package.json must not define a "${hook}" script`).toBeUndefined();
    }
  });

  it('exposes both lowercase and product-name CLI entrypoints', () => {
    expect(pkg.bin?.memoring).toBe('bin/memoring.mjs');
    expect(pkg.bin?.Memoring).toBe('bin/memoring.mjs');
  });

  it('pulls in no telemetry/analytics production dependency', () => {
    const flagged = Object.keys(pkg.dependencies ?? {}).filter(isTelemetryPkg);
    expect(flagged).toEqual([]);
  });

  it('imports no telemetry/analytics SDK anywhere in the shipped source tree', () => {
    const offenders: string[] = [];
    for (const file of shippedSourceFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const mod of TELEMETRY_MODULES) {
        // Any specifier whose package name starts with `mod`, in all load forms:
        // `from '…'`, side-effect `import '…'`, dynamic `import('…')`, and `require('…')`.
        // Relative (`./analytics-x`) and aliased (`@core/…`) imports start with `.`/`@core`,
        // so the leading-quote anchor leaves them alone.
        const specifier = new RegExp(`(from|import|require)\\s*\\(?\\s*['"\`]${escapeRe(mod)}(-|/|['"\`])`);
        if (specifier.test(text)) offenders.push(`${path.relative(repoRoot, file)} → ${mod}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
