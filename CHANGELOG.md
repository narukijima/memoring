# Changelog

All notable changes to Memoring — the frozen specification baseline and the v0 implementation
built against it — are recorded here.

## Unreleased — version reporting

- **Single source of truth for the version string.** `memoring version` / `--version` now report both
  numbers dynamically — `memoring <package.json version> (spec <VERSION>)`, e.g. `memoring 0.1.2
  (spec 1.0.0)` — read from the source tree at runtime (relative to the source location, not the
  caller's CWD) instead of a hardcoded `memoring v0 (spec-v1.0)`. The MCP `serverInfo.version` reuses
  the same package version. A test pins the output to `package.json` and the `VERSION` file so the
  implementation/release version, the frozen spec baseline, and what the CLI prints can never silently
  diverge. They are intentionally different numbers; see `docs/adr/0008-cli-upgrade-path.md` for the
  semantics and the deferred, opt-in update-notifier plan.

## Unreleased — multi-Realm CLI

- **First-class multi-Realm management.** Added `memoring realm new/list/use/current/rename/rm`
  backed by a local plaintext registry (`realms.toml`) that stores only names/ids/roots/key mode.
  New Realms are created under `<base>/realms/<slug>/`, registered, and made current; legacy direct
  replicas at `<base>/realm.toml` remain valid and are lazily registered without moving data.
- **Fail-closed active Realm resolution.** Recall/data commands resolve by `--realm`, then a direct
  base replica (only while it is the sole Realm — legacy single-replica back-compat), then a unique
  CWD match across registered Realms' `realm.toml` project roots/git remotes. Once a second Realm is
  registered, a base replica no longer short-circuits, so `realm use`/CWD switching engages even on an
  `init`-at-base layout. They do not fall back to sticky `current`; unresolved/ambiguous resolution
  Silences. `watch` binds an explicit Realm at launch and refuses CWD/current inference.
- **Safety boundaries preserved.** No cross-Realm search/context, no key/Gate identity changes, and
  `realm rm` is confirmed, audited, refuses the last Realm, and avoids deleting roots that contain
  the registry base or another Realm.
- **Global `memoring` command.** The `bin/memoring.mjs` launcher is marked executable and the README
  documents `npm link` (or `npm install -g .`) to put a `memoring` command on the PATH, so the CLI can
  be run as `memoring <command>` from anywhere (still source-only via `tsx`, no build step). Running
  `node bin/memoring.mjs <command>` from the repo remains the no-link fallback.

## 0.1.2 — passwordless by default

- **Passwordless default; passphrase becomes opt-in.** `memoring init` now creates a passwordless
  replica by default — the vault stays AEAD-encrypted, but the key lives in a local `keys/key.json`
  (`0600`), so there is no password to set or forget. `memoring init --passphrase` opts into the
  strong scrypt-wrapped vault with a one-time recovery code. Key handling is centralized in a single
  mode-aware `openActiveRealm()` in core (CLI commands no longer each manage keys), which is also
  what lets a future UI reuse the same path. Default mode is *local convenience protection*, not full
  at-rest encryption — see `SECURITY.md` and the rationale/threat model in
  `docs/adr/0001-passwordless-default.md`. Opening an existing `--passphrase` replica still works
  (backward compatible); only the *default* key format is new.

## Unreleased — v0 implementation

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
- **Install robustness (0.1.1):** the `memoring` launcher now prints a clear, actionable error when
  dependencies are missing instead of exiting silently; README documents the supported Node range
  (20/22 LTS — the native `better-sqlite3` build can fail on the newest Node, e.g. 26) and the
  clone-then-`cd` step; added `.nvmrc` (22) and an `engines` upper bound.

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
