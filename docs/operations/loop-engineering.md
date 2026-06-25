# Loop Engineering — operator discipline (non-normative)

**Status: non-normative operations guidance.** This document adds no invariant, Recipe value, or
behavior. It does not change `context.md`, the Gate, the egress permission table, the 13 blocking
gates, Claim authority, loop convergence, or public CLI behavior. Where it states a rule, that rule
is a restatement of an existing frozen invariant for the benefit of a human or AI operator running
the system under automation. If anything here appears to conflict with `docs/v0/`, the frozen
specification wins and this file is the bug.

## Two loops, do not conflate them

There are two distinct loops, at two layers:

- **Memoring's internal loop** is fixed and already converges in code:
  `capture → normalize → classify → abstract → consolidate`, then **Gate-first recall** to
  `context.md`. Convergence to idle and the ban on re-eating its own output are guaranteed by the
  invariants — Loop convergence / idle (Detailed Design §4.13) and the Ouroboros Law
  (Detailed Design §4.12). The Gate runs **before** ranking (AGENTS.md "Gate First").
- **Loop Engineering** is the **external operator's discipline** for driving change *into* the
  repository and operating the system: how an operator (or an AI agent acting for one) proposes a
  diff, verifies it, persists it, and decides when to stop. It lives entirely outside the product.
  It must never relax an internal invariant to make an outer iteration "converge."

When this document says "the loop," it means the **outer operator loop** unless it explicitly names
the internal one.

## Generator / evaluator split

Loop Engineering is a generator/evaluator pair. The split mirrors Claim authority
(`CON-002`: "AI/rule output only proposes; authority lives in the validator", see
[`packages/claim/validator.ts`](../../packages/claim/validator.ts)).

- **Generator (proposes, never authorizes):** the AI agent or memory provider drafts the change —
  code, a Recipe value, a candidate Claim. A proposal carries no authority on its own.
- **Evaluator (authorizes):** a change is accepted only when the evaluators agree:
  1. the **validator** ([`packages/claim/validator.ts`](../../packages/claim/validator.ts)) for
     Claim consolidation — schema → evidence/origin → sensitivity → policy → suppression;
  2. the **Gate tests** and **recall eval** for output safety and `context.md` quality;
  3. **`npm test` / `npm run typecheck`** for the contract;
  4. **human external-impact review** for anything that crosses a checkpoint below.

A generator that also signs off on its own output is a defect — it is the outer-loop form of letting
self-generated context count as evidence.

## Verification is the evaluator

`npm run eval` ([`tests/recall-eval.test.ts`](../../tests/recall-eval.test.ts)) is the **primary
quality evaluator for `context.md`**. It runs the real Gate-first pipeline over the fixture and
scores five axes — safety, required-constraint coverage, stale-warning correctness, token budget,
opaque-citation consistency — and fails on any regression.

For any change touching **retrieval, `context.md`, the Gate, or the validator**, the evaluator is
all three of:

```bash
npm run typecheck   # the contract still holds
npm test            # invariants and unit/integration behavior
npm run eval        # context.md quality across the 5 scored axes
```

Treat a green run as necessary, not sufficient: it does not authorize a checkpoint crossing (below).

## Unattended / scheduled work must be bounded

Any agent run that is unattended, looped, or scheduled **must declare, up front**, all of:

| Bound | Meaning |
| --- | --- |
| **Signal** | the observable condition the run reacts to (a new diff, a failing test, a review request) — never "keep going". This is the outer-loop analogue of `new_observational_evidence` (§4.13). |
| **Stop condition** | the explicit success/failure predicate that ends the run. |
| **Max retries** | hard cap on re-attempts of a failing step. |
| **Max LLM calls** | hard cap on model invocations for the run. |
| **Per-run budget** | token / cost ceiling for a single run. |
| **Daily budget** | token / cost ceiling across runs in a day. |

A run with no new signal and no pending work must **idle**, not poll — exactly as the internal loop
goes idle with no new evidence (§4.13). A run that cannot make progress stops at its cap and reports;
it does not spin.

## Human checkpoints

A human must be in the loop at these points, and **only** as a gate on the *change*, never as a
queue over individual Claims (the product is fully automatic consolidation — AGENTS.md
"Fully automatic consolidate"; there is **no review queue**):

