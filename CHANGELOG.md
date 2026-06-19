# Changelog

All notable changes to the Memoring specification baseline are recorded here.
This repository contains the specification only; implementation is a separate phase.

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
