# Memoring Implementation Instructions

This document is an implementation instruction set that an implementation AI (and implementer) can begin work from directly. It states what to build, in what order, how far to build it, what not to build, and where it is considered complete. The rationale, philosophy, data structures, invariants, and the user-facing specification of design decisions are each held by dedicated documents. This document avoids duplication and references each document where needed. During implementation, if you need to know "why does it work this way," consult the design document; if you need to know "what must be satisfied," consult the requirements document; if you need to know "what form does it take," consult the detailed design document / specification.

---

## 1. Premises and reading order

Memoring is a Sovereign Memory Loop that takes in the history that AI tools accumulate locally and continuously, automatically organizes, abstracts, and consolidates it as a memory asset under the user's effective control. Before entering implementation, read through them in this order: the Final Design (the constitution that runs through philosophy, structure, constraints, safety, data, and operations) → the Requirements (the verifiable FR/NFR/CON/OUT requirements) → the Basic Design (overall composition, data flow, responsibility allocation) → the Detailed Design (component responsibilities, the full set of JSON schemas, invariants, Gate predicate) → the Specification (CLI/Daemon/MCP/context.md format, configuration, egress permission). This document is the execution procedure built on top of these.

The north star of implementation is the 4 cores that v0 builds. Everything else remains as boundaries to uphold, but is excluded from v0's implementation responsibility.

```text
1. Intake:  Take in history from the local accumulation of AI tools (connect → capture).
2. Storage: Store the Undiluted encrypted without breaking it.
3. Loop:    Automatically run organize / classify / abstract / consolidate (normalize → classify → abstract → consolidate).
4. Egress:  Generate .memoring/context.md (recall through the Gate).
```

Build it so that value stands up with just these 4. In particular, "intake" and "the automatic loop" are the main body of Memoring; if these are weak, it does not become a product. The DB / object store / index are the foundation, not the core value.

---

## 2. What to build first as the minimal configuration (MVP)

What must be pushed through first is a vertical slice in which value stands on its own. Before spreading functionality horizontally, push this vertical slice through from end to end.

```text
memoring init
  Create the encrypted replica, mandatorily generating passphrase / recovery material.

memoring connect claude-code
  Produce the Inventory with detect, and assign sources to a Realm (include / exclude).

capture (with raw-only fallback)
  Produce Undiluted and Occurrence simultaneously. Do not lose raw even when parse fails.

minimal loop
  normalize (turn into Event) → classify candidate (AI candidate for scope / sensitivity)
  → abstract (Claim candidate) → consolidate (consolidate through the validator).

context build
  Gate (Audience × Aperture) → safety header → with Ouroboros marker,
  generate .memoring/context.md.
```

If this vertical slice goes through, the first experience holds: "When you start a new Claude Code session, the past decisions, preferences, and constraints are carried over as context.md." Do not forget that the leading command is `memoring context build`, not `memoring search`. At the MVP stage, the Gate / safety header / Ouroboros marker / file safety must not be omitted. Do not bolt on safety afterward; build it in from the very first moment you create the egress.

---

## 3. Implementation order and priority

The phases proceed in the order that fattens the vertical slice (Chapter 2). Completion of each phase is judged by the invariants in the Detailed Design and by the relevant items of the v0 blocking gate re-listed in Chapter 7 of this document. The numbers refer to the numbers of the blocking gate (13 items).

### P0: capture / encryption / Chronicle / schema

The foundation. Fix the schema of Undiluted / Occurrence / Event / Chronicle, and encrypt the entire DB at-rest. Implement capture as a 1-to-2 verb that produces Undiluted and Occurrence simultaneously, and give it the raw-only fallback from the start. The Chronicle is append-only, serving as a foundation from which the index and the lower layers can be deterministically rebuilt.

- Completion condition: gate 1 (when raw capture fails it does not proceed to derived processing / there is a raw-only fallback).
- Also satisfy: the encryption foundation that is the prerequisite for the auxiliary gates "store unknown fields without discarding them, as encrypted refs" and "no plaintext global index / persistent plaintext FTS file exists."

### P1: Connector / Parser / Watcher

