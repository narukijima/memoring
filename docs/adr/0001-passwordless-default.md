# ADR 0001 — Passwordless by default; passphrase encryption is opt-in

- Status: Accepted
- Date: 2026-06-20
- Scope: security core / key management (Detailed Design §7.4, FR-083, NFR-016)

## Context

v0 (Spec Baseline v1.0) mandates a user-chosen passphrase at `memoring init`
(FR-083): the vault DEK is scrypt-wrapped behind the passphrase, with a one-time
recovery code as the only other unlock path. Losing **both** leaves the replica
permanently undecryptable (NFR-016).

In practice this makes the most likely failure mode a usability one, not an
attack: a user sets a passphrase at setup, forgets it weeks later, and can no
longer open their Memoring asset — with no service or support to recover it
(local-first OSS). That risk outweighs the marginal confidentiality benefit here,
because the **source** history Memoring ingests (e.g. `~/.claude/projects`,
Codex/ChatGPT local files) already sits on the same disk **in plaintext**.
Strongly encrypting only the *derived* replica, at the cost of a
forget-and-lose-everything trap, is a poor default.

## Decision

The default is **passwordless**. `memoring init` (no flag) generates a random DEK
and root secret, stores them **unwrapped** in a local key file
(`keys/key.json`, mode `0600`), and the vault stays AEAD(DEK)-encrypted as before.
No passphrase, no recovery code, nothing to forget.

Strong encryption becomes **opt-in**: `memoring init --passphrase` keeps the
existing envelope scheme (scrypt KEK wrapping the DEK + one-time recovery code),
with an explicit "lose both and the data is unrecoverable" warning.

`openActiveRealm()` in `@core/runtime` auto-detects the mode from which key file
is present and only prompts for a passphrase in passphrase mode. All CLI commands
go through this single core entry point — key handling is no longer scattered in
each command, so a future UI can reuse the same core without re-implementing key
logic.

## Threat model (default mode — stated honestly)

Default mode is **local convenience protection**, not full at-rest encryption.

Protects against:
- Plaintext SQLite/WAL/temp files on disk (none are written — in-memory DB only).
- Leaking the vault **blob alone** (e.g. an accidental commit of `memoring.db`
  without `key.json`): unreadable without the key.

Does **not** protect against:
- Anyone who can read your home directory (they get `key.json` too).
- A backup that carries both `vault` and `key.json`.
- Malware running as your user while the account is unlocked (already out of
  scope for v0).

For protection against a copied home directory or backup, use full-disk
encryption (FileVault) or `--passphrase`.

## Consequences

- Deviates from FR-083 / NFR-016: the passphrase requirement becomes opt-in.
  The frozen-spec docs under `docs/v0/` are not edited; this ADR records the
  implementation decision that supersedes that requirement for the code release.
- New default key format (`keys/key.json`) → released as **0.1.2**.
  Backward-compatible for *opening*: a replica created with `--passphrase` (only
  `keybundle.json` present) still opens via the passphrase path, so there is no
  destructive migration and no breaking change for existing users.
- Derivation is unchanged (DEK + `HKDF` realm_key), so a future
  `memoring key enable-passphrase` can wrap an existing passwordless vault's DEK
  without rebuilding it.

## Deferred (explicitly not in this change)

- `memoring key enable-passphrase` (convert an existing vault in place).
- `export/import --bundle` and an `--encrypted` (age/passphrase) backup.
- OS keychain / Secure Enclave wrapping of `key.json` (revisit per-platform:
  macOS Keychain, Linux Secret Service, Windows DPAPI).
- Device pairing, multi-device sync, daemon-/UI-premised auth.
