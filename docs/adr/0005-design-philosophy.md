# ADR 0005 — Design philosophy / core beliefs

- Status: Accepted
- Date: 2026-06-23
- Scope: design rationale. Consolidates the load-bearing beliefs that govern
  every later decision, and names the one frontier (association / binding) the
  codebase has deliberately left underbuilt. Anchors — does not restate —
  Final Design §2 (Design Philosophy), §2.5 (The Undiluted is Truth), §2.7 (The
  Metabolic Razor), and §3 (Core Principles, the numbered 1–21 list).
- Relates to: ADR-0004 (v0.1 candidates and the invariant each must not cross),
  ADR-0003 (remote-AI egress gate), ADR-0001 (passwordless default). Where this
  ADR and the Final Design disagree on wording, the Final Design §2–§3 text wins;
  this ADR only points at it and explains *why it is shaped this way*.

## Context

Memoring's rationale is spread across the Final Design (§2–§3, frozen and
bilingual), four ADRs, AGENTS.md, and the code itself. A new agent can read all
of it and still miss the single organizing idea that makes the rest coherent.
This ADR is the **map**: one place that states the core beliefs, marks what is
inviolable versus free, and records the design tensions that are already
*resolved* so they are not relitigated. It is a navigation layer, not a new
source of truth — every belief below cites the principle or section that owns its
full text.

The reason Memoring exists at all is in the first belief. If memory were fully
free — raw recall piped straight into an LLM — there would be nothing to build;
you would just attach a database. Memoring earns its existence by enforcing a
**floor** that neither the AI nor the *absence* of a watching human can lower,
and then granting maximal freedom above it.

## Decision

The following beliefs are accepted as the design constitution's working summary.
Each is binding to the extent its anchor is binding; this ADR adds no new
invariant, it organizes existing ones.

### B0 — The one-line principle

**On a floor the machine enforces no matter what, allow unlimited freedom,
autonomy, self-extension, and association above it.**

Everything else is a corollary. The floor is *managed and mechanical*; the space
above it is *organic and free*. There is no priority ordering between the two —
they are two parallel tracks, both first-class.
(Anchors: §2 Design Philosophy; §3.)

### B1 — The floor is inviolable, and it is enforced by mechanism, not by a human

These are the load-bearing walls. They hold whether or not anyone is watching,
and neither the AI nor a future maintainer's edit may weaken them:

- **The Gate is the sole egress predicate.** One conjunctive decision — Audience ×
  Aperture — runs *before* ranking on every recall surface. "Being a local file"
  is never a basis to surface anything. (§3 #11, #12, #17; Final Design §16;
  `packages/core/policy.ts`.) Note: today this holds by *call-graph convention*,
  not by a mechanism that fails on a future edit — and the four "channels" each
  enforce a *channel-appropriate* floor, not a literal call to one shared
  `gate()`. `context-pack.ts` calls `gate()`; `search.ts`/`mcp.ts` enforce a
  query-time filter chain + index-time exclusion that never indexes
  secret/unknown/out-of-scope/sealed rows; `extractor.ts` re-checks the remote
  predicate block before a prompt leaves the device. Hardening this convention
  into a *failing test* on every egress sink — including the `export` derivative
  surface — is FLOOR-track work, not a new invariant.