The entry point. Enumerate the Inventory with `detect`, and receive include/exclude and Realm assignment with `configure`. The Connector does not return the entire host tool as one lump, but handles it per source. The Parser is the boundary between the dirty outside world and the fixed schema, and does not treat the host transcript format as a stable API. On an unknown format / unsupported version, it does not perform a broken parse but falls back to raw-only fallback / Quarantine / doctor warning. The Watcher targets only the selected sources, and enqueues a capture job only when a diff arrives (it does not make whole-tool watch the default).

- Initial Connectors: Claude Code local transcript / session, Codex local session, manual import directory, generic JSONL / Markdown transcript.
- Completion condition: gate 2 (no data loss on Parser failure / unknown format / unsupported host version; falls to fallback / Quarantine / doctor warning), gate 12 (connect produces an Inventory and makes you choose Realm assignment / does not make whole-tool watch the default).

### P2: classify / abstract / consolidate + validator

The heart of the loop. AI only creates candidates; the validator does the confirmation. consolidate runs in the order schema validation → evidence validation (including origin authority) → sensitivity / scope validation → policy validation → lifecycle / conflict validation → suppression check, and makes only what passes consolidated. Do not build a review queue. Always write abstract (the leap that draws up Claim candidates from Events) and consolidate (the process that passes candidates through evidence, consistency, and safety validation) as distinct. Generate Derivation, and give AI-derived records a created_by_derivation_id.

- Completion condition: the evidence side of gate 8 (origin ∈ {assistant, host_summary, host_memory, system, unknown} does not become independent evidence, and the host-memory laundering loop is closed), and the auxiliary gate "a Claim has evidence / a Summary alone does not become consolidated."
- Loop convergence: diff-driven; in a fixed Realm with no new evidence, converge to idle in a finite number of steps (the loop convergence invariant in the Detailed Design). Do not keep spinning with zero diff.

### P3: search (exact + FTS + n-gram) / ContextPack / Gate

The egress. Search has metadata filter / exact / FTS / trigram or n-gram fallback / session reconstruction. For Japanese and CJK, keep exact and n-gram fallback always available (n is an implementation choice). Do not place the plaintext index on persistent disk; encrypt it at-rest, and build the index after the Secret Scan. The ContextPack is recall, not a dump, and only items that satisfy the Gate predicate enter it. The Gate is decided by the 2 axes of Audience × Aperture, and comes before ranking (Gate First). The context.md includes a safety header (the distinction between current guidance and untrusted excerpt) and a signed Ouroboros marker, and satisfies file safety (canonical path / .memoring symlink refuse / chmod 0600 / atomic write).

- Completion condition: gate 3 (secret / unknown / confidential(standard), and unclassified (classified=false) do not appear in context.md), gate 4 (anything other than Active Realm / active scope / classified does not appear in search / context), gate 5 (the Gate operates by Audience × Aperture / secret is raw-impossible at any Aperture), gate 6 (safety header and Ouroboros marker), gate 7 (file safety), gate 13 (context.md is practically readable in a new AI session).

### P4: reactive governance / Seal / delete / redact

After-the-fact governance. The user governs by after-the-fact operations, not prior approval. Implement forget / claim pin / correct / expire / label merge / rename / split / delete / redact. delete / redact cascade to derived artifacts, and Seal generates a SealRule so that they do not revive on reprocess / re-capture. The creation and release of a SealRule are limited to the user's explicit operation only. Declassify (the relaxation that lowers sensitivity) is confirmed only by a closed enumeration of non-AI authorities.

- Completion condition: gate 9 (Declassify does not occur by anything other than a closed enumeration of authorities), gate 10 (delete / redact cascade and Seal prevents reprocess revival), gate 11 (event_identity does not change even after reprocess, and evidence does not float in the air).

### P5: MCP read-only / backup_export

An optional receptacle. MCP is read-only by default, excludes secret / unknown / confidential, and requires an audit log. write does not exceed add_memory_candidate (which can write only to candidate state). When making HTTP MCP opt-in, require localhost bind / auth token / origin check. For export, only run backup_export in v0; for redacted_export / dataset_export, fix only the constraints and leave the implementation to a later stage.

- Completion condition: satisfy the MCP / export specification of the Specification. backup_export makes a complete copy as a same-user full-text encrypted backup, including secret / unknown (it does not emit plaintext outside the key boundary).

---

## 4. Proposed directory structure

v0 is narrowed to CLI + daemon + SQLite + filesystem + schemas + fixtures + doctor. Use the following tree as the basis.

