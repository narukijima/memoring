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

**Spec Baseline v1.0 frozen (2026-06-20) · v0 implemented.**

The seven design documents are the canonical, frozen specification (`docs/v0/`). The v0
implementation (CLI + local daemon) is built against them and lives in `apps/` and `packages/`.
v0 is single-user, local-first, source-only (TypeScript run via `tsx`, no build step). The spec
remains frozen: implementation does not change a structural invariant without an ADR (see `AGENTS.md`).

**Versioning.** Two deliberately distinct markers: `VERSION` (`1.0.0`) is the frozen **spec
baseline**; `package.json` `version` (`0.1.0`) is the **code release**. They version different
things and do not need to match.

## Quick start

Requires Node.js ≥ 20.

```bash
npm install                      # if native installs are gated:
                                 #   npm approve-scripts better-sqlite3 esbuild fsevents && npm install
npm run typecheck && npm test    # optional: verify the build

# Create an encrypted local replica (generates a passphrase + recovery code — keep both):
node bin/memoring.mjs init

# Discover and connect your Claude Code history, choosing a sensitivity policy, then backfill:
node bin/memoring.mjs connect claude-code --all --backfill --default-sensitivity internal

# From inside a project, hand safe context to your next AI session (the main exit):
node bin/memoring.mjs context build          # writes .memoring/context.md through the Gate
```

Safety model in one line: every output passes a single **Gate** (Audience × Aperture) before
ranking; secret / unknown / out-of-scope / unclassified content is never emitted; deletions and
Seals are durable across reprocessing. See the Specification (§7.3 egress table) and `SECURITY.md`.

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

[MIT](LICENSE) © The Memoring Authors. See `SECURITY.md` for the threat model and how to report vulnerabilities.
