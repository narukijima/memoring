# Memoring Requirements Document

This document is a verifiable, ambiguity-free requirements definition for starting the v0 implementation of Memoring. The intended readers are implementers, reviewers, and acceptance judges. Each requirement has an ID (FR / NFR / CON / OUT); functional requirements are written as verifiable statements of "must be able to …" and "must not …". The rationale for philosophy, structure, and data schemas is not re-explained; where necessary, refer to the relevant locations in the Final Design (`memoring_design_final_ja.md`) and the Detailed Design (`memoring_detailed_design_ja.md`). References in the body point to the owning location within the completed document set (invariants → Detailed Design, egress permission table → Specification, Recipe initial values → Detailed Design, data schema → Detailed Design, blocking gate → Implementation Instructions / Final Design). References that carry a document name (e.g. "Detailed Design §4 “Structural invariants”", "Specification §7 “Egress permission”") point to another document; references that carry only a chapter number point to a chapter of this document itself.

---

## 1. Purpose and scope

### 1.1 Purpose

Memoring is a local-first / single-user OSS (Sovereign Memory Loop) that ingests the histories that AI tools accumulate locally and, as a user-controlled memory asset under the user's effective control, automatically accumulates, organizes, classifies, abstracts, and consolidates them so they can be retrieved as safe context only when needed. This document defines the requirements this v0 must satisfy.

### 1.2 Scope of v0

v0 is designed so that value is established by the following four:

1. Intake: ingest history from the local accumulation of AI tools.
2. Accumulation: store the Undiluted encrypted without breaking it.
3. Loop: run normalize / classify / abstract / consolidate automatically.
4. Output: generate `.memoring/context.md`.

The form is narrowed to CLI + local daemon. In particular, "intake" and the "automatic loop" are the core of Memoring.

### 1.3 Target users

- Individuals who use AI coding agents / AI chat daily.
- Users who want to turn the local history of Claude Code / Codex into an asset.
- Users who want to grow their own AI work history into a future RAG / Context / Dataset.

It assumes single-user / local-first; team / organization / multi-device are out of scope (Chapter 5).

### 1.4 v0 initial Connectors

- Claude Code local transcript / session Connector.
- Codex local session Connector.
- manual import directory Connector.
- generic JSONL / Markdown transcript Connector.

Full support for ChatGPT / Claude / Gemini export, local embedding / vector index, and MCP server is placed on the v0.1-and-later roadmap (explicitly marked out of scope in Chapter 5).

---

## 2. Functional requirements (FR)

The 8 verbs map to Input (connect / capture), Loop (normalize / classify / abstract / consolidate), and Output (recall / handoff). FRs are enumerated along this verb flow, followed by the requirements for governance, deletion, export, and MCP.

### 2.1 connect / Inventory / Realm assignment

- **FR-001**: `connect` must be able to detect the host tool's local accumulation and enumerate discovered sources not as a single lump but as an Inventory. detect must be re-runnable (Final Design §10 “Intake and Retrieval”).
- **FR-002**: For each source, the Inventory must be able to present source_stable_id, project root / git remote / account, transcript path / last modified, sensitivity hint, suggested Realm, host_tool / host_tool_version / format_version (Final Design §10 “Intake and Retrieval”).
- **FR-003**: The user must be able to choose include / exclude against the Inventory and assign each source to a Realm (Final Design §6 “Realm, Replica, Storage” / §10 “Intake and Retrieval”).
- **FR-004**: Even history from the same host tool (Claude Code / Codex) must be distributable into separate Realms per project / git remote / account (Final Design §6 “Realm, Replica, Storage” / §10 “Intake and Retrieval”).
- **FR-005**: connect must not by default mix an entire host tool into one Realm. It must not make whole-tool watch the default (Final Design §10 “Intake and Retrieval”).
- **FR-006**: A ConnectorInstance's watch target must be limited to the selected set of sources (Final Design §10 “Intake and Retrieval”).

### 2.2 capture / Undiluted, Occurrence

- **FR-007**: capture must ingest the original without breaking it and simultaneously generate the Undiluted (content) and the Occurrence (when, from which source, and at which cursor it was observed) (capture is the only one-to-two verb; Final Design §5 “Data structures” / §10 “Intake and Retrieval”).
- **FR-008**: capture must use filesystem watch as its primary path, and the Watcher must be able to detect appends (diffs) to the host's local accumulation and enqueue a capture job (Final Design §2 “Design philosophy” / §10 “Intake and Retrieval”).
- **FR-009**: capture must not force classification at ingestion time (Capture First, Final Design §3 “Core principles”).
- **FR-010**: Backfill must be OFF by default, and immediately after init it must be able to run with watch only first. While keeping the default OFF, it must provide the path `memoring backfill --since <t> --dry-run` / `connect --backfill --dry-run`, present Inventory, Realm, sensitivity hint, and sample count, and be able to execute after user confirmation (Final Design §10 “Intake and Retrieval”, Specification §1 “CLI”).
- **FR-011**: If raw capture fails, it must not proceed to derivation processing. It must have a fallback that does not lose raw (Final Design §16 “v0 completion conditions (blocking gate)”).

### 2.3 normalize / Parser

