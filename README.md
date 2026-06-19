# Memoring — Sovereign Memory Loop

**Memoring: Own your AI memory.**

Memoring is a local-first, OSS **Sovereign Memory Loop**. It ingests the history that AI tools
(Codex, Claude Code, ChatGPT, Claude, Gemini, …) accumulate locally — conversations, instructions,
responses, tool runs, command results, file diffs, decisions, constraints, preferences, work
patterns — and turns it into a memory asset you actually control: automatically captured,
organized, classified, abstracted, and consolidated, then handed back only when needed as safe
context. Here, **own means user-controlled**: you hold your own copy, and you govern the keys,
deletion, portability, and egress. It is not a claim of legal ownership over third-party content.
Memoring is not a log store and not a database — the DB, object store, and index are only the
substrate; the product value is the loop that keeps growing history into usable memory and context.

---

## Status

**Frozen — Spec Baseline v1.0 (2026-06-20).**

This repository is the canonical, frozen specification baseline that implementation works against.
No implementation code lives here yet — building it is a separate, later phase (see `AGENTS.md`).

## Document map

The specification is the single source of truth for the v0 build. Seven documents, in two
languages. Directory encodes language: `docs/v0/ja/` (source) and `docs/v0/en/` (official translation).
Same seven filenames in both.

Recommended reading order (the core spine):

| # | Document | `docs/v0/ja` · `docs/v0/en` | What it gives you |
| --- | --- | --- | --- |
| 1 | **Final Design Document** (the constitution) | [ja](docs/v0/ja/memoring_design_final.md) · [en](docs/v0/en/memoring_design_final.md) | Philosophy, structure, the Glossary (canonical terms), Invariants vs Recipe, the safety core. Read the Glossary first. |
| 2 | **Requirements Document** | [ja](docs/v0/ja/memoring_requirements.md) · [en](docs/v0/en/memoring_requirements.md) | Verifiable v0 requirements with IDs (FR / NFR / CON / OUT). |
| 3 | **Basic Design Document** | [ja](docs/v0/ja/memoring_basic_design.md) · [en](docs/v0/en/memoring_basic_design.md) | Whole-system layout, components and responsibilities, data flow, storage. |
| 4 | **Detailed Design Document** | [ja](docs/v0/ja/memoring_detailed_design.md) · [en](docs/v0/en/memoring_detailed_design.md) | Data-model contracts, full JSON schemas, structural invariants, Gate predicate, Recipe initial values. |
| 5 | **Specification** | [ja](docs/v0/ja/memoring_specification.md) · [en](docs/v0/en/memoring_specification.md) | CLI / Daemon / MCP / `context.md` formats, settings, and the egress permission table (§7.3, the single source of truth for output). |
| 6 | **Implementation Instructions** | [ja](docs/v0/ja/memoring_implementation_instructions.md) · [en](docs/v0/en/memoring_implementation_instructions.md) | MVP vertical slice, phases P0–P5, and the 13 blocking gates (Definition of Done). |

Read on its own track (the "why" and the market framing):

| Document | `docs/v0/ja` · `docs/v0/en` | What it gives you |
| --- | --- | --- |
| **Project Plan** | [ja](docs/v0/ja/memoring_project_plan.md) · [en](docs/v0/en/memoring_project_plan.md) | Why Memoring exists, who it serves, where it is going. |

## Source-of-truth policy

- **Japanese (`docs/v0/ja/`) is the source of truth.** English (`docs/v0/en/`) is the official translation.
- If the two editions disagree, that is a bug: the Japanese edition wins and the English is corrected.
- Numbers, invariants, JSON schemas, requirement statements, and the egress permission table are
  kept byte-identical across both editions.

## Governance

- Changes to **core / contract / invariants** require an **ADR** (Architecture Decision Record).
- **Recipe** numbers (thresholds, weights, budgets) are **versioned tunables** — they may change
  without an ADR, but a Recipe change must never break a structural invariant.
- The frozen baseline is the specification only. **Implementation code is a separate phase** and
  does not modify the frozen invariants without an ADR.

## License

TBD.
