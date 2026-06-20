# AGENTS.md — Memoring implementation contract

This repository is a **frozen specification baseline (Spec Baseline v1.0, 2026-06-20)**. If you are
an implementation agent, you implement **against** this specification. You do not change a frozen
invariant without an ADR. The spec is the authority; your job is to realize it, not to redesign it.

The v0 implementation now lives here (`apps/`, `packages/`, `tests/`), built against this
specification. It realizes the spec; it does not redefine it. New work proceeds by the
Implementation Instructions and must keep the load-bearing invariants below intact.

## Reading order

Read in this order before writing any code (same as `README.md`):

1. **Final Design Document** (`docs/v0/en/memoring_design_final.md`) — the constitution: philosophy,
   structure, the Glossary (canonical terms), the Invariant-vs-Recipe split, the safety core.
   Read the Glossary first; every later document assumes those terms.
2. **Requirements Document** (`docs/v0/en/memoring_requirements.md`) — verifiable v0 requirements
   (FR / NFR / CON / OUT).
3. **Basic Design Document** (`docs/v0/en/memoring_basic_design.md`) — system layout, components,
   data flow, storage.
4. **Detailed Design Document** (`docs/v0/en/memoring_detailed_design.md`) — data-model contracts,
   full JSON schemas, structural invariants, the Gate predicate, Recipe initial values.
5. **Specification** (`docs/v0/en/memoring_specification.md`) — CLI / Daemon / MCP / `context.md`
   formats, settings, and the **egress permission table (§7.3, the single source of truth)**.
6. **Implementation Instructions** (`docs/v0/en/memoring_implementation_instructions.md`) — the MVP
   vertical slice, phases P0–P5, and the **13 blocking gates** (Definition of Done).

The **Project Plan** (`docs/v0/en/memoring_project_plan.md`) is the "why" — read it for context, not
for build details.

When a document says "why," go to the Final Design. "What must hold" → Requirements. "What shape"
→ Detailed Design / Specification. "In what order, how far" → Implementation Instructions.

## Load-bearing invariants (the core you must not break)

These are structural Laws, not tunables. Breaking one is a defect even if tests pass. Authority for
each is the Detailed Design (invariants, Gate predicate) and the Specification (egress table).

- **Gate First.** The output Gate runs **before** ranking — an irreversible order. Ranking is
  quality tuning, never a safety mechanism. secret / unknown / confidential(standard) / out-of-scope
  never reach ranking.
- **No raw secret egress.** Events containing keys / tokens / passwords cannot be raw-egressed under
  any Aperture; only redacted / surrogate forms, and only where the egress table allows.
- **Silence (fail-closed).** If a decision cannot be made, emit nothing. Undetermined → not output.
- **AI reaches only `candidate`.** `confirmed` is reachable only by user, explicit policy, or
  user-defined rule. AI confidence / similarity / a git remote alone never confirm.
- **Declassify is closed-enumeration, non-AI authority only.** Declassify lowers sensitivity and
  increases exposure; AI candidate cannot do it. **Escalate** raises sensitivity / reduces exposure
  and AI candidate *is* allowed (confirmation is policy / validator / user).
- **Ouroboros.** Never count Memoring's own generated context (ContextPack / `context.md`) as
  evidence or reinforcement. This applies to both the recall path and the reinforcement path.
- **origin restricts independent evidence.** Of the 10 `origin` values, only
  `user / tool_result / command_result / file_diff / external_artifact` are independent evidence;
  `assistant / host_summary / host_memory / system / unknown` are not, and
  `host_summary / host_memory / system / unknown` cannot be evidence at all. This closes the
  host-memory laundering loop.
- **sensitivity is per-Event** (one of `public / internal / confidential / secret / unknown`).
  `unclassified` is **not** a sensitivity value — it is the Scope axis meaning "no valid Assignment"
  (`classified(x)=false`). Undetermined sensitivity floors to `unknown`.
- **identity / trust is per-Realm.** Never create a cryptographic boundary inside a Realm; separate
  trust by splitting into another Realm (another directory, another key). `event_identity` is
  source-stable and **rotation-invariant** (derived from `source_identity` / `session_identity`,
  unchanged across reprocess / re-dedup / reconnect / restore / KEK rotation / DEK rekey).
- **Fully automatic consolidate.** No review queue, no per-item manual approval. Claims consolidate
  automatically; safety is enforced at output by the Gate, not by withholding consolidation.
- **Recipe (numbers) vs Invariant (shape) are separate.** Recipe values are versioned tunables;
  changing one must never break an invariant.

## How to build

Follow the Implementation Instructions: stand up the **MVP vertical slice** (capture → loop →
`context.md` through the Gate), then thicken it through **P0 → P5** in order. Safety
(Gate, safety header, Ouroboros marker, file safety) is built in from the first moment the output
exists — never bolted on later.

- Each phase's completion is judged by its items in the **13 blocking gates**
  (Implementation Instructions §7 is canonical).
- **Definition of Done = all 13 blocking gates satisfied.** Supplementary gates are checked via the
  test strategy (Implementation Instructions §6) and must not bloat the 13 blocking gates.

## v0 — what NOT to do

Confirmed out of scope for v0 (resuming any of these requires an ADR; summary of Implementation
Instructions §5.1):

- No predefined persona classification (do not hard-code personal / private / social / work /
  anonymous).
- No automatic label-merge confirmation (merge candidates are surfaced only; confirmation is
  user / policy / rule).
- No cryptographic boundary (Key Domain) inside a Realm.
- No first-party cloud backup / sync, no ReplicaManifest / root_hash sync / known-replica tracking.
- No review queue / manual approval. No live multi-device sync. No team / organization / admin.
- No desktop app. No browser scraping / private-API dependence. No import that bypasses a provider's
  access control. No hook injection / real-time event capture.
- No MCP write integration beyond `add_memory_candidate`. No span / line-level redaction (v0 closes
  the whole session that shows the marker). No pack-local alias citation IDs (v0 uses opaque IDs
  `clm_` / `evt_`). No full fine-tuning dataset builder. Vector search is not required for v0.
  No automatic ranking-weight tuning (manual Recipe only).

The four that touch the structural core directly — **no review queue**, **no predefined
categories**, **no crypto boundary inside a Realm**, **no self-generated context as evidence** —
must not be "conveniently" eroded mid-implementation.

## Common engineering conventions (Implementation Instructions §5.2)

- No speculative engineering / future-proofing / unnecessary abstraction. Implement exactly what is
  required.
- **Interface freeze:** do not change settled function signatures, data structures, or existing
  interfaces on your own.
- **Surgical changes:** do not blindly bolt conditional branches onto existing logic; fix the target
  logic.
- Delete dead code in the same change (unused imports / orphan variables / obsolete helpers).
- Never log or commit secrets / credentials / personal data — logs carry only ids / counts / states.
- Defects in the design core go through the **ADR** process, not ad-hoc implementation changes. An
  ADR states whether the change is core / contract / Recipe / example, plus impact on existing
  Realms, security / privacy, and rollback / compatibility. Core / contract changes are never made
  unilaterally in implementation.

## Language policy

- **Source code, commits, PRs, and in-code comments are English.**
- The specification is **bilingual**: Japanese (`docs/v0/ja/`) is the source of truth, English
  (`docs/v0/en/`) is the official translation. **If the two disagree, Japanese wins.**
