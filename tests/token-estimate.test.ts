// estimateTokens — the single source of truth for the context.md token budget.
// These pin the calibration that matters: it is deterministic, conservative vs the
// real tokenizer for the dense content context.md is full of (opaque IDs, markdown
// punctuation, CJK), and never wildly over for plain prose. A future real BPE must
// keep these properties.
import { describe, expect, it } from 'vitest';
import { estimateTokens } from '@core/token-estimate';

const charsOver4 = (s: string): number => Math.ceil(s.length / 4);

describe('estimateTokens', () => {
  it('is 0 for empty and deterministic', () => {
    expect(estimateTokens('')).toBe(0);
    const s = 'the quick brown fox jumps over the lazy dog';
    expect(estimateTokens(s)).toBe(estimateTokens(s));
  });

  it('tracks plain English close to ~0.75 tokens/word, not wildly over', () => {
    // 9 words → a real tokenizer gives ~9–11; stay in a sane band (not 2× chars/4).
    const t = estimateTokens('the quick brown fox jumps over the lazy dog');
    expect(t).toBeGreaterThanOrEqual(8);
    expect(t).toBeLessThanOrEqual(14);
  });

  it('counts opaque IDs DENSER than chars/4 (the reason char/4 was unsafe)', () => {
    const id = 'clm_01KVRJV5WTJ4M9S463KJZAN141'; // 29 dense base32-ish chars
    expect(estimateTokens(id)).toBeGreaterThan(charsOver4(id)); // ~13 vs 8
  });

  it('counts a citation/evidence line denser than chars/4', () => {
    const line = '- clm_01KVRJV5WTJ4M9S463KJZAN141: kind=decision, evidence=3';
    expect(estimateTokens(line)).toBeGreaterThan(charsOver4(line));
  });

  it('counts CJK at roughly one token per character (cl100k-dense, safe-side)', () => {
    const ja = '日本語のテスト文字列';
    expect(estimateTokens(ja)).toBeGreaterThanOrEqual(ja.length); // ≥ 1 token/char
  });

  it('grows monotonically with repeated content', () => {
    const one = estimateTokens('constraint: never force-push to main.');
    const ten = estimateTokens('constraint: never force-push to main.\n'.repeat(10));
    expect(ten).toBeGreaterThan(one * 8);
  });
});
