# ADR 0012 — Realm-local LLM defaults

- Status: Accepted
- Date: 2026-06-25
- Scope: CLI operator config, `realm.toml` non-secret LLM defaults, and provider
  resolution fallback order. No Realm/key/Gate invariant changes.
- Relates to: ADR-0002 (LLM memory provider), ADR-0003 (remote AI egress gate),
  ADR-0011 (output-layer LLM), Specification §5.1 (`realm.toml`).

## Context

ADR-0002 deferred the live wiring for provider/model/base URL selection. The first
implementation accepted only environment variables:

- `MEMORING_LLM_BASE_URL` / `MEMORING_LLM_MODEL` for the loop provider.
- `MEMORING_ASK_BASE_URL` / `MEMORING_ASK_MODEL`, falling back to `MEMORING_LLM_*`,
  for `ask` / `chat`.

That is workable for one-off commands, but it is not the right operator shape for
a local-first tool. A local model is part of the Realm's local operating setup,
not a shell preference. Users should not need to edit shell startup files just to
make `memoring ask` use a locally running OpenAI-compatible endpoint.

## Decision

Add a non-secret Realm-local LLM default in `realm.toml`:

```toml
[llm]
base_url = "http://127.0.0.1:11434/v1"
model = "gemma4:latest"
egress = "local"
```

Add CLI management:

```text
memoring config show
memoring config set local-model --base-url <loopback-url> --model <id>
memoring config unset local-model
```

`local-model` only accepts loopback URLs (`localhost`, `127.0.0.1`, `::1`) and
persists `egress = "local"`. Remote providers remain env-driven and still require
`MEMORING_LLM_REMOTE_OPT_IN=1`. API keys are never written to `realm.toml`.

Provider resolution order:

1. Per-command environment variables.
2. Realm-local `llm` defaults.
3. Existing fallback behavior:
   - loop provider: deterministic rule-based provider;
   - output provider: no answer model, so `ask` / `chat` print guidance and refuse
     to fabricate.

For `ask` / `chat`, `MEMORING_ASK_*` remains role-specific first, then
`MEMORING_LLM_*`, then Realm-local `llm`.

## Consequences

- Local model setup survives new shells and Codex invocations without shell
  startup edits.
- Env vars still work as a temporary override for testing or one-off provider
  swaps.
- The stored values are not secrets; they are local endpoint coordinates and model
  names. Keys stay out of config.
- No egress default changes. A loopback model is local; a remote model is still
  default-off and not persisted by `local-model`.
