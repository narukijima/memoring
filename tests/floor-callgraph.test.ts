import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCAN_ROOTS = ['packages/retrieval', 'packages/claim', 'apps/cli/commands'];

function filesUnder(relDir: string): string[] {
  const dir = path.join(ROOT, relDir);
  const out: string[] = [];
  const walk = (cur: string) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(path.relative(ROOT, abs));
    }
  };
  walk(dir);
  return out.sort();
}

function source(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function scannedFiles(): string[] {
  return SCAN_ROOTS.flatMap(filesUnder).sort();
}

function importedBindings(src: string): Map<string, Set<string>> {
  const imports = new Map<string, Set<string>>();
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g;
  for (const match of src.matchAll(re)) {
    const clause = match[1] ?? '';
    const from = match[2] ?? '';
    const bindings = imports.get(from) ?? new Set<string>();
    const named = /\{([\s\S]*?)\}/.exec(clause)?.[1];
    if (named) {
      for (const part of named.split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim();
        if (name) bindings.add(name);
      }
    }
    imports.set(from, bindings);
  }
  return imports;
}

describe('mechanical floor callgraph guardrails', () => {
  it('pins the raw-text egress sink allowlist and the export derivative guard', () => {
    expect(scannedFiles()).toEqual(expect.arrayContaining([
      'packages/retrieval/context-pack.ts',
      'packages/retrieval/search.ts',
      'packages/claim/extractor.ts',
      'apps/cli/commands/export.ts',
    ]));

    const sinks = new Set<string>();
    for (const rel of scannedFiles()) {
      const src = source(rel);
      if (rel === 'packages/retrieval/context-pack.ts' && /writeContextFileSafely[\s\S]*atomicWriteFile\(resolvedOut,\s*content/.test(src)) {
        sinks.add(`${rel}:writeContextFileSafely`);
      }
      if (rel === 'packages/retrieval/search.ts' && /export function searchRealm\(/.test(src)) {
        sinks.add(`${rel}:searchRealm`);
      }
      if (rel === 'packages/claim/extractor.ts' && /provider\.abstract\(batch\.map/.test(src)) {
        sinks.add(`${rel}:remote-pre-egress`);
      }
      if (rel === 'apps/cli/commands/export.ts' && /purpose\s*!==\s*['"]backup['"]/.test(src)) {
        sinks.add(`${rel}:backup-export-only`);
      }
    }

    expect([...sinks].sort()).toEqual([
      'apps/cli/commands/export.ts:backup-export-only',
      'packages/claim/extractor.ts:remote-pre-egress',
      'packages/retrieval/context-pack.ts:writeContextFileSafely',
      'packages/retrieval/search.ts:searchRealm',
    ]);
    expect(source('apps/cli/commands/export.ts')).toMatch(/Only backup_export is implemented/);
  });

  it('keeps Seal mutator authority out of the autonomous loop, retrieval, and daemon code', () => {
    const authority = new Set<string>();
    for (const rel of [...filesUnder('packages'), ...filesUnder('apps')]) {
      if (rel === 'packages/claim/seal.ts') continue;
      const src = source(rel);
      const callsCreate = /\bcreateSealRule\(/.test(src.replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, ''));
      const callsOrDefinesRelease = /\breleaseSealRule\(/.test(src.replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, ''));
      if (callsCreate || callsOrDefinesRelease) authority.add(rel);
    }

    expect([...authority].sort()).toEqual(['apps/cli/commands/forget.ts', 'packages/security/redaction.ts']);

    for (const rel of [...filesUnder('packages/retrieval'), ...filesUnder('apps/daemon')]) {
      expect(source(rel), rel).not.toMatch(/\b(createSealRule|releaseSealRule)\b/);
    }
    expect(source('packages/core/loop.ts')).not.toMatch(/\b(createSealRule|releaseSealRule)\b/);
  });

  it('lets the loop import index writers without importing floor-output or floor-mutator symbols', () => {
    const loop = source('packages/core/loop.ts');
    const imports = importedBindings(loop);
    expect([...imports.get('@retrieval/search')!].sort()).toEqual(['indexClaim', 'indexEvent']);

    const allBindings = [...imports.values()].flatMap((set) => [...set]);
    expect(allBindings).not.toEqual(
      expect.arrayContaining([
        'searchRealm',
        'buildContext',
        'handleMcpRequest',
        'createSealRule',
        'releaseSealRule',
        'deleteUndiluted',
        'forgetClaim',
        'forgetByPattern',
        'redactEventById',
        'allowedSensitivity',
        'allowedSensitivityState',
        'allowedScopeState',
      ]),
    );
    expect(allBindings.filter((name) => /^(redact|forget)/.test(name))).toEqual([]);
  });
});
