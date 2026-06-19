# Memoring Basic Design Document

This document is the Basic Design Document for surveying the whole picture before implementing Memoring. The intended readers are developers about to begin implementation, reviewers, and stakeholders who want to grasp the architecture. It presents, at a high level, the overall system structure, the major components and their division of responsibilities, the data flow, the storage areas, the inputs and outputs, and the processing flow. Field-granularity JSON schemas, the full enumeration of invariant formulas, and the full set of CLI commands are out of scope for this document and are left to the Detailed Design Document and the Specification. The purpose here is to fix "what is placed where, and how it flows" through diagrams and responsibilities.

The full ideological background (Sovereign Memory Loop, The Undiluted is Truth, the Metabolic Razor of the dissipative structure, etc.) is left to the Final Design Document (the constitution), but the key points are cited to the extent needed to understand the structure.

---

## 1. Overall System Structure

Memoring is an OSS Sovereign Memory Loop that ingests the history that AI tools accumulate locally and automatically accumulates, organizes, abstracts, and consolidates it as a memory asset under the user's effective control, retrieving it as safe context only when needed. The core value is not a database but the loop that keeps growing history into usable memory and context; the DB, object store, and index are its foundation.

v0 is narrowed to single-user / local-first, and the structure consists of the following 5 execution / storage elements.

```text
CLI                The user's entry point. init / connect / watch / context build / search / forget / doctor.
local daemon       A resident process that runs the loop work-driven. watch → capture → enqueue jobs for each stage.
encrypted SQLite   memoring.db. Encrypts the entire DB at-rest. Holds entity and job queue.
object store       objects/ directory that encrypts and stores Undiluted (the original byte sequence) and Artifact.
index              The search surface for FTS / exact / n-gram. A regenerable projection; encrypted at-rest.
```

These belong to one Realm (one memory world that shares keys) and are placed as a local replica under `~/.memoring/` (Chapter 5).

### 1.1 Package Structure

The implementation is narrowed to CLI + daemon + encrypted SQLite + filesystem + schemas + fixtures + doctor. The Core schema and policy are kept small, changes in the external world are confined to Connector / Parser, and the irregularity of classification and organization is confined to the AI and the loop. The Job queue may be a SQLite table in v0. The AI provider is treated as an adapter, and provider-specific processing is not put into Core.

```text
memoring/
  apps/
    cli/                       Entry point for user operations
    daemon/                    Resident process of the work-driven loop
  packages/
    core/                      loop, schema, policy, chronicle, realm, recipe
    storage/                   sqlite, object-store, encrypted-db
    intake/                    connectors, parsers, watcher
    claim/                     extractor, validator, consolidation, lifecycle, seal
    retrieval/                 search, ranking, context-pack, mcp
    security/                  key-lifecycle, redaction, secret-scan, audit, ouroboros
    integrations/              claude-code, codex, manual-directory, generic-jsonl, markdown-transcript
  schemas/                     Fixed schema definitions
  fixtures/                    golden fixtures (for Connector verification on each host update)
  docs/
```

This layered structure embodies the policy of "keep the core small and fixed, and push complexity outward." Changes in external formats are absorbed by Connector / Parser, per-model differences by Schema / Validator, and search and context generation by Retrieval.

---

## 2. Major Components and Division of Responsibilities

The responsibilities of each package are shown below. The principle of placing authority not in the AI model but in schema, validator, policy, and evidence runs throughout the component split.

### 2.1 core

Holds the control of the whole loop and the system's immutable foundation.

```text
loop        The hub that runs the loop differentially. Enqueues each stage's job in order and converges to idle.
schema      The fixed schema of Undiluted / Occurrence / Event / Session / Label / Assignment / Claim / Derivation
            / ContextPack / Artifact / SealRule / Policy / Chronicle.
policy      Evaluation of policy.v2 governing output Gate / egress / precedence. The core of safety judgment.
chronicle   An append-only log of operations. The lower layers and index can be deterministically reconstructed from here.
realm       Realm = 1 identity = 1 trust boundary = 1 key. Holds the resolution of the Active Realm.
recipe      The version-managed unit that owns adjustment values that are not invariants (thresholds / weights / token budget).
```

