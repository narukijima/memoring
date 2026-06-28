import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readClaimStatement } from '@claim/extractor';
import { buildAtlas, collectAtlasClaims } from '@retrieval/atlas';
import { textLooksContextInjected } from '@security/ouroboros';
import { seedRealmFromFixture, type SeededRealm } from './seed';

describe('Memory Atlas projection', () => {
  let seeded: SeededRealm;
  let cwd: string;
  let prevCwd: string;

  beforeEach(async () => {
    seeded = await seedRealmFromFixture();
    prevCwd = process.cwd();
    cwd = fs.mkdtempSync(path.join(fs.realpathSync.native('/tmp'), 'memoring-atlas-'));
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    seeded.restore();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('writes derived Markdown with frontmatter and an Ouroboros marker', () => {
    const outDir = path.join(cwd, '.memoring', 'atlas');
    const result = buildAtlas(seeded.realm.ctx, { outDir });
    const index = fs.readFileSync(path.join(outDir, 'index.md'), 'utf8');

    expect(result.files).toContain('index.md');
    expect(index).toContain('authority: derived');
    expect(index).toContain('can_be_evidence: false');
    expect(index).toContain('audience: human_local_view');
    expect(textLooksContextInjected(index)).toBe(true);
  });

  it('collects only claims that pass the human_local_view standard Gate', () => {
    const ctx = seeded.realm.ctx;
    const claim = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')[0]!;
    ctx.store.putClaim({ ...claim, claim_id: 'clm_secret_atlas_test', sensitivity: 'secret' });
    ctx.store.putClaim({ ...claim, claim_id: 'clm_unknown_atlas_test', sensitivity: 'unknown' });

    const claims = collectAtlasClaims(ctx);

    expect(claims.some((c) => c.claim.claim_id === 'clm_secret_atlas_test')).toBe(false);
    expect(claims.some((c) => c.claim.claim_id === 'clm_unknown_atlas_test')).toBe(false);
  });

  it('does not leak ungated health issue text into Atlas health pages', () => {
    const ctx = seeded.realm.ctx;
    const claim = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')[0]!;
    const secretStatement = readClaimStatement(ctx, claim);
    ctx.store.putClaim({
      ...claim,
      claim_id: 'clm_secret_atlas_health_test',
      sensitivity: 'secret',
      valid_until: '2000-01-01T00:00:00.000Z',
    });
    const outDir = path.join(cwd, '.memoring', 'atlas');

    buildAtlas(ctx, { outDir, now: new Date('2026-06-28T00:00:00.000Z') });

    for (const rel of ['health/conflicts.md', 'health/stale.md', 'health/gaps.md']) {
      const body = fs.readFileSync(path.join(outDir, rel), 'utf8');
      expect(body).not.toContain(secretStatement);
      expect(textLooksContextInjected(body)).toBe(true);
    }
  });
});
