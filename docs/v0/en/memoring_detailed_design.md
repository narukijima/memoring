# Memoring Detailed Design Document

This document defines the detailed design for implementing Memoring / Sovereign Memory Loop. The readers are the engineers implementing the core / storage / intake / claim / retrieval / security packages, and the AI. It specifies the data model contracts, state transitions, the responsibilities and processing units of each component, structural invariants, error handling, permissions and authorities, security, logging, test perspectives, and Recipe initial values, at a granularity that leaves implementation in no doubt.

Philosophy, scope, and marketability are deferred to the Final Design Document (the constitution, `memoring_design_final_ja.md`) and the Project Plan (`memoring_project_plan_ja.md`); ID-tagged requirements to the Requirements Document (`memoring_requirements_ja.md`); and the user-facing operational specification to the Specification (`memoring_specification_ja.md`). This document strictly distinguishes "the contract that validator / gate / policy must always uphold" from "the tunables that a Recipe owns," and preserves JSON schemas, formulas, and numbers verbatim in substance.

In this document, an Invariant is a form fixed at design time and is always upheld by validator / gate / policy. A Tunable is an initial value owned by a versioned Recipe and is consolidated in Chapter 10. The two must never be confused.

---

## 1. Data model contract

This is not a complete DB schema but a contract that the implementation upholds. The authoritative copy of the machine-readable schema is `schemas/*.schema.json` (or zod / io-ts), where required / optional / enum / version / migration are finalized and validated. The JSON examples in this chapter are their human-readable projection. The entire DB is encrypted at rest. The following JSON examples are logical contracts; the actual at-rest representation uses opaque IDs and encrypted refs. The `*_ref` fields are encrypted references and do not hold plaintext.

The core entities are as follows.

```text
Undiluted
Occurrence
Event
Session
Label
Assignment
Claim
Derivation
ContextPack
Artifact
SealRule
Policy
Chronicle
```

### 1.1 Undiluted

The immutable raw data before interpretation. It is the origin point of all reconstruction.

```json
{
  "undiluted_id": "und_01J...",
  "realm_id": "realm_01J...",
  "payload_format": "jsonl_line",
  "encrypted_payload_ref": "objects/7f/ab/obj_01J...",
  "content_fingerprint": "hmac-sha256:...",
  "size_bytes": 4096,
  "compression": "zstd",
  "encryption": { "algorithm": "aead-implementation-choice", "data_key_id": "dek_01J..." },
  "created_at_ref": "encrypted:...",
  "status": "active | redacted | deleted",
  "schema_version": "undiluted.v1"
}
```

Field meanings and validator rules:

- Undiluted immutability refers to the immutability of the payload bytes. Metadata can be updated append-versioned in the Chronicle.
- `encrypted_payload_ref` is an opaque ref and does not contain a semantic name.
- `content_fingerprint` is an HMAC keyed on `realm_key`. It enables dedup within the same Realm while preventing existence confirmation of known plaintext (confirmation attack). It does not dedup across Realms. `realm_key` is a rotation-invariant key derived via KDF from the Realm root secret (rotation-invariant; derived from recovery material), and does not change `content_fingerprint` across KEK rotation / DEK rekey (§4.10 / §7.4).
- `status` is one of active / redacted / deleted. delete / redact follows the cascade in §7.3.

### 1.2 Occurrence

The record of contact — at what time, from which source, at which cursor the Undiluted was observed. Because the same raw payload may be observed multiple times, Undiluted (what was recorded) and Occurrence (when, where, and how it was observed) are separated.

```json
{
  "occurrence_id": "occ_01J...",
  "undiluted_id": "und_01J...",
  "source_id": "src_01J...",
  "connector_id": "claude_code",
  "connector_version": "Connector.v1",
  "parser_hint": "claude_code_jsonl",
  "source_path_ref": "encrypted:...",
  "source_cursor_ref": "encrypted:...",
  "captured_at_ref": "encrypted:...",
  "capture_method": "watch",
  "assignment_ids": [],
  "status": "captured",
  "schema_version": "occurrence.v1"
}
```

`capture` is the only 1-to-2 verb, producing Undiluted and Occurrence simultaneously. `source_path_ref` / `source_cursor_ref` / `captured_at_ref` are encrypted references.

### 1.3 Event

An observed fact translated from a source-specific format into a common time-series event. By means of `event_identity`, evidence remains stable across reprocessing.

```json
{
  "event_id": "evt_01J...",
  "event_identity": "eid:hmac:<source_identity|session_identity|message_id_or_content_anchor>",
  "occurrence_ids": ["occ_01J..."],
  "session_id": "ses_01J...",
  "turn_id": "turn_01J...",
  "event_type": "tool_result",
  "role": "tool",
  "origin": "tool_result",
  "created_at_ref": "encrypted:...",
  "timestamp_confidence": "source_reported",
  "sequence": 42,
  "text_ref": "encrypted:...",
  "source_extra_ref": "encrypted:...",
  "source_account_ref": "encrypted:optional",
  "tool": { "name": "bash", "input_ref": "encrypted:...", "exit_code": 1,
            "stdout_artifact_id": "art_...", "stderr_artifact_id": "art_..." },
  "assignment_ids": ["asg_..."],
  "sensitivity": "unknown",
  "sensitivity_classification_state": "candidate",
  "context_injected": false,
  "context_pack_id": null,
  "context_pack_digest": null,
  "context_recipe_id": null,
  "injected_at_ref": "encrypted:null_or_time",
  "parser_version": "claude_code_jsonl.v1",
  "schema_version": "event.v1"
}
```

Field meanings and validator rules:

- `event_id` is a schema representation and may change when the Parser version changes.
- `event_identity` is an immutable opaque HMAC, derived from the logical coordinates on the source without including `undiluted_id` (§4.10). The evidence of a Claim points to this. For the derivation rule, see §1.3.1 below.
- `origin` expresses the nature of the evidence and is the primary field that determines Ouroboros Guard / whether something can be evidence. For the values, see §1.3.2 below.
- `sensitivity_classification_state` has the same state space as the scope's classification_state, and the most the AI can produce is candidate.
- The `context_injected` family is session-level provenance (equal across events of the same session) and is set when a session started by having it read a Memoring-generated context.md is detected by a signed-marker match. `context_pack_digest` matches the ContextPack's `self_ingestion_marker_digest`. Its meaning is fixed to "this session is a session started by having it read a Memoring-generated context.md / ContextPack."

#### 1.3.1 Derivation of event_identity (§12.10)

`event_identity` is fixed to the logical coordinates on the source, not to raw bytes. Because `undiluted_id` is content-derived (`content_fingerprint` is an HMAC) and what it points to may change with dedup or re-acquisition, it is not used as the basis of identity.

```text
source_identity  = hmac(realm_key, connector_id || source_stable_id || source_account_stable_key)
session_identity = hmac(realm_key, source_identity || host_session_stable_id)
event_identity   = hmac(realm_key, source_identity || session_identity || (message_id | content_anchor))
                   # message_id if the source has a stable id, otherwise content_anchor

connector_instance_id is excluded from identity. Because its value may change on
  re-connect / restore, it is demoted to a provenance / config reference (§1.9).
undiluted_id is not included in event_identity. It is demoted to a traversal pointer to raw.
reprocess (Parser version change) does not change event_identity.
re-dedup / a change in the content_fingerprint scheme also does not change event_identity.
re-connect / restore also does not change event_identity (by virtue of stable coordinates).
Claim.evidence points to event_identity (not undiluted_id).
```

`source_logical_position` is contracted per Connector.

```text
append source:   stable offset / message id / source cursor
snapshot source: content-anchored hash (not line number)
```

By using `realm_key` as the key, `event_identity` does not collide across Realms, and the identity itself does not expose sensitive information in plaintext. `realm_key` is a rotation-invariant key derived from the Realm root secret (rotation-invariant), and keeps `event_identity` / `content_fingerprint` / `normalized_key` / `SealRule.target_signature` invariant across KEK rotation / DEK rekey / reconnect / restore (§4.10 / §7.4). This closes the safety violation whereby Sealed content could revive through reprocess / re-capture.

#### 1.3.2 origin values (§14.3)

`origin` expresses the nature of the evidence.

```text
origin values (10 values):
  user              user utterance / explicit instruction, decision, correction (external observation)
  tool_result       tool / command output (external observation)
  command_result    execution result of a shell etc. (external observation)
  file_diff         file change / diff (external observation)
  external_artifact  ingested external artifact (external observation)
  assistant         host AI's response / paraphrase (cannot be independent evidence)
  host_summary      summary generated by the host (cannot be independent evidence; not qualified as evidence)
  host_memory       host's own memory / CLAUDE.md-style injection (cannot be independent evidence; not qualified as evidence)
  system            host's system / config / CLAUDE.md-style injection (cannot be independent evidence; not qualified as evidence)
  unknown           undeterminable (cannot be independent evidence; treated as not qualified as evidence)

independent evidence allowed (= external_observation): user / tool_result / command_result / file_diff / external_artifact
independent evidence not allowed: assistant / host_summary / host_memory / system / unknown
cannot be evidence at all (derived / non-authoritative): host_summary / host_memory / system / unknown
```

`origin ∈ {assistant, host_summary, host_memory, system, unknown}` does not become an independent evidence signal, and `origin ∈ {host_summary, host_memory, system, unknown}` cannot be evidence at all. This closes the laundering loop whereby Memoring observes host-side memory → Memoring re-injects it → it returns to host memory. `source_account_ref` is provenance that distinguishes multiple accounts / identifiers within the same source.

