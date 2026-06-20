import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchRealm, rebuildIndex } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { seedRealmFromFixture, type SeededRealm } from './seed';

let seeded: SeededRealm;
beforeEach(async () => {
  seeded = await seedRealmFromFixture();
});
afterEach(() => seeded.restore());

describe('search (FR-040..042, NFR-018)', () => {
  it('finds consolidated claims by exact substring', () => {
    const hits = searchRealm(seeded.realm.ctx, 'better-sqlite3');
    expect(hits.some((h) => h.ref_type === 'claim')).toBe(true);
  });

  it('finds events via n-gram fallback (English substring ≥3 chars)', () => {
    const hits = searchRealm(seeded.realm.ctx, 'indentation');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('never returns the secret text (G3 / CON-007)', () => {
    const hits = searchRealm(seeded.realm.ctx, 'sk-abc1234567890');
    expect(hits.length).toBe(0);
  });

  it('excludes out-of-scope items when an active scope is given (FR-042)', () => {
    // A label that matches nothing → everything is out of scope → no hits.
    const hits = searchRealm(seeded.realm.ctx, 'indentation', { activeLabelIds: ['lbl_does_not_exist'] });
    expect(hits.length).toBe(0);
    // The real active label returns hits.
    const active = resolveActiveLabelIds(seeded.realm.ctx, ['proj_test']);
    const hits2 = searchRealm(seeded.realm.ctx, 'indentation', { activeLabelIds: active });
    expect(hits2.length).toBeGreaterThan(0);
  });

  it('rebuilds deterministically from lower layers (NFR-006)', () => {
    const before = searchRealm(seeded.realm.ctx, 'better-sqlite3').length;
    rebuildIndex(seeded.realm.ctx);
    const after = searchRealm(seeded.realm.ctx, 'better-sqlite3').length;
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(0);
  });
});