### 2.2 storage

Responsible for the physical persistence of data.

```text
sqlite         encrypted SQLite holding entity and job queue.
object-store   The objects/ layer that encrypts and stores Undiluted / Artifact.
encrypted-db   at-rest encryption of the entire DB, plus control to avoid leaving plaintext on disk (WAL / temp store, etc.).
```

### 2.3 intake

Constitutes the entry point. It judges nothing, and first ingests without breaking (Capture First).

```text
connectors   Discovers the local accumulation of AI tools (detect / Inventory) and assigns sources to a Realm.
parsers      The boundary separating the dirty external world from the fixed schema. Treated as a best-effort unstable Parser.
watcher      Detects appends (diffs) of selected sources and enqueues a capture job.
```

### 2.4 claim

Draws Claims up from Events, validates them, and consolidates them. A Claim is a versioned, provenance-backed assertion.

```text
extractor       Draws Claim candidates up from Events (abstract).
validator       The referee that validates schema / evidence / sensitivity / scope / policy / lifecycle.
consolidation   Fully automatically consolidates validated candidates as consolidated.
lifecycle       The state transition of candidate / consolidated / conflicted / superseded / rejected / redacted.
seal            Durable sealing (prohibition of resurrection) via delete / redact + SealRule.
```

### 2.5 retrieval

Builds a recall surface from the Realm only when called (recall).

```text
search        metadata filter / exact / FTS / n-gram fallback / session reconstruction.
ranking       Quality adjustment that orders only items that passed the Gate. Not a safety mechanism.
context-pack  Assembles the ContextPack and hands it over as .memoring/context.md (handoff).
mcp           A v0 optional read-only receiving surface for external connections.
```

### 2.6 security

Provides each safety mechanism cross-cuttingly.

```text
key-lifecycle  An envelope-style key hierarchy (KEK / DEK / realm_key), unlock, rotation, recovery.
redaction      The cascade and tombstone of delete / redact.
secret-scan    Inspection that detects key / token and stops raw output (Secret Scan).
audit          An append-only audit log of high-risk operations.
ouroboros      The Ouroboros Guard that does not treat self-generated context as evidence.
```

### 2.7 integrations

Concrete Connector implementations for specific host tools.

```text
claude-code / codex / manual-directory / generic-jsonl / markdown-transcript
```

---

## 3. Data Flow

Memoring's metabolism is grasped as a three-beat rhythm of Input (ingest) / Loop (metabolize) / Output (hand off). The 8 verbs map onto this three-beat rhythm.

```text
Input / entry
  connect    Find the local accumulation of AI tools and open the mouth.
  capture    Ingest the original without breaking it. The only 1-to-2 verb that generates Undiluted and Occurrence simultaneously.

Loop / automatic loop (fully automatic. No approval queue in between)
  normalize  Translate source-specific formats into Event.
  classify   The AI assigns scope / sensitivity.
  abstract   The leap of drawing Claim candidates up from Events.
  consolidate Pass candidates through evidence / consistency / safety validation and consolidate them as Claims.

Output / exit
  recall     Build a recall surface from the Realm only when called.
  handoff    Hand the generated context over to the AI tool as context.md.
```

capture is the only 1-to-2 verb. Because the same original can be observed multiple times, it simultaneously generates the content itself (Undiluted) and the fact of having encountered it (Occurrence). abstract and consolidate must always be written separately. abstract is a leap, and consolidate is the process of consolidating through validation.

### 3.1 work-driven Job Enqueue

The loop does not run constantly; it runs only when a diff arrives. The Watcher detects appends to the host's local accumulation and enqueues a capture job, and it proceeds in a work-driven manner where each stage of capture → normalize → classify → abstract → consolidate enqueues the next stage's job. If there is no new diff, there is no job, and the daemon goes idle waiting for the Watcher. Expensive AI calls run only when there is a new Event, and they do not waste computational resources by spinning with zero diff.

