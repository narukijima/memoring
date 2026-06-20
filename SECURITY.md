# Security Policy

Memoring is a local-first, privacy-focused tool: it turns the local history of AI tools into a
user-controlled, encrypted-at-rest memory asset and hands it back only through a single output
**Gate**. Security is the product, so please report issues responsibly.

## Reporting a vulnerability

- Preferred: open a **private security advisory** on the GitHub repository
  (Security → Advisories → "Report a vulnerability"). Do not open a public issue for a
  security report.
- Please include a description, affected version/commit, reproduction steps, and impact.
- Do not include real secrets or personal data in a report — a minimal synthetic repro is enough.

## Scope: what v0 defends, and what it does not

This summarizes the threat model in the Detailed Design (§7.5). It is the contract; the design docs
are authoritative.

**Key modes.** By default a replica is **passwordless**: the vault stays AEAD-encrypted, but
the key is stored unwrapped in a local key file (`keys/key.json`, `0600`). This is *local convenience
protection* — it avoids plaintext SQLite/WAL and protects the vault blob alone, but not against
anyone who can read your home directory. `memoring init --passphrase` opts into a strong
scrypt-wrapped vault with a one-time recovery code (lose both and the data is unrecoverable). The
"Defended" items below that depend on the at-rest key being unavailable to a disk reader
(lost/stolen disk, cloud/backup operator) hold **only in `--passphrase` mode**; in default mode use
full-disk encryption for that property. See [docs/adr/0001-passwordless-default.md](docs/adr/0001-passwordless-default.md).

**Defended in v0**

- Lost/stolen disk (`--passphrase` mode; or any mode under full-disk encryption): the database is
  encrypted at rest as a single AEAD blob; no plaintext payload or index touches disk (temp store is
  in memory).
- Cloud/backup operator (`--passphrase` mode): only the encrypted receptacle is handed over;
  plaintext never leaves the key boundary. In default mode, exclude `keys/key.json` from any backup.
- Accidental git commit of `.memoring/`: canonical-path resolution, symlink refusal, `chmod 0600`,
  and `.git/info/exclude`.
- Prompt injection via a malicious transcript: a Safety Header separates current guidance from
  untrusted quoted evidence; content is never executed as instructions.
- Timestamp-tampering supersession: ordering uses Memoring's own capture order, never the
  source-reported timestamp.
- Host-memory laundering: host-generated content (CLAUDE.md / `<system-reminder>` / summaries) is
  classified by `origin` and can never become independent evidence.
- Over-exposure to a remote AI provider: the egress permission table (Audience × Aperture ×
  purpose); secret is never raw-egressed; everything fails closed (Silence) when undecidable.
- Revival of deleted/Sealed content on reprocess: durable suppression via SealRule, enforced on
  every derived/egress path.

**Partially mitigated**

- A user mixing up the wrong Realm, a tampered/malicious connector, and another local Unix user are
  limited (Active-Realm resolution, raw-only fallback + doctor checks, file permissions) but not
  fully defended.

**Out of scope in v0 (stated explicitly)**

- Local malware running as the same user while the replica is unlocked may read the plaintext key or
  decrypted data. Minimization is done (temp in memory, no payload in logs) but is not a defense
  goal.
- Copies already handed to an external AI, already-written exports, or old backups: Seal works on
  internal derived data and future reprocessing, but cannot retract data that already left.

## Known v0 limitations relevant to security

- Secret detection is deterministic/regex-based (best-effort). It biases fail-closed where it
  matters, but is not exhaustive — an unusual credential shape can be missed.
- Sensitivity is event-level (no span-level redaction): one secret line marks the whole event
  secret, trading recall for safety.

## Supported versions

v0 is pre-1.0; only the latest `main` is supported.
