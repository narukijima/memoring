// LLM memory provider (Mode B local / Mode C remote). A backend-agnostic
// MemoryProvider that asks a language model to abstract DURABLE memories from
// Events. It only PROPOSES candidates — the validator/Gate keep authority
// (CON-002), so a model can never push a Claim to `confirmed`. Vendor specifics
// live behind LlmBackend so this file stays vendor-neutral (provider boundary,
// Basic Design §2.6/§8). A `remote` backend's raw-text egress is gated upstream
// in extractor.ts (pre-egress sensitivity gate); this provider never sees an
// event the caller chose not to forward.
import { CLAIM_KINDS, type ClaimKind } from '@core/schema/enums';
import type { AbstractCandidate, AbstractInput, MemoryProvider } from './provider';

/** Vendor adapter boundary: one model round-trip. `egress` declares whether the
 *  call leaves the device, which the provider surfaces to drive the pre-egress
 *  gate (local = on-device, same trust envelope as Mode A; remote = off-device). */
export interface LlmBackend {
  id: string;
  model: string;
  egress: 'local' | 'remote';
  complete(prompt: string): Promise<string>;
}

// Language-agnostic by construction (no keyword lists): the model reads turns in
// any language. The instruction targets the observed Mode-A failure head-on —
// pasted role/mission prompts and one-off task instructions must NOT be kept.
const EXTRACTION_INSTRUCTION = [
  'You extract DURABLE, cross-session memories from a coding assistant conversation.',
  'A memory is DURABLE if it stays useful in a FUTURE, unrelated session: a standing user',
  'preference ("I always use X", "never Y"), a settled decision ("we decided X", "X will be',
  'used"), a stable project fact, or a reusable procedure.',
  'Do NOT keep: ephemeral or one-off task instructions, pasted role/mission/agent prompts',
  '("You are a ... reviewer"), tool output, shell banners, greetings, or anything specific',
  'only to the current task.',
  'Return ONLY a JSON array (no prose, no code fence). Each element:',
  '{"kind": one of ["preference","constraint","decision","fact","project_context","procedure"],',
  ' "statement": a concise, self-contained restatement (<= 280 chars),',
  ' "confidence": number 0..1,',
  ' "mode": "explicit" if the user stated it directly, else "inferred",',
  ' "source": the [#N] turn number this memory came from}.',
  "Example — turn '[#9 user] I always use tabs, never spaces.' yields:",
  '[{"kind":"preference","statement":"Uses tabs, never spaces.","confidence":0.9,"mode":"explicit","source":9}]',
  'If nothing qualifies, return [].',
].join('\n');

export function buildPrompt(inputs: AbstractInput[]): string {
  const turns = inputs.map((i, n) => `[#${n + 1} ${i.role ?? i.origin}] ${i.text}`).join('\n\n');
  return `${EXTRACTION_INSTRUCTION}\n\nConversation turns:\n${turns}`;
}

function stripFences(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1]!.trim() : t;
}

/** Parse a model response into validated candidates. Tolerant of code fences and
 *  a `{ "candidates": [...] }` wrapper; strict on kind/statement so malformed or
 *  hallucinated fields are dropped rather than poisoning the candidate stream. */
export function parseCandidates(raw: string): AbstractCandidate[] {
  let data: unknown;
  try {
    data = JSON.parse(stripFences(raw));
  } catch {
    return [];
  }
  let arr: unknown[] = [];
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).candidates)) {
    arr = (data as Record<string, unknown>).candidates as unknown[];
  }

  const kinds: ReadonlySet<string> = new Set(CLAIM_KINDS);
  const out: AbstractCandidate[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const statement = typeof o.statement === 'string' ? o.statement.trim() : '';
    if (typeof o.kind !== 'string' || !kinds.has(o.kind) || statement.length === 0) continue;
    const confidence = Math.min(1, Math.max(0, typeof o.confidence === 'number' ? o.confidence : 0.7));
    // The model cites a 1-based [#N] turn; convert to a 0-based input index.
    // Missing/invalid → 0 (the caller drops it if out of range for the batch).
    const sourceIndex =
      typeof o.source === 'number' && Number.isFinite(o.source) ? Math.max(0, Math.floor(o.source) - 1) : 0;
    out.push({
      kind: o.kind as ClaimKind,
      statement: statement.slice(0, 280),
      mode: o.mode === 'explicit' ? 'explicit' : 'inferred',
      confidence,
      sourceIndex,
    });
  }
  return out;
}

export class LlmMemoryProvider implements MemoryProvider {
  readonly id: string;
  readonly name: string;
  readonly version = 'llm.v1';
  readonly egress: 'local' | 'remote';

  constructor(private readonly backend: LlmBackend) {
    this.id = `llm:${backend.id}:${backend.model}`;
    this.name = `LLM (${backend.id} / ${backend.model})`;
    this.egress = backend.egress;
  }

  async abstract(inputs: AbstractInput[]): Promise<AbstractCandidate[]> {
    if (inputs.length === 0) return [];
    const raw = await this.backend.complete(buildPrompt(inputs));
    return parseCandidates(raw);
  }
}
