# ADR 0007 — Import memory from other AIs (paste-export ingestion)

- Status: Accepted (v0.1; implemented behind the `memoring import` command)
- Date: 2026-06-24
- Scope: a new **intake source** for foreign-AI "what I know about you" exports
  (ChatGPT / Claude / Gemini), pasted in by the user. Implements the
  "ChatGPT/Claude/Gemini exports / manual-import" connector parked in
  [ADR-0004 §7](0004-v0_1-candidates.md).
- Relates to: ADR-0004 (Context invariant + §7 connector-expansion guardrails),
  ADR-0006 (target-Realm resolution), Specification §4 (candidate write / no
  evidence authority), §5.2 (policy precedence — user decision is authority),
  §7.3 (egress / Gate).

## Context

People accumulate memory inside other AI tools. Those tools can export it via a
prompt ("export everything you know about me"). The owner wants Memoring to
**import** that pasted answer into a chosen Realm.

A pasted foreign-AI export is **both** (a) AI-authored **and** (b) off-device.
That is exactly the content Memoring's core invariant forbids from gaining
authority: *no AI-generated or off-device content gains evidence authority*
(ADR-0004 "Context"). A foreign AI's "summary of you" is the canonical
**laundering vector** — if it could become independent evidence, an external model
could dictate Memoring's confirmed memory. So the design problem is **not**
plumbing; it is: *how does imported content become useful without ever becoming
authoritative on its own?*

The good news: the safety core already has the exact primitive needed. Event
`origin` is the strongest, marker-independent authority layer, and
`host_memory` is an enumerated origin that **no connector currently emits** —
reserved for precisely "another tool's memory store about the user"
([enums.ts](../../packages/core/schema/enums.ts) `NON_EVIDENCE_ORIGINS`). Mapping
imported entries onto it inherits every existing laundering guard with no new
mechanism.

## Decision

Add a CLI-first intake path, `memoring import`, that ingests a pasted export
through the **same** `capture → normalize → classify` pipeline as every other
source, landing each entry as a non-authoritative **`host_memory` Event** plus a
reviewable **`candidate` Claim**. Imported claims **never auto-consolidate**; the
user **explicitly promotes** the ones they want, and that user decision — not the
foreign AI — is the authority that makes a promoted claim recallable.

No new origin, no new Claim state, no Gate change, no new egress channel.

### (a) Authority model — the crux

Two records per entry, with authority pinned at the floor:

1. **`host_memory` Event** (the durable, laundering-safe record). Created by the
   normal `capture()` → `normalizeOccurrence()` path. Because
   `host_memory ∈ NON_EVIDENCE_ORIGINS`:
   - the validator rejects any Claim that cites it as evidence
     ([validator.ts](../../packages/claim/validator.ts) step 5,
     `provenance:non_evidence_origin`);
   - `abstractEvents` never abstracts it (it only abstracts `origin==='user'`,
     [extractor.ts:120](../../packages/claim/extractor.ts)), so it can never
     spawn a Claim that quietly consolidates;
   - it defaults to `unknown` sensitivity (off-device), so it is **Silenced** by
     the Gate and never indexed (search.ts `indexEvent` skips `unknown`).

   This is the whole laundering defense, reused verbatim. Even if every layer
   above were deleted, the origin layer alone keeps imported content out of
   evidence.

2. **`candidate` Claim** (the review surface). Created directly, mirroring the
   sanctioned non-authority precedent in
   [mcp.ts](../../packages/retrieval/mcp.ts) `handleAddCandidate`:
   `status:'candidate'`, `created_by:'ai'`, `evidence_event_identities:[]`. With
   no evidence it can never satisfy the validator, and a `candidate` Claim is
   never indexed (only `consolidated` claims are — search.ts:54), so it is staged
   but invisible to recall/search/context/MCP.

