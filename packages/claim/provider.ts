// Memory provider (the AI adapter boundary, Basic Design §2.6/§8). The provider
// only PROPOSES candidates; authority lives in the validator/gate/policy/evidence
// (CON-002). Provider-specific code never enters core.
//
// v0 ships a deterministic rule-based provider (Mode A "no-AI degraded" that is
// still functional). A real local/remote LLM (Mode B/C) is a drop-in adapter and
// must still pass the same validator/gate — it can never reach `confirmed`.
import type { ClaimKind } from '@core/schema/enums';

export type MaybePromise<T> = T | Promise<T>;

export interface AbstractInput {
  text: string;
  origin: string;
  role: string | null;
}

export interface AbstractCandidate {
  kind: ClaimKind;
  statement: string;
  confidence: number;
  /** explicit user statement vs merely inferred pattern (Detailed Design §10.1). */
  mode: 'explicit' | 'inferred';
}

export interface MemoryProvider {
  id: string;
  name: string;
  version: string;
  /** Egress class of this provider's `abstract` call. `local` runs entirely
   *  on-device (Mode A rule-based / local LLM) and shares the loop's trust
   *  envelope. `remote` sends raw Event text off-device (Mode C) and MUST be fed
   *  only events that clear the pre-egress sensitivity gate — the caller enforces
   *  this (extractor.ts), reusing the output Gate's `allowedSensitivity` so there
   *  is no second, divergent safety predicate. */
  egress: 'local' | 'remote';
  /** abstract — the leap from Events to Claim candidates. May be async (a model
   *  call); the caller awaits. Batch-capable by signature (`inputs[]`). The
   *  provider only PROPOSES; authority stays in the validator/Gate (CON-002), so a
   *  candidate can never self-promote to confirmed. */
  abstract(inputs: AbstractInput[]): MaybePromise<AbstractCandidate[]>;
}

interface Pattern {
  re: RegExp;
  kind: ClaimKind;
}

// Conservative explicit-statement patterns. These fire only on user-origin text
// (the caller restricts inputs), so the resulting candidate's evidence is a
// user-origin Event — enough for an explicit preference/constraint/decision.
const PATTERNS: Pattern[] = [
  { re: /\b(?:never|do not|don't|must not|avoid|no longer)\b/i, kind: 'constraint' },
  { re: /\b(?:always|must|make sure to|be sure to|ensure that)\b/i, kind: 'constraint' },
  { re: /\b(?:i prefer|i'd prefer|i like|prefer to|please use|use .* instead of|i want you to)\b/i, kind: 'preference' },
  { re: /\b(?:we decided|let's go with|i'll use|we'll use|decision:|i decided|going with|chose to)\b/i, kind: 'decision' },
  { re: /\b(?:the project|this repo|this project|our codebase) (?:is|uses|targets|is called)\b/i, kind: 'project_context' },
];

function firstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  const m = trimmed.match(/^.{1,280}?[.!?。！？](\s|$)/);
  return (m ? m[0] : trimmed).slice(0, 280).trim();
}

export class RuleBasedProvider implements MemoryProvider {
  id = 'rule_based';
  name = 'rule-based (no-AI degraded)';
  version = 'rule_based.v1';
  egress = 'local' as const; // pure in-process regex; never leaves the device

  abstract(inputs: AbstractInput[]): AbstractCandidate[] {
    const out: AbstractCandidate[] = [];
    for (const input of inputs) {
      const text = input.text;
      if (!text || text.length < 8) continue;
      for (const p of PATTERNS) {
        if (p.re.test(text)) {
          out.push({
            kind: p.kind,
            statement: firstSentence(text),
            confidence: 0.85, // explicit user statement → meets τ_conf for explicit kinds
            mode: 'explicit',
          });
          break; // one candidate per event in v0
        }
      }
    }
    return out;
  }
}