```text
memoring/
  apps/
    cli/
    daemon/
  packages/
    core/        loop, schema, policy, chronicle, realm, recipe
    storage/     sqlite, object-store, encrypted-db
    intake/      connectors, parsers, watcher
    claim/       extractor, validator, consolidation, lifecycle, seal
    retrieval/   search, ranking, context-pack, mcp
    security/    key-lifecycle, redaction, secret-scan, audit, ouroboros
    integrations/ claude-code, codex, manual-directory, generic-jsonl, markdown-transcript
  schemas/
  fixtures/
  docs/
```

Examples of the main files placed in each directory (naming is an implementation choice; these are illustrations to show where responsibility lies).

```text
packages/core/
  loop.ts            diff-driven work-driven orchestration (job enqueue / idle convergence)
  schema/            types and version of Undiluted / Occurrence / Event / Session / Claim / Assignment / Label /
                     Derivation / ContextPack / Artifact / Chronicle / SealRule / Policy
  policy.ts          evaluation of policy.v2 (precedence, egress decision)
  chronicle.ts       append-only log and sequence, index rebuild
  realm.ts           Realm resolution (Active Realm), Replica layout
  recipe.ts          loading and version management of the versioned Recipe (thresholds / weights / budget)

packages/storage/
  encrypted-db.ts    at-rest encrypted DB (seals the leaks of WAL / journal / temp / FTS shadow / vacuum / backup)
  object-store.ts    encrypted object storage of Undiluted / Artifact (opaque ref)
  sqlite.ts          SQLite access and job queue table

packages/intake/
  connectors/        Connector implementation (detect / configure / backfill / watch / parse / health)
  parsers/           source-specific format → Event. fixture / golden output / unknown field passthrough
  watcher/           filesystem watch, diff detection, capture job enqueue

packages/claim/
  extractor.ts       abstract (Event → the leap to Claim candidates)
  validator.ts       schema / evidence / sensitivity / scope / policy / lifecycle / conflict validation
  consolidation.ts   consolidate (candidate → consolidated / conflicted / rejected)
  lifecycle.ts       valid_from / valid_until / supersede / reinforcement
  seal.ts            SealRule generation and suppression check

packages/retrieval/
  search.ts          metadata / exact / FTS / n-gram / session reconstruction
  ranking.ts         score that runs only after the Gate (does not relax the safety floor)
  context-pack.ts    Gate predicate → fixed sections → safety header → Ouroboros marker
  mcp.ts             read-only MCP (optional)

packages/security/
  key-lifecycle.ts   envelope scheme (DEK / KEK), KDF, unlock, rotation, recovery
  redaction.ts       redact / delete cascade, tombstone
  secret-scan.ts     key / token detection, secret flag, index holds only the redacted representation
  audit.ts           audit log (recording of required operations)
  ouroboros.ts       self-ingestion prohibition via signed marker / origin / session provenance

packages/integrations/
  claude-code/ codex/ manual-directory/ generic-jsonl/ markdown-transcript/

schemas/             JSON schema definitions (the at-rest representation is opaque ID + encrypted refs)
fixtures/            inputs and golden output for Parser validation
```

Technology selection principles.

```text
Keep Core schema and policy small.
Make Connector / Parser the layer that absorbs changes in the external world.
Confine the irregularity of classification / organization to the AI and the loop.
The job queue may be a SQLite table in v0.
Make Storage filesystem + encrypted SQLite as the basis.
Treat the AI provider as an adapter; do not put provider-specific processing into Core.
Do not build a review queue. Concentrate user operations into reactive governance.
```

---

## 5. Prohibitions

### 5.1 What not to do in v0

These are settled not as "we'll do it someday" but as "we will not do it in v0." Resuming requires an ADR.

