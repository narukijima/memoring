# ADR 0011 — Conversational output-layer LLM (natural-language I/O over gated memory)

- Status: Accepted (plan only; the feature is deferred — no code ships with this ADR)
- Date: 2026-06-24
- Scope: records the model for a future natural-language I/O surface (a "chat with this
  Realm" experience) placed strictly **downstream of the output Gate**. It decides the
  layering, the retrieval/synthesis flow, scope, grounding, egress posture, and the
  provider-abstraction prerequisite. No Realm/key/Gate change; no frozen invariant moves.
- Relates to: ADR-0002 (LLM memory provider — the loop-layer `abstract()` provider, left
  unchanged), ADR-0003 (remote-AI egress gate + default-off — the raw-history path this ADR
  must **not** relax), ADR-0005 (design philosophy — knowledge organ / language organ;
  retrieval ≫ storage), ADR-0007 (import-from-AI — `assistant`/`host_*` origin, candidate-only,
  self-ingestion marker), ADR-0010 (web control panel — owner write surface, candidate-only
  write boundary). Specification §4 (MCP), §7.3 (egress table — single source of truth),
  §7.5 (scope opt-in); Detailed Design (Gate predicate; `origin` / independent-evidence sets).

## Context

Today a consumer reaches a Realm's memory through deterministic surfaces only: the
`context.md` ContextPack and the MCP tools `memoring_search` / `memoring_add_memory_candidate`
(`packages/retrieval/mcp.ts`). Every one of those answers passes the output Gate
(`packages/core/policy.ts`) first. The owner reads structured, gated facts — there is no
natural-language conversation *with* their own memory.

There is exactly one LLM in the system today, and it lives at the **input/consolidation**
layer: the `MemoryProvider.abstract()` call (`packages/claim/provider.ts`, ADR-0002) that
turns raw Events into Claim candidates during the loop. That provider sees **raw history**;
its remote egress is therefore **default-OFF** behind an explicit opt-in (ADR-0003,
`MEMORING_LLM_REMOTE_OPT_IN`, Specification §7.3 `remote-ai-default-off`). The provider
interface is also **classification-shaped**: its only model-facing method is `abstract()`.
There is no `generate` / chat capability.

The design philosophy (ADR-0005) frames memory as the deterministic **knowledge organ** and
treats *how memory is retrieved* as more important than how it is stored. A natural-language
conversation surface is the missing **language organ**: a renderer that lets the owner ask in
prose and read answers in prose, without the LLM ever becoming the memory or entering the
consolidation loop. The risk to avoid is the obvious one — bolting a chatbot onto the store so
that the model's fluency, priors, or hallucinations leak *into* the memory or *past* the Gate.
This ADR records the model that keeps that from happening, and defers the build to later phases.

## Decision

### 1. Two LLM layers, one boundary between them

Memoring recognizes exactly two LLM roles, separated by the Gate:

| Layer | Role | Sees | Egress default | This ADR |
| --- | --- | --- | --- | --- |
| **Loop-layer** (existing) | `abstract()` — classify / abstract Events → Claim candidates | **raw history** (pre-Gate) | **remote OFF** (ADR-0003 opt-in) | unchanged |
| **Output-layer** (new) | natural-language I/O renderer | **only post-Gate excerpts** | remote-*capable*; default needs a §7.3/§7.5 amendment (§5) | introduced here |

The output-layer LLM is a **language organ**, not a chatbot and not part of consolidation. The
memory remains the deterministic internal store. Swapping the output provider changes the
*voice*, never the *memory*. This is the precise reason it "does not pollute the internals":
the output LLM sits **strictly downstream of the Gate** and can touch nothing the Gate has not
already released. Gate First is preserved by construction — the LLM is on the far side of it.

### 2. Bidirectional flow (inbound one-shot in v1; agentic recall deferred)

- **Inbound (user → LLM → internal).** The user's prose becomes a retrieval query. For v1 this
  is **one-shot**: natural language → **one** query → **gated** retrieval (`memoring_search` /
  the ContextPack path) → render. The LLM forms the query; the *retrieval still passes the
  Gate*. Agentic multi-hop / associative retrieval (the LLM iterating queries and chaining
  associations) is **deferred** to a later evolution — it widens the read surface and deserves
  its own treatment.
- **Outbound (internal → LLM → user).** Gated results → the LLM synthesizes natural language →
  the user. The LLM only ever phrases what retrieval already released.

### 3. Scope is per-Realm (a global "whole-self twin" is deferred)

One conversation session binds to **exactly one Realm**. Cross-Realm recall within a session is
**prohibited** — it is the per-Realm identity/trust invariant, not a tunable. A global,
cross-Realm "whole-self" twin (one assistant that speaks across every Realm) is **deferred to a
separate future ADR**: it conflicts with the cross-Realm invariant and must not be smuggled in
as a convenience here. One Realm = one directory = one key = one trust boundary, end to end.

### 4. Grounding is strict — Silence is extended to the output LLM

The output LLM answers **only** from retrieved gated memory. On empty or insufficient
retrieval it states that there is **no grounded answer** rather than filling the gap from
general knowledge or model priors. This extends the **Silence / fail-closed** invariant from
the Gate to the renderer: undetermined → not asserted. No hallucination and no
general-knowledge backfill are permitted by default. The model's parametric knowledge is a
phrasing aid, never a source of facts about the owner.

### 5. Egress — provider-agnostic; the output layer is remote-*capable*, but defaulting it to remote requires a spec amendment

Internal and external providers are treated at **parity** (a swappable registry, §6). The owner's
intent is that the output role **may default to remote**, justified by *what the output LLM can
see*: only post-Gate, secret-free, in-scope excerpts. This is recorded as a **deferred intent, not
asserted as already-permitted.** A remote output provider rides the `remote_ai` purpose
(`remote_ai_processing` Audience), which the frozen baseline marks **default-DENY + scope opt-in**
(policy.v2 `remote-ai-default-off`; Specification §7.3 / §7.5 — the single source of truth).
Enabling the output role remote **by default would therefore require amending §7.3 / §7.5 /
policy.v2**; it cannot be a mere implementation knob, and nothing here overrides that default-deny
posture. The mechanism that bounds *what* such a remote provider could ever see, and the mandatory
safeguards:

- **(mechanism) The remote output LLM rides the existing `remote_ai_processing` Audience
  column.** A remote output provider is, by definition, a remote AI consuming memory, so its
  retrieval is gated under the existing `remote_ai_processing` Audience (`AUDIENCES` in
  `packages/core/schema/enums.ts`). It therefore inherits that column's floor automatically:
  `secret` / `unknown` never egress, out-of-scope never egress, and raw `confidential`
  egresses only under a one-shot explicit confirmation (§7.3 note 6 / §7.5) — never silently.
  No new Gate primitive is introduced (Interface freeze respected).
- **(a) Disclosure + an easy force-local switch.** Remote use of the output layer is clearly
  disclosed, and a single setting (an env var / per-Realm setting) forces the output layer
  on-device. The owner can always keep the conversation entirely local.
- **(b) The loop-layer stays default-OFF, separately.** ADR-0003's raw-history opt-in
  (`MEMORING_LLM_REMOTE_OPT_IN`) is **unchanged** and remains default-deny. The output-layer
  remote default is a *distinct per-role knob* over already-Gated content; it does **not**
  relax the raw-history path, and the §7.3 egress table itself is untouched.
- **(c) The synthesized output carries the Ouroboros / self-ingestion marker.** Natural
  language produced by the output LLM is Memoring-generated context and carries the
  self-generated marker (the `memoring:ouroboros` token / signed ` ```memoring-ouroboros `
  block, `self_ingestion_marker_digest`), so if it is ever re-ingested it can never be counted
  as evidence or reinforcement.
- **(d) Start READ-ONLY.** v1 has **no write-back**, so Ouroboros risk is zero. Any future
  write-back is **candidate-only**: `assistant` origin (non-independent evidence), never
  self-promoting to `confirmed`, gated on explicit user confirmation — the same boundary
  ADR-0007 (import) and ADR-0010 (web panel) already hold.

Until such an amendment exists, the output role is held to the same `remote-ai-default-off` posture
as any `remote_ai` consumer: **OFF by default, scope opt-in required**. Whether an amended default
later rides §7.5 scope opt-in or a dedicated per-role setting is itself **deferred**. This ADR does
**not** flip §7.5, §7.3, or any egress default. The non-negotiable floor is the Gate column above:
no raw secret egress, ever, under any provider.

### 6. Provider abstraction — per-role registry; a generate capability is a prerequisite

The two roles share one **provider registry with per-role configuration**: the loop role keeps
its `abstract()` provider and its default-off remote posture; the output role selects a
generate/chat provider and its own (remote-allowed) posture. The current `MemoryProvider`
exposes only `abstract()`; a **generate / chat capability must be added** before the output
layer can be built. This ADR records that as an **implementation prerequisite only** — it is
**not** implemented here, and the `MemoryProvider` interface is **not** changed by this ADR.

### 7. Any per-Realm persona is user-defined config, never a hard-coded category

If a Realm's conversation is given a "persona" (tone, addressed role, framing), it is **owner
configuration**, never a predefined classification. Memoring ships **no** hard-coded persona or
category taxonomy (the no-predefined-persona invariant; AGENTS.md "v0 — what NOT to do"). The
language organ may adopt a voice the owner sets; it must not infer one from a fixed catalogue.

### Invariants preserved (review checklist)

- **Gate First** — the output LLM is strictly downstream of the Gate; secret / unknown /
  out-of-scope / undetermined never reach it. The Gate still runs before ranking.
- **No raw secret egress** — enforced by the `remote_ai_processing` column for remote output,
  unchanged for every other path.
- **Silence / fail-closed** — extended to the renderer (§4): no grounded retrieval → no answer.
- **AI reaches only `candidate`** — v1 is read-only; any future write-back is candidate-only,
  user-confirmed (§5d).
- **Ouroboros** — synthesized output is marked self-generated and can never be evidence or
  reinforcement (§5c).
- **`origin` restricts independent evidence** — output-LLM utterances are `assistant` origin:
  not independent evidence; cannot self-confirm.
- **Identity / trust is per-Realm** — one session, one Realm; cross-Realm recall prohibited
  (§3).
- **No predefined persona / category** — any persona is user-defined config (§7).

## Consequences

- Memoring gains a documented path to "talk to your Realm" without the LLM ever becoming the
  memory, entering the loop, or seeing anything the Gate withheld. The deterministic core is
  unchanged; the model is a replaceable renderer.
- The owner can run the conversation fully on-device (force-local) or accept a remote renderer
  whose input is, by construction, already the safe-to-emit set.
- A clear separation is recorded between the **loop-layer** (raw history, remote default-OFF,
  untouched) and the **output-layer** (post-Gate; remote-*capable* but still OFF-by-default until a
  §7.3/§7.5 amendment) so a future implementer cannot quietly relax the raw-history path — or
  default the renderer to remote without amending the egress table — while building the chat surface.
- One concrete prerequisite is named (the provider `generate` capability) so the build does not
  start by mutating a frozen interface ad hoc.
- No frozen invariant moves and no code ships with this ADR.

## Deferred (not in this change)

- **All implementation.** The chat/CLI/Web surface, the provider `generate` capability, the
  per-role registry wiring, and any setting changes are **subsequent phased PRs after this ADR
  is accepted**. The natural first rung is the MCP tools that already exist today
  (`memoring_search`); a dedicated `memoring chat` surface is a later phase.
- **Agentic / multi-hop associative retrieval** (the LLM iterating queries and chaining
  associations) — v1 is one-shot (§2).
- **A global cross-Realm "whole-self" twin** — its own future ADR; conflicts with the
  per-Realm invariant (§3).
- **Any write-back** beyond the read-only v1 — if added, candidate-only and user-confirmed
  (§5d); not designed here.
- **The output role's remote default.** Defaulting the output renderer to remote rides the
  `remote_ai` purpose that §7.3 / §7.5 / policy.v2 freeze as default-deny + scope opt-in, so it
  **requires a spec amendment** (a future ADR), not a build-time toggle. Until then the output role
  is OFF-by-default like any `remote_ai` consumer. This ADR flips no egress default (§5).
