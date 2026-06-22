// Token estimation for the context.md budget (§3.6). v0 used Math.ceil(len/4),
// which is internally consistent but UNDER-counts what context.md is full of —
// opaque IDs (clm_01K…, dense random base32), markdown punctuation, newlines — so
// "does not exceed token_budget" could be optimistic against a real model tokenizer.
//
// This is a dependency-free, on-device structural approximation of a GPT-style
// (cl100k/o200k) tokenizer: pre-tokenize into word / number / symbol / whitespace
// pieces (the same shape as the cl100k pre-tokenization regex) and sum a per-piece
// sub-token estimate. It is intentionally slightly CONSERVATIVE (rounds up on the
// unpredictable pieces) so the budget guarantee stays safe-side. It is NOT exact; a
// real vendored BPE can replace the body behind the same estimateTokens() signature
// without touching the allocator, the trim loop, or the eval — they all call this one
// function (the single source of truth, so they can never drift apart).
//
// These constants are estimator calibration, not user-facing knobs (CON-017 is about
// not creating a "third category" of hand-tuned numbers); they live here, documented,
// rather than in a Recipe.

// cl100k-style pre-tokenization: contractions, optional-leading-space letter runs,
// number runs, symbol runs, and whitespace runs. Unicode-aware so CJK is counted
// (where tokenizers run far denser than 4 chars/token). Every character matches
// exactly one alternative, so coverage is total.
const PIECE_RE = /'(?:[sdmt]|ll|ve|re)| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+/gu;
const CJK_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

const CHARS_PER_WORD_TOKEN = 4; // English averages ≈ 4 chars/token
const DIGITS_PER_NUMBER_TOKEN = 3; // cl100k splits numbers into ≤3-digit groups
const CHARS_PER_SYMBOL_TOKEN = 2; // punctuation/ID runs ≈ 1 token per ~2 chars
const CHARS_PER_CJK_TOKEN = 1.0; // CJK ≈ 1 token per char in cl100k (safe-side)

function estimatePiece(piece: string): number {
  if (/^\s+$/u.test(piece)) {
    // A lone space is absorbed into the following word's leading-space token; runs
    // and newlines add tokens (~1 per 2 whitespace chars).
    if (piece === ' ') return 0;
    return Math.max(1, Math.ceil(piece.length / 2));
  }
  const body = piece.trimStart(); // a leading space rides along in the same token
  if (CJK_RE.test(body)) return Math.max(1, Math.ceil(body.length / CHARS_PER_CJK_TOKEN));
  if (/^\p{L}/u.test(body)) return Math.max(1, Math.round(body.length / CHARS_PER_WORD_TOKEN));
  if (/^\p{N}/u.test(body)) return Math.max(1, Math.round(body.length / DIGITS_PER_NUMBER_TOKEN));
  return Math.max(1, Math.ceil(body.length / CHARS_PER_SYMBOL_TOKEN));
}

/** Estimate the GPT-style token count of `text`. Deterministic, on-device, and the
 *  single source of truth for the context.md token budget (allocator + trim loop +
 *  eval all call this). Slightly conservative by design (safe-side for §3.6). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const m of text.matchAll(PIECE_RE)) tokens += estimatePiece(m[0]);
  return tokens;
}
