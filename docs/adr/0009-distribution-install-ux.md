# ADR 0009 — Distribution and install UX

- Status: Accepted (plan only; the native-dependency strategy is deferred to its own ADR)
- Date: 2026-06-24
- Scope: how end users install and obtain Memoring (packaging / distribution channels).
  No code or behaviour change — this records a roadmap and its gating prerequisite. Builds on
  ADR-0008 (version reporting + upgrade path).
- Relates to: ADR-0008 (upgrade path / opt-in update-notifier), ADR-0003 (egress, no-egress-by-default),
  ADR-0001 (passwordless default / at-rest AEAD blob), Specification §5.1 (replica layout), §7.3 (egress table).

## Context

The v0 install is **source-only / from-source**:

```bash
git clone … && cd memoring
npm install        # compiles the native better-sqlite3 dependency
npm link           # puts a global `memoring` on PATH
```

`package.json` is `private: true`, so Memoring is **not published to npm**; cloning is the only path.
There is no build step (the CLI runs TypeScript via `tsx`), and no Docker image, single-file binary,
or Homebrew formula.

This is a **developer install, not an end-user quickstart.** Peer CLIs set the expectation:

- **Claude Code** — a native installer (`curl … | sh`) plus **Homebrew**.
- **Codex** — an npm-wrapped binary (`npm i -g …`) plus **Homebrew**.

Both distribute **self-contained, prebuilt binaries**: the user needs no Node toolchain and no native
compile. Memoring currently requires the opposite (install Node → build a native addon → link). That
gap is precisely why Memoring cannot offer a one-line quickstart today.

The goal is quickstart parity (a one-liner install plus a trivial upgrade) **without** eroding the
local-first / sovereign / no-egress-by-default posture and **without** touching a frozen invariant.
ADR-0008 already decided the *upgrade* mechanics and the first distribution rung (flip
`private` → `false` and `npm publish` at v1; an opt-in, no-telemetry update-notifier deferred). This
ADR places that into a full roadmap and names the one prerequisite that gates the rest.

## Decision

### A phased distribution roadmap

Adopt the phases below. Each builds on the previous and is pulled **only when its prerequisite is
met** — do not build ahead of need (YAGNI).

| Phase | Channel | Install / upgrade | Prerequisite | Peer parity |
| --- | --- | --- | --- | --- |
| **0 — now** | from source | `git clone` → `npm install` → `npm link`; upgrade = `git pull` (ADR-0008) | none (current state) | — |
| **1 — at v1** | npm | `npm install -g memoring`; upgrade `npm i -g memoring@latest` / `npm update -g memoring` | flip `private`→`false` + `npm publish` (ADR-0008) | Codex (npm) |
| **2** | Homebrew | `brew install …` | native-dependency strategy resolved (below) | Claude / Codex (brew) |
| **3** | self-contained binary | `curl … \| sh` installer + single executable | a packaging mechanism that embeds the native binary | Claude (native install) |

Phase 1 is the cheapest rung and is already specified by ADR-0008; it is the natural first action at
v1. Phase 1 still requires the user to have Node and a working/prebuilt native dependency — see below.

### Gating prerequisite: the native-dependency strategy

The blocker to Phases 2–3 (and a reliability gap even in Phase 1) is the **native `better-sqlite3`
dependency**: a published npm package still fails to install for users on an unsupported Node version
or without a build toolchain, and there is no way to ship a single binary while a native addon must be
compiled on the user's machine. Any clean quickstart requires **removing or fully prebuilding** this
dependency. The options, to be chosen in a **dedicated ADR before Phase 2**:

- **(a) Migrate to Node's built-in `node:sqlite`** (Node 22.5+). Removes the native dependency
  entirely and simplifies every downstream packaging path. It **must** preserve the storage
  invariants: the at-rest vault is an AEAD blob (`memoring.db`), **never** an on-disk SQLite/WAL file
  (Specification §5.1, ADR-0001); the engine swap must keep decrypt-in-memory / re-encrypt and the
  `event_identity` / Seal / durability behaviour identical.
- **(b) Guarantee prebuilt binaries** for every target OS/Node combination (`better-sqlite3` ships
  prebuilds; pin `engines` and verify coverage in CI). Lower migration risk; ongoing maintenance to
  track Node releases.
- **(c) Bundle the native `.node`** into a self-contained binary (the Phase 3 mechanism). Defers the
  problem into the packaging layer rather than removing it.

The storage-engine choice is a **contract-level decision** and goes through its own ADR; it is **not**
made here. This ADR only records that distribution beyond Phase 1 depends on it.

### Distribution must not erode the ethos

- **Standard package managers only** (npm, Homebrew). Installation is an explicit user action; the
  registry fetch it performs is not memory egress and never touches the Gate.
- **No telemetry** in any installer or in the binary. The only network call Memoring may ever make on
  its own is the opt-in update check already constrained by ADR-0008 (opt-in, no telemetry,
  non-blocking, throttled, stderr-only, never auto-update).
- **Installers place a binary on PATH and nothing more.** They MUST NOT run `memoring init`, touch
  `~/.memoring` / `MEMORING_HOME`, or create/modify any Realm or key.
- **Verifiable artifacts** where the channel supports it (npm provenance; published checksums for a
  `curl | sh` installer). No obfuscation.

## Consequences

- A clear, ordered answer to "how do users install Memoring?" that matches peer expectations, with the
  cheapest rung (npm) already specified by ADR-0008.
- The highest-leverage technical decision (the SQLite engine) is named and explicitly deferred to its
  own ADR, so packaging work does not start on an unstable foundation.
- No frozen invariant moves and no code changes ship with this ADR.

## Deferred (not in this change)

- **All implementation.** `npm publish` (Phase 1 = v1 work, per ADR-0008), a Homebrew formula/tap
  (Phase 2), and a self-contained binary + `curl | sh` installer (Phase 3).
- **The native-dependency / SQLite-engine ADR** that gates Phase 2 (options a / b / c above).
- Windows packaging specifics and signing / notarization for a native installer.
