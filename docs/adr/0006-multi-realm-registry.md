# ADR 0006 — Local multi-Realm registry and CLI switching

- Status: Accepted
- Date: 2026-06-24
- Scope: CLI/core active Realm resolution. Implements Specification §6.5
  ergonomically without changing the Realm/key/Gate model.
- Relates to: Final Design §6.5, Specification §1.1/§5.1/§9, ADR-0004 §2.

## Context

Memoring already defines one Realm as one identity/trust boundary: one directory,
one key, one replica. The v0 implementation can hold multiple memories only by
running `memoring init` in different directories and manually switching
`MEMORING_HOME`.

Specification §6.5 defines the missing operating model: commands resolve exactly
one Active Realm before active-scope resolution, and if that Realm cannot be
determined uniquely, recall surfaces must Silence. Realms are not connected, and
cross-Realm search/context are out of v0.

## Decision

### Registry layout

Add a local plaintext registry at:

```text
<base>/realms.toml
```

where `<base>` is `MEMORING_HOME ?? ~/.memoring`. The base directory is mode
`0700`; `realms.toml` is mode `0600`.

The registry stores only convenience metadata:

```text
current = "<realm_id>"

[[realms]]
name = "work"
realm_id = "realm_..."
root = "/abs/path/to/base/realms/work"
created_at = "..."
key_mode = "local" | "passphrase"
```

It stores no secrets and no payload. New Realms created via `memoring realm new`
live under:

```text
<base>/realms/<slug>/
```

The per-Realm `realm.toml` remains authoritative for that Realm's composition:
projects, root paths, git remotes, connectors, and name. The registry is only a
local index plus sticky management pointer.

### Active root resolution

Resolution is command-class dependent.

Recall/data commands (`context`, `search`, `backfill`, `watch`, `reprocess`,
`claim`, `label`, `forget`, `suppress`, `export`, `mcp`, `index`, and similar
egress/data commands) resolve in this order:

1. `--realm <id|name>`: lookup in the registry and resolve to one root.
2. Direct base replica: if `<base>/realm.toml` exists **and it is the only
   registered Realm**, use that root without requiring a registry (legacy
   single-replica back-compat). Once a second Realm is registered this tier is
   skipped, so a normal `init`-at-base layout still gets CWD switching.
3. CWD unique match: canonicalize CWD and match it against every registered
   Realm's plaintext `realm.toml` `projects[].root_paths` and `git_remotes`.
4. Otherwise Silence. Do not fall back to the registry `current` pointer.

Management commands (`realm list`, `realm use`, `realm current`,
`realm rename`, `realm rm`) may use the registry `current` pointer as a default.
Explicit arguments or `--realm` override it.

The registry `root` field is not a CWD-resolution basis by itself. CWD matching
must read each Realm's own `realm.toml` before unlock and reuse the existing
project matching logic.

### Back compatibility

A direct single-replica layout remains valid:

```text
MEMORING_HOME=/path/to/replica
/path/to/replica/realm.toml
```

That path takes precedence over registry/current for recall/data commands **while it
is the only registered Realm**. After `realm new` adds a second Realm, the base
replica becomes the `default` registered Realm and is resolved like any other (by
`--realm` or CWD match), so it no longer swallows every resolution.

If a legacy replica exists at `<base>/realm.toml`, it is lazily and idempotently
registered as `default` with `root=<base>`. The replica is never moved. Failure
to write this auto-registration, for example on a read-only base, must not stop
direct-root access.

### Daemon/watch

A long-running daemon binds one explicit Realm at launch and never tracks a
moving CWD/current pointer.

Allowed launch bindings:

- `--realm <id|name>` resolved through the registry.
- `MEMORING_HOME` pointing directly at a replica.

CWD inference and registry `current` inference are refused for daemon/watch.
This keeps watch, key bundle, index, and daemon scope separated per Realm.

### Deletion semantics

`memoring realm rm <name|id> --yes` removes both the registry entry and the
Realm directory, then writes an audit record with ids/state only. It is
irreversible and uses the same headless/interactive confirmation pattern as
other destructive CLI operations.

The command refuses to remove the last registered Realm. It also refuses to
remove a root that is the registry base or that contains another registered
Realm root, because deleting such a directory would delete the registry or
unrelated Realms. Normal `realm new` roots under `<base>/realms/<slug>/` are safe
for full recursive removal.

If the removed Realm is `current`, the pointer is repointed to the oldest
remaining Realm by `created_at` (with `realm_id` as a deterministic tie-breaker).
The registry never keeps a dangling current pointer.

## Consequences

- The frozen open APIs stay intact: `replicaLayout(root)`, `openActiveRealm(root,
  provider)`, `openRealmLocal(root)`, `openRealm(pass, root)`, and
  `attachRealm(...)` are not changed. The new resolver computes a root first and
  then calls those APIs.
- The Gate remains the sole egress safety mechanism. Resolution decides which
  Realm to open; it does not relax output policy or join Realms.
- Cross-Realm search/context remain unavailable. Listing multiple Realms is
  registry metadata enumeration, not recall.
- A torn or missing `realms.toml` cannot brick a direct replica: per-Realm
  `realm.toml` plus direct `MEMORING_HOME` still opens the replica.

## Deferred

- Cross-Realm features of any kind.
- Sync, first-party backup, live multi-device replication.
- Moving/migrating an existing legacy direct replica into `<base>/realms/`.

## Since shipped

- A **local web panel** for Realm management arrived in ADR-0010
  (`apps/server/panel.ts`): it lists registered Realms, switches the viewed Realm
  per request (explicit Realm id, no CWD/`current` inference), and exposes
  set-active / create / delete over the owner-write surface. It reuses this
  registry and the same resolution APIs; it does **not** add cross-Realm recall.
