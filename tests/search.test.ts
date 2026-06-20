import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchRealm, rebuildIndex } from '@retrieval/search';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { seedRealmFromFixture, type SeededRealm } from './seed';

let seeded: SeededRealm;
let active: string[];
beforeEach(async () => {
  seeded = await seedRealmFromFixture();
  active = resolveActiveLabelIds(seeded.realm.ctx, ['proj_test']);
});
afterEach(() => seeded.restore());

describe('search (FR-040..042, NFR-018)', () => {
  it('finds consolidated claims by exact substring', () => {
    const hits = searchRealm(seeded.realm.ctx, 'better-sqlite3', { activeLabelIds: active });
    expect(hits.some((h) => h.ref_type === 'claim')).toBe(true);
  });

  it('finds events via n-gram fallback (English substring ≥3 chars)', () => {
    const hits = searchRealm(seeded.realm.ctx, 'indentation', { activeLabelIds: active });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('never returns the secret text (G3 / CON-007)', () => {
    const hits = searchRealm(seeded.realm.ctx, 'sk-abc1234567890', { activeLabelIds: active });
    expect(hits.length).toBe(0);
  });

  it('fails closed: no active scope → no results (G4/FR-042)', () => {
    expect(searchRealm(seeded.realm.ctx, 'indentation').length).toBe(0);
    expect(searchRealm(seeded.realm.ctx, 'indentation', { activeLabelIds: [] }).length).toBe(0);
  });

  it('excludes out-of-scope items when a non-matching scope is given (FR-042)', () => {
    expect(searchRealm(seeded.realm.ctx, 'indentation', { activeLabelIds: ['lbl_does_not_exist'] }).length).toBe(0);
    expect(searchRealm(seeded.realm.ctx, 'indentation', { activeLabelIds: active }).length).toBeGreaterThan(0);
  });

  it('rebuilds deterministically from lower layers (NFR-006)', () => {
    const before = searchRealm(seeded.realm.ctx, 'better-sqlite3', { activeLabelIds: active }).length;
    rebuildIndex(seeded.realm.ctx);
    const after = searchRealm(seeded.realm.ctx, 'better-sqlite3', { activeLabelIds: active }).length;
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(0);
  });
});