```text
  Watcher detects a diff
        │  enqueue
        ▼
  ┌───────────┐ enqueue ┌────────────┐ enqueue ┌──────────┐
  │  capture  │────────▶│ normalize  │────────▶│ classify │──┐
  └───────────┘         └────────────┘         └──────────┘  │
        ▲                                                     │ enqueue
        │ If there is no new diff, there is no job             ▼
        │                              ┌────────────┐ enqueue ┌──────────┐
   (converge to idle)  ◀──────────────│consolidate │◀────────│ abstract │
                                       └────────────┘         └──────────┘
```

### 3.2 Inner Loop and Outer Loop

The loop is grasped as two loops of differing scale.

```text
Inner Loop (Memoring internal / automatic / diff-driven)
  Input supplies new evidence.
  normalize → classify → abstract → consolidate.
  The output is a maintained Realm. It has an idle state.

Outer Loop (closes by going through the world)
  Output → context.md → next AI work → new history → Input.
  The closing segment lies outside Memoring (the user's actual work).
  What Memoring owns is only the 2 endpoints of Input and Output.
```

Output is not a stage of the Inner Loop. It is an on-demand tap that reads the Realm through the Gate; it is not a station passed every lap, but generates context.md only when needed.

```text
                        ┌──────────────── Outer Loop ────────────────┐
                        │                                            │
   ┌──────────┐    capture    ┌─────────── Inner Loop ──────────┐    │
   │ AI tool's │ ───────────▶ │ normalize→classify→abstract→    │    │
   │   local   │              │             consolidate          │    │
   │  history  │              │     output = maintained Realm     │    │
   └──────────┘              └────────────────┬────────────────┘    │
        ▲                                      │ recall (on-demand tap)  │
        │ next AI work → new history            ▼                          │
        │                            ┌──────────────────┐                │
        └────────────────────────── │ .memoring/context.md │ ◀──────────┘
                  handoff            └──────────────────┘
```

---

## 4. Overall Picture of the Data Layer

Data is represented by 3 observational records, 1 asserted knowledge, 1 projection surface, and the 3 control axes that run through them.

### 4.1 The 5 Layers

```text
Layer 1: Undiluted    [observational truth]  The original byte sequence. Encrypted, and the payload bytes are not altered.
Layer 2: Occurrence   [observational truth]  When, of which source, at which cursor the Undiluted was observed.
Layer 3: Event        [observational truth]  source-specific format converted into a common time-series event.
Layer 4: Claim        [asserted knowledge]   A versioned, provenance-backed mutable assertion. Re-verifiable from evidence.
Layer 5: Recall       [projection / regenerated]  search index, ContextPack, MCP result, export view.
```

The lower 3 layers (Undiluted / Occurrence / Event) are observational records, and as observed facts they are not altered except by deletion / redaction. A Claim is asserted knowledge, a mutable assertion that can be re-verified and regenerated from evidence. Recall is not truth but a regenerable surface to make search and retrieval fast; if it breaks, it is reconstructed from the lower layers.

Separating observational record and asserted knowledge is a safety principle (The Undiluted is Truth). Because classification, summarization, abstraction, and Claim-making always wobble, if only the first AI output were saved and the original discarded, the memory could never be rebuilt into something better. The original is truth, and derived data is treated as something that can be remade.

### 4.2 Reason for Separating Undiluted and Occurrence

The same raw payload can be observed multiple times. If the content is the same, one Undiluted suffices, but when, of which source, at which cursor it was observed is a separate fact. Undiluted represents "what was recorded," and Occurrence represents "when, where, and how it was observed."

### 4.3 The 3 Control Axes

3 control axes run through all 5 layers.

```text
Provenance Axis / provenance   Where it came from, what it is grounded on, by which process it was made.
Scope Axis / context           Which context / purpose it belongs to. Not a pre-defined fixed category but a label assigned by the AI.
                               It has no cryptographic boundary within the Realm; identity / trust separation is done per Realm.
Safety Axis / safety           sensitivity (per event), secret, remote-AI permission, export permission. No span-level partial redaction.
```

