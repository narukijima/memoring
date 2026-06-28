import fs from 'node:fs';
import path from 'node:path';
import { gate, type GateRequest } from '@core/policy';
import type { Claim } from '@core/schema/entities';
import type { RealmContext } from '@core/runtime';
import { hmacHex } from '@security/crypto-primitives';
import { renderMarkerBlock, signMarker } from '@security/ouroboros';
import { newId } from '@core/schema/ids';
import { ensureDir, atomicWriteFile } from '@storage/fs-safety';
import { readClaimStatement } from '@claim/extractor';
import { claimScope } from './claim-scope';
import { toGateItem, toScopedClaim } from './context-pack';

export interface AtlasBuildOptions {
  outDir: string;
  now?: Date;
}

export interface AtlasBuildResult {
  outDir: string;
  files: string[];
  claims: number;
}

interface AtlasClaim {
  claim: Claim;
  statement: string;
  labels: string[];
}

function slug(value: string): string {
  const s = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

function marker(ctx: RealmContext, now: Date): string {
  const policyDigest = hmacHex(ctx.realmKey, 'atlas|human_local_view|standard|derived_projection|can_be_evidence=false');
  return renderMarkerBlock(
    signMarker(ctx.realmKey, {
      context_pack_id: newId('contextPack', now.getTime()),
      recipe_id: 'atlas.v1',
      policy_digest: policyDigest,
      generated_at: now.toISOString(),
    }),
  );
}

function frontmatter(title: string): string {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    'authority: derived',
    'can_be_evidence: false',
    'source: post-gate projection',
    'audience: human_local_view',
    'aperture: standard',
    '---',
    '',
  ].join('\n');
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    out.set(k, [...(out.get(k) ?? []), item]);
  }
  return out;
}

function renderClaimList(items: AtlasClaim[]): string {
  if (items.length === 0) return '- No gated claims.\n';
  return items.map((item) => `- ${item.statement} (${item.claim.claim_id})`).join('\n') + '\n';
}

function isExpired(item: AtlasClaim, now: Date): boolean {
  return item.claim.valid_until !== null && Date.parse(item.claim.valid_until) <= now.getTime();
}

function writeMarkdown(outDir: string, rel: string, body: string, written: string[]): void {
  const target = path.join(outDir, rel);
  ensureDir(path.dirname(target), 0o700);
  atomicWriteFile(target, body, 0o600);
  written.push(rel);
}

function ensureGitInfoExclude(repoRoot: string): void {
  const exclude = path.join(repoRoot, '.git', 'info', 'exclude');
  if (!fs.existsSync(exclude)) return;
  const current = fs.readFileSync(exclude, 'utf8');
  if (current.split(/\r?\n/).includes('.memoring/atlas/')) return;
  fs.appendFileSync(exclude, `${current.endsWith('\n') ? '' : '\n'}.memoring/atlas/\n`, { mode: 0o600 });
}

export function collectAtlasClaims(ctx: RealmContext): AtlasClaim[] {
  const activeLabels = ctx.store.listLabels(ctx.realmId).filter((l) => l.state === 'active');
  const req: GateRequest = {
    audience: 'human_local_view',
    aperture: 'standard',
    activeLabelIds: activeLabels.map((l) => l.label_id),
    crossScopeAllowed: false,
  };
  const labelNames = new Map(activeLabels.map((l) => [l.label_id, l.canonical_name]));
  const out: AtlasClaim[] = [];
  for (const claim of ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')) {
    const scoped = toScopedClaim(ctx, claim);
    if (!gate(toGateItem(ctx, scoped), req).pass) continue;
    const scope = claimScope(ctx, claim);
    out.push({
      claim,
      statement: readClaimStatement(ctx, claim),
      labels: scope.labelIds.map((id) => labelNames.get(id)).filter((name): name is string => Boolean(name)),
    });
  }
  return out.sort((a, b) => b.claim.valid_from.localeCompare(a.claim.valid_from));
}

export function buildAtlas(ctx: RealmContext, opts: AtlasBuildOptions): AtlasBuildResult {
  const now = opts.now ?? new Date();
  const outDir = path.resolve(opts.outDir);
  ensureDir(outDir, 0o700);
  ensureGitInfoExclude(process.cwd());
  const written: string[] = [];
  const claims = collectAtlasClaims(ctx);
  const mark = marker(ctx, now);

  const index = [
    frontmatter('Memoring Atlas'),
    '# Memoring Atlas',
    '',
    'This is a read-only derived projection. It is not canonical memory and cannot be Claim evidence.',
    '',
    '## Views',
    '- [[decisions]]',
    '- [[constraints]]',
    '- [[procedures]]',
    '- [[chronicle]]',
    '- [[health/conflicts]]',
    '- [[health/stale]]',
    '- [[health/gaps]]',
    '',
    '## Labels',
    ...[...groupBy(claims.flatMap((c) => c.labels), (x) => x).keys()].sort().map((name) => `- [[labels/${slug(name)}|${name}]]`),
    '',
    mark,
    '',
  ].join('\n');
  writeMarkdown(outDir, 'index.md', index, written);

  writeMarkdown(outDir, 'chronicle.md', `${frontmatter('Chronicle')}# Chronicle\n\n${renderClaimList(claims)}\n${mark}\n`, written);
  for (const kind of ['decision', 'constraint', 'procedure'] as const) {
    const title = `${kind[0]!.toUpperCase()}${kind.slice(1)}s`;
    writeMarkdown(
      outDir,
      `${kind === 'decision' ? 'decisions' : `${kind}s`}.md`,
      `${frontmatter(title)}# ${title}\n\n${renderClaimList(claims.filter((c) => c.claim.kind === kind))}\n${mark}\n`,
      written,
    );
  }

  for (const [label, items] of groupBy(claims.flatMap((c) => c.labels.map((label) => ({ label, item: c }))), (x) => x.label)) {
    writeMarkdown(
      outDir,
      `labels/${slug(label)}.md`,
      `${frontmatter(label)}# ${label}\n\n${renderClaimList(items.map((x) => x.item))}\n${mark}\n`,
      written,
    );
  }

  writeMarkdown(
    outDir,
    'health/conflicts.md',
    `${frontmatter('Conflicts')}# Conflicts\n\nAtlas projects only gated consolidated claims, so conflicted Claims are not rendered here.\nRun \`memoring health\` for the local advisory diagnostic list.\n\n${mark}\n`,
    written,
  );
  writeMarkdown(outDir, 'health/stale.md', `${frontmatter('Stale')}# Stale\n\n${renderClaimList(claims.filter((c) => isExpired(c, now)))}\n${mark}\n`, written);
  writeMarkdown(
    outDir,
    'health/gaps.md',
    `${frontmatter('Gaps')}# Gaps\n\nAtlas projects only gated, scoped Claims. Ungated weak-scope or weak-evidence records are intentionally not rendered in this derived projection.\nRun \`memoring health\` for the local advisory diagnostic list.\n\n${mark}\n`,
    written,
  );

  return { outDir, files: written, claims: claims.length };
}
