# Contributing to Memoring

Thanks for your interest. Memoring is built against a **frozen specification** (`docs/v0/`), so
contributions realize the spec rather than redesign it.

## Before you start

- Read [`AGENTS.md`](AGENTS.md) — it is the implementation contract: load-bearing invariants, the
  Definition of Done (the 13 blocking gates), and the v0 prohibitions. The same contract applies to
  human and AI contributors.
- Read the Glossary in `docs/v0/en/memoring_design_final.md` first; later documents assume its terms.
- The Japanese spec (`docs/v0/ja/`) is the source of truth; English (`docs/v0/en/`) is the official
  translation. If they disagree, Japanese wins.

## Development

```bash
npm install            # if native installs are gated: npm approve-scripts better-sqlite3 esbuild fsevents && npm install
npm run typecheck      # must stay clean
npm test               # must stay green
```

Source-only (TypeScript via `tsx`, no build step). Run the CLI with `node bin/memoring.mjs <cmd>`.

## Conventions

- **Surgical diffs, strict YAGNI.** Implement exactly what is needed; no speculative abstractions.
- **Interface freeze.** Do not change settled function signatures / data structures on your own.
- **Delete dead code** in the same change you create it.
- **English** for all code, comments, commits, and PRs.
- **Conventional Commits** (`fix:`, `feat:`, `docs:`, `chore:`, …), imperative and concise.
- **Never commit secrets or personal data.** Logs and audit records carry only ids / counts / state.
- Keep `npm run typecheck` and `npm test` green; add a regression test for every fix.

## Changing the design core

A change to **core / contract / structural invariants** is not an ordinary code change — it requires
an **ADR** (see Detailed Design §11) stating the change target, impact on existing Realms, the
security/privacy impact, and the rollback/compatibility policy. Recipe numbers (thresholds, weights,
budgets) are versioned tunables and may change without an ADR, but must never break an invariant.

## Security

Do not file security issues as public issues — see [`SECURITY.md`](SECURITY.md).