```text
Do not do predefined personality classification (do not hardcode personal / private / social / work / anonymous).
Do not do automatic label-merge confirmation (merge candidates are surfacing only; confirmation is by user / policy / rule).
Do not create an encryption boundary (Key Domain) within a Realm. Separate identity / trust at the Realm unit.
Do not build first-party cloud backup / sync (provide only the standard receptacle).
Do not do ReplicaManifest / root_hash sync / known-replica tracking.
Do not build a review queue / manual approval.
Do not do live multi-device sync.
Do not do team / organization / admin.
Do not build a desktop app.
Do not do browser scraping / dependence on non-public APIs.
Do not do imports that bypass the provider's access control.
Do not do hook injection / real-time event capture.
Do not do MCP write integration (writes beyond add_memory_candidate).
Do not do span / line-level redaction.
Do not track context injection at the span unit (in v0, close the entire session in which the marker appears to the safe side).
Do not create pack-local alias citation IDs (in v0, opaque IDs (clm_ / evt_); aliases are v0.1).
Do not fully implement a fine-tuning dataset builder (fix only the constraints).
Do not make vector search mandatory in v0.
Do not do automatic tuning of ranking weights first (manual Recipe only).
```

In particular, the following 4 are directly tied to the core of the structure, so do not break them during implementation just because "it's convenient."

- Do not build a review queue. A Claim is fully automatic consolidate; do not design it so the user approves them one by one. Safety is protected not by stopping consolidated but by the Gate at output time.
- Do not have predefined categories. Do not hardcode fixed root categories; treat Scope as a label that the AI assigns.
- Do not create an encryption boundary within a Realm. Boundaries that would be troublesome if mixed are separated into different Realms (different directory, different key). This is a design decision and not the kind of thing to be resumed by an ADR.
- Do not make self-generated context into evidence. Do not count the ContextPack / context.md that Memoring generated as evidence or reinforcement of a Claim.

### 5.2 Common implementation conventions

```text
Do not do speculative engineering / future-proofing / unnecessary abstraction. Implement only the requested scope.
Interface freeze: do not arbitrarily change a settled function signature / data structure / existing interface.
Surgical implementation: do not blindly graft conditional branches onto existing logic. Surgically fix the target logic.
Delete dead code immediately within the same change (unused imports / orphan variables / unneeded helpers).
Do not output to logs / commit secret / credential / personal data. Record only id / count / state in logs.
```

When a defect involving the core of the design appears, handle it not by an ordinary implementation change but by the design change process (ADR). In an ADR, explicitly state whether the change target is core / contract / Recipe / implementation example, and write the impact on existing Realms, the impact on security / privacy, and the rollback / compatibility policy. Changes belonging to core / contract are not made at the implementation's own discretion.

---

## 6. Test policy

Tests are a means to mechanically confirm that the invariants have not been broken. Consider the test composition in the following 4 layers.

- The Parser is validated by fixture / golden output. Each Connector records the tested host version / format version / Parser version, and has golden fixtures. Validate the Connector each time the host updates, and confirm with fixtures that it does not break on an unknown format and falls to raw-only fallback / Quarantine. Also validate unknown field passthrough with golden.
- The pass/fail criterion of the integration test is satisfying the 13 items of Chapter 7 of this document (= the v0 blocking gate of the Detailed Design). This is the final criterion of "does it work," and do not bloat the blocking gate.
- Auxiliary tests handle the perspectives that supplement the blocking gate (encrypted storage of unknown fields, absence of a plaintext global index / persistent plaintext FTS file, rebuild from the lower layers when the index is corrupted, that a Claim has evidence, not making context.md into evidence, that evidence_count matches the independent evidence count, that Japanese search holds with exact + n-gram, the determinism of label normalization and the merge-confirmation authority, the invariance of event_identity after reprocess, that the Recipe has a version / eval / audit / rollback ref, the functioning of deletion and tombstone, etc.).
- AI output differences are compared by eval. Observe the output difference for the same fixture by eval, and do not change the Core schema. The default on a Recipe change is no auto-retroactive, and application to existing records is by explicit reprocess.
- Invariants are protected by unit tests of the validator / gate. The Gate predicate, consolidation invariant, reinforcement invariant, stable event identity invariant, Ouroboros Law, forget durability invariant, temporal ordering invariant, and so on are nailed down clause by clause with validator and gate tests. For the concrete predicates and JSON schemas, refer to the Detailed Design.

---

## 7. Completion condition (Definition of Done)

v0 is considered complete when it satisfies all 13 items of the following v0 blocking gate. Treat each item as a checklist that the implementation AI can self-verify. For the detailed rationale and reference sections, consult the invariants / Gate predicate of the Detailed Design.

