# ADR 0002 — Multi-provider LLM memory provider (Mode B/C) and the pre-egress gate

- Status: Accepted (increment 1: provider boundary + pre-egress gate. Live wiring — CLI/config/keys/real backfill — deferred to increment 2.)
- Date: 2026-06-20
- Scope: claim/provider boundary (Basic Design §2.6/§8, Detailed Design §10.1), safety core (egress; Specification §7.3/§7.5), `MemoryProvider` interface

## Context

Real-data evaluation of v0's deterministic `RuleBasedProvider` (Mode A) showed it
extracts essentially zero durable memory from real coding transcripts. Across a
real ~/.claude corpus (1,262 user-origin events) it produced 375 candidates, of
which 374 were `constraint` and the top-ranked were pasted role/mission prompts;
preference/decision/fact/procedure never fired. Two structural reasons:

1. The five patterns are surface keyword regexes (`must`/`never`/`always`…) and
   the matched keyword is buried below the recorded `firstSentence` in 96.5% of
   hits, so the stored statement is unrelated task-framing.
2. The patterns are English-only (`\b` does not anchor on CJK). 53% of this
   user's turns contain Japanese and are invisible to Mode A by construction.

A language-specific fix (adding Japanese patterns) only widens a brittle surface
approach. The structural answer is an LLM classifier that is language-agnostic.
The `MemoryProvider` boundary (`abstract(inputs) → candidates`) was designed as
the drop-in swap point for exactly this (Mode B local / Mode C remote), but v0
shipped only Mode A and marked B/C as OUT.

**Safety finding that shapes this ADR:** `provider.abstract()` runs on RAW
decrypted Event text DURING the loop, BEFORE the output Gate. `policy.ts`'s
`remote_ai_processing` audience governs only OUTPUT (context pack / export).
There is no gate between a raw Event and the provider. So a remote LLM provider
added as a naïve drop-in would exfiltrate raw local history, bypassing the entire
§7.3 egress table — a raw-history leak, not a feature.

## Decision

**1. The `MemoryProvider` boundary evolves (interface change, authorized).**
`abstract` may now be async (`MaybePromise<AbstractCandidate[]>`) — a model call
is inherently async; sync providers (Mode A) are unaffected because the caller
awaits. A new required field `egress: 'local' | 'remote'` declares whether the
call leaves the device. `abstractEvents` and `runLoop` become async accordingly.
This touches a frozen interface and is therefore recorded here.

**2. Vendor-neutral LLM provider.** `LlmMemoryProvider` (in `@claim/llm-provider`)
implements `MemoryProvider` over an `LlmBackend` adapter (`complete(prompt) →
Promise<string>`). Provider/core code stays vendor-neutral; wire formats live in
`@integrations/llm/*`. The first adapter is `OpenAiCompatibleBackend`, which
covers OpenAI, DeepSeek, and any OpenAI-API server **including a local Ollama /
llama.cpp endpoint**; Anthropic (Claude) and Google (Gemini) adapters follow.
The prompt targets the observed failure directly (reject pasted role/mission
prompts and one-off task instructions; keep only cross-session-durable memory)
and is language-agnostic. Output is parsed defensively (kind ∈ canonical set,
non-empty statement, confidence clamped).

**3. Pre-egress sensitivity gate (the safety core of this ADR).** When
`provider.egress === 'remote'`, the caller (`extractor.ts`) forwards an Event to
`abstract()` only if it clears BOTH `allowedSensitivity(sensitivity,
'remote_ai_processing', 'standard')` AND `allowedSensitivityState(state,
'remote_ai_processing', 'standard')` — the SAME pair the output Gate checks
(`policy.ts`), not a parallel predicate. Consequence: `secret` / `unknown` (hard
floor), unconfirmed `confidential`, and any value still at `candidate`
determination-state are never sent off-device; only public/internal text whose
scope is `inferred`/`confirmed` can egress. A `local` provider (Mode A, or a
loopback LLM endpoint) is exempt — it never leaves the device and inherits the
loop's existing trust envelope.

**4. Authority and provenance.** The provider only PROPOSES; the validator/Gate
keep authority (CON-002) — an LLM candidate can never reach `confirmed`. The
candidate's `mode` maps to claim provenance (`created_by`), which drives the
validator's evidence bar: `inferred` (the default for LLM-derived patterns) →
`created_by:'ai'` → the `ai_inferred_pattern` bar (τ=0.85, min_evidence=2), so a
single model assertion does NOT consolidate until independently corroborated;
`explicit` (a model-identified explicit user statement) → `created_by:'rule'` →
the explicit bar, exactly as Mode A. `Derivation.model_provider` records the
egress class (`local`/`remote`) and `prompt_version` records the provider's
version, so off-device and LLM-derived derivations are auditable.

**5. Mode A is retained, demoted.** `RuleBasedProvider` stays as the always-on
deterministic fallback floor (LLM unavailable / not configured) and for
language-agnostic noise suppression — NOT extended with language-specific
patterns.

## Why this needs no change to the origin contract

The canonical `ORIGINS` (10 values) and the independent/non-evidence partitions
(`enums.ts`, ADR-4, §1.3.2/§4.12/G8) are untouched. The provider still only sees
`origin === 'user'` events (`extractor.ts` filter), so host-memory laundering
closure is intact. This ADR adds a *new* safety gate (pre-egress) and evolves the
provider signature; it does not weaken any existing invariant.

## Threat model — remote providers (Mode C), stated honestly

Protects against:
- `secret` / `unknown` / unconfirmed-`confidential` Event text ever reaching a
  remote model (pre-egress gate, reusing the Gate predicate).
- Silent default egress: a remote provider is never the default; nothing egresses
  unless a remote provider is explicitly constructed (and, in increment 2,
  explicitly enabled in config).
- A loopback URL that is actually a forwarding / subscription-bridging proxy:
  `MEMORING_LLM_PROXY` (CLI, unsupported path) forces egress=remote so the
  loopback→local heuristic cannot silently exempt off-device traffic from the gate.

Does **not** protect against:
- The third-party data handling a user opts into for the public/internal text
  that IS forwarded (subject to that vendor's terms) — this is the eyes-open
  trade of Mode C and can never be the default.
- Span-level secrets inside an otherwise public/internal event: v0 has no
  span-level redaction (OUT-014), so the unit of egress control is the whole
  Event. Secret-flagged events are withheld entirely, not surrogated.

## Consequences

- New async surface: `abstract` / `abstractEvents` / `runLoop` are async-capable.
  No behavior change for Mode A. 111 tests green (15 new), typecheck clean.
- `OpenAiCompatibleBackend` is implemented and unit-tested via an injected
  `fetchImpl`; no live network call ships enabled. Mode A remains the default, so
  this increment cannot egress any data on its own.

## Deferred (explicitly not in this change)

- **Live wiring (increment 2):** realm config to select a provider/model/base_url,
  API key sourcing from env / OS keychain (never persisted in config), a CLI
  opt-in, and the first real backfill run — all cost- and privacy-incurring, so
  gated on explicit user go.
- Anthropic and Gemini adapters (same `LlmBackend` boundary).
- Batched `abstract` calls (the signature is already batch-capable; the caller is
  still per-event).
- **Origin-aperture widening** — feeding `tool_result` / `command_result` /
  `file_diff` to `abstract` for the kinds §3.3.1 permits (fact / project_context /
  procedure), keeping assistant/host/system excluded so G8 holds. This touches the
  ADR-4 invariant and will be its own ADR.
- A non-determinism strategy for LLM-backed integration tests (golden transcripts
  / recorded responses) beyond the deterministic mock-backend unit tests.