- **FR-012**: normalize must be able to translate a source-specific format into a common Event (Final Design §2 “Design philosophy”). An Event must keep evidence stable across reprocess via event_identity (Final Design §5 “Data structures” / Detailed Design §4 “Structural invariants”).
- **FR-013**: The Parser must not cause data loss on parse failure / unknown format / unsupported host version, and must fall back to raw-only fallback / Quarantine / doctor warning. ParseResult must return a set of Events or a QuarantineRecord; when parsing is impossible it must not create an Event but fall to a QuarantineRecord (referencing Occurrence / Undiluted) so that raw is not lost (Detailed Design §3 “Responsibilities and processing units of each component” / §5 “Error handling”, Final Design §16 “v0 completion conditions (blocking gate)”).
- **FR-014**: raw that cannot be normalized must be retained as raw-only and reprocessable later by updating the Parser (Detailed Design §3 “Responsibilities and processing units of each component”).
- **FR-015**: An unknown field must be stored in an encrypted blob (source_extra_ref) and excluded from index / ContextPack until promoted to a known field. It must not be discarded (Detailed Design §3 “Responsibilities and processing units of each component” / §9 “Test perspectives”).
- **FR-016**: Quarantine is a state of parse / event and must not be treated as a state of Claim (Final Design §8 “Claim Model” / Detailed Design §3 “Responsibilities and processing units of each component”).

### 2.4 classify / Scope (Label, Assignment)

- **FR-017**: classify must let AI assign scope (Label / Assignment) and sensitivity. Predefined fixed root categories (personal / private / social / work / anonymous, etc.) must not be hardcoded (Final Design §7 “Scope” / Detailed Design §4 “Structural invariants”).
- **FR-018**: A single target must be able to have multiple Labels (label_ids). A Label must be an attribute, not physical storage (Final Design §7 “Scope” / Detailed Design §1 “Data model contract”).
- **FR-019**: The classification_state must be able to distinguish the 5 values candidate / inferred / confirmed / rejected / conflicted. unclassified is not a value of classification_state; it must be a scope-axis notion meaning that the target has no valid Assignment (no Assignment, or only rejected) = classified(x)=false (Final Design §7 “Scope”).
- **FR-020**: What AI may assign is only up to candidate. Making it confirmed must be limited to the user, an explicit policy, or a user-defined deterministic rule (Final Design §7 “Scope” / §9 “AI”, Detailed Design §1 “Data model contract”).
- **FR-021**: An unclassified target (classified(x)=false; no Assignment, or only rejected) must not be advanced to index / Claim / ContextPack / export (Final Design §7 “Scope” / §10 “Intake and Retrieval”, Detailed Design §1 “Data model contract”).
- **FR-022**: Assignment and Label (vocabulary) must be treated as separate entities. Assignment is the attachment of a label to a target; Label represents the vocabulary itself (Final Design §7 “Scope” / Detailed Design §1 “Data model contract”).

### 2.5 Label normalization (Prune)

- **FR-023**: Prune must deterministically normalize Label notation variants (case / full-width vs half-width / whitespace) and be able to make aliases into alias candidates (Final Design §7 “Scope” / Detailed Design §10 “Recipe initial values”).
- **FR-024**: A new Label close to an existing Label must be able to be surfaced as a merge candidate. The threshold for proximity judgment must be owned by a versioned Recipe (Final Design §7 “Scope” / Detailed Design §10 “Recipe initial values”).
- **FR-025**: The confirmation of Label merge / rename / split must be performed by the reactive governance of user / policy / rule. AI must only produce candidates and must not confirm (Final Design §7 “Scope” / Detailed Design §4 “Structural invariants”).
- **FR-026**: merge must consolidate Labels, re-point the label_ids of the related Assignments, and union the evidence. It must not silently drop (Final Design §7 “Scope” / Detailed Design §4 “Structural invariants”).
- **FR-027**: Label normalization (vocabulary) in Final Design §7 “Scope” and Claim merge (assertion consolidation) in §8 “Claim Model” must not be confused, and must be handled as separate processes.

### 2.6 abstract / consolidate (Claim)