```text
[ ]  1. If raw capture fails, do not proceed to derived processing (there is a raw-only fallback).
[ ]  2. No data loss on Parser failure / unknown format / unsupported host version;
        falls to raw-only fallback / Quarantine / doctor warning.
[ ]  3. secret / unknown / confidential(standard), and unclassified (classified=false)
        do not appear in context.md.
[ ]  4. Anything other than Active Realm / active scope / classified does not appear in search / context.
[ ]  5. The output Gate operates by Audience × Aperture. The default is ai_tool + standard.
        secret cannot be output as raw at any Aperture.
[ ]  6. context.md includes a safety header (distinguishing current guidance and untrusted excerpt) and
        an Ouroboros marker.
[ ]  7. context.md satisfies file safety (canonical path / .memoring symlink refuse /
        chmod 0600 / atomic write).
[ ]  8. origin ∈ {assistant, host_summary, host_memory, system, unknown} does not become independent evidence,
        and the host-memory laundering loop is closed.
[ ]  9. The sensitivity Declassify (the relaxation that lowers sensitivity) does not occur by anything other than a closed enumeration of non-AI authorities
        (does not relax by AI confidence / similarity / git remote alone).
[ ] 10. delete / redact cascade downstream, and Seal prevents reprocess revival with a SealRule.
[ ] 11. event_identity does not change even after reprocess (Parser version / blob granularity change),
        and evidence does not float in the air.
[ ] 12. connect produces an Inventory and makes you choose Realm assignment. Does not make whole-tool watch the default.
[ ] 13. .memoring/context.md is practically readable in a new AI session.
```

The auxiliary gates (those upheld in v0 but not bloating blocking) are confirmed as included in the test policy of Chapter 6 of this document.

---

## 8. Procedure to begin

The first several moves concentrate on the foundation-building to make the vertical slice of Chapter 2 hold. The concrete execution order is as follows.

1. Initialize the repository and build the directory structure of Chapter 4. Place `apps/cli`, `apps/daemon`, `packages/*`, `schemas/`, `fixtures/`, `docs/`.
2. Fix the schema of Undiluted / Occurrence / Event / Chronicle in `schemas/` (generate schemas/*.schema.json as the authoritative source, and settle and validate required / optional / enum / version / migration. The at-rest representation is opaque ID + encrypted refs). Give it schema_version from the start.
3. Stand up the at-rest encrypted DB with `packages/storage/encrypted-db.ts`. Encrypt or disable WAL / rollback journal / temp store / FTS shadow / vacuum intermediates / backup files, and place the temp store in memory / tmpfs. Do not place the key in the DB in plaintext.
4. Implement the envelope scheme (DEK / KEK / KDF / recovery material) in `packages/security/key-lifecycle.ts`. Call it from `memoring init`.
5. Implement `memoring init` in `apps/cli`. Push it through to encrypted replica creation and the mandatory generation of passphrase / recovery material.
6. Implement the Claude Code Connector's `detect` (Inventory enumeration) and `configure` (include/exclude + Realm assignment) in `packages/intake/connectors/`, and push `memoring connect claude-code` through.
7. Implement capture. Confirm with top priority that it produces Undiluted and Occurrence simultaneously and does not lose raw via the raw-only fallback even when parse fails (gate 1).
8. Place the input of the Claude Code transcript and the golden output in `fixtures/`, and validate the Parser (normalize → Event) with fixtures.
9. Implement the minimal loop (classify candidate → abstract → consolidate + validator) in `packages/claim/`, and generate Derivation.
10. Implement context build with `packages/retrieval/context-pack.ts`. Assemble it in the order Gate predicate → fixed sections → safety header → Ouroboros marker → file safety, and push `memoring context build --out .memoring/context.md` through (gates 3–7, 13).

With these 10 moves, the MVP vertical slice stands up. From there, fatten P1–P5 of Chapter 3 in order, and confirm the completion of each phase with the checklist of Chapter 7.

---

## Related documents

- Final Design (the constitution of philosophy, structure, constraints, safety, data, operations)
- Requirements (the verifiable FR / NFR / CON / OUT requirements)
- Basic Design (overall composition, data flow, responsibility allocation, processing flow)
- Detailed Design (component responsibilities, the full set of JSON schemas, invariants, Gate predicate, state transitions, error handling, permissions, security, logs, test perspectives)
- Specification (CLI / Daemon / MCP / context.md format, configuration, data formats, operation specification, constraint specification, egress permission table)