**Where auto-consolidation stops (explicitly).** `consolidatePending`
([consolidation.ts](../../packages/claim/consolidation.ts)) would otherwise run
the validator over every candidate each loop and settle it to `rejected`
(evidence:none) — churning imported items out of the review pool. We add one
guard: a candidate carrying the import provenance marker
(`import:claim:<id>` meta) is **skipped** — neither consolidated nor rejected. It
waits, durably, for a human. This is the single line where the loop's automatic
authority machinery is held back for imported content.

**Promotion = user authority.** `memoring import promote <id>` is the only path
to authority, and it requires an explicit human action per item (§5.2: a user
decision is a legitimate authority / Declassify source). It sets
`status:'consolidated'`, `created_by:'user'` (the user now asserts it — it is no
longer "the AI's summary"), attaches an `explicit_user` scope Assignment, sets an
explicit sensitivity, and indexes it. `reject` settles it to `rejected`. Nothing
imported reaches recall without this step.

### (b) Intake mechanism — dedicated command, reusing the pipeline

The `Connector` contract ([types.ts](../../packages/intake/types.ts)) assumes
**disk sources with cursors** (`detect()` / `read(fromCursor)`). A one-shot paste
has nothing to detect and no cursor to advance, so forcing it into
`detect()`/watch would be a lie. We therefore add a **dedicated `memoring import`
command** that takes the blob from `--file`, `--text`, or stdin, and drives the
pipeline directly — **but it still reuses `capture()` (G1) and
`normalizeOccurrence()` (G2)** via a registered `import_ai` Connector whose only
real method is `parse()`. `detect()`/`read()` return nothing (there is nothing on
disk to watch), so the resident loop correctly ignores imports. Capture-raw-first
is preserved: the command calls `capture()` before any parsing.

### (c) Parsing — one tolerant parser, quarantine on failure

A single `parseExport(bytes)` handles both shipped formats and auto-detects which:

- **Claude**: ordered `N. **Category**` headers, then a fenced code block of
  `[YYYY-MM-DD] - entry` / `[unknown] - entry` lines.
- **Gemini**: labeled sections, bullet entries with a verbatim quote (`根拠:`) and
  `日付: [YYYY-MM-DD]`, and a trailing `インポート元は <name> です` line.

Each entry maps to `{ kind, statement, quote, date, provider }`. Category → `kind`
([enums.ts](../../packages/core/schema/enums.ts) `CLAIM_KINDS`):

| Source category | kind |
| --- | --- |
| Instructions / カスタム指示 | `constraint` |
| Identity / ユーザー属性情報 / Career | `fact` |
| Projects / イベント・プロジェクト・計画 | `project_context` |
| Preferences / 好み | `preference` |
| Interests / 興味・関心 / Relationships / 人間関係 | `fact` |

If the blob has no recognizable structure, the parser returns
`{kind:'quarantine'}`; `normalizeOccurrence` writes a `QuarantineRecord` and the
raw is already safe in the Undiluted (G2, no raw loss). Unknown trailing fields
(the source provider, the verbatim quote, the date) are preserved in the Event's
encrypted `source_extra_ref`, never indexed (FR-015).

### (d) Identity & dedup — content anchor

Pasted text has no message-id or cursor. We synthesize a **stable** one:
`message_id = entry:<sha256(provider | kind | statement | date)>`, under a
**provider-stable** `host_session_stable_id = import:<provider>`. `eventIdentity`
([identity.ts](../../packages/intake/identity.ts)) then HMACs those under
`realm_key`, so the identity is realm_key-derived, reprocess/restore-invariant
(G11), and never collides across Realms. Because neither anchor depends on the
whole blob, an entry dedups **across re-exports** — re-running the export prompt
later (which yields cosmetically different surrounding text) still dedups every
unchanged entry, not just a byte-identical re-paste. (Folding the blob hash into
the session id would have flipped every entry's identity on any drift — a trailing
newline, one reworded unrelated line — defeating exactly the dedup this is for.)
The raw layer additionally dedups a byte-identical blob via `content_fingerprint`
(capture.ts). Candidate Claims are created only for **newly-created** events, so
re-import never duplicates claims.

### (e) Sensitivity & classification