- **FR-028**: abstract draws up Claim candidates from Events, and consolidate consolidates those candidates by passing them through verification of evidence, consistency, and safety. The two must be written distinctly as separate steps (Final Design §2 “Design philosophy”).
- **FR-029**: consolidation must be fully automatic and must not have a review queue / manual approval queue (Final Design §8 “Claim Model” / §3 “Core principles”).
- **FR-030**: A candidate must pass schema validation → evidence validation (including origin authority) → sensitivity / scope validation → policy validation → lifecycle / conflict validation → suppression check, and become consolidated or conflicted / rejected (Detailed Design §2 “State transitions”, Final Design §8 “Claim Model”).
- **FR-031**: A long-term Claim must always have evidence. A Claim must not be confirmed on the basis of Summary alone, past AI-generated Claims alone, or a ContextPack / context.md that Memoring generated (Final Design §8 “Claim Model”).
- **FR-032**: The origin requirements per kind must be satisfied. constraint / do_not_do / decision require user origin and must not be consolidated by assistant alone. preference is allowed with one user origin, and assistant is only auxiliary (Final Design §8 “Claim Model”).
- **FR-033**: The origin enum must be user / tool_result / command_result / file_diff / external_artifact / assistant / host_summary / host_memory / system / unknown. What can serve as independent evidence is limited to user / tool_result / command_result / file_diff / external_artifact; assistant / host_summary / host_memory / system / unknown must not be independent evidence. system (the host's system / settings / CLAUDE.md-style injection) must not be independent evidence, cannot be the basis of constraint / decision / do_not_do, and is treated as equivalent to project policy only on explicit import. An ingestion whose origin cannot be determined must be set to origin=unknown and, on the safe side, treated as not allowed for independent evidence and as not qualifying as evidence (Final Design §8 “Claim Model”).
- **FR-034**: A high-risk Claim too may be auto-consolidated if it passes the validator. Safety is protected not by stopping consolidated but at the output Gate (Final Design §8 “Claim Model” / §9 “AI”, Detailed Design §4 “Structural invariants”).
- **FR-035**: Synonymous Claims must be auto-mergeable and able to union evidence. Similar Claims that cannot be merged must not be silently duplicated but treated as conflict / duplicate_candidate (Final Design §8 “Claim Model”).
- **FR-036**: A Claim must be able to have valid_from, an optional valid_until, and an optional supersedes. A superseded old Claim must drop out of active recall (Final Design §8 “Claim Model”).

### 2.7 Driving the fully automatic loop

- **FR-037**: The loop must be diff-driven. It must proceed in a work-driven manner where each stage (capture → normalize → classify → abstract → consolidate) enqueues the job of the next stage (Final Design §2 “Design philosophy”).
- **FR-038**: When there is no new diff, AI / expensive steps must not be fired. The daemon must wait for the Watcher and become idle (Final Design §2 “Design philosophy” / Detailed Design §4 “Structural invariants”).
- **FR-039**: For a fixed Realm (no new evidence), the loop must stop generating new candidates in a finite number of steps and converge to idle. It must not keep running on zero diffs (Detailed Design §4 “Structural invariants”).

### 2.8 search

- **FR-040**: search must be able to provide metadata filter, exact match, FTS, trigram / n-gram fallback, and session reconstruction (Final Design §10 “Intake and Retrieval” / Detailed Design §4 “Structural invariants”).
- **FR-041**: For Japanese / CJK, exact match and n-gram fallback must be permanently provided. The value of n is an implementation choice; the requirement is "exact + n-gram fallback exists" (Final Design §10 “Intake and Retrieval” / Detailed Design §4 “Structural invariants”).
- **FR-042**: locked Realm / unclassified (classified(x)=false) / out-of-scope must not enter search candidates (Final Design §10 “Intake and Retrieval”).
- **FR-043**: vector search must not be a mandatory feature of v0 (Final Design §10 “Intake and Retrieval”, Chapter 5).

### 2.9 recall / handoff (context.md generation)

- **FR-044**: handoff must be able to generate the recalled context as `.memoring/context.md` in the CWD. This must be the default primary output (Specification §3 “context.md (ContextPack)”, Final Design §10 “Intake and Retrieval”).
- **FR-045**: context.md must be ephemeral and regenerated for each use. It must not be stored long-term, and by default must not be included as a sync / backup target (Specification §3 “context.md (ContextPack)”).
- **FR-046**: context.md must be composable from fixed sections (Safety Header / Active scope and boundary / Current project facts / Pinned, consolidated memories / Recent decisions / Active tasks / Relevant episodic summaries / Procedures / Constraints, do_not_do / Open conflicts, stale warnings / Citations, Evidence Map) (Specification §3 “context.md (ContextPack)”).
- **FR-047**: The Safety Header must distinguish curated context (current guidance) from quoted historical evidence (untrusted) and give each section a trust level (Specification §3 “context.md (ContextPack)”, Final Design §16 “v0 completion conditions (blocking gate)”).
- **FR-048**: raw excerpt / tool output / externally-derived text must be enclosed in a fenced / quote block, labeled as untrusted historical excerpt, and must not be mixed into the active constraints section (Specification §3 “context.md (ContextPack)”).
- **FR-049**: AI-facing citations must use only opaque IDs (clm_ / evt_). pack-local alias citation IDs must not be created in v0 (Specification §3 “context.md (ContextPack)”, Chapter 5).
- **FR-050**: The Evidence Map must not emit transcript source path and absolute path, but may emit project-relative code path within the active project. Sensitive filenames must be policy gated (Specification §3 “context.md (ContextPack)”).
- **FR-051**: The ContextPack must have a token budget and must not exceed it. raw excerpt must have an upper bound. The concrete numbers must be owned by a versioned Recipe (Specification §3 “context.md (ContextPack)”, Detailed Design §4 “Structural invariants” / §10 “Recipe initial values”).
- **FR-052**: raw excerpt must be a last resort and must always be emitted with citation, fence, opaque citation, and safety header. safety header / constraints / scope boundary must not be pushed out into raw excerpt (Specification §3 “context.md (ContextPack)”, Detailed Design §4 “Structural invariants”).

### 2.10 Active Realm resolution

- **FR-053**: Before context build / search, it must be able to resolve the Active Realm. It must canonicalize the CWD, match against each Realm's root_paths / git_remotes, and if uniquely determined, make that Realm active (Final Design §6 “Realm, Replica, Storage”).
- **FR-054**: When multiple Realms match, or none match, it must be Silence and either make the user specify with `--realm <id>` or not output (Final Design §6 “Realm, Replica, Storage”).
- **FR-055**: A context build for which the Active Realm is not determined must not output context.md (do not mix by guessing, Final Design §6 “Realm, Replica, Storage” / §16 “v0 completion conditions (blocking gate)”).
- **FR-056**: cross-Realm search / cross-Realm context must not be provided. When operating multiple Realms, watch / keyring / index / daemon scope must be separated per Realm (Final Design §6 “Realm, Replica, Storage”, Chapter 5).
- **FR-085**: Implement the active scope resolution rule and make it Silence when unresolvable (the authoritative source is Detailed Design §3.4). If there is a CLI specification (--scope / --label / --project), make that the active scope; otherwise canonicalize the CWD, match against Project.root_paths / git_remotes to determine active_project, and make the active scope the Labels that belong to active_project and have classification_state ∈ {confirmed, inferred}. When multiple active_projects match or zero match, make it Silence (do not emit context.md, and prompt for --scope / --project). Even when emitting candidate scope under the standard Aperture, limit it to the active scope. Add --scope / --project to `context build`, and leave active_label_ids / active_project_ids and resolution_basis in the ContextPack manifest (Specification §1.1 “CLI”, Detailed Design §3.4).

### 2.11 Output Gate (Audience × Aperture)

- **FR-057**: The output Gate must decide output permission by only the 2 axes of Audience (who reads) and Aperture (how far to emit). This must be the sole safety mechanism, and being a local file must not be used as the basis of safety (Detailed Design §4 “Structural invariants”).
- **FR-058**: The Gate must not put into the ContextPack any item that does not satisfy the predicate of Detailed Design §4 “Structural invariants” (captured / not_deleted / not_redacted / not_suppressed / classified / active_scope_match / allowed_scope_state / allowed_sensitivity / allowed_sensitivity_state / not_conflicted / cross_scope_allowed / has_required_provenance / not_self_generated_context_as_evidence).
- **FR-059**: The default Audience × Aperture must be ai_tool + standard (Detailed Design §4 “Structural invariants”, Specification §7 “Egress permission (egress permission table)”).
- **FR-060**: secret / unknown must not be emitted to output. unclassified (classified(x)=false) must be dropped at the stage before sensitivity judgment (the Gate's classified condition) (hard floor, not allowed for any Audience / Aperture; secret cannot be emitted as raw). confidential must be dropped under standard, and even under permissive must be allowed only on one-shot explicit confirmation (Detailed Design §4 “Structural invariants”, Specification §7 “Egress permission (egress permission table)”).
- **FR-061**: For all external / derived purposes (remote_ai / redacted_export / dataset_export), sensitivity that is still candidate must not be emitted externally (it requires sensitivity_classification_state ∈ {inferred, confirmed}, Detailed Design §4 “Structural invariants”, Specification §7 “Egress permission (egress permission table)”).
- **FR-062**: The Gate must come before ranking. When `¬gate(x, r)`, the score must be undefined, and secret / unknown / confidential / out-of-scope must not reach ranking (Gate First, Detailed Design §4 “Structural invariants”).
- **FR-063**: A ranking penalty is a quality adjustment and must not loosen safety (Detailed Design §4 “Structural invariants”).

### 2.12 reactive governance

- **FR-064**: The user must be able to govern Claims through after-the-fact operations. It must provide `forget <claim_id>`, `forget --pattern`, `claim pin / correct / expire`, and `label merge / rename / split` (Final Design §8 “Claim Model”, Specification §1 “CLI”).
- **FR-065**: What requires prior confirmation must be limited to irreversible safety operations such as destructive delete / redact, remote AI transmission of confidential raw (on one-shot confirmation), or remote AI transmission of secret that has been redacted / surrogate-ized. secret raw must not be sent to remote AI even with confirmation (Final Design §8 “Claim Model”, Specification §7 “Egress permission (egress permission table)”).
- **FR-066**: It must not substitute for the user's judgment, and must be able to surface conflict and the mixing-in of sources from another root at recall time / init time (Final Design §2 “Design philosophy” / §8 “Claim Model”).

### 2.13 Deletion / redact / Seal

- **FR-067**: The user must be able to execute explicit deletion (delete / redact). `The Undiluted is Truth` does not mean "cannot be erased" (Detailed Design §7 “Security”).
- **FR-068**: delete / redact must cascade to derivatives (Undiluted delete → Occurrence tombstone → Event redacted → removal of the corresponding token / n-gram / embedding / snippet from index → removal of the corresponding event_identity from Claim.evidence → Claims with insufficient evidence move to redacted / conflicted → tombstone the ContextPack manifest references, Detailed Design §7 “Security”, Final Design §16 “v0 completion conditions (blocking gate)”).
- **FR-069**: In an Event redact, text_ref must be removed and event_identity must remain for traversal (Detailed Design §7 “Security”).
- **FR-070**: Deletion must leave a tombstone (the fact of deletion and the minimal scope) (Detailed Design §7 “Security” / §9 “Test perspectives”).
- **FR-071**: Seal must, in addition to delete / redact, generate a SealRule and prevent the same content from being revived by reprocess / re-capture (Detailed Design §4 “Structural invariants” / §7 “Security”, Final Design §16 “v0 completion conditions (blocking gate)”).
- **FR-072**: A candidate matching an active SealRule must not be advanced to Claim / index / ContextPack / export (Detailed Design §4 “Structural invariants” / §1 “Data model contract”).
- **FR-073**: The release of a SealRule must be limited to an explicit user operation. AI / policy must neither create nor release a SealRule (Detailed Design §4 “Structural invariants” / §1 “Data model contract”).

### 2.14 export

- **FR-074**: export must be divided by purpose and able to distinguish backup_export / redacted_export / dataset_export (Specification §7 “Egress permission (egress permission table)” / §6 “Data formats”).
- **FR-075**: backup_export must work in v0. It is a full-text encrypted backup / replica of the same user (a complete copy including secret / unknown), requires same_user + client-side encryption, and must not let plaintext out beyond the key boundary (Specification §7 “Egress permission (egress permission table)” / §6 “Data formats”).
- **FR-076**: redacted_export / dataset_export must fix only the constraints in v0 and must not be made a primary CLI operation (Specification §6 “Data formats”, Chapter 5).
- **FR-077**: redacted_export / dataset_export must satisfy source lineage, license / provider boundary, third-party data removal, secret redaction, scope boundary, user approval, and reproducible manifest. As a derived export, it must require sensitivity_classification_state ∈ {inferred, confirmed} (FR-061). Each sensitivity / purpose cell value must follow the egress permission table (the authoritative source is Specification §7.3). A dataset without lineage, training without consent, or an export crossing the scope boundary must not be permitted (Specification §6 “Data formats” / §7 “Egress permission (egress permission table)”).
- **FR-078**: redacted_export / dataset_export must by default exclude assistant output / tool output / third-party source code / customer data. backup_export must not apply this exclusion (Specification §6 “Data formats”).

### 2.15 MCP (receiver / optional)

- **FR-079**: MCP must be v0 optional and read-only by default (Specification §4 “MCP”, Chapter 5).
- **FR-080**: MCP must be scope required, exclude secret / unknown / confidential, and leave an audit log (Specification §4 “MCP”).
- **FR-081**: MCP write must prohibit direct writes to confirmed / consolidated and must not write beyond add_memory_candidate (which can write only the candidate state, v0 optional) (Specification §4 “MCP”, Chapter 5).
- **FR-082**: If HTTP MCP is made opt-in, it must require localhost bind, auth token, and origin check (Specification §4 “MCP”).

### 2.16 init / doctor

- **FR-083**: `init` must create a local encrypted replica, mandatorily generate passphrase / recovery material, auto-detect Connectors (showing the Inventory), have the user select sources and assign Realms, and be verifiable with doctor (Final Design §10 “Intake and Retrieval”, Specification §1 “CLI”).
- **FR-084**: `doctor` must inspect the compatibility of host_tool / format / Parser version and file safety, and only give warnings and suggestions. It must not arbitrarily change the host AI tool's settings, retention period, or permissions (Final Design §10 “Intake and Retrieval”, Specification §1 “CLI” / §2 “Daemon”).

---

## 3. Non-functional requirements (NFR)

### 3.1 Encryption

- **NFR-001**: The entire DB (memoring.db) must be encrypted at-rest. This is a structural requirement with default ON and must not be bolted on later (Final Design §6 “Realm, Replica, Storage”, Detailed Design §4 “Structural invariants” / §7 “Security”).
- **NFR-002**: The Undiluted must be stored encrypted, and plaintext raw must not be placed on disk (Final Design §6 “Realm, Replica, Storage”).
- **NFR-003**: A per-domain encryption boundary (Key Domain) must not be created within a Realm. The boundary within a Realm must be a soft attribute by scope label, and safety must be protected at the output Gate (Final Design §6 “Realm, Replica, Storage” / §7 “Scope”).
- **NFR-004**: The log must not emit content payload, and must record only id / counts / state (Detailed Design §4 “Structural invariants”).

### 3.2 Index safety

- **NFR-005**: A plaintext index must not be placed on persistent disk. At-rest it must be encrypted. A plaintext index must be handled only as a transient value in process memory / tmpfs (Final Design §5 “Data structures” / §10 “Intake and Retrieval”, Detailed Design §4 “Structural invariants”).
- **NFR-006**: The index must be deterministically rebuildable from Chronicle / lower layers (Final Design §10 “Intake and Retrieval”, Detailed Design §4 “Structural invariants” / §9 “Test perspectives”).
- **NFR-007**: index build must occur after Secret Scan. On scan failure, that event must not be indexed (Final Design §10 “Intake and Retrieval”, Detailed Design §7 “Security”).
- **NFR-008**: The token / n-gram / embedding / term frequency / snippet cache contained in the index must all be subject to encryption (Detailed Design §4 “Structural invariants”).
- **NFR-009**: When using SQLite, the WAL / rollback journal / temp store / FTS shadow table / vacuum intermediate files / backup file must be encrypted or disabled. The temp store must be placed in memory / tmpfs, and plaintext intermediate files must not be left on disk (Detailed Design §4 “Structural invariants”).

### 3.3 Key lifecycle

- **NFR-010**: The master key must be derived from the user's passphrase or OS secret via KDF. The key itself must not be placed in the DB in plaintext (Final Design §6 “Realm, Replica, Storage”, Detailed Design §7 “Security”).
- **NFR-011**: The key hierarchy must be an envelope scheme, with a DEK per Realm and the DEK wrapped by a KEK. realm_key is an HMAC key for identity / fingerprint, and must be a separate line derived via KDF from the Realm root secret (rotation-invariant; derived from recovery material; undecryptable if lost). It must be separated from the DEK line for data at-rest encryption and must not be shared across Realms (Detailed Design §7 “Security”).
- **NFR-012**: The KDF parameters (algorithm / memory / iterations / salt) must be recorded to make re-derivation deterministic (Detailed Design §7 “Security”).
- **NFR-013**: The AEAD nonce / IV must be unique per key and must not be reused (Detailed Design §7 “Security”).
- **NFR-014**: KEK rotation / DEK rekey must be possible. Rotation must be performed by envelope re-encryption without plaintext-ing the payload. KEK rotation / DEK rekey re-encrypts the payload envelope but does not change realm_key. Therefore event_identity / content_fingerprint / normalized_key / SealRule.target_signature must be invariant across rotation / reconnect / restore (Detailed Design §7 “Security”).
- **NFR-015**: redacted_export / dataset_export must be sealed with a key separate from backup (export key separation). backup_export is a full-text encrypted copy of the Realm and keeps the same key domain (Detailed Design §7 “Security”).
- **NFR-016**: At initial setup, recovery material must be generated, and Memoring must not retain the recovery plaintext (Detailed Design §7 “Security”).
- **NFR-017**: In environments where an OS keychain is available, use the keychain; on headless / container / WSL, use a passphrase-based file-based encrypted key bundle (Final Design §10 “Intake and Retrieval”).

### 3.4 CJK search

- **NFR-018**: Japanese / CJK search must be established with exact match and n-gram fallback. Search misses due to tokenizer differences must be compensated by exact + n-gram fallback (Final Design §10 “Intake and Retrieval”, Detailed Design §4 “Structural invariants” / §9 “Test perspectives”).

### 3.5 Loop convergence / idle

- **NFR-019**: The loop must be diff-driven and converge to idle in a finite number of steps for an invariant Realm (Detailed Design §4 “Structural invariants”).
- **NFR-020**: In the idle state (no pending job ∧ no new evidence), AI / compute resources must not be consumed. busy polling beyond the Watcher's waiting must not be done (Detailed Design §4 “Structural invariants”).
- **NFR-021**: The only triggers allowed other than evidence are time-driven maintenance (expire on valid_until arrival, reinforcement decay), executed boundedly as a scheduled tick. Infinite derivation jobs must not be generated without new evidence (Detailed Design §4 “Structural invariants”).

### 3.6 Host-change resilience / raw-only fallback

- **NFR-022**: The host transcript format must not be regarded as a stable API. The Connector must record tested host version / format version / Parser version (Detailed Design §3 “Responsibilities and processing units of each component”).
- **NFR-023**: For unknown format / unsupported version, it must not do a broken parse but fall to raw-only fallback. Even when it cannot intake / parse, it must not lose raw (Detailed Design §3 “Responsibilities and processing units of each component”).
- **NFR-024**: The Connector must not strongly depend on folder path / file layout and must use source_stable_id as the primary key (Detailed Design §3 “Responsibilities and processing units of each component”).
- **NFR-025**: The Connector must have golden fixtures and be verifiable on each host update. detect must be re-runnable (Detailed Design §3 “Responsibilities and processing units of each component” / §9 “Test perspectives”).
- **NFR-026**: Even if a host update changes the internal folder structure or storage format, the whole of Memoring must not break and must at minimum fall to raw-only capture / Quarantine / doctor warning (Detailed Design §3 “Responsibilities and processing units of each component”).

### 3.7 Performance

- **NFR-027**: Processing must be diff-driven and run expensive AI calls only when there are new Events (Final Design §2 “Design philosophy”, Detailed Design §4 “Structural invariants”).
- **NFR-028**: The Job queue may be a SQLite table in v0. A busy loop must not be created (Detailed Design §4 “Structural invariants”, Implementation Instructions).

### 3.8 Audit log

- **NFR-029**: The following operations must always leave an audit log: Crossing / ContextPack generation / MCP request / remote AI enrichment / export / delete / redact / policy override / key recovery / Recipe change (Detailed Design §8 “Logging”).
- **NFR-030**: Since no review queue exists, high-risk memory review must not be an audit target. Instead, audit the exposure / correction / Seal / delete of high-risk Claims (Detailed Design §8 “Logging”).

### 3.9 local-first / single-user

- **NFR-031**: v0 must be limited to single-user / local-first / CLI + local daemon (Final Design §4 “v0 responsibility boundary”).
- **NFR-032**: v0 must not implement first-party cloud backup / sync. What it has must be a local encrypted Realm, a client-side-encrypted local export archive, local restore, and a self-contained encrypted archive that can be carried to any storage destination (Final Design §6 “Realm, Replica, Storage”, Chapter 5).
- **NFR-033**: When sending to the cloud, plaintext raw must not be placed, and client-side encryption must be done before upload. The decryption key must be on the user's side (Final Design §6 “Realm, Replica, Storage”).

### 3.10 context.md file safety

- **NFR-034**: The output of context.md must satisfy the following file safety: canonically resolve the output path; refuse if `.memoring` is a symlink; refuse or warn if the output destination is outside the repo / world-readable; after atomic write, chmod 0600 (parent directory 0700 recommended); add `.memoring/` to `.git/info/exclude` at generation time and do not rewrite `.gitignore`; judge the `.memoring/` exclusion for manual import not by string match but after canonical path resolution (Specification §3 “context.md (ContextPack)”, Final Design §16 “v0 completion conditions (blocking gate)”).

---

## 4. Constraints (CON)

These are design invariants (Laws) that the validator / gate / policy must always uphold. They are distinguished from Recipe numerics.

- **CON-001**: What AI may assign is only up to candidate. Making scope (Assignment / Label) confirmed is limited to the user / explicit policy / user-defined rule, and AI must not confirm (Final Design §7 “Scope” / §9 “AI”).
- **CON-002**: AI must not grant permission for external transmission of secret / confidential, perform destructive redact / delete, or permanently permit a Crossing. Authority must be placed in schema / validator / policy / evidence, not in the model (Final Design §9 “AI”).
- **CON-003**: The Declassify of sensitivity (a relaxation that lowers sensitivity) must not be confirmed by AI alone. The signals that can confirm it are limited to the closed enumeration of Detailed Design §4 “Structural invariants” (explicit user rule / explicit project policy / user-confirmed correction / verified public source import with an immutable URL / detector-pattern-specific deterministic false-positive rule) (Final Design §3 “Core principles”, Detailed Design §4 “Structural invariants”, Specification §7 “Egress permission (egress permission table)”).
- **CON-004**: AI confidence / probability, semantic similarity / embedding proximity, a filename / path containing "public", the git remote being public, and occurrence frequency / recurrence must not be used as a basis for Declassify (Detailed Design §4 “Structural invariants”).
- **CON-005**: A change of Escalate (a tightening that raises sensitivity, the Silence direction) is allowed even as an AI candidate, but the Declassify (a relaxation that lowers sensitivity) direction is not allowed (Ratchet, Detailed Design §4 “Structural invariants”).
- **CON-006**: secret must not be sent to remote AI as raw even with user confirmation. What can be sent is limited to that which has been redacted / masked / surrogate-ized (Final Design §9 “AI”, Specification §7 “Egress permission (egress permission table)”).
- **CON-007**: The index_text of a secret event must be redacted_or_empty and context_output must be disallowed. An event into which even one line of secret is mixed must make the whole event secret (event-unit sensitivity, Detailed Design §4 “Structural invariants”, Final Design §5 “Data structures”).
- **CON-008**: sensitivity must be event-unit and must not do span-unit partial redaction (Final Design §5 “Data structures”, Detailed Design §4 “Structural invariants”, Chapter 5).
- **CON-009**: self-generated context (a ContextPack / context.md that Memoring generated) must not be made the evidence of a Claim. It must also not be counted in the recall_count of reinforcement (Final Design §2 “Design philosophy”, Detailed Design §4 “Structural invariants”).
- **CON-010**: origin ∈ {assistant, host_summary, host_memory, system, unknown} must not be counted as independent evidence. origin ∈ {host_summary, host_memory, system, unknown} must not be made evidence at all. system cannot be the basis of constraint / decision / do_not_do, and is treated as equivalent to project policy only on explicit import (Final Design §8 “Claim Model”, Detailed Design §4 “Structural invariants”).
- **CON-011**: An assistant-derived assertion in a context_injected session must not be counted as independent evidence / reinforcement signal. Even within the same session, observations with externality (user message / tool result / command result / file diff / external artifact / explicit user correction / explicit user decision) may be used as evidence (Final Design §10 “Intake and Retrieval”, Detailed Design §4 “Structural invariants”).
- **CON-012**: event_identity must be derived from the source-side stable coordinate. It must not be made to depend on raw blob granularity (undiluted_id / object layout). The stable coordinates must be source_identity = hmac(realm_key, connector_id || source_stable_id || source_account_stable_key), session_identity = hmac(realm_key, source_identity || host_session_stable_id), event_identity = hmac(realm_key, source_identity || session_identity || (message_id | content_anchor)). Give the Source entity a source_stable_key_hmac, and exclude connector_instance_id from identity and demote it to provenance / config reference (because its value may change on re-connect / restore). realm_key is rotation-invariant (NFR-011 / NFR-014), and event_identity must not change under any of reprocess (Parser version change) / blob granularity change / re-dedup / content_fingerprint scheme change / re-connect / restore. Claim.evidence must point to event_identity (Detailed Design §4 “Structural invariants” / §1 “Data model contract”).
- **CON-013**: identity / trust boundary (a separate persona / separate trust boundary / work that must absolutely not be mixed) must be separated by Realm, and topic / project / work theme must be handled by scope label. An encryption boundary must not be created within a Realm (Final Design §6 “Realm, Replica, Storage” / §7 “Scope”).
- **CON-014**: Realms must not be linked by design. It must be 1 Realm = 1 identity = 1 trust boundary = 1 key (Final Design §6 “Realm, Replica, Storage” / §7 “Scope”).
- **CON-015**: A Claim's sensitivity must not fall below the maximum sensitivity of its evidence (sensitivity order public < internal < confidential < secret, unknown is Silence). To fall below, it requires the Declassify signal of Detailed Design §4 “Structural invariants”, and cannot be lowered by an AI candidate alone (Detailed Design §4 “Structural invariants”, Specification §7 “Egress permission (egress permission table)”).
- **CON-016**: The Recipe (thresholds / weights / budget) must not break the structural invariants. The floor of safety penalty / the ceiling of raw_excerpt_share can be changed only toward the safe side (Detailed Design §4 “Structural invariants”, Final Design §13 “Recipe”).
- **CON-017**: Do not create a "third category" of numeric knobs that humans frequently touch by hand. Tunable values must be owned by a versioned Recipe (which has recipe_id / version / eval / audit / rollback ref) (Detailed Design §4 “Structural invariants” / §9 “Test perspectives”, Final Design §13 “Recipe”).
- **CON-018**: supersede must not use a source-declared timestamp as the basis of a safety judgment. Decide it consistently with capture order / Chronicle.sequence / explicit valid_from, and do not use a future-dated / inconsistent / non-monotonic timestamp as the basis of supersede (Detailed Design §4 “Structural invariants”).
- **CON-019**: reinforcement_score must be a bounded scalar with 0 ≤ score ≤ 1. The score must not be raised by an increase of correction / conflict alone, and a user_rejected Claim must not be auto_consolidated (Detailed Design §4 “Structural invariants”).
- **CON-020**: A predefined root category must not be created. Label merge confirmation requires user / policy / rule, and a label must not be promoted to an encryption boundary (Detailed Design §4 “Structural invariants”, Final Design §7 “Scope”).
- **CON-021**: content_fingerprint and index derivatives must be retained as HMAC keyed by realm_key and must not expose plaintext. dedup across Realms must not be done (Detailed Design §1 “Data model contract” / §4 “Structural invariants”).

---

## 5. Out of scope (OUT)

This fixes what will not be done in v0. It is not "do it someday" but "do not do it in v0", and resuming requires the design change process (ADR) (Final Design §17 “What we will not do”, Detailed Design §11 “Design change process (ADR)”).

- **OUT-001**: Do not do predefined persona classification (do not hardcode personal / private / social / work / anonymous).
- **OUT-002**: Do not do automatic label merge confirmation (merge candidates are surfacing only; confirmation is user / policy / rule).
- **OUT-003**: Do not create an encryption boundary (Key Domain) within a Realm. The separation of identity / trust is done per Realm. This is a design decision, not the kind of thing to be resumed via ADR.
- **OUT-004**: Do not build first-party cloud backup / sync (only prepare a standard receiver).
- **OUT-005**: Do not do ReplicaManifest / root_hash sync / known-replica tracking.
- **OUT-006**: Do not build a review queue / manual approval.
- **OUT-007**: Do not do live multi-device sync.
- **OUT-008**: Do not do team / organization / admin.
- **OUT-009**: Do not build a desktop app.
- **OUT-010**: Do not do browser scraping / dependence on non-public APIs.
- **OUT-011**: Do not do imports that circumvent a provider's access control.
- **OUT-012**: Do not do hook injection / real-time event capture.
- **OUT-013**: Do not do MCP write integration (writes beyond add_memory_candidate).
- **OUT-014**: Do not do span / line-unit redaction.
- **OUT-015**: Do not track context injection per span (v0 closes the entire session in which the marker appears as context_injected on the safe side; span-ization is v0.1).
- **OUT-016**: Do not create pack-local alias citation IDs (v0 uses opaque IDs (clm_ / evt_); aliases are v0.1).
- **OUT-017**: Do not fully implement a fine-tuning dataset builder (only fix the constraints).
- **OUT-018**: Do not make vector search mandatory in v0.
- **OUT-019**: Do not do automatic tuning of ranking weights first (manual Recipe only).
- **OUT-020**: Do not provide cross-Realm search / cross-Realm context (Final Design §6 “Realm, Replica, Storage”).
- **OUT-021**: Do not implement a direct S3 / R2 / Google Drive client (Final Design §6 “Realm, Replica, Storage”).
- **OUT-022**: Do not do automatic operation of crypto-shred propagation / backup re-key (Final Design §6 “Realm, Replica, Storage”).

---

## 6. Acceptance criteria

The completion condition for v0 is the blocking gate of Final Design §16 “v0 completion conditions (blocking gate)” (the completion conditions also correspond to Implementation Instructions “Completion conditions”). Below, each gate is mapped to the traceability of the requirements that satisfy it. v0 is complete when all gates are closed.

| Gate | Content | Related requirements |
| --- | --- | --- |
| G1 | If raw capture fails, do not proceed to derivation processing (there is a raw-only fallback) | FR-011, FR-014, NFR-023 |
| G2 | On Parser failure / unknown format / unsupported host version, no data loss and fall to raw-only fallback / Quarantine / doctor warning | FR-013, FR-016, NFR-022, NFR-023, NFR-026 |
| G3 | secret / unknown / unclassified (classified(x)=false) / confidential (standard) do not appear in context.md | FR-060, CON-007, CON-008 |
| G4 | Other than Active Realm / active scope / already-classified do not appear in search / context | FR-021, FR-042, FR-053, FR-054, FR-055, FR-058, FR-085 |
| G5 | The output Gate works by Audience × Aperture (default ai_tool + standard; secret cannot be emitted as raw) | FR-057, FR-058, FR-059, FR-060, FR-062, FR-063, CON-006 |
| G6 | context.md contains a safety header (distinguishing current guidance from untrusted excerpt) and an Ouroboros marker | FR-047, FR-048, CON-009 |
| G7 | context.md satisfies file safety (canonical path / .memoring symlink refuse / chmod 0600 / atomic write) | NFR-034, FR-044 |
| G8 | origin ∈ {assistant, host_summary, host_memory, system, unknown} does not become independent evidence, and the host-memory laundering loop is closed | FR-031, FR-032, FR-033, CON-010, CON-011 |
| G9 | The Declassify of sensitivity does not occur by an authority other than the closed enumeration of Detailed Design §4 “Structural invariants” | CON-003, CON-004, CON-005, CON-015 |
| G10 | delete / redact cascade downstream, and Seal prevents reprocess revival with a SealRule | FR-068, FR-069, FR-071, FR-072, FR-073 |
| G11 | event_identity does not change even after reprocess (Parser version / blob granularity change), and evidence is not left dangling | FR-012, CON-012 |
| G12 | connect emits an Inventory and lets the user choose Realm assignment. Do not make whole-tool watch the default | FR-001, FR-003, FR-004, FR-005, FR-006 |
| G13 | `.memoring/context.md` is practically readable in a new AI session | FR-044, FR-046, FR-050, FR-051 |

> Note: The context.md file safety that G7 requires corresponds to NFR-034 (§3.10). The details are defined by Specification §3 “context.md (ContextPack)” and Final Design §16 “v0 completion conditions (blocking gate)”.

### Supplementary acceptance criteria (Detailed Design §9 “Test perspectives”, do not bloat blocking)

The following are upheld in v0 but are not included in blocking. The corresponding requirements are noted alongside.

- Do not discard unknown fields; store them in an encrypted source_extra_ref (FR-015).
- No plaintext global index / persistent plaintext FTS file exists (NFR-005, NFR-008).
- On index corruption, it can be rebuilt from lower layers (NFR-006).
- A Claim has evidence. It does not become consolidated on Summary alone (FR-031).
- Do not make context.md / ContextPack the evidence of a Claim (CON-009).
- An assistant paraphrase in a context_injected session is not counted as independent evidence / reinforcement (CON-011).
- The Declassify of sensitivity (a relaxation that lowers sensitivity) does not occur by an AI candidate alone (CON-003).
- A Claim's sensitivity does not fall below the maximum sensitivity of its evidence (CON-015).
- remote AI / export confirm not only the value of sensitivity but also classification_state (inferred / confirmed) (FR-061).
- evidence_count matches the independent evidence count of Detailed Design §10 “Recipe initial values” (the premise definition of FR-035).
- Japanese search is established with exact and n-gram fallback (FR-041, NFR-018).
- Label normalization is deterministic, and label merge confirmation is limited to user / policy / rule (FR-023, FR-025, CON-020).
- event_identity does not change even after reprocess, and evidence is not left dangling (CON-012).
- The Recipe has version / eval / audit / rollback ref. Do not create a third-category knob (CON-017).
- Deletion (delete / redact) works and leaves a tombstone (FR-067, FR-070).

---

## Related documents

- Final Design Document (`memoring_design_final_ja.md`): the comprehensive rationale for philosophy, structure, invariants, data structures, and operational policy. The `§` reference target of this document.
- Basic Design Document (`memoring_basic_design_ja.md`): overall composition, data flow, and responsibility division.
- Detailed Design Document (`memoring_detailed_design_ja.md`): the full JSON schema, state transitions, Gate predicate, and the implementation granularity of invariants.
- Specification (`memoring_specification_ja.md`): the user-visible behavior and format such as CLI / Daemon / MCP / context.md format and the egress permission table.
- Implementation Instructions (`memoring_implementation_instructions_ja.md`): implementation order, MVP, directory structure, prohibitions, and completion conditions.
