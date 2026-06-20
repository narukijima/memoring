# Changelog

All notable changes to Memoring — the frozen specification baseline and the v0 implementation
built against it — are recorded here.

## Unreleased — v0 implementation (branch `feat/v0-mvp`)

- **v0 implemented** against the frozen spec: CLI + local daemon, the four cores
  (intake → storage → loop → egress), all 13 blocking gates satisfied. Single-user, local-first,
  source-only (TypeScript via `tsx`). Storage is in-memory SQLite persisted as one AEAD-encrypted
  blob (no on-disk SQLite/WAL/FTS by construction).
- **Independent multi-pass review & polish.** Three adversarial review passes (two models) found and
  fixed real defects, each with a regression test. Highlights:
  - Closed a **host-memory laundering** hole: host-injected CLAUDE.md / `<system-reminder>` lines
    were mis-classified as user evidence (Gate 8 was effectively failing); now routed to a
    non-evidence origin at intake.
  - Hardened the secret scanner against fail-open credential misses (and a ReDoS regression).
  - Emitted conflicted Claims into the Open-conflicts section (previously dead code).
  - Surfaced malformed parser lines and preserved unknown source fields; matched active scope by
    git remote; honest not-found for `forget`/`delete`; ContextPack manifest cascade.
  - Prevented cross-process DB clobbering with a replica lock, scoped to a daemon tick so `watch`
    and `context build` coexist without reviving Sealed content.
- **OSS release prep:** MIT `LICENSE`, `SECURITY.md` (threat model + reporting), `CONTRIBUTING.md`,
  and package metadata.

## v1.0 — 2026-06-20

- **Spec baseline frozen** (Spec Baseline v1.0). The seven design documents are the
  canonical, frozen specification the implementation builds against.
- Reorganized into a bilingual layout: Japanese source in `docs/v0/ja/`, official English
  translation in `docs/v0/en/` (same seven filenames; directory encodes language).
- Added the official English edition of all seven documents, faithful to the Japanese
  source (invariants, numbers, JSON schemas, IDs, and the egress permission table kept
  byte-identical across editions).
- Added root `README.md` (overview, document map, source-of-truth policy, governance) and
  `AGENTS.md` (implementation contract, load-bearing invariants, Definition of Done).
- Source-of-truth fix (Japanese-first, propagated to English): Specification §6.1 corrected
  to reference the **10** fixed `context.md` sections defined in §3.2 (was "11").
