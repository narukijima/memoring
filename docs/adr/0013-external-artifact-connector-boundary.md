# ADR 0013 — External artifact connector boundary

- Status: Proposed / deferred. This ADR defines the boundary; it does not implement a connector.
- Date: 2026-06-28
- Scope: future intake for articles, papers, notes, PDF-derived Markdown, and similar external files.
- Relates to: Final Design evidence authority by origin, Detailed Design Gate predicate and event identity, Specification §7.3 egress table, ADR-0007 import-from-AI.

## Context

Memoring will eventually need to ingest external artifacts that are not host transcripts: articles, papers, local notes, PDFs converted to Markdown, and attached research files. These can be useful evidence, but only if they enter through the same intake and safety model as every other source.

The risk is treating a parsed Markdown summary, OCR result, or generated wiki page as canonical memory. That would bypass capture, make parser output look authoritative, and could launder Memoring-generated projections back into Claim evidence.

## Decision

External artifacts are a future Connector source whose normalized Events use `origin = external_artifact` only when the artifact is an actual external observation selected by the user. The connector must not ingest Memoring-generated projections such as `.memoring/context.md`, `.memoring/atlas/`, health reports, or ask artifacts as Claim evidence or reinforcement.

The required pipeline is:

1. **Capture raw first.** Store the original artifact bytes as Undiluted before parsing. Parser output is derived.
2. **Parse after capture.** Extract text/metadata into Events only after raw capture succeeds.
3. **Quarantine on parse failure.** If PDF/OCR/Markdown parsing fails or is ambiguous, create a QuarantineRecord and do not create Events.
4. **Assign Realm and scope explicitly.** Artifact intake must resolve a Realm and must not fall back to cross-Realm or global ingestion.
5. **Keep event_identity stable.** Use a source-stable artifact coordinate plus a content anchor for entries. Reprocess, parser upgrades, and OCR changes must not move evidence identity.
6. **Never bypass the Gate.** Search, Atlas, ask artifacts, WebUI views, and future exports must read external artifact Claims only through the existing Gate.
7. **No projection evidence.** wiki / atlas / health / ask artifact outputs are derived projections with `can_be_evidence=false`; re-importing them must not create independent evidence or reinforcement.
8. **Sensitivity stays event-level.** A secret span in a parsed artifact makes the Event secret; v0 does not add span-level redaction.

## Authority

`external_artifact` is one of the five independent-evidence origins, but it is not magic. A Claim still needs schema validation, sensitivity/scope validation, policy validation, and the per-kind evidence rules. An external article can support a fact; it cannot by itself confirm a user decision, constraint, or preference unless the existing per-kind rules allow it.

Memoring-generated artifacts are not `external_artifact`; they are derived output. Their authority is:

```text
authority: derived
can_be_evidence: false
source: post-gate projection or synthesis
```

## Implementation boundary

Do not implement a large connector in this ADR. A future implementation PR must include:

- golden fixtures for at least one text artifact and one parse-failure artifact;
- tests that parse failure creates Quarantine and no Event;
- tests that `.memoring/atlas/`, `.memoring/artifacts/`, and `.memoring/context.md` are excluded from manual artifact intake;
- tests that `origin=external_artifact` can support only allowed Claim kinds;
- tests that secret / unknown / unclassified / out-of-scope artifact-derived content does not pass search, context, Atlas, ask, MCP, or WebUI output.

## Consequences

This keeps the LLM Wiki / Atlas approach as a human read-only projection, not a canonical store. It also gives future external-file ingestion a clear path without changing the frozen v0 invariants: Gate First, Ouroboros, origin authority, event_identity stability, and Silence all remain unchanged.