- **ADR** — any core / contract / Recipe / invariant change (AGENTS.md "Defects in the design core go
  through the ADR process").
- **Recipe change** — even though Recipe values are versioned tunables, retuning them is a human
  decision, and a Recipe change must never break an invariant.
- **Remote AI egress** — any send to an external provider. OFF by default; governed by the egress
  permission table (Specification §7.3) and remote-AI sending rules (§7.5).
- **Delete / redact** — destructive or exposure-changing operations on the user's data.
- **PR merge.**
- **Release.**

Human checkpoints gate **transitions of the system**, not the steady-state operation of the loop.
Putting a human on every consolidated Claim is the wrong design and is forbidden.

## Hard prohibitions (operator loop)

These are restatements of frozen invariants in operational terms. None may be relaxed to make an
outer iteration converge:

- **No zero-diff spinning.** A run that produces no diff and has no new signal must stop/idle, not
  loop. (Outer-loop form of §4.13 convergence; the internal loop already forbids busy spinning.)
- **No generated context as evidence.** Never feed Memoring's own `context.md` / ContextPack back in
  as input, evidence, or justification — for a Claim or for a code change. (Ouroboros Law §4.12;
  `manual_import_path includes .memoring/ ⇒ exclude`.)
- **No automatic external action without explicit authority:** no auto PR merge, no auto deploy, no
  remote AI egress, no destructive/redacting operation, and **no Recipe retuning** performed by an
  agent on its own. Each requires the corresponding human checkpoint above.
- **No loosening of safety surfaces.** Gate, egress table, Silence (fail-closed), Ouroboros,
  token budget (§3.6), and active-scope resolution are not operator tunables and must not be widened
  to get a run to pass.

## Branch / worktree isolation

Run parallel agent work on **isolated branches or git worktrees** (`feat/…`, `fix/…`, etc., per
AGENTS.md Git Conventions), one change per branch. This keeps generators from corrupting each other's
trees, keeps each diff independently reviewable at its checkpoint, and keeps `.memoring/` artifacts
from one run out of another run's input (reinforcing the Ouroboros boundary).

## Operator checklist

For every agent-driven change:

- [ ] **Discovery** — read the relevant frozen spec section(s) and existing code before proposing.
      Identify whether the change crosses a checkpoint (ADR / Recipe / egress / delete-redact /
      merge / release).
- [ ] **Handoff** — the generator proposes a surgical diff on an isolated branch/worktree; no
      self-authorization.
- [ ] **Verification** — run the evaluator. For retrieval/context/Gate/validator changes:
      `npm run typecheck && npm test && npm run eval`. Inspect output; do not trust a summary.
- [ ] **Persistence** — commit the diff (Conventional Commits) with the *why*; never commit secrets,
      `.memoring/` data, or generated context.
- [ ] **Scheduling** — if unattended/looped, declare signal + stop condition before starting.
- [ ] **Caps** — declare max retries, max LLM calls, per-run budget, daily budget; idle on no signal.
- [ ] **Human checkpoint** — stop and request human sign-off at ADR / Recipe / remote egress /
      delete-redact / PR merge / release. Never queue per-Claim.

## Evaluator template

When acting as the evaluator (reviewing a proposed change before it is accepted), **assume the change
is broken until proven otherwise**:

1. **Assume broken.** Default verdict is reject. The generator must earn acceptance.
2. **Run the commands.** Execute `npm run typecheck`, `npm test`, and (for
   retrieval/context/Gate/validator changes) `npm run eval`. Do not accept on description alone.
3. **Inspect the output.** Read the actual scorecard, the failing assertions, the produced
   `context.md` — not the agent's summary of them.
4. **Verify against the frozen spec.** Check the change against the named invariant (Detailed Design
   for invariants/Gate predicate, Specification §7.3 for egress) — not against vibes.
5. **Reject with a concrete reason.** A rejection must name the specific failure, e.g.:
   - **Gate** — secret / unknown / out-of-scope / unclassified content could reach output, or
     ranking was allowed to run before the Gate.
   - **Silence** — an undetermined decision emits something instead of nothing (fail-closed broken).
   - **Ouroboros** — self-generated context (`.memoring/`, prior ContextPack) was used as evidence,
     reinforcement, or change justification.
   - **Egress** — a send violates the §7.3 table (raw secret egress, a `deny`/`surrogate` cell
     treated as `raw`, or remote AI without the human checkpoint).
   - **Token budget** — the emitted document exceeds `token_budget` (§3.6), or the constraints
     safety-floor was trimmed.

A change is accepted only when no such reason remains and the relevant human checkpoint (if any) has
been cleared.
