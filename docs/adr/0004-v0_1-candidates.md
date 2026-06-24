# ADR 0004 — v0.1 candidates carved out of the frozen v0 scope

- Status: Proposed (deferred; one slice since implemented — the foreign-AI
  manual-import connector of #7 shipped via ADR-0007. The rest remain deferred.)
- Date: 2026-06-22
- Scope: roadmap boundary. Records seven features that are explicitly **out of v0**
  and the v0 invariant each must not cross when it is eventually built.
- Relates to: OUT-013..016 (Requirements §5), Specification §4 (MCP), §6.2/§7.3
  (export / egress), Final Design §6 (Realm, Replica, Storage), §16 (blocking gate).

## Context

v0 is a **local-first vertical slice**: `init → connect → capture → loop →
context build`, guarded by one safety mechanism (the output Gate, Audience ×
Aperture, Gate First). The frozen spec deliberately excludes anything that would
(a) turn Memoring into a sync service, (b) add a second safety mechanism beside
the Gate, or (c) let AI-generated or off-device content re-enter as authority.

Several capabilities are attractive and were repeatedly raised, but each one, done
naively, breaks a v0 invariant. This ADR parks them as **v0.1 candidates** and,
for each, states the boundary it must respect so a later implementer does not
quietly relax the safety core. With the exception of the foreign-AI manual-import
connector (#7), which has since shipped under its own ADR-0007, none of these are
implemented now.

## Decision

Defer all seven (the foreign-AI manual-import slice of #7 has since shipped via
ADR-0007; the rest stand). Each is admissible in v0.1+ **only** behind its own ADR
that shows
it does not cross the stated boundary. The general rule that dominates all of
them: *the Gate stays the sole safety mechanism, it runs before ranking, and no
off-device plaintext or AI-authored content gains evidence authority.*

### 1. AI-native Collections view

- **What.** A derived, queryable "collections" surface that groups Claims/Events
  by AI-proposed themes for browsing (a read model on top of recall).
- **Why deferred.** v0's lead surface is `context.md` (recall, not dump) and the
  reactive-governance model has **no review queue and no predefined persona
  categories** (OUT, Prohibitions). A collections view risks becoming a de-facto
  review queue or a persona taxonomy baked into the core.
- **Boundary it must not cross.** Read-only projection through the **same Gate** as
  context.md/search (secret/unknown/confidential/unclassified/out-of-scope never
  appear); AI may only *suggest* groupings as candidates — never confirm scope or
  Declassify (G9); collections are not persisted as a new authority and never
  become Claim evidence.

### 2. Distributed Realm / encrypted metadata sync

- **What.** Syncing Realm metadata (labels, manifests, index shards) across
  machines with the payload kept encrypted.
- **Why deferred.** v0 is **local-first with no first-party sync** (NFR-032) and
  forbids a **per-domain encryption boundary inside a Realm** (NFR-003 / CON-013).
  "Encrypted metadata" sync tends to grow a second key boundary and a server of
  record.
- **Boundary it must not cross.** No encryption boundary *within* a Realm; Realms
  stay unconnected (cross-Realm search/context remain unavailable, Spec §9); any
  transport is an **encrypted archive carried by the user** (ADR-aligned with
  backup_export), not a live first-party service. event_identity /
  content_fingerprint / SealRule.target_signature stay realm_key-derived and
  rotation/restore-invariant (CON-012).

### 3. HTTP MCP beyond localhost

- **What.** Exposing the MCP server over the network (remote tools / cloud MCP).
- **Why deferred.** v0 MCP is **read-only by default, stdio-default**, the only
  write is `add_memory_candidate` (candidate state, non-user origin, no evidence
  authority), and HTTP is opt-in **localhost-only** with auth token + origin check
  (Spec §4; OUT-013). A networked MCP is a new egress channel that must pass the
  Gate identically — easy to get wrong.
- **Boundary it must not cross.** Same Gate as context.md on every response
  (secret/unknown/confidential/unclassified excluded; scope required; audited); no
  write beyond `add_memory_candidate`; if ever bound off-localhost it requires
  localhost-equivalent authn/authz **plus** the egress-table adjudication used for
  remote_ai. Cloud-hosted MCP is out (see #6).

### 4. Recall evaluation dashboard

- **What.** A UI/reporting layer over the recall-quality metrics.
- **Why deferred.** v0 ships the **measurement** (the fixture-based recall-eval
  harness — safety pass, constraint coverage, stale warning, token budget, opaque
  citation consistency), which is the part that protects the safety core. A
  dashboard is presentation and adds no invariant.
- **Boundary it must not cross.** The eval harness stays the source of truth and
  runs in CI; a dashboard reads its output only and must never feed scores back
  into ranking or the Gate (ranking is not a safety mechanism; Gate First).

### 5. Live multi-device sync

- **What.** Real-time replication of a Realm across devices.
- **Why deferred.** Explicitly prohibited in v0 (Prohibitions; NFR-032: no
  first-party cloud backup/sync, no ReplicaManifest/root_hash sync, no live
  multi-device sync). Live sync forces a conflict/merge model and a server of
  record that the reactive-governance + single-writer Realm model does not have.
- **Boundary it must not cross.** Carry-not-sync: the supported path stays
  **backup_export → (user-chosen transport) → restore** of a self-contained
  encrypted archive (same_user, client-side encryption; plaintext never leaves the
  key boundary). No first-party always-on replica; no automatic cross-device merge.

### 6. Cloud-hosted Memoring service

- **What.** A hosted backend that stores/processes Realms server-side.
- **Why deferred.** Inverts the product's premise (sovereign, local-first, the user
  holds the keys). Server-side processing is a standing remote egress of exactly
  the history the Gate exists to protect.
- **Boundary it must not cross.** If ever offered, it is a **zero-knowledge carrier
  of encrypted archives only** (the server sees ciphertext, same as a dumb storage
  target like rclone/R2 documented for backup transport) — never a processor of
  plaintext, never the key boundary, never an evidence source. Any server-side AI
  processing is `remote_ai_processing` and bound by the egress table (default-off,
  scope opt-in, secret_scan_passed, no secret/unknown raw).

### 7. Connector expansion (Codex, manual-import dir, generic JSONL, Markdown transcript)

- **What.** Additional source Connectors beyond Claude Code.
- **Status update.** The **manual-import** slice has since shipped via **ADR-0007**:
  `memoring import` ingests a pasted ChatGPT/Claude/Gemini "everything you know about
  me" export through the same pipeline, landing each entry as a non-authoritative
  `host_memory` Event plus a review `candidate` (no evidence authority until the user
  promotes it). **Codex, generic JSONL, and Markdown-transcript** connectors remain
  deferred.
- **Why the rest stay deferred (and a v0 scope correction).** v0 shipped exactly ONE
  source-watching connector — Claude Code (`packages/integrations/claude-code`,
  registered in `packages/intake/registry.ts`). The earlier requirements/design prose
  listing four connectors as v0 overstated scope; this ADR records the correction: the
  others are v0.1. The Connector interface (`packages/intake/types.ts`) is stable and
  the registry extends cleanly, so this is additive, not a redesign. Building
  speculative parsers (especially Codex, whose transcript format would be guessed at)
  violates YAGNI and risks the G2 quarantine contract.
- **Boundary it must not cross.** Every new connector flows through the SAME pipeline:
  capture-raw-first (G1), parse → Event OR Quarantine with no raw loss on
  failure/unknown-format/unsupported-version (G2), realm_key-derived event_identity
  that is reprocess/restore-invariant (G11), and `detect` → Inventory → per-source
  include/exclude + Realm assignment, never whole-tool watch by default (G12). A new
  connector adds a source, never a new egress channel or a Gate bypass.

## Consequences

- v0 stays a clean local-first slice; none of the above dilutes the blocking gates.
- Each candidate now has a written guardrail, so a future ADR can be judged by
  whether it respects the boundary rather than re-deriving it.
- The one capability whose *measurement* lands in v0 (recall eval, #4) does so as a
  test harness, not a service — keeping the safety-relevant part while deferring the
  presentation.

## Not in this ADR

This ADR decides nothing about *how* to build any candidate; it only fixes the
boundary. Per-scope remote opt-in and content-Seal-aware egress remain tracked by
ADR-0003's "Deferred" section, and full DEK rekey by ADR-0001.