Recall (index) being not secret does not mean it is harmless. Because the index can contain vocabulary, file names, error strings, person names, and project names, the index is also encrypted at-rest, and no plaintext index is placed on persistent disk. ContextPack is a projection, and by default it does not store the body but leaves only the manifest (pack id, Recipe, policy, evidence id, active scope, generation time, etc.).

---

## 5. Realm and Storage Areas

### 5.1 Truth Is Not a Place but the Realm

Truth is neither local nor cloud, but the consistent Realm. A Realm holds the Undiluted set / Occurrence set / Event set / Claim set, Policy definitions, and Chronicle.

A Realm is one memory world that shares keys and must not be mixed, with 1 Realm = 1 identity = 1 trust boundary = 1 key. The physical copy where a Realm resides is called a Replica.

### 5.2 Default local replica Layout

By default, the Realm is placed at `~/.memoring/`.

```text
~/.memoring/
  realm.toml          The Realm's settings (root_paths / git_remotes, etc.)
  memoring.db         entity and job queue. at-rest encryption
  objects/            Encrypted storage of Undiluted / Artifact
  indexes/            Search index (at-rest encryption)
  connectors/         ConnectorInstance settings
  policies/           policy.v2, etc.
  logs/               audit log
```

### 5.3 Encryption Policy

The entire DB (memoring.db) is at-rest encrypted. Undiluted is stored encrypted, and no plaintext raw is placed on disk. The master key is derived via KDF from the user's passphrase or OS secret, and the key itself is not placed in the DB in plaintext. The key hierarchy is envelope-style, with each Realm holding a DEK wrapped by a KEK. The DEK is for at-rest encryption and supports rotation / rekey. realm_key (the HMAC key for identity computation and fingerprints) is a separate lineage derived via KDF from the Realm root secret (rotation-invariant; derived from recovery material), and is separated from the DEK / KEK lineage. Because KEK rotation / DEK rekey do not change realm_key, event_identity / content_fingerprint / normalized_key / SealRule.target_signature are invariant across rotation / reconnect / restore. realm_key is not shared across Realms.

There is no per-domain cryptographic boundary (Key Domain) within a Realm. The boundary within a Realm is a soft attribute by scope label, and safety is protected at the output Gate. This is a design decision, not a v0 deferral. Contexts that must absolutely not be linked (two identities, work and personal, etc.) are made into separate Realms (separate directories, separate keys) rather than cryptographically separated within a Realm. It suffices to simply run `memoring init` separately, requiring no additional features.

### 5.4 Operating Multiple Realms

identity / trust boundary are separated by Realm, and topic / project / work theme are handled by scope label. The recommended composition of the initial Realms (a starting point, not hardcoded) is as follows.

```text
personal-private        Personal / life / investment / health / chitchat / non-public conceptions
public-persona          Public persona / public activity / thought / dissemination / OSS / public-premised
company-work            The corporation's business / revenue / internal memos / product operation / work as a company
customer-confidential   Customer engagements / third-party information / NDA / contracts / work that must absolutely not be mixed
```

Do not increase per-project Realms from the start. Promote to a Realm only what has grown so large that it needs an independent trust boundary or operational boundary. Make only boundaries strong enough to require cryptographic separation into Realms, and let all other irregularity be absorbed by scope label and the Gate.

Realms are by design not linked. cross-Realm search / cross-Realm context are not provided in v0. When operating multiple Realms, watch, the keyring, the index, and daemon scope are separated per Realm.

### 5.5 Resolution of the Active Realm

context build / search first resolve a unique Active Realm and then operate (this comes before active scope).

```text
1. Canonicalize the CWD.
2. Match against the root_paths / git_remotes registered to each Realm.
3. If uniquely determined, make that Realm active.
4. When it matches multiple Realms, or matches nowhere, Silence.
   Make the user specify the Realm explicitly (--realm <id>), or produce no output.
5. A context build for which the Active Realm is not determined produces no context.md (do not mix by guessing).
```

A source's Realm assignment is decided at connect time. Even for the history of the same host tool (Claude Code / Codex), it is sorted into separate Realms per project / git remote / account.

