# ADR 0008 — CLI version reporting and the update/upgrade path

- Status: Accepted
- Date: 2026-06-24
- Scope: CLI surface (`memoring version` / `--version`), MCP `serverInfo.version`,
  `packages/core/version.ts`, and the (deferred) update-notifier policy. No change
  to the Realm/key/Gate model or any frozen invariant.
- Relates to: Specification §1 (CLI), §4 (MCP), §7.3 (egress table — local-first,
  no-egress-by-default), ADR-0003 (remote-AI default-off opt-in).

## Context

Three version numbers existed and disagreed, and the CLI hardcoded a fourth:

- `VERSION` = `1.0.0` — the frozen specification baseline (Spec Baseline v1.0).
- `package.json` `"version"` = `0.1.2` — the implementation/release version
  (semver; what npm and any future update check would compare).
- `apps/cli/main.ts` printed a hardcoded `memoring v0 (spec-v1.0)`.
- `packages/retrieval/mcp.ts` reported a hardcoded `serverInfo.version: 'v0'`.

A hardcoded version string drifts the moment either number changes, and nothing
forced the four to agree. Separately, there is no documented answer to "how does
a user upgrade?" — which matters now (pre-publish, run from a `git` checkout) and
will matter differently after a v1 `npm publish`.

These are two numbers with two different meanings and they are *intentionally*
different: the spec baseline is frozen at `1.0.0` while the implementation is
pre-1.0 (`0.1.2`). Conflating them into one string hides that distinction.

## Decision

### 1. Single source of truth, read dynamically

`packages/core/version.ts` is the only place that derives version numbers. It
exports `packageVersion` (from `package.json` `"version"`), `specVersion` (from
the `VERSION` file), and `versionLine()`:

```text
memoring <packageVersion> (spec <specVersion>)   e.g. memoring 0.1.2 (spec 1.0.0)
```

- `memoring version` / `memoring --version` print `versionLine()`.
- MCP `serverInfo.version` reuses `packageVersion`.
- Both files are read **relative to the source location** via
  `fileURLToPath(import.meta.url)` walking up to the repo root — never
  `process.cwd()`, because `bin/memoring.mjs` → `tsx` runs the CLI with the
  *caller's* working directory (the user's project), not the repo. This mirrors
  how `bin/memoring.mjs` already computes `root`.
- A vitest (`tests/version.test.ts`) reads `package.json` and `VERSION`
  independently and asserts the version line contains both, so the numbers can
  never silently diverge again.

**Semantics (the rule going forward):** `package.json` `"version"` is the
implementation/release version (semver, what gets published and compared);
`VERSION` is the frozen spec baseline (changes only when the spec is re-frozen
via its own process). They are not expected to match.

### 2. Upgrade path — now (pre-publish)

`package.json` already carries publish metadata (`publishConfig.access: public`,
a `files` allowlist, and the `memoring` `bin`) and no longer sets `private`, but
Memoring is **still unpublished** — and a published package would not yet resolve
its own `@core/*` imports under `tsx` inside `node_modules` (see README). So the
install today is by cloning the repo and running `npm link` (or `npm install -g .`).
The linked `memoring` runs the checked-out source live (source-only via `tsx`, no
build step). Therefore the supported upgrade is:

```text
git pull            # update the source the linked binary already runs
npm install         # ONLY when dependencies changed (e.g. better-sqlite3 bump)
```

No rebuild, no relink. The running CLI reflects the working tree immediately. The
version line above makes "what am I running" answerable from a checkout.

### 3. Upgrade path — future (v1 publish)

The publish metadata is already in place (no `private`; `publishConfig`/`files`/`bin`
present), so v1 work is the actual `npm publish` once the source-only/`tsx`
alias-resolution blocker is resolved. The upgrade then becomes:

```text
npm install -g memoring@latest      # or: npm update -g memoring
```

At that point an **opt-in update-notifier** may compare `packageVersion` against
the npm registry and print "update available" to stderr.

### 4. Update-check boundary (the constraint that governs the notifier)

An update check is a **network call**, which is in direct tension with Memoring's
local-first / sovereign / no-egress-by-default posture (Specification §7.3,
ADR-0003). The egress table governs *memory content*; an update check is metadata,
not memory — but the ethos still applies. Any update check, if ever added, MUST:

- be **opt-in** — disabled by default, or at minimum clearly disclosed and
  disableable via an env var such as `MEMORING_NO_UPDATE_CHECK`;
- carry **no telemetry** — it may read the registry's latest version and send
  nothing identifying (no usage data, no Realm/replica info, no machine id);
- **never block** the command it is attached to — run out of band, fail silent on
  any network error;
- be **throttled** (e.g. at most once per day, cached locally);
- write only to **stderr**, never stdout (stdout is the CLI's data channel and
  feeds `context.md` / MCP consumers);
- **never auto-update** silently — it informs; the user runs the upgrade.

## Consequences

- The four version strings collapse to two sources, both dynamic; a test pins
  them together. Bumping `package.json` is now the whole release-version change.
- No frozen invariant moves. This is a CLI/MCP surface + docs change only; the
  Gate, keys, Realms, and egress table are untouched.
- "How do I upgrade?" has a documented answer for both the current checkout model
  and the future published model.

## Deferred (not in this change — YAGNI until publish)

- The update-notifier itself is **not implemented**. It is specified here as a
  constraint set so that whoever adds it at publish time cannot quietly make it
  on-by-default, chatty, telemetered, or blocking.
- The actual `npm publish` is v1 work (the publish metadata is already in place;
  there is no longer a `private` flag to flip).
- Any auto-update mechanism is explicitly out of scope, now and at v1.
