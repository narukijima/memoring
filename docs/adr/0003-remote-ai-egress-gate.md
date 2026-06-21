# ADR 0003 — Remote-AI egress: Seal-aware pre-egress gate + default-off opt-in

- Status: Accepted
- Date: 2026-06-21
- Scope: safety core (egress; Specification §7.3 `remote-ai-default-off` / §7.5 scope opt-in), `claim/extractor.ts` pre-egress gate, `apps/cli/provider.ts` provider resolution
- Supersedes: ADR 0002 §3 ("Pre-egress sensitivity gate") and its threat-model claims

## Context

ADR 0002 introduced a pre-egress gate for `remote` providers that checked the
sensitivity **value** and **determination-state** only — `allowedSensitivity` +
`allowedSensitivityState` for `remote_ai_processing` — and the code comments
asserted it "mirror[s] the output Gate exactly". A multi-reviewer audit (workflow
+ Codex) found that claim is false and the gap is real:

1. **No suppression (Seal) parity.** The output Gate (`policy.ts`) is a ~12-clause
   AND that also enforces `not_suppressed` (Seal), `not_redacted`, `not_deleted`,
   `not_conflicted`. The remote pre-egress filter enforced none of them, and the
   loop runs `abstractEvents` (the network call) BEFORE `consolidatePending`/the
   validator's Seal check — so the only downstream Seal check is strictly *after*
   the egress already happened. A user who ran `memoring forget` and later restated
   the same preference in a new session could have that raw text sent to the
   external model (a new `event_identity` slips the identity Seal; the content
   Seal was never consulted pre-egress).

2. **No default-off / scope opt-in.** Spec §7.3 `remote-ai-default-off` requires
   `default: deny` and `scope_opt_in: true` for `purpose=remote_ai`. The
   implementation enabled remote egress purely from `MEMORING_LLM_BASE_URL`
   (+ a non-loopback host or `MEMORING_LLM_EGRESS=remote`), with no explicit
   opt-in and no scope axis — so every classified user event from every connected
   project was eligible to be sent off-device on each loop tick.

## Decision

**1. The pre-egress gate is Seal/suppression-aware.** For `provider.egress ===
'remote'`, `extractor.ts` now additionally requires, per event:
`event.status === 'active'` (redacted/deleted withheld), no active `event_identity`
Seal, and no active `pattern` Seal matching the text — in addition to the existing
sensitivity value + determination-state floor. This brings the remote path's
suppression behaviour in line with the output Gate (`not_suppressed` /
`not_redacted`). `secret`/`unknown` remain hard-floored; only `public`/`internal`
text at `inferred`/`confirmed` state, that is not forgotten/sealed/redacted, can
egress. The false "mirror the output Gate exactly" comments were corrected.

**2. Remote AI is default-OFF, gated on an explicit opt-in.** Provider resolution
(`apps/cli/provider.ts`) computes the **effective** egress the same way the backend
does (so a cloud URL with no explicit `MEMORING_LLM_EGRESS` is correctly treated as
remote). If the effective egress is `remote` and `MEMORING_LLM_REMOTE_OPT_IN` is not
truthy, Memoring **refuses the remote provider and falls back to the on-device
rule-based provider (Mode A)**, with a loud warning that names the env var and the
local-model alternative. A loopback/local model needs no opt-in. The unsupported
`MEMORING_LLM_PROXY` path still forces `remote`, so it is also subject to the opt-in.

## Why this is conformance, not an invariant change

The change brings the implementation toward the frozen spec (§7.3/§7.5): it adds
checks (default-deny + Seal parity), never relaxes one. `secret`/`unknown` were
already withheld and remain so. The `MemoryProvider` interface is unchanged. The
existing `origin === 'user'` filter (host-memory-laundering closure, ADR 0002 / G8)
is intact.

## Threat model update

Now also protects against:
- Forgotten/sealed/redacted raw text reaching a remote model (the pre-egress gate
  consults `event_identity` and `pattern` Seals and event status).
- Silent remote egress from configuration alone: remote is default-deny and
  requires an explicit, named opt-in.

Still does **not** protect against (carried over from ADR 0002):
- The vendor's handling of the public/internal text the user opts in to forward.
- Span-level secrets inside an otherwise public/internal event (OUT-014; the unit
  of egress control is the whole Event).

## Deferred (explicitly not in this change)

- **Per-scope remote opt-in.** v0 implements opt-in at realm granularity: the opt-in
  permits remote processing of all connected scopes, rather than a per-label
  allow-list. `content_signature`-Seal evaluation against raw event text is also out
  of scope (content Seals are keyed on (kind, normalized statement), not raw text);
  the identity + pattern Seals cover the reachable cases via the normal loop, which
  only ever abstracts freshly-normalized events. A per-scope `remote_ai_opt_in`
  allow-list and content-Seal-aware egress are a future ADR.
- **Full DEK rekey** (re-encrypting the payload under a fresh DEK) — see ADR-0001 /
  the rekey work; KEK rotation is implemented, payload rekey is deferred.