---

## 6. Input and Output

### 6.1 Entry

The entry is the sessions / history that AI tools accumulate in local hidden folders (under the home directory, etc.). Whether CLI or desktop app, they are obtained from those actual files. The entry judges nothing, first ingests without breaking, and accumulates encrypted (Capture First).

A Connector has 4 ingestion methods per source type.

```text
Append source     Claude Code transcript, Codex session. Reads the appended portion by cursor.
Snapshot source   export format. Diff-matches per snapshot.
Artifact source   diff, stdout, stderr, attachments. Treated as blob and artifact.
Event source      hooks / MCP events. Not required in v0.
```

connect does not treat a host tool as a single lump, but enumerates discovered sources as an Inventory. From there the user selects include / exclude and assigns each source to a Realm. watch targets only selected sources, and does not make tool-wide watch the default. Because the history of Claude Code / Codex can mix work, personal, OSS, customer engagements, and separate identities, do not mix everything into 1 Realm via the initial onboarding path.

The v0 initial Connectors are the 4: Claude Code local transcript, Codex local session, manual import directory, and generic JSONL / Markdown transcript.

### 6.2 Exit

```text
v0 default:  .memoring/context.md (the main exit)
v0 optional: MCP read-only (experimental, a receiving surface for external connections)
```

Making `.memoring/context.md` the main exit is because it is more break-resistant than MCP or hook injection, since any AI tool can read it. context.md is treated as ephemeral and regenerated for each use. It is not stored long-term, and by default is not included in sync / backup targets. `.memoring/` is added to `.git/info/exclude` at generation time, and `.gitignore` is not rewritten.

The output has a Safety Header that distinguishes curated context (the current guidance Memoring has verified) from quoted historical evidence (quotations of past logs), and quotations are confined to fenced / quote blocks as untrusted evidence. AI-facing citations are limited to opaque IDs (clm_ / evt_) only. context.md embeds a signed Ouroboros marker to prevent self-ingestion at re-ingestion time.

MCP is v0 optional, read-only by default, placed as the standard receiving surface for external connections. secret / unknown / confidential are excluded, and writes do not exceed `add_memory_candidate` into the candidate state.

---

## 7. Processing Flow

The input and output of each stage are shown at the conceptual level. Everything proceeds work-driven and converges to idle when there is no diff.

```text
Stage       Input                        Processing                                Output
─────────  ─────────────────────────  ──────────────────────────────────────  ─────────────────────
connect    Host's local accumulation    detect → Inventory → Realm assignment      ConnectorInstance / source selection
capture    source append (diff)          Ingest the original encrypted without breaking it   Undiluted + Occurrence (1-to-2)
normalize  Undiluted / Occurrence        Translate source-specific format into a common time-series   Event (stable by event_identity)
classify   Event                         The AI assigns scope / sensitivity (candidate) Assignment / sensitivity (candidate)
abstract   Event                         The leap of drawing Claim candidates up    Claim candidate
consolidate Claim candidate + evidence  Validate schema / evidence / sensitivity / scope /   Claim consolidated (or conflicted / rejected)
                                        policy / lifecycle / suppression
recall     Maintained Realm (on-demand)  Gate → ranking → ContextPack assembly      ContextPack (manifest)
handoff    ContextPack                  Generate .memoring/context.md              context.md
```

### 7.1 Convergence (idle)

The loop is diff-driven and converges to idle in a finite number of steps against an immutable Realm. It does not permit spinning with zero diff.

```text
fire (stage firing) only when new_observational_evidence ∨ user_trigger ∨ scheduled_maintenance_tick.
AI / expensive steps fire only when new_observational_evidence.
In a fixed Realm with no new evidence, the loop stops generating new candidates in a finite number of steps,
  the pending jobs become empty, and it enters idle.
In idle it does not consume AI / computational resources, and does no busy polling beyond waiting on the Watcher.
```

