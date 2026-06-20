import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  markerDigest,
  renderMarkerBlock,
  signMarker,
  textLooksContextInjected,
  pathIsMemoringInternal,
  OUROBOROS_TOKEN,
} from '@security/ouroboros';

const realmKey = randomBytes(32);
const input = {
  context_pack_id: 'ctx_1',
  recipe_id: 'recipe_context_budget_v1',
  policy_digest: 'abc',
  generated_at: '2026-06-20T00:00:00.000Z',
};

describe('Ouroboros marker (G6 / §10.7)', () => {
  it('digest is deterministic for the same input and realm key', () => {
    expect(markerDigest(realmKey, input)).toBe(markerDigest(realmKey, input));
  });
  it('digest changes with a different realm key', () => {
    expect(markerDigest(realmKey, input)).not.toBe(markerDigest(randomBytes(32), input));
  });
  it('signed marker round-trips into a fenced block carrying the token', () => {
    const block = renderMarkerBlock(signMarker(realmKey, input));
    expect(block).toContain(OUROBOROS_TOKEN);
    expect(block).toContain('signature:');
  });
  it('a marker in ingested text flags context_injected (whole-session safe side)', () => {
    expect(textLooksContextInjected(`some text ${OUROBOROS_TOKEN} more`)).toBe(true);
    expect(textLooksContextInjected('ordinary user message')).toBe(false);
  });
  it('manual-import excludes .memoring/ by canonical path', () => {
    expect(pathIsMemoringInternal('/repo/.memoring/context.md')).toBe(true);
    expect(pathIsMemoringInternal('/repo/src/app.ts')).toBe(false);
  });
});