Imported entries are off-device origin → Events default to `unknown` (Silence
until the user declares), exactly like an unclassified connector source.
`secret-scan` runs on the imported text **twice**: once inside
`normalizeOccurrence` (the Event), and once on each entry's statement before a
candidate Claim is created — a secret entry creates **no** candidate (the raw
stays withheld in the Undiluted / secret Event). Candidate Claims carry `unknown`
sensitivity until promotion; `promote` requires an explicit `--sensitivity`
(public/internal/confidential) — an explicit user Declassify (§4.3), never a
synthesized default. AI signals never Declassify.

### (f) Provenance / origin tagging

`origin:'host_memory'` is the machine-enforced "foreign-AI-imported" tag — the
Ouroboros/laundering logic and the Gate already treat it as non-evidence,
mirroring `host_summary`/`host_memory` handling in
[normalize.ts](../../packages/intake/normalize.ts). The candidate Claim records
its provenance (`{provider, date, source_event_identity}`) in the
`import:claim:<id>` marker, surfaced by `import list` and recorded on `promote`
(audit). The verbatim quote stays in the encrypted `source_extra_ref`. A promoted
claim is `created_by:'user'` (the user asserted it) but its import lineage is
retained for audit — it is never re-emitted as first-party *evidence* because it
carries no evidence events.

### (g) Export-prompt helper (bidirectional)

`memoring import --print-prompt <claude|gemini|chatgpt>` prints the matching
export prompt to stdout, so the user can run it in the other tool and paste the
result back. This is a pure local string print — no egress.

## How each FLOOR invariant is preserved

1. **No evidence authority for imported content.** Candidate Claims have
   `evidence_event_identities:[]` (handleAddCandidate precedent); `host_memory`
   events are `NON_EVIDENCE_ORIGINS`. Both routes to authority are closed at the
   validator/origin layer, independently.
2. **No laundering loophole.** A pasted AI summary lands as `host_memory`:
   never independent evidence, never abstracted, never auto-consolidated. This is
   the same `allEvidenceIndependent` invariant guarded by `tests/recall-eval.test.ts`
   scenario 6 for `host_summary`; the imported-content equivalent (a `host_memory`
   event can never back a consolidated claim, even after a full loop/reprocess) is
   covered by the dedicated `tests/import-from-ai.test.ts` suite.
3. **Gate stays the sole egress mechanism.** Imported events run
   classify → secret-scan → Gate like everything else; `unknown`/`secret` are
   excluded; candidate Claims are not indexed. No new egress channel is added.
4. **Pipeline contracts.** capture-raw-first (G1: `capture()` before parse);
   parse → Event OR Quarantine with no raw loss (G2); realm_key-derived,
   reprocess-invariant `event_identity` (G11); a per-entry Inventory shown by
   `--dry-run` with per-item include via `promote`, never a whole-tool default
   (G12).
5. **Target Realm.** The command resolves the active Realm via
   `openResolvedRealm` (ADR-0006): `--realm` / registry / CWD. No single-Realm
   assumption.
6. **Frozen APIs unchanged.** No new origin (`host_memory` pre-existed), no new
   Claim state, no Gate/key change, no cross-Realm feature, no cloud/MCP/API
   ingestion.

## Consequences

- Memoring gains a second intake source without a second safety mechanism: the
  importer is "just another source" whose entries are pinned non-authoritative by
  the origin they already had a slot for.
- Imported memory is **opt-in per item**: it is inert until a human promotes it,
  which is the only point authority is conferred — and it is conferred by the
  user, not the foreign AI.
- One small, provably-safe change to `indexClaim`/`claimScopeState`: when a
  consolidated claim has **no** evidence-derived labels, fall back to the claim's
  own `explicit_user` Assignment so a promoted (evidence-less) import is
  recallable. For every existing evidence-backed claim the fallback is a no-op
  (their labels already come from evidence).

## Not in this ADR

UI (the source of truth for operations is the CLI). Bulk/file-watched import
directories. Any path that confers authority without an explicit per-item user
action. First-party export of Memoring's own memory as a foreign-AI prompt target
(the reverse direction beyond `--print-prompt`).