- **Sensitivity has a hard floor.** `secret` and `unknown` are never raw-emitted
  at any Aperture; `confidential` requires one-shot explicit confirmation. The
  default is Silence. (§3 #9, #17; `enums.ts` `maxSensitivityOf`.)
- **Scope is default-deny, and membership is decided at recall.** No cross-scope
  leakage; an empty active scope matches nothing (fail-closed, no realm-wide
  fallback). A claim's egress scope is *re-derived at recall* as the union of its
  evidence events' labels; `activeScopeMatch` admits on `some()` overlap, which
  is correct for single-scope recall but means a multi-scope "bridge" claim can
  surface under any one of its scopes. Link traversal is itself a scope crossing
  and must therefore be held to a stricter `every()`-in-active-scope test — see
  B5. (§3 #20; `policy.ts` `activeScopeMatch`, `retrieval/active-scope.ts`.)
- **Forget is physically real *and crash-durable*.** Delete/redact cascade to
  actual blob removal, and a SealRule prevents reprocess-revival durably across
  rebuilds and rekeys. The store has two persistence domains — per-file objects
  (immediate) and the whole-DB AEAD blob (only on `flush()`) — so "physically
  real" also requires that a crash never leaves a live DB row pointing at a
  vanished blob, nor an orphan blob with no row. Tombstone-before-delete ordering
  and an open-time reconciliation sweep are what make this a *mechanism* rather
  than a lucky ordering. (§3 #19; `security/redaction.ts`, `claim/seal.ts`,
  `storage/object-store.ts`, `storage/encrypted-db.ts`.)
- **Authority is by origin; AI only proposes.** AI/rule output and host-generated
  memory cannot create durable memory or relax sensitivity on their own; the
  validator governs consolidation. Seal create/release authority is user-origin
  only, and that authority is enforced by *who may call the mutator* (caller
  allowlist ⊆ {`redaction.ts`, forget CLI}), pinned by a structural test. (§3 #8,
  #15, #16, #18; `claim/validator.ts`, `claim/seal.ts`.)
- **Encryption and durability are structural.** The whole store is one encrypted
  at-rest blob; a single-writer exclusive lock fails closed. A surface that holds
  that lock for a long-lived session (the MCP stdio server) must NOT become a
  writer that serializes a stale snapshot over a concurrent forget/Seal — writes
  belong on short-lived open→write→close envelopes. (§3 #13;
  `storage/encrypted-db.ts`, `apps/cli/commands/mcp.ts`, `apps/cli/commands/watch.ts`.)
- **Never go berserk; never corrupt memory.** The autonomous loop only proposes
  through the validator — it never writes an egress surface, never mutates a
  Seal, never downgrades sensitivity. It *does* legitimately call the index
  writers (`indexEvent`/`indexClaim`), which live in the same module as the
  `searchRealm` egress reader — so this guarantee is *symbol-level*
  (index-writers allowed, egress readers / Seal mutators forbidden), not
  module-level. (`core/loop.ts`.)

### B2 — Above the floor, memory is free and high-entropy

Memory has **no fixed shape**. Do not force content into rigid schemas; only thin
metadata/type is classifiable. The AI may self-extend schemas, collections, and
links — organic, brain-like growth — and may run autonomously 24/7, because human
intervention is a bottleneck, not a safety mechanism. The bodies stay free; only
a thin structural layer (refs / labels / salience / type) is governed.
(Anchors: §3 #2, #3, #4; §2.5 "The Undiluted is Truth.")

### B3 — Retrieval ≫ storage (the center of gravity)

What matters is not what is stored but what is stored **in a retrievable state and
pulled out repeatedly**. As with human memory, most input is discarded; what
survives is what gets re-retrieved. The design center of gravity is therefore
**recall + association + links**, not capture. Capture is solved; retrieval is the
work. (§3 #1, #11; "Context is recalled, not dumped.")

One precise boundary lives inside this belief and must not be smudged:
`valid_recall_count` (`claim/lifecycle.ts:14`) is, by deliberate design,
*external re-confirmation only — context.md inclusion is NOT counted*. Reviving
recall signals (B4) means populating a **separate** recall-event signal
(`last_recalled_at` + a recall counter); it must not silently fold context.md
inclusion into `valid_recall_count`, or it overwrites an intentional semantic.

### B4 — The "set" / binding is the real frontier, and it is underbuilt

Humans re-surface memories bound to strong parameters — emotion, senses, place.
The AI analog is a **salience binding**: signals (recency, repetition, surprise,
source-trust, user-pin, co-occurrence, scope) that attach to a memory and drive
associative recall as a *set*. Today this exists only as a partly-frozen
reinforcement scalar and one link type (claim→evidence); `last_recalled_at`
(`entities.ts:137`) is only ever written null, `supersedes[]` (`entities.ts:140`)
is always `[]`, and the recall/age inputs to `reinforcement()` are always passed
0. Most signals are wired but never driven. This is the single largest gap versus
the stated center of gravity, and it is *named as future work, not a defect to
hide*. (Anchors: §2 Design Philosophy; reinforcement model in `claim/lifecycle.ts`,
`core/recipe.ts`.)

### B5 — Links are scope-aware edges: association proposes, the Gate disposes

Links are the central hard problem — without working links there is no
"remembering." But association only ever **proposes candidates**. Each proposed
candidate must still pass the Gate *individually* before it can surface. Link
traversal is a scope crossing, governed by the default-deny cross-scope Gate, and
because a link is itself a scope-crossing edge the traversed neighbor is held to
the stricter `every()`-in-active-scope test (not the seed path's `some()`). Links
live in the thin structural layer (refs / labels / salience); bodies stay free.
The Gate disposes per-item at the two recall integration points
(`retrieval/context-pack.ts`, `retrieval/search.ts`) — but only `context-pack.ts`
actually calls `gate()`. A proposer therefore slots in on the `buildContext`
path, where `gate(toGateItem(...), req)` is the structural per-item check; it must
NOT resolve a neighbor's body on the search/MCP path (which has no reusable
per-item `gate()` and would route around the index-eligibility filter). An edge to
a forgotten/redacted claim must be **inert by construction** — validity is checked
at read time (both endpoints must be live), so a physically-lingering edge can
never revive content the forget floor erased. (Anchors: B1, B4; §3 #11.)

## Resolved tensions (do not relitigate)

These were live design tensions; each is **settled**. Future agents should design
within the resolution, not reopen it.

- **Self-extension vs. the floor → self-extension is a tenant that cannot move
  load-bearing walls.** Organic growth, new schemas, new links, and 24/7
  autonomy are all encouraged *above* the floor. None of them may reach the
  Gate, a Seal, sensitivity downgrade, or an egress surface. The loop proposes;
  authority lives in the validator and in user-gated CLI paths only. Freedom
  above, walls below — they do not conflict because they live in different
  layers. The forcing function that keeps this true under self-extension is
  *mechanism*: the first new structure (a link table, if/when added) must inherit
  the forget cascade by construction, not by a remembered manual edit. (B1, B2;
  `core/loop.ts`, `claim/validator.ts`, `security/redaction.ts`.)

- **Retrieval-first vs. safety-first → they are the same locus.** The Gate runs
  at the exact moment of recall/egress. Improving retrieval and hardening safety
  therefore happen at one place, not two competing ones. A better proposer makes
  recall better *and* is disposed by the same Gate that makes it safe. There is
  no trade to manage here; the two tracks meet at `gate()`. (B3, B5.)

- **Hands-off autonomy vs. safety → autonomy is safe because the floor is
  mechanical.** The owner sets invariants and otherwise stays hands-off; safety
  does not depend on a human being present to approve. The machine enforces the
  floor 24/7. The *absence* of the human is explicitly not permitted to weaken
  anything — that is the whole point of a mechanically enforced floor. Autonomy
  also must not corrupt: the 24/7 loop's per-tick open→close lock discipline and
  crash-durable forget ordering are part of "never go berserk." (B0, B1.)

## The vision this serves

Memoring treats AI as a **new life form** — human-brain efficiency × AI 24/7
autonomy — and **memory is its core organ**. The human is the **owner, not the
operator**: they set the invariants ("drive in the nail"), select which Realm/scope
an agent connects to, and then hand off; the machine runs continuously and
enforces the floor without supervision. A life form whose memory could be
corrupted, leaked, or made to go berserk is not viable — which is why the floor is
non-negotiable, and why everything above it can be free.

## Not in this ADR

- No new invariant, schema, or mechanism is decided here. This ADR maps and
  summarizes; the binding text lives in Final Design §2–§3 and the cited code.
- The §2.7 thermodynamics ("The Metabolic Razor" / the four dissipative-structure
  concepts) is **summarized by reference only**. Per the project guardrail it must
  not be re-derived or expanded outside Final Design §2.7 and the project plan §6.
  Read §2.7 there for the full treatment.
- *How* to build the association/binding frontier (B4/B5) — a recall counter
  feeding reinforcement, a supersedes chain, an associative proposer, co-occurrence
  edges, semantic recall — is roadmap work tracked by ADR-0004 and ADR-0003's
  Deferred sections, each admissible only behind its own ADR that shows it does
  not cross the floor.