`system` (host's system / config / CLAUDE.md-style injection) is not made independent evidence. It cannot serve as the basis for constraint / decision / do_not_do either, and is treated as project-policy-equivalent only on explicit import.

An ingest whose origin cannot be determined (e.g. an unsupported Parser) is `origin=unknown`, and on the safe side is treated as not allowed for independent evidence and not qualified as evidence.

#### 1.3.3 SecretScanResult

The deterministic result of an event-level Secret Scan. index build / remote_ai / redacted_export must reference this.

```json
{
  "secret_scan_id": "scan_01J...",
  "event_id": "evt_01J...",
  "secret_scan_status": "not_run | passed | failed | error",
  "secret_scan_passed": false,
  "secret_detected": false,
  "secret_scan_version": "secretscan.v1",
  "redaction_ref": "encrypted:optional",
  "created_by_derivation_id": "der_01J... | null",
  "created_at_ref": "encrypted:...",
  "schema_version": "secretscanresult.v1"
}
```

Field meanings and validator rules:

- The Secret Scan runs deterministically and completes before index build (§5.4 / §6.4 / §7.1).
- The Scan's secret determination overrides the AI candidate's sensitivity and forces secret.
- scan failure / undeterminable → `secret_scan_status = failed / error`, `secret_scan_passed = false`. The event in question is treated as not egressable (Silence) and is not indexed.
- index build / remote_ai / redacted_export must reference `secret_scan_passed = true`.

### 1.4 Assignment / Label

The ScopeLabel is split into the assignment (Assignment) and the vocabulary (Label). Assignment expresses "which label is attached to which target," and Label expresses "the label vocabulary itself."

Assignment:

```json
{
  "assignment_id": "asg_01J...",
  "target_type": "event",
  "target_id": "evt_01J...",
  "label_ids": ["lbl_01J..."],
  "project_ids": ["proj_01J..."],
  "classification_state": "candidate | inferred | confirmed | conflicted | rejected",
  "assigned_by": "ai | rule:path_git_remote | user_rule | explicit_user",
  "confidence": 0.86,
  "evidence": ["occ_01J..."],
  "created_by_derivation_id": "der_01J... | null",
  "created_at_ref": "encrypted:...",
  "schema_version": "assignment.v1"
}
```

Label (vocabulary):

```json
{
  "label_id": "lbl_01J...",
  "realm_id": "realm_01J...",
  "canonical_name_ref": "encrypted:...",
  "normalized_key": "hmac:...",
  "aliases_ref": "encrypted:[...]",
  "state": "active | merged | deprecated",
  "merged_into": "lbl_01J... | null",
  "merge_history_ref": "encrypted:[...]",
  "created_at_ref": "encrypted:...",
  "schema_version": "label.v1"
}
```

Validator rules:

```text
The most the AI can produce is candidate (Assignment.classification_state).
confirmed is only the user, explicit policy, or a user-defined rule.
A single target is allowed to have multiple labels (label_ids).
An unclassified (classified(x)=false) / rejected target does not proceed to index / Claim / ContextPack / export.
Assignment.created_by_derivation_id points to a Derivation for AI-derived assignments.
normalized_key is an HMAC keyed on realm_key, used for vocabulary dedup / merge determination, and does not expose the plaintext label.
merge consolidates Labels (retaining merge_history), re-points the label_ids of the related Assignments, and unions the evidence. The AI only produces merge candidates and does not finalize.
A label is a soft attribute within a Realm and does not get promoted to a cryptographic boundary. A boundary that requires separation is separated by Realm.
```

### 1.5 Claim

A versioned, evidence-backed, mutable assertion drawn up from facts.

```json
{
  "claim_id": "clm_01J...",
  "kind": "decision",
  "statement_ref": "encrypted:...",
  "structured_predicate_ref": "encrypted:optional",
  "assignment_ids": ["asg_..."],
  "project_ids": ["proj_..."],
  "abstraction_level": 4,
  "status": "candidate | consolidated | conflicted | superseded | rejected | redacted",
  "evidence_event_identities": ["eid:hmac:..."],
  "evidence_occurrence_ids": ["occ_..."],
  "created_by": "ai | rule | user | validator",
  "created_by_derivation_id": "der_01J... | null",
  "created_at_ref": "encrypted:...",
  "last_recalled_at_ref": "encrypted:null_or_time",
  "valid_from_ref": "encrypted:...",
  "valid_until_ref": "encrypted:optional",
  "supersedes": ["clm_..."],
  "evidence_count": 2,
  "reinforcement_score": 0.7,
  "confidence": 0.95,
  "sensitivity": "confidential",
  "sensitivity_classification_state": "inferred",
  "schema_version": "claim.v1"
}
```

Field meanings and validator rules:

- `kind` (Claim Form) is preference / constraint / decision / fact / project_context / procedure. For the per-kind origin requirements, see §3.3.1.
- `evidence_event_identities` points to `event_identity` (HMAC), not to `undiluted_id`.
- `evidence_count` refers to the independent evidence count per the independent evidence definition (§10.1). `independent_evidence_count` is an alias for it; the definition must not diverge. Repetition of the same utterance, duplication of the same tool output, the reappearance of context.md, and an assistant paraphrase in a context_injected session do not increase `evidence_count`.
- `sensitivity` inherits the maximum sensitivity of the evidence, and lowering it below that requires a non-AI authority (§6.3 / §4.7). `sensitivity_classification_state` has the state space of §2.3.
- The scale of `abstraction_level`: 0 = raw-derived fragment, 2 = session summary, 4 = stable preference / constraint / policy, 5 = values-level abstraction. `abstraction_level` is a reference value in v0 and is not made the primary axis of ranking.
- `created_by_derivation_id` points to a Derivation for AI-derived Claims, and may be null when `created_by=user / rule / validator`.
- A Claim has an encrypted natural-language statement and an optional structured predicate. Synonymous preferences auto-merge and union the evidence. Similar Claims that cannot be merged are not silently duplicated but treated as `status = conflicted` + `conflict_reason = duplicate_candidate` (no new state is created).

### 1.6 ContextPack

A projection generated only when called. By default it does not store the body, leaving only the manifest (pack id, Recipe, policy, evidence id, active scope, generation time, etc.).

```json
{
  "context_pack_id": "ctx_01J...",
  "purpose": "coding_agent_session_start",
  "realm_id": "realm_01J...",
  "audience": "ai_tool | remote_ai_processing | export | human_local_view",
  "aperture": "strict | standard | permissive | full_access",
  "active_label_ids": ["lbl_..."],
  "active_project_ids": ["proj_..."],
  "resolution_basis": "cli_scope | cli_project | cwd_project_match",
  "context_budget_recipe_id": "recipe_context_budget_v1",
  "token_budget": "from_context_budget_recipe",
  "generated_at_ref": "encrypted:...",
  "policy_applied": ["active_scope_only", "no_secret", "no_unknown",
                     "classified_only", "no_confidential",
                     "historical_context_quarantine",
                     "citations_required", "self_ingestion_marker"],
  "policy_digest": "hmac-sha256:...",
  "manifest_only": true,
  "body_ref": null,
  "self_ingestion_marker_digest": "hmac-sha256:...",
  "evidence_ids": ["clm_...", "evt_..."],
  "schema_version": "contextpack.v1"
}
```

Field meanings and validator rules:

- By default it does not store the body, only the manifest (`manifest_only: true`, `body_ref: null`). Citations for the AI are opaque IDs only.
- `audience` and `aperture` record the output Gate (§3.4) applied to this pack; the default is `ai_tool + standard`.
- `policy_digest` is the digest of the applied policy.v2, allowing later audit of "through which Gate it was emitted."
- `self_ingestion_marker_digest` matches the signed marker embedded in context.md and is used for the context_injected determination at re-ingest time (§1.3).

### 1.7 Chronicle

An append-only log of operations. Lower layers can be deterministically reconstructed from here.

```json
{
  "chronicle_id": "chr_01J...",
  "sequence": 1024,
  "prev_chronicle_id": "chr_01J...",
  "op_type": "capture | normalize | scope_confirm | consolidate | redact | delete | seal | reindex",
  "target_ref": "und_01J... | evt_... | clm_...",
  "payload_digest": "hmac-sha256:...",
  "created_at_ref": "encrypted:...",
  "schema_version": "chronicle.v1"
}
```

append-only. The index can be deterministically reconstructed from the Chronicle. `sequence` is an internal order that increases monotonically within the Realm and is the primary information for order judgment (the supersede of §4.16) that does not depend on the source-reported timestamp. `prev_chronicle_id` is for chain verification; the order is held by `sequence` (it does not break even under concurrent updates).

### 1.8 Artifact

Artifacts such as diff, stdout, stderr, attachments.

```json
{
  "artifact_id": "art_01J...",
  "kind": "stdout | stderr | diff | attachment",
  "encrypted_ref": "objects/7f/ab/art_01J...",
  "content_fingerprint": "hmac-sha256:...",
  "filename_ref": "encrypted:optional",
  "mime_type": "text/plain",
  "size_bytes": 1024,
  "schema_version": "artifact.v1"
}
```

The attachment filename is encrypted.

### 1.9 Support entities

```text
Policy { policy_id, version, rules[], precedence_rank, schema_version }
Source { source_id, source_stable_key_hmac, connector_id, connector_instance_id, source_type, schema_version }
Project { project_id, root_paths_ref, git_remotes_ref, schema_version }
ConnectorInstance { connector_instance_id, connector_id, config_ref, schema_version }
Tombstone { tombstone_id, deleted_ref, minimal_range_ref, created_at_ref, schema_version }
QuarantineRecord { quarantine_id, occurrence_id, undiluted_id, reason, parser_version, created_at_ref, schema_version }
```

`source_stable_key_hmac` is `hmac(realm_key, connector_id || source_stable_id || source_account_stable_key)` (= `source_identity`) and is the basis of the stable coordinate for event_identity (§1.3.1). `connector_instance_id` is excluded from the basis of identity and demoted to a provenance / config reference (because its value may change on re-connect / restore).

Session, Derivation, and SealRule are defined below as independent entities rather than support entities.

### 1.10 Session

A provenance entity representing one session on the source (one conversation / one execution). The session-family fields of an event are normalized here.

```json
{
  "session_id": "ses_01J...",
  "realm_id": "realm_01J...",
  "source_id": "src_01J...",
  "connector_instance_id": "ci_01J...",
  "host_tool": "claude_code | codex | manual | ...",
  "host_tool_version": "x.y.z",
  "format_version": "claude_code_jsonl.v3",
  "cwd_ref": "encrypted:optional",
  "project_ids": ["proj_01J..."],
  "git_remote_ref": "encrypted:optional",
  "source_account_ref": "encrypted:optional",
  "transcript_path_ref": "encrypted:optional",
  "started_at_ref": "encrypted:...",
  "ended_at_ref": "encrypted:optional",
  "context_injected": false,
  "context_pack_digest": "hmac-sha256:null_or_digest",
  "schema_version": "session.v1"
}
```

`context_injected` / `context_pack_digest` are held at session-level, and the events belonging to that session inherit the same values. `host_tool_version` / `format_version` are the inspection targets recorded by the Connector's host-resilience contract (§3.2); on an unsupported version it falls back to raw-only. git_remote / cwd / transcript path are held as encrypted refs and are not exposed in plaintext.

### 1.11 Derivation

The provenance of a derivation by AI / Recipe. AI-derived records point to it via `created_by_derivation_id`.

```json
{
  "derivation_id": "der_01J...",
  "realm_id": "realm_01J...",
  "derivation_type": "scope_classify | sensitivity_classify | consolidate | abstract | label_suggest",
  "input_event_identities": ["eid:hmac:..."],
  "input_claim_ids": ["clm_..."],
  "model_provider": "local | <provider>",
  "model_name": "...",
  "model_version": "...",
  "temperature": 0.2,
  "prompt_version": "consolidate_prompt.v3",
  "recipe_id": "recipe_consolidation_v1",
  "validator_version": "validator.v2",
  "policy_digest": "hmac-sha256:...",
  "output_digest": "hmac-sha256:...",
  "created_at_ref": "encrypted:...",
  "schema_version": "derivation.v1"
}
```

Derivation is provenance for audit and reproduction and is not itself evidence. Output differences for the same input are compared in eval, and the Core schema is not changed. The default on a Recipe change is no auto-retroactive, and application to existing records is by explicit reprocess (§9.4 / Chapter 10). A legacy record is tied to a placeholder Derivation with `derivation_id=legacy`.

### 1.12 SealRule

Represents the durable suppression of a Seal. It ensures that delete / redact-ed content does not revive through reprocess / re-capture.

```json
{
  "suppression_id": "seal_01J...",
  "realm_id": "realm_01J...",
  "match_type": "event_identity | content_signature | pattern",
  "target_signature_ref": "encrypted:...",
  "scope": "Realm | label | project",
  "scope_ref": "lbl_... | proj_... | null",
  "reason_ref": "encrypted:optional",
  "created_by": "user",
  "active": true,
  "created_at_ref": "encrypted:...",
  "schema_version": "sealrule.v1"
}
```

A candidate matching an active SealRule does not proceed to Claim / index / ContextPack / export (§4.15). `created_by` is limited to user, and removal is likewise limited to an explicit user operation (AI / policy neither creates nor removes). `target_signature` is held as an HMAC keyed on `realm_key` and does not expose the suppressed content in plaintext.

---

## 2. State transitions

### 2.1 Classification state (scope classification_state, §7.2)

The scope classification state (Assignment.classification_state) has the following 5 states. `unclassified` is not a state value but a scope-axis notion meaning "there is no valid Assignment on the target (no assignment)," and is not included in the state space.

```text
candidate     The AI or a weak rule produced a candidate.
inferred      Inferred from a strong deterministic signal such as path / project / Connector / git remote / account.
confirmed     Finalized by the user, or by explicit policy / a user-defined rule.
conflicted    Multiple classifications conflict.
rejected      The candidate was negated.
```

Transition conditions:

```text
(Assignment absent) → candidate     AI / a weak rule produces a candidate
(Assignment absent) → inferred      a deterministic signal of path / project / Connector / git remote / account
candidate    → inferred      a deterministic signal is attached later
candidate    → confirmed     user / explicit policy / user-defined rule (AI not allowed)
candidate    → rejected      the candidate is negated
inferred     → confirmed     user / explicit policy / user-defined rule
any          → conflicted    multiple classifications conflict
any          → rejected      user / policy negates
```

The boundary of finalization authority: classification by the AI is only up to candidate. The only parties that can make something confirmed are the user, explicit policy, and a user-defined deterministic rule.

`classified(x)` = the target has an Assignment with classification_state ∈ {candidate, inferred, confirmed, conflicted}. When Assignment is absent, or only rejected ones exist, `classified(x)=false` (= unclassified), and in the Gate's classified condition it drops to the stage before the sensitivity determination. Whether a candidate scope may be emitted to output is decided by the Aperture via `allowed_scope_state` (§3.4). strict allows only inferred / confirmed; standard allows candidate limited to active scope.

### 2.2 Claim State (§8.4)

The Claim's states are unified into the following 6 states. reinforcement is not a state but a signal that drives the state transitions.

```text
candidate     A candidate for long-term memory.
consolidated  Established as a long-term Claim. Usable in a ContextPack (only when it passes the Gate).
conflicted    There is counterevidence or contradiction.
superseded    Replaced by a newer Claim, or expired and removed from active recall.
rejected      The user or policy negated it.
redacted      Not used due to a safety / deletion request.
```

Transition conditions:

```text
candidate    → consolidated  auto_consolidate(m) is true (§3.3 / §4.7)
candidate    → rejected      does not pass schema / evidence validation, or user / policy negates
candidate    → conflicted    there is counterevidence / contradiction
consolidated → conflicted    later counterevidence / contradiction
consolidated → superseded    a newer Claim replaces it, or it is removed from active recall on valid_until arrival
any          → redacted      safety / deletion request (delete / redact cascade, Seal)
any          → rejected      user / policy negates
```

A Claim has `valid_from`, an optional `valid_until`, and an optional `supersedes`. When told "forget the previous policy," the old Claim becomes superseded and is removed from active recall. The order judgment of supersede is decided not by the source timestamp but by capture order / `Chronicle.sequence` / an explicit `valid_from` (§4.16).

`duplicate_candidate` is not a new state. A duplicate candidate that cannot be merged is represented by `status = conflicted` + `conflict_reason = duplicate_candidate` (§1.5).

### 2.3 sensitivity classification_state (§15.2)

sensitivity also has the same determination states as scope.

```text
candidate   The AI or a weak rule produced a candidate.
inferred    Inferred from a path / Connector / account / policy / Declassify signal.
confirmed   Finalized by the user, explicit policy, or a user-defined rule.
conflicted  Multiple determinations conflict.
rejected    The candidate was negated.
```

The most the AI can produce is candidate. The only parties that can make something confirmed are the user, explicit policy, and a user-defined rule.

The sensitivity value (public / internal / confidential / secret / unknown) and the determination state (candidate / inferred / confirmed / conflicted / rejected) are orthogonal. The asymmetry of Declassify (a relaxation that lowers sensitivity) is defined by §6.3 and §4.3. remote_ai / redacted_export / dataset_export look not only at the value but also at the determination state (§6.4 / §7.2).

---

## 3. Responsibilities and processing units of each component

### 3.1 Connector interface (§10.2)

A Connector is the part that finds the local accumulation of an AI tool and opens a mouth to it.

```ts
interface Connector {
  id: string;
  displayName: string;
  sourceType: 'append' | 'snapshot' | 'event' | 'artifact';

  detect(): Promise<DetectionResult>;          // returns an Inventory (re-runnable)
  configure(input: ConnectorConfig): Promise<ConnectorInstance>;  // include/exclude and Realm assignment
  Backfill(options: BackfillOptions): AsyncIterable<OccurrenceInput>;
  watch(options: WatchOptions): AsyncIterable<OccurrenceInput>;
  parse(raw: Undiluted, occurrence: Occurrence): Promise<ParseResult>;
  health(): Promise<ConnectorHealth>;
}
```

`detect` does not return the host tool as a single lump. It enumerates the discovered sources as an Inventory.

```text
DetectionResult.sources[]:
  source_stable_id
  project root / git remote / account / account profile
  transcript path / last modified
  estimated sensitivity hint
  suggested Realm
  host_tool / host_tool_version / format_version
```

`configure` receives the include / exclude over the Inventory and the Realm assignment of each source. The granularity of a ConnectorInstance is not the whole host tool but the selected set of sources. `watch` targets only the selected sources. Whole-tool watch is not made the default. Because the history of Claude Code / Codex may mix work, personal, OSS, customer engagements, and a separate identity, the initial flow does not mix everything into one Realm.

### 3.2 Parser requirements (§10.3)

A Parser is the boundary that separates the dirty outside world from Memoring's fixed schema. The local transcript format is not regarded as a stable API and is treated as a best-effort unstable Parser.

```text
Parser id / version / host tool version / format hint
source fingerprint / schema version
fixture set / golden output
unknown field passthrough
parse failure Quarantine
raw-only fallback
```

raw that cannot be normalized is retained as raw-only and reprocessed later by updating the Parser. An unknown field is stored in an encrypted blob (`source_extra_ref`) and is excluded from index / ContextPack until it is promoted to a known field. A secret within an unknown field is also subject to the event-level Secret Scan.

Resilience to host changes (the fixed Connector contract):

```text
The host transcript format is not regarded as a stable API.
The Connector records the tested host version / format version / Parser version.
detect / doctor inspect the host version and Parser compatibility.
On an unknown format / unsupported version, it does not perform a broken parse but falls back to raw-only.
Even when acquisition / parse fails, raw is not lost.
It does not depend too strongly on folder path / file layout. source_stable_id is made the primary key.
It holds golden fixtures and verifies the Connector on every host update.
The Connector can re-detect the Inventory (detect is re-runnable).
```

Even if a host (Claude Code / Codex) update changes the internal folder structure or storage format, Memoring as a whole does not break and at minimum degrades to raw-only capture / Quarantine / doctor warning.

### 3.3 consolidation pipeline (§8.6)

Memoring does not create a review queue. A Claim is treated as something that accumulates autonomously. A candidate passes through a validation chain.

```text
AI / a rule creates a candidate
  → schema validation
  → evidence validation (including origin authority, §3.3.1)
  → sensitivity / scope validation
  → policy validation
  → lifecycle / conflict validation
  → suppression check (Sealed content is not revived)
  → consolidated, or conflicted / rejected
```

Quarantine is not a state of a Claim but a state of a parse / event (§5). A candidate that does not pass schema / evidence validation becomes rejected and does not become a Claim.

Both low-risk and high-risk are auto-consolidated if they pass the validator. Safety is protected not by stopping consolidated but by the Gate at output time. The design does not have the user approve one item at a time.

The exact predicate of auto-consolidate is given in §4.7.

#### 3.3.1 Evidence rule and origin authority (§8.5)

A long-term Claim always has evidence. Evidence is an Event, and its origin (§1.3.2) determines authority. An assistant utterance or a host-generated artifact is an observation of "it was said so / it was generated so" and is not made the basis for "it is true."

origin and authority:

```text
user             explicit utterance / correction / decision / pin. The strongest authority.
tool / command   tool result / command result / file diff. Strong as an observation with externality.
external         ingested external artifact (file etc.).
assistant        assistant utterance. An observation; not made independent evidence.
host_summary     summary generated by the host. derived. cannot be independent evidence; not qualified as evidence.
host_memory      memory generated by the host (auto memory etc.). derived. cannot be independent evidence; not qualified as evidence.
system           host's system / config / CLAUDE.md-style injection. cannot be independent evidence; not qualified as evidence. cannot serve as the basis for constraint / decision / do_not_do. project-policy-equivalent only on explicit import.
unknown          undeterminable. On the safe side, treated as cannot be independent evidence; not qualified as evidence.
```

origin allowed per kind:

```text
constraint / do_not_do   requires user origin (explicit utterance / rule / policy). assistant alone not allowed.
decision                 requires user origin. assistant alone not allowed.
preference               allowed with 1 user origin. assistant is auxiliary only (not allowed alone).
fact / project_context   tool / file diff / command result / user origin are strong. assistant is auxiliary only.
procedure                allowed with a repeated successful tool trace. assistant summary alone not allowed.
```

Forbidden:

```text
Making an AI summary the sole basis
Making a past AI-generated Claim the sole basis
Making a Memoring-generated ContextPack / context.md the basis
Counting origin ∈ {assistant, host_summary, host_memory, system, unknown} as independent evidence
Counting an assistant-derived assertion in a context_injected session as independent evidence
Consolidating a constraint / do_not_do / decision on assistant origin alone
Putting a Claim without evidence at the top of a ContextPack
```

An explicit preference / constraint / decision can be remembered with 1 piece of evidence. A pattern that the AI merely inferred requires multiple pieces of independent evidence (initial values in Chapter 10).

### 3.4 Gate predicate (§12.1)

The authoritative copy of the Gate predicate is this section. The output Gate is the only safety gate that judges whether something may enter the output. The condition for item `x` to enter the ContextPack of request `r` is as follows. `r` has an Audience (who reads it) and an Aperture (how far it is emitted).

```text
gate(x, r)
= captured(x)
∧ not_deleted(x)
∧ not_redacted(x)
∧ not_suppressed(x)                    # Seal does not revive even on reprocessing (§4.15)
∧ classified(x)                        # classified(x)=false (unclassified) / rejected is not emitted. The stage before sensitivity determination
∧ active_scope_match(scope(x), r.active_scopes)
∧ allowed_scope_state(scope_state(x), r.audience, r.aperture)
∧ allowed_sensitivity(sensitivity(x), r.audience, r.aperture)
∧ allowed_sensitivity_state(sensitivity(x), r.audience, r.aperture)
∧ not_conflicted_for_request(x, r)
∧ cross_scope_allowed(x, r)
∧ has_required_provenance(x)
∧ not_self_generated_context_as_evidence(x)   # origin gate (§4.12)
```

The output Gate is decided by only the 2 axes of Audience and Aperture. This is the only safety mechanism. Being a local file is not made the basis for safety.

Definitions of Audience and Aperture:

```text
Audience:     ai_tool (default) / remote_ai_processing / export / human_local_view
Aperture:  strict / standard (default) / permissive / full_access
```

`classified(x)`: the target has an Assignment with classification_state ∈ {candidate, inferred, confirmed, conflicted}. Assignment absent, or only rejected → `classified(x)=false` (= unclassified) (§2.1).

`allowed_scope_state` (whether a candidate scope may be emitted):

```text
strict:        scope_state ∈ {inferred, confirmed}
standard:      scope_state ∈ {candidate, inferred, confirmed} (candidate is limited to active scope)
permissive:    same as standard
full_access:   all (human_local_view Audience only)
```

`allowed_sensitivity` (which class may be emitted. For details, the single table of §7.2 is authoritative):

```text
hard floor (not allowed under any Audience / Aperture): secret(raw) / unknown (unclassified drops to the prior stage by the classified(x) condition)
strict:        public / internal only
standard:      public / internal (confidential is dropped)
permissive:    public / internal; confidential only on a one-shot confirmation
full_access:   all (human_local_view Audience only. secret only when redacted)
```

`allowed_sensitivity_state` (the requirement on the determination state):

```text
Audience = ai_tool / human_local_view:
  standard / permissive: state ∈ {candidate, inferred, confirmed}
                         (candidate internal / public is limited to active scope)
  strict:                state ∈ {inferred, confirmed}

Audience = remote_ai_processing / export:
  state ∈ {inferred, confirmed} (the still-candidate is not emitted externally)
```

Therefore secret / unknown / unclassified (classified(x)=false) / out-of-scope / no-provenance / self-generated context / suppressed will have one of the conditions become false and will not enter the ContextPack. In remote_ai_processing and export, the still-candidate determination is additionally dropped.

Design decision: the reason the default `ai_tool + standard` can emit active-scope candidate internal / public is that this is a handoff to the user's own AI tool that the user themselves started. This differs in purpose from remote_ai_processing, where Memoring autonomously calls an external provider for classification / abstraction (§6.4). The latter is default deny and does not emit still-candidate sensitivity externally. Mistaking the Audience and tilting toward the looser side is forbidden.

The following 3 of the predicates of `gate(x, r)` are defined.

```text
not_conflicted_for_request(x, r):
  A conflicted Claim is emitted only into the "Open conflicts" section of the context and is dropped from normal recall by the Gate.
cross_scope_allowed(x, r):
  The permission of Crossing (emitting across a scope outside the active scope). v0 is default deny. Allowed only when policy explicitly permits.
has_required_provenance(x):
  Satisfying the required provenance per item type.
    Claim: has evidence satisfying the per-kind origin requirement (§3.3.1).
    Assignment / sensitivity: has a classification_state, and for external purposes state ∈ {inferred, confirmed}.
    Event: has an origin (§1.3.2).
```

#### Resolution rule of active scope (authoritative)

`r.active_scopes` is determined by the following procedure. The authoritative copy of active scope resolution is this section (CLI is Specification §1.1).

```text
1. If there is a CLI explicit (--scope / --label / --project), make that the active scope.
2. Otherwise, canonicalize the CWD and match it against Project.root_paths / git_remotes to decide active_project.
3. Make the Labels with classification_state ∈ {confirmed, inferred} that belong to active_project the active scope.
4. When active_project has multiple matches or zero, Silence (does not emit context.md; prompts for --scope / --project).
5. Even when emitting a candidate scope under standard Aperture, it is limited to active scope.
```

CLI: add `--scope` / `--project` to `context build`. Leave `active_label_ids` / `active_project_ids` and `resolution_basis` (the resolution basis) in the ContextPack manifest. When resolution is impossible, it is Silence (already made an FR).

### 3.5 Gate First / Ratchet (§12.2 / §12.3)

#### Gate First (Ranking is after the Gate)

```text
rankable(x, r) ⇒ gate(x, r)
¬gate(x, r) ⇒ score(x, r) is undefined
```

The safety mechanism is the Gate. The ranking penalty is a quality adjustment, not a safety mechanism. secret / unknown / confidential / out-of-scope do not reach ranking. The Gate keeps the irreversible order of coming before ranking.

#### Ratchet

Safety determination becomes monotonically stricter. Automatically, it moves only in the direction of stricter.

```text
gate=false until unknown changes to classified
classified(x)=false (unclassified) → treated as output high-risk until a confirmed / inferred Assignment is attached
secret → output=false unless redacted
Declassify (a relaxation that lowers sensitivity) is not finalized by an AI candidate alone
```

The AI's confidence and a tunable Recipe do not loosen safety. Only policy and validator have relaxation conditions. The closed enumeration of Declassify (a relaxation that lowers sensitivity) is given in §6.3.

### 3.6 ranking (§13.3, after the Gate)

ranking is a quality adjustment applied only to items that have passed the Gate. The ranking coefficients / floors are tunables owned by the Recipe and are given in Chapter 10. A safety floor can be changed only toward the safe side. For the initial values of the score formula and floor / ceiling, see §10.3.

---

## 4. Structural invariants (§12 in full)

What is fixed is not numbers but the shapes, boundaries, orderings, predicates, and permission conditions that must not be broken. The following is the contract that validator / gate / policy always uphold.

```text
Invariant: the shapes fixed at design time. validator / gate / policy always uphold them.
Tunable:   initial values owned by the versioned Recipe (Chapter 10).
Forbidden third category: numbers that look fixed but are in fact frequently touched by hand. Do not create these.
```

### 4.1 §12.1 Gate predicate

The full form is given in §3.4. All conditions of `gate(x, r)`, the Audience / Aperture definitions, and `allowed_scope_state` / `allowed_sensitivity` / `allowed_sensitivity_state` are invariant.

### 4.2 §12.2 Gate First

```text
rankable(x, r) ⇒ gate(x, r)
¬gate(x, r) ⇒ score(x, r) is undefined
```

### 4.3 §12.3 Ratchet and Declassify

Safety decisions tighten monotonically (§3.5). The signals that can confirm a Declassify (a relaxation that lowers sensitivity; e.g. unknown→internal/public, confidential→public, secret→lower; the direction that increases output exposure) are limited to the following closed enumeration. Nothing outside this is grounds for relaxation.

```text
Permitted Declassify signals:
  - the user's explicit rule (this label / this source is public, etc.)
  - the project's explicit policy (a declaration stated in policy.v2)
  - a user-confirmed correction (an explicit operation raising a candidate to confirmed-safe)
  - import from a verified public source accompanied by an immutable URL
  - a detector-pattern-specific deterministic false-positive rule (limited to a specific pattern)
```

```text
Things that must NOT be grounds for Declassify:
  - AI confidence / probability
  - semantic similarity / embedding proximity
  - filename alone / "public" contained in the path
  - the git remote merely being public
  - occurrence frequency / reoccurrence
```

Declassifying unknown / unclassified (classified(x)=false) for the purpose of remote_ai_processing transmission is forbidden. unknown does not leave the system externally until it becomes classified. Relaxation always requires an explicit and auditable signal and never happens by AI alone. Escalate (a tightening that raises sensitivity; e.g. internal→confidential, public→secret, keep unknown; the Silence side that reduces output exposure) is allowed even as an AI candidate.

### 4.4 §12.4 Safety floor

The coefficients of the safety penalty have fixed lower bounds. The concrete values live in the Recipe, but they can only be changed toward the safe side.

```text
weight(sensitivity_penalty) ≥ floor_sensitivity > 0
weight(cross_scope_penalty) ≥ floor_cross_scope > 0
weight(conflict_penalty)    ≥ floor_conflict    > 0
raw_excerpt_share ≤ raw_excerpt_share_ceiling
```

### 4.5 §12.5 Search / encryption invariant

```text
read(Index) requires unlocked Realm
at_rest(Index) = Encrypt(index_payload)
global_plaintext_index = forbidden
persistent_plaintext_fts_file = forbidden
remote_index_build_without_opt_in = forbidden
sqlite_aux_files = encrypted_or_disabled
plaintext_payload_in_logs = forbidden
```

The tokens, n-grams, embeddings, term frequencies, and snippet caches contained in the index are all derived information from content and are subject to encryption.

When using SQLite, close every path by which derivatives of the payload could leak. WAL / rollback journal / temp store / FTS shadow table / vacuum intermediate files / backup file are either encrypted or disabled. Put the temp store in memory / tmpfs and leave no plaintext intermediate files on disk. Do not emit content payload to logs; record only id / counts / state.

### 4.6 §12.6 Japanese / CJK search invariant

```text
search_text(q) = metadata_filter(q) ∪ exact(q) ∪ fts(q) ∪ trigram_or_ngram(q) ∪ session_reconstruction(q)
```

n is not fixed. Only the existence of the fallback is invariant. The value of n is an implementation choice.

### 4.7 §12.7 Claim consolidation invariant

```text
auto_consolidate(m)
= status(m) = candidate
∧ evidence_sufficient(m, kind(m), origin(m))
∧ confidence(m) ≥ τ_conf(...)        # τ_conf is Recipe (Chapter 10)
∧ conflict_count(m) = 0
∧ user_rejected(m) = false
∧ policy_allows_store(m)
∧ schema_valid(m)
∧ provenance_valid(m)
∧ not_self_generated_context_as_evidence(m)
```

Being high-risk does not forbid auto-consolidate. high-risk restricts exposure, not store.

```text
high_risk(m) ⇒ exposure_restricted(m) = true
high_risk(m) ⇒ remote_ai_gate(m) = false unless explicit_user_approval
high_risk(m) ⇒ cross_scope_gate(m) = false unless policy_allows
```

A Claim's sensitivity is not lower than the maximum sensitivity of its evidence (sensitivity ordering: public < internal < confidential < secret; unknown is Silence).

```text
sensitivity(m) is at least max_sensitivity(evidence(m)).
Making sensitivity(m) lower than max_sensitivity(evidence(m))
  requires one of the Declassify signals enumerated in §4.3.
An AI candidate alone cannot go below the maximum sensitivity of the evidence.
```

The grounds for lowering sensitivity are limited to the closed enumeration in §4.3; AI confidence or semantic similarity is not grounds.

### 4.8 §12.8 Reinforcement invariant

reinforcement is a bounded scalar. The Recipe (Chapter 10) owns the signals, weights, and decay, but the following is invariant.

```text
0 ≤ reinforcement_score(m) ≤ 1
The trigger for incrementing valid_recall_count is only re-confirmation as an external observation. Inclusion in context.md itself is not counted.
correction_count increment ⇒ that correction alone does not raise reinforcement_score
conflict_count increment ⇒ that conflict alone does not raise reinforcement_score
user_rejected(m) = true ⇒ auto_consolidate(m) = false
self_generated_context_reappears(m) ⇒ valid_recall_count does not increase
self_generated_context_reappears(m) ⇒ independent_evidence_count does not increase
context_injected(session) ∧ assistant_originated(x) ⇒ valid_recall_count does not increase
context_injected(session) ∧ assistant_originated(x) ⇒ independent_evidence_count does not increase
```

### 4.9 §12.9 Context budget invariant

```text
ContextPack has a budget
ContextPack does not exceed the budget
an explicit cap exists for raw_excerpt
raw_excerpt is a last resort and always has citations / fence / safety header
safety header / constraints / scope boundary are not pushed out by raw excerpt
```

### 4.10 §12.10 Stable event identity invariant

The full form is given in §1.3.1. The HMAC derivation of `event_identity` from stable coordinates (via `source_identity` / `session_identity`), the non-participation of `undiluted_id` and `connector_instance_id` in identity, invariance across reprocess / re-connect / restore, and the per-Connector contract of `source_logical_position` are invariant. Because `realm_key` is rotation-invariant (§7.4), `event_identity` is unchanged across KEK rotation / DEK rekey.

### 4.11 §12.11 Event-level sensitivity invariant

```text
contains_secret_span(event) ⇒ sensitivity(event) = secret
secret(event) ⇒ index_text(event) = redacted_or_empty
secret(event) ⇒ context_output(event) = false
```

Even a tool output with only one line of mixed-in secret makes the whole event secret. A drop in recall is tolerated; implementation simplicity and safe-side Silence take priority.

Known cost: in coding use, tokens / keys easily get mixed into tool output, and erring on the safe side drags down useful context as collateral. v0 accepts this. Span-level masking is a matter for a future ADR and is not implemented in v0.

### 4.12 §12.12 Ouroboros Law

```text
self_generated_context(x) ⇒ evidence_allowed(x) = false
self_generated_context(x) ⇒ reinforcement_recall_signal(x) = false
self_generated_context(x) ⇒ independent_evidence_signal(x) = false
manual_import_path includes .memoring/ ⇒ exclude
context_injected(session) ∧ assistant_originated(x) ⇒ independent_evidence_signal(x) = false
context_injected(session) ∧ assistant_originated(x) ⇒ reinforcement_recall_signal(x) = false
context_injected(session) ∧ external_observation(x) ⇒ evidence_allowed(x) = true
```

`external_observation` = user message / tool result / command result / file diff / external artifact / explicit user correction / explicit user decision. It does not include the assistant's rephrasings.

### 4.13 §12.13 Loop convergence / idle invariant

The loop is diff-driven and converges to idle in a finite number of steps against an invariant Realm. It does not permit spinning on indefinitely with zero diff.

```text
fire(step) ⇒ new_observational_evidence ∨ user_trigger ∨ scheduled_maintenance_tick
AI / expensive steps fire only when there is new_observational_evidence.

converge:
  On a fixed Realm with no new evidence, the loop stops generating
  new candidates in a finite number of steps, the pending job set empties, and it enters idle.

idle:
  When there is no pending job ∧ no new evidence, the loop consumes no AI / compute resources.
  It does not do busy polling beyond the Watcher's wait.
```

Convergence is supported by existing invariants. Without them, the loop would re-eat its own derived output as input and generate infinite candidates with no new evidence.

```text
Do not make Derived into evidence (§3.3.1).
Do not ground only on past AI-generated Claims (§3.3.1).
Do not count self-generated context as evidence / recall_count (§4.12).
Do not make the assistant's rephrasings in a context_injected session into independent evidence (§4.12).
```

The only trigger permitted other than evidence is time-driven maintenance.

```text
Permitted: expire on reaching valid_until; reinforcement decay when adopted.
Constraint: run as a scheduled tick in a bounded manner; do not make it a busy loop.
      Do not generate infinite derived jobs without new evidence.
```

The specifics of the convergence decision and numbers such as the maintenance-tick interval are not this invariant but are owned by the versioned Recipe (Chapter 10).

### 4.14 §12.14 Label space invariant

```text
label_merge_confirm requires user / policy / rule (not confirmed by an AI candidate)
label_alias_suggest = AI candidate only
merge(label_a, label_b) ⇒ evidence(result) = evidence(a) ∪ evidence(b)
predefined_root_category = forbidden
```

The thresholds and normalization rules for proximity decisions are owned by the Recipe (§10.5). The thresholds only decide the surfacing range and do not loosen the Gate. labels are not promoted to the encryption boundary.

### 4.15 §12.15 Forget durability invariant

In addition to deletion, Seal generates a SealRule and guarantees that the same content does not revive on reprocess / re-capture.

```text
Seal(target) ⇒ delete/redact(target) ∧ create(SealRule)
SealRule suppresses future candidates by signature (pattern / target identity).
reprocess(Parser) ∧ matches(x, active SealRule) ⇒ x does not advance to Claim / index / ContextPack.
re-capture(same source) ∧ matches(x, active SealRule) ⇒ same as above.
suppression suppresses derived / output even when raw is not physically deleted.
SealRule release is only by the user's explicit operation (AI / policy does not release it).
```

suppression works together with the cascade of §7.3. Because delete alone could let reprocess regenerate the same Claim, Seal becomes durable only when accompanied by suppression. Propagation to backups / already-exported output is not guaranteed (§7.5 threat model).

### 4.16 §12.16 Temporal ordering invariant

supersede (a new assertion replacing an old one) does not use the source-declared timestamp as grounds for a safety decision.

```text
supersede(new, old) is not confirmed by the old/new of the source timestamp alone.
The source timestamp is a reference value with timestamp_confidence and can be tampered with.
A future-dated / inconsistent / non-monotonic timestamp is not grounds for supersede.
supersede is decided consistently with capture order / Chronicle.sequence (§1.7) / explicit valid_from.
A supersede in the direction of lowering sensitivity requires a Declassify signal of §4.3.
```

Reason: to prevent the attack where a malicious transcript injects a future-dated utterance and replaces an old, correct constraint with new misinformation. Temporal ordering takes Memoring's own observation order (capture / sequence), not content, as primary information.

---

## 5. Error handling

The entrance judges nothing and first ingests without breaking (Capture First). Errors fall to the safe side, and the undecidable is Silence.

### 5.1 raw-only fallback

raw that cannot be normalized is kept as raw-only and reprocessed later after updating the Parser. If raw capture fails, do not proceed to derived processing. Even when acquisition / parse is impossible, do not lose raw.

### 5.2 Quarantine

`Connector.parse` (§3.1) returns a `ParseResult`. `ParseResult` is either a group of Events or a QuarantineRecord (§1.9). When parse is impossible, do not create an Event and drop it into a QuarantineRecord (referencing Occurrence / Undiluted; raw is not lost).

```ts
type ParseResult =
  | { kind: 'events'; events: Event[] }
  | { kind: 'quarantine'; record: QuarantineRecord };
```

A parse failure is dropped into Quarantine. Quarantine is not a state of a Claim but a state of parse / event. A candidate that does not pass schema / evidence validation becomes rejected and does not become a Claim.

### 5.3 parse failure / unknown format / unsupported host version (§10.3)

For an unknown format / unsupported version, do not do a broken parse but fall to raw-only fallback. At minimum it falls to raw-only capture / Quarantine / doctor warning. `detect` / `doctor` check host version and Parser compatibility. Even if a host update changes the internal folder structure or storage format, Memoring as a whole does not break.

An unknown field is stored in an encrypted blob (`source_extra_ref`) and excluded from index / ContextPack until promoted to a known field. It is not discarded.

### 5.4 Secret Scan failure fail-closed (§15.6)

Secret Scan is Silence. On undecidable / failure, set `secret_scan_passed=false`. The result is recorded as a SecretScanResult (§1.3.3), runs deterministically, and completes before index build. The Scan's secret decision overrides an AI candidate's sensitivity and forces secret.

```text
Secret Scan is Silence. On undecidable / failure, secret_scan_passed=false.
On secret detection, raw is kept encrypted but the secret flag is set, and only a redacted representation is used in the index.
secret / unknown / confidential are by default not emitted to ContextPack / MCP / export / remote AI.
remote AI transmission requires secret_scan_passed=true and scope opt-in.
remote AI / export further require sensitivity ∈ {public, internal} and sensitivity_classification_state ∈ {inferred, confirmed}. An AI candidate's internal / public cannot go to external exposure.
index build comes after Secret Scan. On scan failure, that event is not indexed.
The default is "when in doubt, do not send."
```

### 5.5 The undecidable is Silence

unknown / unclassified (classified(x)=false) / out-of-scope / no-provenance make one of the Gate's conditions false and do not enter the ContextPack. A context build with no determined Active Realm does not emit a context.md (it does not guess and mix). When multiple Realms match, or none match anywhere, it is Silence, and the user is made to specify the Realm explicitly (`--realm <id>`), or no output is produced.

---

## 6. Permissions and authority

Authority is placed in schema, validator, policy, and evidence, not in the model. AI proposes, Memoring validates, and the user governs after the fact (Propose-Validate-Govern).

### 6.1 policy precedence (§15.3)

The authoritative source for policy precedence is Specification §5. This section is kept consistent with it.

```text
hard safety rule
  > destructive delete / redact confirmation
  > user explicit decision
  > project policy
  > Connector config
  > path / workspace / git remote / account rule
  > AI candidate
  > default Silence
```

organization / team policy does not exist in v0. work is a label for the individual's work context, and central management is out of scope for v0. The authorities usable for Declassify of sensitivity (a relaxation that lowers sensitivity) and for confirming also follow this precedence. An AI candidate can neither Declassify nor confirm sensitivity.

### 6.2 What AI cannot confirm (§9.2)

AI only creates candidates and has no authority to confirm the following.

```text
confirming scope (Assignment / Label)
permission to externally transmit secret / confidential
destructive redact / delete
permanent permission of Crossing
```

A high-risk Claim can become consolidated automatically, but that does not mean AI confirmed it. It is stored as an assertion that passed the validator, and the Gate protects it from out-of-scope / remote AI / secret / confidential output. auto-consolidate does not mean "AI confirms" but "the Memoring validator verifies an AI candidate, and only those that satisfy policy and evidence become consolidated."

### 6.3 The closed enumeration of Declassify (§12.3)

Declassify (a relaxation that lowers sensitivity) imposes the same asymmetry as scope. It is not confirmed by AI alone. The signals that can confirm it are limited to the closed enumeration in §4.3, and vague grounds such as "strong deterministic signal" are not used.

```text
Examples of Declassify:    unknown → internal/public, confidential → public, secret → lower
Grounds that can confirm Declassify: only the Declassify signals of §4.3 (explicit user rule /
  explicit project policy / user-confirmed correction /
  verified public source import accompanied by an immutable URL /
  detector-pattern-specific deterministic false-positive rule).
Escalate (a tightening that raises sensitivity) is in the Silence direction and is allowed even as an AI candidate.
```

A Claim's sensitivity inherits the maximum sensitivity of its evidence (sensitivity ordering public < internal < confidential < secret; unknown is Silence).

```text
Claim.sensitivity = max_sensitivity(evidence)
Lowering it below this requires a Declassify signal of §4.3. It cannot be lowered by AI alone (§4.7).
```

### 6.4 remote AI policy (§9.3)

Transmission to remote AI (an external provider) follows the unified table in §7.2.

```text
secret        raw transmission is not allowed even with confirmation. Only redacted / masked / surrogate forms.
confidential  default deny. Allowed only with a one-shot explicit confirmation on the spot.
internal      default deny. Allowed only when scope opt-in + Audience policy + state ∈ {inferred, confirmed} are satisfied.
public        allowed if state ∈ {inferred, confirmed}.
```

remote AI requires default OFF, scope opt-in, `secret_scan_passed=true` (see SecretScanResult §1.3.3), and policy allows. internal / public still as an AI candidate are not emitted to remote AI. This is the policy for when Memoring itself autonomously calls remote AI for classification / abstraction, and is a different purpose from the Audience × Aperture (§3.4) of when the user hands context.md to their own AI tool. `remote_ai` is a value of the egress purpose, `remote_ai_processing` is a value of Audience; they are distinct concepts and must not be conflated.

---

## 7. Security

### 7.1 Encryption / index safety (§12.5 / §11.2)

The whole DB (`memoring.db`) is encrypted at rest. Undiluted is stored encrypted, and plaintext raw is not placed on disk. The master key is derived from the user's passphrase or OS secret via KDF. The key itself is not placed in the DB in plaintext. There is no per-domain encryption boundary (Key Domain) within a Realm. The boundary within a Realm is a soft attribute by scope label, and safety is protected by the output Gate.

index safety:

```text
Do not place a plaintext index on persistent disk. At rest, encrypt it.
Treat a plaintext index only as a transient value in process memory / tmpfs.
Do not include locked Realm / unclassified (classified(x)=false) / out-of-scope in search candidates.
The index can be deterministically reconstructed from the Chronicle / lower layers.
Build the index after Secret Scan.
```

It satisfies the Search / encryption invariant of §4.5 (global plaintext index forbidden, SQLite aux files encrypted or disabled, payload output to logs forbidden).

### 7.2 sensitivity classes and the egress permission table (the authoritative source is Specification §7.3)

Do not mix sensitivity (one per event) and scope (context). The authoritative source of the egress permission table is Specification §7.3, and this section references it. remote AI policy / Gate predicate / policy.v2 / Secret Scan are derived from this table. The values re-listed in this section are kept in complete agreement with Specification §7.3.

```text
Sensitivity:
  public        already public. Usable within the active scope.
  internal      non-public but low risk. remote AI is conditional.
  confidential  customer / contract / legal / unpublished. ContextPack in principle not allowed.
  secret        keys / tokens / passwords. raw output not allowed, redacted / surrogate only.
  unknown       undetermined. Silence.

Scope:
  A label assigned by AI (not a predefined fixed category). sensitivity and context are orthogonal.
  unclassified (classified(x)=false; formerly a sensitivity value) is not a value of sensitivity but falls at
  the stage before sensitivity decision via the Gate's classified condition. It is not emitted to context for any purpose (except backup_export).
```

egress permission table (sensitivity × purpose). Legend for cell values: raw=raw output allowed / surrogate=redacted・surrogate only (raw not allowed) / △=conditional・explicit confirmation / deny=not allowed. context_pack has stages by Aperture (default standard). The authoritative source is Specification §7.3.

```text
purpose →     context_pack   context_pack       context_pack  remote_ai          redacted_          dataset_           backup_
sensitivity↓  strict         standard(default)  permissive    _processing        export             export             export
------------  -------------  -----------------  ------------  -----------------  -----------------  -----------------  ----------
public        raw(inf/conf)  raw                raw           △raw(note1)        raw(inf/conf)      △raw(note5)        raw
internal      raw(inf/conf)  raw(note2)         raw           △raw(note1)        surrogate          △surrogate(note5)  raw
confidential  deny           deny               △raw(note6)   △surrogate(note6)  △surrogate(note6)  deny               raw
secret        deny           deny               deny          surrogate(note3)   surrogate          deny               raw(note4)
unknown       deny           deny               deny          deny               deny               deny               raw(note4)
```

```text
note1: remote_ai's public / internal require sensitivity_state ∈ {inferred, confirmed} and
     scope opt-in and Audience policy permission and secret_scan_passed=true. Still-candidate is not allowed.
note2: context_pack standard's internal / public allow candidate too (limited to active scope). Other purposes do not emit candidate.
note3: secret does not send raw to remote AI (not allowed even with confirmation).
     What can be sent is only redacted / masked / surrogate forms (§6.4).
note4: backup_export is a full-text encrypted backup of the same user (same_user + client_side encryption).
     A complete copy including secret / unknown. Plaintext does not leave the key boundary. A different purpose from redacted_export / dataset_export.
note5: dataset_export requires consent / lineage / third-party removal / user approval.
note6: confidential's context_pack(permissive) / remote_ai / redacted_export require a one-shot explicit confirmation + secret_scan_passed.
```

hard floor:

```text
unclassified (classified(x)=false; formerly a sensitivity value) is not emitted to context for any purpose (it falls
  before the sensitivity decision via the Gate's classified condition). Only backup_export is exempt, being a full-text copy.
raw egress of secret / unknown is not allowed except backup_export. unknown is not allowed in any derived export.
All external/derived purposes (remote_ai, redacted_export, dataset_export) require sensitivity_state ∈ {inferred, confirmed}.
```

export treats backup_export (full-text, same user, encrypted) and redacted_export / dataset_export (derivatives that may leave the key boundary) as distinct purposes.

re-classification of redaction: redact does not erase the original sensitivity. redacted / surrogate are generated as separate derived items, and Secret Scan is re-run on those themselves. On condition that the surrogate contains no secret (`secret_scan_passed=true`), egress is allowed only at the surrogate cell of the table. The floor decision (raw not allowed) is made against the original item's original class.

division of roles: the Audience × Aperture of `gate(x, r)` is the decision for the context_pack path. remote_ai / export are adjudicated by this table + policy including the purpose dimension. policy.v2 (equivalent to §5.3, Specification) is a derivative from this table, not a hand-written authority.

enforcement: remote_ai / redacted_export / dataset_export look not only at the value but also at the decision state. They require `sensitivity ∈ {public, internal}` and `sensitivity_classification_state ∈ {inferred, confirmed}`, and an AI candidate's internal / public is not emitted outside the key boundary. This is added on top of remote AI's other conditions (default OFF, scope opt-in, secret_scan_passed, policy allows).

### 7.3 The cascade of redaction / deletion and Seal / SealRule (§15.5 / §12.15)

```text
default: keep the encrypted raw.

redact     exclude from derived / index / ContextPack / export.
           range redaction creates a redacted surrogate and makes the original Undiluted a deletion target.
delete     make the object a deletion target.
tombstone  leave only the fact of deletion and a minimal range.
Seal     in addition to delete/redact, generate a SealRule (§1.12) and do not revive it on reprocess / re-capture.
```

delete / redact cascade to derivatives. Leaving the downstream while deleting only the upstream leaves the supposedly-deleted content in the index or Claims.

```text
Undiluted delete
  → Occurrence is tombstoned (leave only a minimal range)
  → Event is redacted (remove text_ref, keep event_identity for traversal)
  → remove the relevant token / n-gram / embedding / snippet from the index
  → remove the relevant event_identity from Claim.evidence_event_identities
  → remove the relevant occurrence_id from Claim.evidence_occurrence_ids
  → a Claim that becomes evidence-short goes to redacted or conflicted
  → tombstone the relevant reference in the ContextPack manifest
```

Seal is durable suppression and adds a SealRule to the above cascade.

```text
Seal(target)
  → the above delete/redact cascade
  → generate a SealRule (match_type = event_identity / content_signature / pattern)
  → thereafter, a candidate matching on reprocess / re-capture does not advance to Claim / index / ContextPack / export
  → SealRule release is only by the user's explicit operation
```

limits of the propagation guarantee: propagation to backups / exports already written out / copies handed to external AI is not guaranteed. For derived / index / Claim / future reprocess inside Memoring, it is guaranteed by cascade and suppression.

### 7.4 Key lifecycle envelope / KDF / rotation / recovery (§15.7)

```text
hierarchy   envelope scheme. Each Realm has a DEK (data key), and the DEK is wrapped by a KEK (key-encryption key).
            The KEK is derived from a passphrase or OS secret via KDF. The key is not placed in the DB in plaintext.
            The DEK is for at-rest encryption and supports KEK rotation / DEK rekey (a separate lineage that re-encrypts the payload envelope).
realm_key   an HMAC key for identity / fingerprint. Derived via KDF from the Realm root secret (rotation-invariant. Derived from recovery material.
            If lost, decryption is impossible). A separate lineage from DEK / KEK, rotation-invariant. Not shared across Realms.
            Because KEK rotation / DEK rekey do not change realm_key, event_identity / content_fingerprint /
            normalized_key / SealRule.target_signature are invariant across rotation / reconnect / restore
            (§1.3.1 / §4.10). This closes the safety violation where Sealed items could revive on reprocess / re-capture.
kdf         KDF parameters (algorithm / memory / iterations / salt) are recorded to make re-derivation deterministic.
unlock      A Realm is opened by explicit unlock or session unlock. The timeout is tunable.
daemon      Key-holding model of the resident capture daemon: the plaintext key is held only in the daemon process memory and
            not written in plaintext to disk / logs / IPC. On idle timeout, the plaintext key is discarded and it returns to locked
            (thereafter capture buffers as raw-only and derived processing is held until the next unlock).
            Residency has the trade-off of widening the unlock window, which expands the out-of-scope local malware surface (§7.5).
nonce       The AEAD nonce / IV is unique per key. It is not reused (collision avoidance by counter or random).
rotation    Enables KEK rotation / DEK rekey. rotation does not plaintext the payload; it is done by re-encrypting the envelope.
            rotation does not change realm_key (only re-encryption of the payload envelope).
export      redacted_export / dataset_export are sealed with a different key from backup (export key separation).
            backup_export is a full-text encrypted copy of the Realm and keeps the same key domain.
recovery    Generate recovery material at initial setup. Memoring does not retain the recovery plaintext.
            If recovery material is lost, the encrypted Realm / export become undecryptable.
```

### 7.5 threat model (what is defended / not defended)

```text
in-scope (defended in v0):
  lost disk / stolen device           → whole-DB at-rest encryption, aux files also encrypted or disabled (§4.5)
  operator of cloud / backup provider  → do not hand over plaintext. The receptacle is encrypted only
  mistaken git commit (sweeping in .memoring) → exclude + canonical path + symlink refuse + chmod 0600 (§9.1)
  malicious transcript (injection)     → trust separation of the safety header; do not execute content as instructions (Specification context.md / §9.1)
  supersede contamination by timestamp attack → do not use the source timestamp as grounds for ordering (§4.16)
  host-memory laundering               → exclude host_summary / host_memory from evidence by origin (§4.12 / §1.3.2)
  excessive exposure to a remote AI provider → the egress table of Audience × Aperture × purpose (§7.2), secret raw not allowed (§6.4)
  confirmation of known-plaintext existence → HMAC content_fingerprint / index derivatives with realm_key (§1.1)
  hijacking context.md via symlink / TOCTOU → canonical path verification, symlink refusal, atomic write (§9.1)
  revival on reprocess despite Seal     → durable suppression by SealRule (§4.15 / §7.3)

partial (mitigated but not fully defended):
  user operation that mixes up the wrong Realm → limit damage by Active Realm resolution and cross-Realm prohibition. The misoperation itself cannot be prevented
  tampered / malicious Connector        → limit damage by raw-only fallback and doctor checks. No complete guarantee
  another Unix user on the same OS      → rely on file permission (chmod 0600). Does not defend beyond the OS's privilege separation

out-of-scope (not defended in v0; stated explicitly in the design):
  local malware running with the same user privilege during unlock
    → the plaintext key / decrypted data may be accessed. Minimization (temp in memory/tmpfs, no payload in logs) is done but not a defense goal.
       The resident capture daemon (§7.4 daemon) widens the unlock window in time and has the trade-off of expanding this surface. The window is narrowed by idle timeout.
  withdrawal of copies already handed to external AI / already-output export / old backup
    → Seal works on internal derived / future reprocess, but propagation to copies that left externally is not guaranteed (§7.3).
```

---

## 8. Logs

### 8.1 Chronicle append-only (§14.7)

The Chronicle is an append-only log of operations, and the index can be deterministically reconstructed from the Chronicle. For the schema, see §1.7. `sequence` is an internal order that increases monotonically within a Realm and is the primary information for the ordering decision of supersede. `op_type` is capture / normalize / scope_confirm / consolidate / redact / delete / seal / reindex. Do not emit content payload to logs; record only id / counts / state (§4.5).

### 8.2 audit log target operations (§15.8)

Operations for which an audit log must be kept:

```text
Crossing / ContextPack generation / MCP request
remote AI enrichment / export
delete / redact
policy override / key recovery / Recipe change
```

Because no review queue exists, high-risk memory review is not an audit target. Instead, audit the exposure / correction / Seal / delete of high-risk Claims.

---

## 9. Test perspectives

### 9.1 v0 blocking gate (verification perspectives as completion conditions, §18.1)

The authoritative source of the 13 blocking gates is Implementation Instructions §7. This section is a re-listing as their verification perspectives, kept consistent in content with Implementation Instructions §7. Verify that all of the following are satisfied.

```text
1. If raw capture fails, do not proceed to derived processing (there is a raw-only fallback).
2. On Parser failure / unknown format / unsupported host version, no data loss and fall to raw-only fallback / Quarantine / doctor warning (§3.2 / §5).
3. secret / unknown / unclassified (classified(x)=false) / confidential (standard) are not emitted to context.md.
4. Anything other than Active Realm / active scope / already-classified is not emitted to search / context (§3.4).
5. The output Gate works by Audience × Aperture. The default is ai_tool + standard. secret has no raw output at any Aperture (§3.4 / §7.2).
6. context.md contains a safety header (distinguishing current guidance and untrusted excerpt) and an Ouroboros marker.
7. The file safety of context.md (canonical path / .memoring symlink refuse / chmod 0600 / atomic write) is satisfied.
8. origin ∈ {assistant, host_summary, host_memory, system, unknown} does not become independent evidence, and the host-memory laundering loop is closed (§3.3.1 / §4.12).
9. Declassify of sensitivity does not occur by any authority other than the closed enumeration of §4.3 (no relaxation by AI confidence / similarity / git remote alone).
10. delete / redact cascade downstream, and Seal prevents reprocess revival via SealRule (§4.15 / §7.3).
11. After reprocess (Parser version / blob granularity change), event_identity does not change and evidence is not left dangling (§1.3.1 / §4.10).
12. connect produces an Inventory and lets the user choose the Realm assignment. Do not make whole-tool watch the default (§3.1).
13. .memoring/context.md is practically readable in a new AI session.
```

### 9.2 Auxiliary gates (defended in v0 but do not bloat blocking, §18.2)

```text
Store an unknown field in an encrypted source_extra_ref without discarding it.
No plaintext global index / persistent plaintext FTS file exists.
On index corruption, it can be reconstructed from lower layers.
A Claim has evidence. It does not become consolidated by Summary alone.
context.md / ContextPack are not made into a Claim's evidence.
The assistant's rephrasings in a context_injected session are not counted as independent evidence / reinforcement.
Declassify of sensitivity (a relaxation that lowers sensitivity) does not occur by an AI candidate alone.
A Claim's sensitivity is not lower than the maximum sensitivity of its evidence (going lower requires a non-AI authority).
remote AI / export check not only the value of sensitivity but also classification_state (inferred / confirmed).
evidence_count agrees with the independent evidence count of §10.1.
Japanese search holds via exact and n-gram fallback.
label normalization is deterministic, and label merge confirmation is limited to user / policy / rule.
After reprocess, event_identity does not change and evidence is not left dangling.
A Recipe has version / eval / audit / rollback ref. Do not create a third-category knob frequently touched by hand.
Deletion (delete / redact) works and leaves a tombstone.
```

### 9.3 fixture / golden output (§10.3)

A Parser has a fixture set / golden output and verifies the Connector at each host update. With golden fixtures, it detects changes in the host format and confirms falling to raw-only fallback for an unknown format.

### 9.4 eval (§9.4)

AI output records model / provider / temperature / prompt_version / schema_version / validator_version / recipe_id as a Derivation (§1.11). The output differences for the same fixture are compared by eval, and the Core schema is not changed. The default at Recipe change is no auto-retroactive, and application to existing Claims is by explicit reprocess.

---

## 10. Recipe initial values (§13 in full)

The authoritative source for the reinforcement formula / Recipe values is this chapter. The values in this chapter are not invariants. They are managed as a manual versioned Recipe. v0 does not implement an automatic Quality Loop. Even when changing the Recipe, the invariants of Chapter 4 must not be broken. These are "tunables owned by the Recipe" and are distinguished from invariants.

```text
Recipe record must include:
  recipe_id / recipe_version / owner / default_value / evaluation_metric
  changed_by / changed_at / reason / rollback_ref
```

### 10.1 Consolidation thresholds

```text
τ_conf.default = 0.80
τ_conf.preference = 0.80
τ_conf.decision = 0.85
τ_conf.ai_inferred_pattern = 0.85

min_evidence_count.default = 2
min_evidence_count.explicit_user_statement = 1
min_evidence_count.user_pinned = 1
min_evidence_count.constraint = 1
min_evidence_count.explicit_decision = 1
min_evidence_count.ai_inferred_pattern = 2
```

The keying of `τ_conf` / `min_evidence_count` is done by a deterministic lookup from `(kind, explicit/inferred)` to a threshold key.

```text
threshold_key(kind, mode):   # mode = explicit | inferred
  (preference, explicit)              → preference / explicit_user_statement
  (constraint, explicit)              → default / constraint
  (decision,   explicit)              → decision / explicit_decision
  (fact | project_context, explicit)  → default / explicit_user_statement
  (procedure,  explicit)              → default / default
  (*, inferred)                       → ai_inferred_pattern / ai_inferred_pattern
  user_pinned uses the user_pinned key regardless of kind (min_evidence_count = 1).
  A pair with no matching key falls back to default (τ_conf.default / min_evidence_count.default).
```

Definition of "independent": separate utterances / operations belonging to different sessions, originating from different sources, or stated by the user on different occasions. Repetition of the same utterance, duplication of the same tool output, reappearance of context.md, and an assertion that the assistant merely rephrased within a context_injected session are not counted.

`evidence_count` refers to this independent evidence count. `independent_evidence_count` is an alias and must not diverge in definition.

### 10.2 Reinforcement Recipe

```text
R_next(m) = clamp01( α R_current + β saturate(valid_recall_count) + γ user_pin
                     + δ saturate(independent_evidence_count)
                     - ε correction_count - ζ conflict_count - λ age_decay )
saturate(n) = n / (n + k)

α=0.70 β=0.08 γ=0.20 δ=0.06 ε=0.15 ζ=0.25 λ=0.05 k=5
```

The trigger for incrementing `valid_recall_count` is only "re-confirmation as an external observation." Inclusion in context.md itself is not counted. Self-reappearance originating from context.md, and the assistant's rephrasing in a context_injected session, are not included in `valid_recall_count` / `independent_evidence_count` (§4.8 / §4.12). Ouroboros (§4.12) applies not only to the recall path but also to the reinforcement path.

### 10.3 Ranking Recipe

Used only after the Gate.

```text
score(x, r) = clamp01(
    0.35 relevance + 0.20 active_scope_match + 0.15 evidence_quality
  + 0.10 memory_status_boost + 0.08 recency + 0.07 reinforcement_score
  - 0.20 sensitivity_penalty - 0.20 cross_scope_penalty
  - 0.10 redundancy_penalty - 0.10 staleness_penalty - 0.20 conflict_penalty )

floor_sensitivity = 0.10
floor_cross_scope = 0.10
floor_conflict    = 0.10
raw_excerpt_share_ceiling = 0.10
```

The floor / ceiling can only be changed toward the safe side (satisfying the Safety floor of §4.4).

### 10.4 Token budget Recipe

```text
coding-agent-session-start:  8k tokens
large-chat-session:         16k tokens
deep-research-context:      32k tokens

Allocation (initial):
  Safety Header / scope boundary    10%
  Constraints / do_not_do           15%
  Project facts                     20%
  Consolidated memories             20%
  Recent decisions / active tasks   20%
  Evidence map                      10%
  Undiluted excerpts                       5% (cap 10%)
```

### 10.5 Prune Recipe

```text
label_normalize = casefold + width_fold + whitespace_trim
label_merge_suggest_threshold.embedding = 0.88
label_merge_suggest_threshold.string    = 0.92   # string similarity after normalization
label_suggest_max_per_init = 20
```

Normalization is deterministic and possible from v0. merge-candidate surfacing by embedding proximity requires local embedding and is therefore consistent with v0.1. The thresholds only decide the surfacing range and do not loosen the Gate. These are initial values for normalization / merge-candidate generation against the Label (vocabulary) entity (§1.4), and confirmation is done by user / policy / rule.

---

## 11. Design change process (ADR)

Make explicit which of core / contract / Recipe / implementation example the change belongs to, and treat it as an ADR. A defect involving core / contract is handled not by an ordinary implementation change but by the following procedure.

```text
1. Create an ADR
2. Make explicit whether the change target is core / contract / Recipe / implementation example
3. Evaluate the impact on security / privacy
4. Write the rollback / compatibility policy
```

The confirmed major design decisions (the contents of the ADRs) are as follows. These are already reflected in each section of this document.

```text
ADR-1: Declassify of sensitivity (a relaxation that lowers sensitivity) is not confirmed by AI alone (§6.3 / §4.3 / §4.7 / §7.2).
ADR-2: An assistant assertion in a context_injected session is not counted as independent evidence / reinforcement (§4.8 / §4.12).
ADR-3: event_identity is derived from the source-side stable coordinates (source_identity / session_identity) and is not made to depend on undiluted_id (blob granularity) or connector_instance_id (which changes on re-connect / restore) (§1.3.1 / §4.10).
ADR-4: Add origin (10 values) to Event, and do not make origin ∈ {assistant, host_summary, host_memory, system, unknown} into independent evidence (§1.3.2 / §4.12).
ADR-5: Split ScopeLabel into Label (vocabulary) and Assignment (assignment) (§1.4).
ADR-6: Add Derivation and give AI-originated records a created_by_derivation_id (§1.11).
ADR-7: Add a Session entity and normalize session provenance (source_account / host version / git remote / context_injected) (§1.10).
ADR-8: Unify sensitivity policy into a single table of Audience × Aperture × purpose, and make the Declassify signal a closed enumeration. secret has no raw remote / raw export even with confirmation (§4.3 / §7.2).
ADR-9: Define the cascade of delete / redact and the SealRule of Seal (§4.15 / §7.3).
ADR-10: Make realm_key a rotation-invariant key derived from the Realm root secret (rotation-invariant, originating from recovery material), and separate it from the DEK / KEK lineage of at-rest encryption (rotation / rekey possible). KEK rotation / DEK rekey do not change event_identity / content_fingerprint / normalized_key / SealRule.target_signature, and close the revival of Sealed items on reprocess / re-capture (§1.1 / §1.3.1 / §4.10 / §7.4).
```

---

## Related documents

- Final Design Document (the constitution): `memoring_design_final_ja.md` — the consistent final version of philosophy / structure / functionality / constraints / safety / operational policy.
- Requirements Document: `memoring_requirements_ja.md` — verifiable requirements with IDs (FR-/NFR-/CON-/OUT-).
- Basic Design Document: `memoring_basic_design_ja.md` — high-level design of overall structure / main components / data flow / responsibility division.
- Specification: `memoring_specification_ja.md` — user-facing functional specification such as CLI / Daemon / MCP / context.md format / configuration / egress permission table.
- Implementation Instructions: `memoring_implementation_instructions_ja.md` — implementation order / priority / MVP / directory structure / prohibitions / completion conditions.
