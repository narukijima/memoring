# ADR 0011 — Conversational output-layer LLM (natural-language I/O over gated memory)

- Status: Accepted — **IMPLEMENTED for the v1 slices.** `memoring ask` (one-shot) and `memoring chat`
  (multi-turn) ship the output-layer renderer, the `OutputProvider.generate` capability (distinct from
  `MemoryProvider.abstract()`), and the per-role `MEMORING_ASK_*` config split — all strictly within the
  model below. See `apps/cli/commands/ask.ts`, `apps/cli/commands/chat.ts`, `apps/cli/output-provider.ts`,
  `tests/ask.test.ts`, `tests/chat.test.ts`, and the two addenda. The items under **Deferred** (agentic
  multi-hop, the cross-Realm twin, write-back, the remote-default-on amendment, the Web chat surface,
  per-Realm persona) remain deferred.
- Date: 2026-06-24 (v1 slices implemented 2026-06-24, PRs #27 `ask`, #30 `chat` + per-role config)
- Scope: records the model for the natural-language I/O surface (a "chat with this
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
This ADR records the model that keeps that from happening; the v1 build (CLI `ask` / `chat`) has since
landed within it in phased slices (see the addenda), with the wider surface still deferred.

## Decision

### 1. Two LLM layers, one boundary between them

Memoring recognizes exactly two LLM roles, separated by the Gate:

| Layer | Role | Sees | Egress default | This ADR |
| --- | --- | --- | --- | --- |
| **Loop-layer** (existing) | `abstract()` — classify / abstract Events → Claim candidates | **raw history** (pre-Gate) | **remote OFF** (ADR-0003 opt-in) | unchanged |
| **Output-layer** (new) | natural-language I/O renderer | **only post-Gate excerpts** | **LOCAL by default; remote opt-in** (settled, Addendum 1; remote-default-on declined) | introduced here, implemented in v1 (`ask` / `chat`) |

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

> **Settled by Addendum 1 (2026-06-24):** the open "may default to remote" question below was resolved
> **LOCAL-by-default + remote opt-in**; the remote-default-on amendment is **declined, not pursued**.
> The original framing is kept as the decision record this addendum supersedes.

Internal and external providers are treated at **parity** (a swappable registry, §6). The owner's
original intent **was** that the output role **might default to remote**, justified by *what the
output LLM can see*: only post-Gate, secret-free, in-scope excerpts. It **was** recorded as a
**deferred intent, not asserted as already-permitted** — and Addendum 1 has since settled it
(LOCAL-by-default + remote opt-in). A remote output provider rides the `remote_ai` purpose
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
  (`MEMORING_LLM_REMOTE_OPT_IN`) is **unchanged** and remains default-deny. Any output-layer
  remote use is a **separate concern** over already-Gated content; it does **not** relax the
  raw-history path, and the §7.3 egress table itself is untouched. (As implemented, per-role
  `MEMORING_ASK_*` config selects the provider — base URL / model / API key / egress preference —
  but the remote **opt-in gate** `MEMORING_LLM_REMOTE_OPT_IN` is **shared** with the loop, so no
  per-role setting alone enables a remote default; Addendum 2.)
- **(c) The synthesized output carries the Ouroboros / self-ingestion marker.** Natural
  language produced by the output LLM is Memoring-generated context and carries the
  self-generated marker (the `memoring:ouroboros` token / signed ` ```memoring-ouroboros `
  block, `self_ingestion_marker_digest`), so if it is ever re-ingested it can never be counted
  as evidence or reinforcement.
- **(d) Start READ-ONLY.** v1 has **no write-back**, so Ouroboros risk is zero. Any future
  write-back is **candidate-only**: `assistant` origin (non-independent evidence), never
  self-promoting to `confirmed`, gated on explicit user confirmation — the same boundary
  ADR-0007 (import) and ADR-0010 (web panel) already hold.

The output role is held to the same `remote-ai-default-off` posture as any `remote_ai` consumer:
**OFF by default, scope opt-in required**. (The originally-open question of whether an amended
default might later ride §7.5 scope opt-in or a dedicated per-role setting was **settled by
Addendum 1: declined** — local-default + remote opt-in, no amendment sought.) This ADR does
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
  untouched) and the **output-layer** (post-Gate; **LOCAL by default, remote configurable but
  discouraged and opt-in** per Addendum 1 — the remote-default-on amendment was declined, not pursued)
  so a future implementer cannot quietly relax the raw-history path — or default the renderer to remote
  without amending the egress table — while building the chat surface.
- One concrete prerequisite was named (the provider `generate` capability) so the build did not
  start by mutating a frozen interface ad hoc — it was then satisfied on a **separate** `OutputProvider`
  interface (`apps/cli/output-provider.ts`), leaving `MemoryProvider.abstract()` untouched (see addenda).
- No frozen invariant moves. The v1 slices (`ask` / `chat`) ship strictly within the model above; the
  wider conversational surface remains deferred (see **Deferred** and the addenda).

## Deferred — and what has since shipped

**Shipped since acceptance** (no longer deferred — see the addenda): the CLI `ask` (one-shot) and
`chat` (multi-turn) surfaces, the `OutputProvider.generate` capability, and the per-role
`MEMORING_ASK_*` config split.

**Still deferred (not built):**

- **The Web conversational surface.** A "chat with this Realm" surface hosted in the Web control panel
  (ADR-0010) is **not yet built**; only the CLI slices ship. MCP `memoring_search` remains the
  deterministic first rung.
- **Agentic / multi-hop associative retrieval** (the LLM iterating queries and chaining
  associations) — v1 is one-shot (§2).
- **A global cross-Realm "whole-self" twin** — its own future ADR; conflicts with the
  per-Realm invariant (§3).
- **Any write-back** beyond the read-only v1 — if added, candidate-only and user-confirmed
  (§5d); not designed here.
- **The output role's remote default.** Defaulting the output renderer to remote rides the
  `remote_ai` purpose that §7.3 / §7.5 / policy.v2 freeze as default-deny + scope opt-in, so it
  **would require a spec amendment** (a future ADR), not a build-time toggle — and **Addendum 1
  declined that path** (local-default + remote opt-in, no amendment sought). The output role is
  therefore OFF-by-default like any `remote_ai` consumer. This ADR flips no egress default (§5).
- **Per-Realm persona config.** The owner-defined voice/tone of §7 is not yet a configurable surface;
  any persona stays user-defined config, never a hard-coded category, when it lands.

## Addendum — settled egress posture (2026-06-24)

Recorded when the first implementation slice (the `memoring ask` CLI command) landed. This
**supersedes the earlier "the output role may default to remote" framing** of §5 (the deferred
intent), and settles the open question §5 left for a future amendment:

> Settled posture: the output layer is LOCAL by default (recommended); a remote/cloud model is
> configurable but DISCOURAGED and stays OPT-IN (clear disclosure that gated, secret-free excerpts
> leave the device). Because remote stays opt-in, this is already compliant with §7.3 / §7.5
> `remote-ai-default-off` — NO egress-table amendment is sought, and remote-default-on is explicitly
> not pursued. This is the same local-default + opt-in posture the loop layer already enforces.

Consequences for the build: the renderer simply aligns its existing egress determination with the
loop layer (`isLoopback` + the same `MEMORING_LLM_REMOTE_OPT_IN` gate) rather than introducing a new
default. The "remote-default-on would need a §7.3/§7.5/policy.v2 amendment" wording in §5 stands —
that path is now declined, not taken. The remote disclosure is calibrated to this layer (gated,
secret-free, in-scope excerpts leave, never raw history), and a local model is recommended.

## Addendum — multi-turn `chat` + per-role provider config (2026-06-24)

Recorded when the second implementation slice landed: the `memoring chat` multi-turn surface and the
per-role provider-config split named as a prerequisite in §6. Both ship strictly within the model
above; no frozen invariant moves.

- **`memoring chat` (multi-turn, §2/§3/§4/§5).** A conversation bound to exactly ONE Realm. The
  Realm + scope are resolved ONCE up front (fail-closed to Silence on ambiguity, like `search` /
  `ask`), so cross-Realm recall is impossible by construction (§3). Each turn reuses the exact `ask`
  guarantees turn-for-turn — gated retrieval via `searchRealm` (downstream of the Gate, never the
  raw store), strict grounding (0 results → no answer, no model call: Silence extended to the
  renderer, §4), answer-only-from-excerpts in the user's language, the signed `memoring:ouroboros`
  marker on every answer (§5c), and READ-ONLY (no Events / Claims / candidates, §5d). Conversation
  context is kept across turns for the model's phrasing only; every turn still performs its OWN
  gated retrieval. The shared safety code (grounding instruction + marker) lives in one place
  (`apps/cli/output-render.ts`) so `ask` and `chat` cannot drift.
- **Per-role provider config (§6 prerequisite, partial).** The output role reads a dedicated
  `MEMORING_ASK_BASE_URL` / `_MODEL` / `_API_KEY` / `_EGRESS` namespace, falling back per-variable to
  the loop's `MEMORING_LLM_*` when unset, so the conversational renderer can use a different model
  than the loop `MemoryProvider`. The `MemoryProvider` and `OutputProvider` interfaces are both
  **unchanged** (the `generate` capability already added by the `ask` slice on `OutputProvider`,
  separate from `MemoryProvider.abstract()`). The shared remote opt-in gate
  (`MEMORING_LLM_REMOTE_OPT_IN`) and the local-default / remote-opt-in posture are untouched — this
  split flips no egress default and seeks no §7.3 / §7.5 amendment.

Still deferred (unchanged): agentic / multi-hop associative retrieval, the global cross-Realm
"whole-self" twin, any write-back, the Web conversational surface, the remote-default-on amendment,
and per-Realm persona config.