This convergence is supported by the invariants "do not treat Derived as evidence," "do not ground only on past AI-generated Claims," and "do not count self-generated context in evidence / recall_count." Without these, the loop would re-eat its own derived output as input and generate infinite candidates without new evidence. Running expensive AI only when there is a new Event is itself a structure that supports convergence.

Only time-driven maintenance (expiry on valid_until arrival, reinforcement decay) is permitted as a trigger other than evidence, but it is executed bounded as a scheduled tick and not made into a busy loop.

---

## 8. The Positioning of AI

The automation of the loop presupposes AI. The AI handles classification, abstraction, candidate memory extraction, summary, and conflict detection. However, authority is placed not in the model but in schema, validator, policy, and evidence.

```text
AI model
  → candidate JSON
  → schema validation
  → policy validation
  → evidence check
  → sensitivity / scope check
  → deterministic validator decision
```

The AI only makes candidates. auto-consolidate does not mean "the AI decides," but "the Memoring validator validates the AI candidate, and only those that satisfy policy and evidence become consolidated." Even a high-risk Claim can become consolidated automatically, but that is not the AI deciding; it is an assertion that passed the validator, and it is protected by the Gate from out-of-scope / remote-AI / secret / confidential output. Safety is protected not by stopping consolidated but by the Gate at output time.

What the AI must not decide is as follows.

```text
confirmed-ization of scope (Assignment / Label)
permission to externally send secret / confidential
destructive redact / delete
permanent permission of Crossing
Declassify of sensitivity (the relaxation that lowers sensitivity)
```

### 8.1 The 3 Modes

To lower the barrier to entry, AI use is opened in 3 modes.

```text
Mode A: no-AI degraded     secure capture / search / context.md / explicit memory only. The intrinsic value is limited.
Mode B: local AI first      The default intrinsic form running classification, abstraction, consolidation on a local model.
                            Opened to open-source local models / a local coding agent.
Mode C: remote AI optional  A major provider API can also be used, but the egress gate is always applied.
                            secret is not sent. confidential is one-shot confirmation.
                            External exposure of candidate sensitivity is restricted by policy.
```

Even without AI, secure capture, exact / FTS / n-gram search, context.md generation, and rule-based memory of explicit pin / constraint / decision hold, but the intrinsic loop value of classification, abstraction, and extraction depends on the AI. The AI is the core of Memoring, and disabling it is a degraded mode. AI-derived records (Claim / Assignment / sensitivity classification) hold a Derivation (model / prompt / Recipe / validator version, etc.) in their provenance.

---

## 9. Design Change Process (ADR)

Changes affecting the core are treated not as ordinary implementation changes but as ADRs (Architecture Decision Records). An ADR explicitly states whether the change target is core / contract / Recipe / implementation example, and evaluates the impact on security / privacy and the compatibility policy. The major design decisions that this Basic Design presupposes include: the AI does not, on its own, Declassify sensitivity (the relaxation that lowers sensitivity); the assistant assertion of a context_injected session is not counted as independent evidence; event_identity is derived from a stable coordinate on the source side; Event holds an origin so that assistant / host artifacts are not treated as independent evidence; Label and Assignment are separated; AI-derived records hold a Derivation; Session is normalized as an independent entity; egress is unified into a single table of Audience × Aperture × purpose; and the cascade of delete / redact and the SealRule of Seal are defined. The details are handled in the invariants and schemas of the Detailed Design Document.

---

## Related Documents

- Final Design Document (memoring_design_final_ja.md): The comprehensive final-version document that makes the thought, structure, function, constraints, safety, data structures, and operating policy consistent.
- Requirements Document (memoring_requirements_ja.md): Verifiable functional / non-functional requirements, constraints, and out-of-scope.
- Detailed Design Document (memoring_detailed_design_ja.md): The responsibilities of each component, the full set of JSON schemas, state transitions, invariants, and Gate predicates.
- Specification (memoring_specification_ja.md): The user-facing behavior and formats such as CLI / Daemon / MCP / context.md format, settings, and the egress permission table.
- Implementation Instructions (memoring_implementation_instructions_ja.md): Implementation order, MVP, directory structure, prohibitions, and completion conditions.
