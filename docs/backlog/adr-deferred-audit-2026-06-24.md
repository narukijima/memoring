# ADR / Spec Deferred-Items Audit — 2026-06-24

> **Point-in-time snapshot** (not a living doc). Read-only audit of every *decided-but-not-yet-
> implemented* item across the 11 ADRs (`docs/adr/0001…0011`) and the frozen v0 spec
> (`docs/v0/en/*`), each status **verified against the actual code** under `apps/` and
> `packages/`.
>
> - **Baseline:** `origin/main` @ `0e11b3e` (audited in a pinned worktree, isolated from other
>   sessions' uncommitted work).
> - **Method:** 14 extractor agents (one per ADR + 2 spec sweeps + the AGENTS.md "what NOT to
>   do" list) → an **adversarial verification pass** that tried to *refute* every
>   `not implemented` / `partial` status by hunting for implementing code → a code-marker grep
>   and a completeness critic. 122 agents total. Every `❌`/`🟡` cites the grep that proves
>   absence or the `file:line` that proves partial presence.
> - **Scope:** this report is the only file added; no code, ADR, or spec was modified.

## Executive summary

Audited **153 distinct decided items** (after folding 10 AGENTS.md restatements into their
canonical spec `OUT-0xx` IDs — see the crosswalk note below):

| Status | Count | Meaning |
|---|---|---|
| ✅ Implemented | **58** | Shipped and code-verified (file:line). |
| 🟡 Partial | **13** | Some of the decided scope shipped; remainder cited as absent. |
| ❌ Not implemented | **82** | Absence proven by grep. |
| **Total** | **153** | |

The `❌ Not implemented` set divides into two materially different kinds — this distinction is the
backbone of the backlog:

- **60 deferred / roadmap items** — an ADR "Deferred"/"future" section or a spec
  `v0.1` tag plans to build these. These are the actionable backlog (**Group A** below).
- **22 intentionally out-of-scope items** — the spec `OUT-0xx`/`NFR` boundaries and the
  AGENTS.md §82-99 "what NOT to do" list. Per AGENTS.md §84, **resuming any of these requires a new
  ADR**; their *absence is the desired state* (**Group B** below). The audit confirmed none have
  leaked into the code.

**Verification changed 2 statuses** (both `partial`/`not_implemented` → `implemented`): the
ADR-0001 "Deferred" `key enable-passphrase` capability actually ships as `memoring rekey
--passphrase` (ADR list is stale), and spec `OUT-017`'s "fix the constraints, do not build the
dataset builder" decision is fully honored in code. See [Appendix A](#appendix-a--verification-overrides).

### The 5 biggest unbuilt blocks

1. **Web control panel — almost entirely unbuilt (ADR-0010, 15 of 16 items `❌`).** The plan-only
   ADR describes a read-only loopback browser panel (Phase 1: Host-header allowlist, Origin
   allowlist, per-session capability token, token-on-every-read, Realm selector, CSP) and an
   owner write surface (Phase 2: forget/redact, Realm create/connect/delete, set-active, passphrase
   entry, import review). Only the *baseline invariant* "don't change the Audience/Gate read path"
   (`ADR0010-15`) is satisfied — because nothing was built yet. Phase 2 is blocked on a Phase-1
   CLI audit-gap closure (`ADR0010-11`).
2. **Distribution & install UX — all 7 items `❌` (ADR-0009).** npm publish (Phase 1), Homebrew
   (Phase 2), self-contained binary + `curl | sh` (Phase 3), ethos constraints on installers, and
   Windows signing. The whole phased rollout is **blocked on a native-dependency / SQLite-engine
   ADR** (`ADR0009-5`) that has not been written — `better-sqlite3` currently constrains the
   supported Node range and any single-binary packaging.
3. **Conversational twin beyond `ask` (ADR-0011, 7 items `❌`).** The v1 `memoring ask` one-shot
   surface shipped and is fully verified (`ADR0011-1…8` `✅`). The rest is deferred: the `memoring
   chat` multi-turn surface, agentic/multi-hop associative retrieval, the cross-Realm "whole-self"
   twin, any write-back beyond read-only, the remote-default-on egress amendment, per-Realm persona
   config, and the per-role `MEMORING_ASK_*` config split.
4. **LLM-memory Mode B is built-but-dormant (ADR-0002).** The interface, the vendor-neutral
   provider/adapter, the OpenAI-compatible backend, and the pre-egress gate all shipped and are
   verified (`ADR0002-1…7` `✅`). What is deferred is the *live wiring* (`ADR0002-8` 🟡:
   provider/model/base_url selection + CLI opt-in + a real backfill run), API-key sourcing
   (`ADR0002-9` 🟡), the Anthropic/Gemini adapters (`ADR0002-10`), and origin-aperture widening
   (`ADR0002-12`). The engine exists; it is not yet plugged in for real use.
5. **The association / semantic-recall roadmap (ADR-0005 B3/B4 + spec v0.1).** The FLOOR-track
   structural guarantees and the B5 associative proposer shipped (`✅`), but the salience-binding
   frontier is **wired-but-dormant** (`ADR0005-6`, `ADR0005-7` 🟡: `last_recalled_at`, recall
   counter, supersedes-chain feeding `reinforcement()`), and the **local embedding / vector index**
   that would strengthen semantic search (`SPEC-PLAN-9.2-embed`, surfaced by the completeness
   critic) is the one v0.1 roadmap pillar absent from every other section.

### How to read this report

- **Status:** `✅` implemented · `🟡` partial · `❌` not implemented. Every `❌`/`🟡` row's evidence is
  the actual grep (proof of absence) or `file:line` (proof of partial presence) the verifier ran.
- **Kind** (Notes prefix): `[roadmap]` = a Deferred/future/`v0.1` item that is planned;
  `[out-of-scope]` = decided NOT to build in v0, resuming needs a new ADR (AGENTS.md §84).
- **Evidence in the tables is clipped** for readability; the full verifier evidence is in the
  [per-source sections](#per-source-detail).
- Source IDs (`ADR-00NN §x`, `OUT-0xx`, `NFR-0xx`, `SPECP-*`) point back to the exact decision.

> **De-duplication note.** The v0 out-of-scope set is stated three times in the repo — spec
> `OUT-001…022` (`requirements.md`), AGENTS.md §82-99, and (for the forward-looking subset)
> ADR-0004 "v0.1 candidates". This report treats the spec `OUT-0xx` IDs as canonical and folds the
> 10 AGENTS.md restatements into them (annotated `[≡ NOTODO-n AGENTS.md §82-99]` in the Source
> column). ADR-0004 §1-6 are kept as separate rows because they carry the ADR's *roadmap* framing;
> their spec-`OUT` twins are cross-referenced in Notes.

## Consolidated backlog (everything decided but not yet — or only partly — built)

### Group A — Deferred / roadmap (actionable backlog)

60 not-implemented + 13 partial items that an ADR or the spec plans to build. Sorted by suggested priority.

| ID | Item | Source | Status | Evidence (clipped) | Blockers | Size | Priority | Notes |
|---|---|---|---|:--:|---|:--:|:--:|---|
| `ADR0005-6` | B3 separate recall-event signal (last_recalled_at + recall counter) feeding reinforcement WITHOUT folding into valid_recall_count | ADR-0005 B3 (lines 122-127) | 🟡 | BUILT: packages/claim/recall.ts implements a separate claim_recall_count:<id> meta key (recall.ts:10-23), writes last_recalled_at (recall.ts:47) and … | none | M | P1 | [roadmap] The semantic boundary the ADR demands (separate signal, never overwrite valid_recall_count) is correctly built and unit-tested, but the counter is ne… |
| `ADR0005-7` | B4 salience binding frontier: drive the wired-but-dormant signals (last_recalled_at, recall/age inputs to reinforcement(), supers… | ADR-0005 B4 (lines 129-141); Not-in-ADR roadmap lines 210-214 | 🟡 | supersedes IS now driven in production (packages/claim/extractor.ts:191,220 sets predecessor id on supersede during consolidation) — contradicting th… | ADR0005-6 | L | P1 | [roadmap] ADR text is now partly stale: supersedes[] is populated and an associative proposer exists. Remaining gap is that recall/age/pin signals are computed… |
| `ADR0009-2` | Phase 1 — publish to npm (flip private→false + npm publish) | ADR-0009 §Decision table Phase 1; §Deferred bullet 1 | ❌ | Absence: `grep -nE '"(private\|publishConfig\|provenance)"' package.json` → package.json:4 `"private": true`, no publishConfig, no provenance field. Ph… | none technically; ADR-0009 ties timing to v1 cut | S | P1 | [roadmap] Cheapest rung, already specified by ADR-0008. Phase 1 still leaves the native-dep reliability gap (ADR0009-4). [verify ✓: Confirmed not_implemented. … |
| `ADR0009-5` | Native-dependency / SQLite-engine ADR (options a/b/c) — gates Phases 2-3 | ADR-0009 §Gating prerequisite; §Deferred bullet 2 | ❌ | Absence of resolution: `grep -rnE 'better-sqlite3\|node:sqlite' apps packages` → only packages/storage/encrypted-db.ts:8 `import Database from 'better… | none — this is the gating decision itself | L | P1 | [roadmap] Contract-level decision (storage invariants §5.1 / ADR-0001). Explicitly deferred to its own ADR; must precede Phase 2. This is the true critical-pat… |
| `ADR0010-1` | Host header allowlist on EVERY request, fail-closed (DNS-rebinding gate) | ADR-0010 §1 / §6 Phase 1 | ❌ | grep -niE 'origin\|host header\|x-forwarded\|rebind' apps/server/main.ts → no matches. Handler at apps/server/main.ts:646 does method check then routes … | none | S | P1 | [roadmap] ADR calls this closing a pre-existing read-only gap; sequenced first in phase 1. [verify ✓: Confirmed not_implemented via independent search across a… |
| `ADR0010-11` | Close CLI audit gap: audit realm new/use/rename + connect at shared orchestration layer (phase-2 prerequisite) | ADR-0010 §1 / Consequences / §6 Phase 2 | ❌ | Only realm_rm audits: apps/cli/commands/realm.ts:211 is the sole appendAudit; realm new/use/rename/connect emit none. No shared audited orchestrator … | none (pure CLI/core change; gates ADR0010-9) | M | P1 | [roadmap] ADR mandates audit live in shared creation orchestrator, NOT in addRealm/setCurrent primitives (would emit phantom records via ensureLegacyRegistered… |
| `ADR0010-2` | Origin allowlist when present (cross-site fetch defense) | ADR-0010 §1 | ❌ | grep -rniE 'origin' apps/server → no header check (only CSS/JS string hits). No Origin comparison in apps/server/main.ts. | ADR0010-1 (same pre-routing gate block) | S | P1 | [roadmap] Reject non-loopback Origin when present; token covers Origin-absent case. [verify ✓: Confirmed not_implemented. No Origin header check, no allowlist,… |
| `ADR0010-3` | Per-session capability token (random, in-memory, fragment delivery, constant-time compare) | ADR-0010 §1 / §6 Phase 1 | ❌ | grep -rniE 'token\|capability\|location.hash\|#t=\|fragment\|timingSafeEqual\|randomBytes\|crypto' apps/server → no matches. No token generation, delivery, … | none | M | P1 | [roadmap] 0600 file persistence optional+OFF by default; fragment-only delivery preferred per §1. [verify ✓: Confirmed not_implemented. Per-session capability … |
| `ADR0010-4` | Token required on every /api/* read+write; GET / token-exempt but still Host-checked | ADR-0010 §1 (Reads require the token too) | ❌ | apps/server/main.ts:665 (/api/scopes) and :673 (/api/memories) serve with no auth; 401 path absent (grep '401' apps/server → none). | ADR0010-3 (token must exist), ADR0010-1 (Host gate) | S | P1 | [roadmap] Missing/invalid token on /api/* = hard 401 regardless of method/Origin. [verify ✓: Confirmed not_implemented. Neither token enforcement, 401 path, no… |
| `ADR0001-4` | export/import --bundle (single-file) and --encrypted (age/passphrase) backup | ADR-0001 Deferred | 🟡 | EXISTS: apps/cli/commands/export.ts:30 `export --purpose backup <dir>` (directory copy; export.ts:71 encryption='passphrase'\|'local_key_included', se… | none | M | P2 | [roadmap] Directory backup/restore shipped; the deferred *single-file bundle* and *--encrypted (age)* surface for protecting a self-decrypting local backup is … |
| `ADR0002-8` | Live wiring (increment 2) — provider/model/base_url selection + CLI opt-in + real backfill run | ADR-0002 Deferred (increment 2) | 🟡 | PRESENT: apps/cli/provider.ts:18 resolveProvider() reads MEMORING_LLM_BASE_URL/MODEL/EGRESS, enforces remote default-off + MEMORING_LLM_REMOTE_OPT_IN… | none | M | P2 | [roadmap] Deferred item largely shipped, but the mechanism is env-based not realm-config-based as the ADR phrased it; functionally equivalent opt-in/selection.… |
| `ADR0002-9` | API key sourcing from env / OS keychain (never persisted in config) | ADR-0002 Deferred (increment 2) | 🟡 | PRESENT (env, never-persisted): apps/cli/provider.ts:64 apiKey: process.env.MEMORING_LLM_API_KEY; never written to RealmConfig (realm.ts:31 has no ke… | none | M | P2 | [roadmap] Env path shipped and is non-persisted as required; the OS-keychain half of the deferred item is not built (comment-only). [verify ✓: Confirmed partia… |
| `ADR0003-3` | Per-scope (per-label) remote_ai_opt_in allow-list — replace realm-granularity opt-in with per-scope allow-list | ADR-0003 §Deferred | ❌ | grep -rn 'remote_ai_opt_in\|remoteAiOptIn\|perScopeOptIn\|scopeOptIn\|optInScopes\|optInLabels\|allow-list' apps packages → only a comment at packages/clai… | none | M | P2 | [roadmap] Intentional deferral — ADR text marks it as a future ADR; needs ADR to resume. Spec §7.5 scope opt-in is the target. [verify ✓: Confirmed not_impleme… |
| `ADR0003-4` | Content-Seal-aware egress: evaluate content_signature Seals against raw event text in the pre-egress gate | ADR-0003 §Deferred | ❌ | content_signature Seals exist generally (packages/claim/seal.ts:30 contentSealSignature; packages/security/redaction.ts:196 createSealRule 'content_s… | none | M | P2 | [roadmap] Intentional — ADR notes content Seals are keyed on (kind, normalized statement) not raw text; identity+pattern Seals cover reachable loop cases. Futu… |
| `ADR0004-3` | HTTP MCP beyond localhost (networked / remote MCP) | ADR-0004 §3 | ❌ | Proof of absence: packages/retrieval/mcp.ts exposes only runStdioMcp (mcp.ts:187) as transport; grep for 'mcp.*http\|sse\|streamable\|createServer.*mcp\|… | none | M | P2 | [roadmap] Intentional defer. Boundary: same Gate on every response, no write beyond add_memory_candidate, off-localhost needs localhost-equiv authn/authz PLUS … |
| `ADR0004-7` | Connector expansion: Codex, manual-import dir, generic JSONL, Markdown transcript | ADR-0004 §7 | ❌ | None of the four named connectors exist. Registry (packages/intake/registry.ts) holds exactly claude_code + import_ai. grep -rni 'codex' packages/ ap… | none | M | P2 | [roadmap] The import_ai connector (packages/integrations/import-ai/index.ts, ADR-0007) is a SEPARATE foreign-AI paste connector — NOT one of ADR-0004's four. B… |
| `ADR0005-12` | Roadmap deferral: HOW to build the association/binding frontier (recall counter, supersedes chain, associative proposer, co-occur… | ADR-0005 Not-in-ADR (lines 210-214) | 🟡 | Recall counter (recall.ts) and supersedes chain (extractor.ts:191) and one-hop proposer (associate.ts) are built; co-occurrence and semantic-recall e… | ADR0005-6 | L | P2 | [roadmap] Intentional staged delivery: supersedes-link + proposer shipped; co-occurrence/semantic association still deferred behind their own floor-clearing AD… |
| `ADR0009-3` | Phase 2 — Homebrew formula / tap (brew install) | ADR-0009 §Decision table Phase 2; §Deferred bullet 1 | ❌ | Absence: `find . -not -path '*/node_modules/*' \( -iname '*.rb' -o -ipath '*HomebrewFormula*' -o -iname '*formula*' \)` → no matches in repo. | ADR0009-5 (native-dependency strategy ADR must resolve firs… | M | P2 | [roadmap] Gated by the SQLite-engine decision per the ADR. [verify ✓: Confirmed not_implemented. Aggressive search (synonyms: brew, tap, formula, goreleaser, H… |
| `ADR0009-7` | Ethos constraints on installers (no init/no ~/.memoring touch, no telemetry, verifiable artifacts) | ADR-0009 §Distribution must not erode the ethos | ❌ | Vacuous — no installer exists to carry the constraints. `grep -rniE 'telemetry\|analytics' apps packages` → zero (no telemetry present in code today, … | ADR0009-2 / ADR0009-4 (constraints attach to the not-yet-bu… | S | P2 | [roadmap] Codebase is currently telemetry-free, which aligns with the constraint, but the constraint is unenforced because there is no installer artifact yet. … |
| `ADR0010-0` | Headline: turn read-only web panel into owner write surface (plan-only ADR) | ADR-0010 Status/§Decision | ❌ | ADR line 3 'plan only — no code or behaviour change ships'. Server still read-only: apps/server/main.ts:646-647 rejects all non-GET with 405; routes … | none (it is the umbrella; sub-items below) | L | P2 | [roadmap] Intentional — ADR is a boundary-fixing plan, no code by design. Tracks the whole effort. [verify ✓: Confirmed not_implemented. Independent search agr… |
| `ADR0010-10` | Phase 2: import paste→review→promote/reject on dedicated owner-only review endpoint + egress test | ADR-0010 §3 / §6 Phase 2 | ❌ | grep -rniE 'listImportedCandidates\|ingestImport\|promoteImportedClaim\|candidate endpoint' apps/server → none (the :418 'candidate' hit is a JS array.f… | ADR0010-3/4 (token is SOLE guard on candidate plaintext), A… | M | P2 | [roadmap] Highest correctness risk per ADR: candidate plaintext has no Gate/audience filter (import-from-ai.ts:219), only the token guards it. Phase 2 MUST add… |
| `ADR0010-5` | CSP on GET / shell (default-src 'self', bootstrap nonce only) | ADR-0010 §1 (token storage / CSP) | ❌ | grep -rniE 'content-security-policy\|default-src\|csp\|nonce' apps/server → no matches. GET / shell response sets no CSP header. | ADR0010-3 (nonce pairs with bootstrap that reads token frag… | S | P2 | [roadmap] Bounds same-origin XSS token-theft introduced by phase-2 candidate rendering. [verify ✓: Confirmed not_implemented via independent search. The only H… |
| `ADR0010-6` | Realm selector: list Realms + active marker + key_mode, view-switch by explicit id (no setCurrent write) | ADR-0010 §4 / §6 Phase 1 | ❌ | Server opens one fixed Realm: apps/server/main.ts:621 openRealmLocal(ROOT). grep 'listRealms\|getCurrent\|openResolvedRealm\|setCurrent' apps/server → n… | ADR0010-3/4 (selector route is /api/*, needs token) | M | P2 | [roadmap] View-switch must use openResolvedRealm({realm:id}); avoids unlocked setCurrent race (Ctx fact 1). [verify ✓: Refute attempt failed. The selector prim… |
| `ADR0011-9` | `memoring chat` multi-turn surface (dedicated later-phase output surface) | ADR-0011 §Deferred 'a dedicated memoring chat surface is a later phase' | ❌ | grep -rni "memoring chat\|cmdChat\|chatRealm\|'chat'\|\"chat\"" over apps+packages returned nothing; main.ts has only 'ask' case, no 'chat' | none (builds on ADR0011-1/7 already shipped) | M | P2 | [roadmap] Intentional — next phase per Addendum/MEMORY. v1 deliberately one-shot via `ask`. [verify ✓: Confirmed not_implemented. v1 deliberately ships one-sho… |
| `SPEC-PLAN-9.2-ingest` | v0.1 roadmap: Ingesting ChatGPT/Claude/Gemini exports (broaden supported AI tools) | spec project_plan.md:204-206 §9.2 (v0.1 and Beyond); requirements.md:39 | 🟡 | Paste-based import pulled forward into v0 via ADR-0007: integrations/import-ai/index.ts parses Claude (parseClaude:88) and Gemini (parseGemini:107) f… | none | L | P2 | [roadmap] Roadmap item partially realized as manual paste import (Claude+Gemini); ChatGPT-specific parsing and broader live-connector coverage remain deferred.… |
| `SPECP-006` | Real-time capture via hooks / MCP events / app-server (event-source ingest) | design_final §10 (memoring_design_final.md:891 'Event source hooks / MCP events. Not requ… | ❌ | Ingest is filesystem watch/backfill only. apps/daemon/main.ts:4 wraps cmdWatch; packages/intake/types.ts:78 Connector.read does 'backfill = from 0; w… | none | L | P2 | [roadmap] v0 ships FS-watch capture; hook/MCP/app-server push-ingest is the deferred concrete capability. Note: the READ-side MCP (packages/retrieval/mcp.ts) e… |
| `SPECP-007` | Codex local-session Connector (v0.1 roadmap connector #2) | design_final §roadmap (memoring_design_final.md:401-405, connector list 1-4) | ❌ | Connector registry has only claude-code (FS capture) + import-ai (paste). packages/intake/registry.ts:7-10 REGISTRY = {claude-code, import-ai}; packa… | none | M | P2 | [roadmap] Roadmap lists 4 connectors (Claude Code, Codex, manual-import dir, generic JSONL/MD). Codex connector is a concrete deferred capability, distinct fro… |
| `ADR0001-5` | OS keychain / Secure Enclave wrapping of key.json (macOS Keychain, Linux Secret Service, Windows DPAPI) | ADR-0001 Deferred | ❌ | grep -rni 'keychain\|secure.enclave\|dpapi\|secret.service\|libsecret\|security-framework\|keytar' apps packages --include=*.ts -> only openai-compatible.t… | none | L | P3 | [roadmap] Per-platform native integration explicitly deferred for later revisit; mitigated today by FileVault/--passphrase guidance in ADR threat model. [verif… |
| `ADR0001-6` | Device pairing, multi-device sync, daemon-/UI-premised auth | ADR-0001 Deferred | ❌ | grep -rni 'device.pair\|pairing\|multi-device\|multidevice\|device-id\|daemon.*auth' apps packages --include=*.ts -> no matches (sync hits are only restor… | ADR0001-5 (keychain) likely a prerequisite for device-bound… | L | P3 | [roadmap] Carry-not-sync is the deliberate v0 posture (restore.ts:7-8). Daemon/UI auth ties into ADR-0010 web panel work, not key management v0. [verify ✓: Con… |
| `ADR0002-10` | Anthropic (Claude) and Google (Gemini) LLM-memory backend adapters | ADR-0002 Decision 2 + Deferred | ❌ | packages/integrations/llm/ contains ONLY openai-compatible.ts (ls). grep -niE 'anthropic\|gemini\|generativelanguage\|x-api-key' over apps+packages (exc… | ADR0002-3 (LlmBackend boundary — already shipped) | M | P3 | [roadmap] Intentional defer. The Gemini/Claude matches are the unrelated import-from-AI feature, not memory backends. [verify ✓: Confirmed not_implemented. Eve… |
| `ADR0002-12` | Origin-aperture widening — feed tool_result/command_result/file_diff to abstract for fact/project_context/procedure | ADR-0002 Deferred | ❌ | packages/claim/extractor.ts:120 `if (event.origin !== 'user') continue;` still restricts abstraction to user-origin only. grep 'tool_result\|command_r… | none | L | P3 | [roadmap] Intentional defer — touches the ADR-4/G8 invariant and the ADR says it needs its own ADR to resume. [verify ✓: Confirmed not implemented. Notably the… |
| `ADR0002-13` | Non-determinism strategy for LLM-backed integration tests (golden transcripts / recorded responses) | ADR-0002 Deferred | ❌ | grep -niE 'golden\|recorded\|cassette\|nock\|fixture' over packages+apps finds no LLM response-recording harness (only unrelated 'recorded KDF params' cr… | ADR0002-10 (more adapters make recorded fixtures more valua… | M | P3 | [roadmap] Deterministic mock-backend unit tests exist; the 'beyond mock' golden/recorded-response layer is not built. [verify ✓: Confirmed not_implemented. Det… |
| `ADR0003-5` | Full DEK rekey — re-encrypt DB blob + object store payload under a fresh DEK (vs. KEK rotation, which is shipped) | ADR-0003 §Deferred (DEK rekey, ADR-0001) | ❌ | KEK rotation IS shipped: packages/security/key-lifecycle.ts:228 rekeyPassphrase (envelope re-encryption of the DEK only), wired via apps/cli/commands… | none | L | P3 | [roadmap] Intentional deferral, cross-refs ADR-0001 rekey work. Heavy: full payload re-encryption of DB + object store. [verify ✓: Confirmed not_implemented. K… |
| `ADR0004-1` | AI-native Collections view (AI-themed read model over recall) | ADR-0004 §1 | ❌ | Proof of absence: grep -rniE 'collections?[-_ ]?view\|collectionsView\|aiCollection' packages/ apps/ --include=*.ts → 0 hits. Also grep -niE 'group\|the… | none | M | P3 | [roadmap] Intentional defer; admissible only behind its own ADR (read-only projection through the same Gate, AI may only suggest groupings as candidates, never… |
| `ADR0004-2` | Distributed Realm / encrypted metadata sync across machines | ADR-0004 §2 | ❌ | Proof of absence: grep -rniE '\bsync\b\|replicaManifest\|multi.?device\|root_hash.*sync\|liveSync' packages/ apps/ --include=*.ts (minus fsync/async nois… | none | L | P3 | [roadmap] Intentional defer (NFR-032 local-first, no first-party sync; NFR-003/CON-013 no per-domain key boundary inside a Realm). Boundary: no encryption boun… |
| `ADR0004-4` | Recall evaluation dashboard (UI/reporting over recall-quality metrics) | ADR-0004 §4 | ❌ | Dashboard absent: grep -rniE 'dashboard' packages/ apps/ --include=*.ts → 0 hits. The protected MEASUREMENT half DID ship as a test harness (not a se… | none | S | P3 | [roadmap] Per ADR §Consequences the eval harness (safety-relevant part) lands in v0 as CI test; only the presentation dashboard is deferred. Boundary: a dashbo… |
| `ADR0004-5` | Live multi-device sync (real-time Realm replication) | ADR-0004 §5 | ❌ | Proof of absence: grep -rniE 'multi.?device\|liveSync\|realtimeSync\|ReplicaManifest\|root_hash.*sync' packages/ apps/ --include=*.ts → 0 hits. apps/cli/… | ADR0004-2 (shares the sync/server-of-record machinery) | L | P3 | [roadmap] Explicitly prohibited in v0 (NFR-032). Boundary: carry-not-sync — backup_export → user transport → restore of a self-contained client-side-encrypted … |
| `ADR0004-6` | Cloud-hosted Memoring service (server-side Realm storage/processing) | ADR-0004 §6 | ❌ | Proof of absence: no hosted backend; grep -rniE 'cloud\|zero.?knowledge\|rclone\|R2' packages/ apps/ --include=*.ts → only comment strings (e.g. apps/cl… | ADR0004-3 (networked surface), ADR0004-2 (server-of-record/… | L | P3 | [roadmap] Intentional defer; inverts the local-first/sovereign premise. Boundary: if ever offered, zero-knowledge carrier of encrypted archives only (ciphertex… |
| `ADR0004-8` | v0 scope correction: v0 ships exactly ONE connector (Claude Code) | ADR-0004 §7 (scope correction) | 🟡 | The original claude_code connector is present and registered (packages/integrations/claude-code/index.ts:20; registry.ts). But the 'exactly ONE' asse… | none | S | P3 | [roadmap] Documentation drift, not a code defect: ADR-0004's 'one connector' line is a v0 snapshot superseded by ADR-0007 (import_ai). No action needed beyond … |
| `ADR0005-10` | Self-extension forcing function: the first new structure (a link table, if/when added) must inherit the forget cascade by constru… | ADR-0005 resolved tension (lines 167-176) | ❌ | No standalone link/edge table exists. grep -rn 'link' packages/storage/schema-ddl.ts and grep for edge/link tables returns no dedicated link table — … | none | M | P3 | [roadmap] Intentional / conditional: the ADR scopes this to a future link table that does not yet exist. No defect today — supersedes lives on the Claim and di… |
| `ADR0006-10` | Deferred: Web/app UI for switching Realms | ADR-0006 §Deferred | ❌ | apps/server/main.ts:7 binds single fixed `const ROOT = process.env.MEMORING_HOME`; grep -n 'listRealms\|registry\|realm use\|switch\|/realm' apps/server/… | none | L | P3 | [roadmap] Intentionally deferred. Web panel is read-only single-Realm (ADR-0010); multi-Realm switch UI not built. [verify ✓: Confirmed not_implemented. Realm … |
| `ADR0006-11` | Deferred: Cross-Realm features (search/context/listing-as-recall) | ADR-0006 §Deferred + §Consequences | ❌ | grep -rniE 'cross.?realm\|crossRealm' apps packages -> only a comment in packages/intake/identity.ts:4 ('never ... across Realms'); no cross-Realm sea… | none | L | P3 | [roadmap] Intentional — explicitly out of v0; would need a new ADR to resume. [verify ✓: Confirmed not_implemented. No code searches, builds context, or recall… |
| `ADR0006-12` | Deferred: Sync / first-party backup / live multi-device replication | ADR-0006 §Deferred | ❌ | grep -rniE 'sync\|replicat\|backup\|multi.?device' over apps/cli + packages finds no sync/replication engine for the registry; registry is local-only (p… | none | L | P3 | [roadmap] Intentional roadmap item; out of this ADR's scope. [verify ✓: Status confirmed but original evidence is imprecise: the repo DOES ship a 'backup' feat… |
| `ADR0006-13` | Deferred: Moving/migrating an existing legacy direct replica into base/realms/ | ADR-0006 §Deferred | ❌ | grep -rniE 'migrat\|move.*replica\|relocat' apps packages (excluding migrate_pages/schema) returns nothing; ensureLegacyRegistered (realm-registry.ts:1… | none | M | P3 | [roadmap] Intentional — legacy replica is registered in place as 'default', never moved. Migration is a separate future task. [verify ✓: Confirmed not_implemen… |
| `ADR0007-12` | Not in this ADR: UI for import operations (CLI is source of truth) | ADR-0007 'Not in this ADR' | ❌ | grep -rn 'import' apps/server apps/daemon --include='*.ts' returns no import-command surface (only TS module imports); web/UI import write path defer… | ADR0007-1 (shipped); needs ADR-0010 owner-write surface to … | M | P3 | [roadmap] Intentional — explicitly excluded; CLI is the operational source of truth. [verify ✓: Confirmed not_implemented (intentional exclusion). ADR-0007 'No… |
| `ADR0007-13` | Not in this ADR: Bulk / file-watched import directories | ADR-0007 'Not in this ADR' | ❌ | import_ai Connector detect()/read() deliberately return empty (packages/integrations/import-ai/index.ts:208,214); grep -rn 'watch\|chokidar\|importDir\|… | ADR0007-1 | M | P3 | [roadmap] Intentional — a paste has nothing to watch; forcing detect()/watch would be 'a lie' per §b. Would need its own ADR to resume. [verify ✓: Confirmed no… |
| `ADR0007-14` | Not in this ADR: first-party export of Memoring's own memory as a foreign-AI prompt target (reverse direction beyond --print-prom… | ADR-0007 'Not in this ADR' | ❌ | Only exportPromptFor (prints the prompt to run elsewhere) exists; grep -rn 'export.*memory\|exportMemory\|dumpClaims\|exportRealm' apps packages --inclu… | none | L | P3 | [roadmap] Intentional exclusion; the bidirectional helper stops at printing the prompt. Outbound memory export would cross egress concerns (Gate) and needs its… |
| `ADR0008-6` | Future v1 publish: flip private→false and npm publish | ADR-0008 §Decision.3 / §Deferred | ❌ | package.json:4 still "private": true; grep 'npm publish\|npm install -g memoring\|npm update -g' over apps+packages returned NO MATCHES | none | S | P3 | [roadmap] Intentionally deferred to v1 (ADR §Deferred: 'v1 work'). Correctly not built. [verify ✓: Independent search agrees with the audit. The v1 publish fli… |
| `ADR0008-7` | Opt-in update-notifier (registry compare, no telemetry, non-blocking, throttled, stderr-only, no auto-update) — the 6 constraints | ADR-0008 §Decision.4 / §Deferred | ❌ | grep -rniE 'update.?notifier\|update.?check\|MEMORING_NO_UPDATE_CHECK\|registry.npmjs\|update available\|auto.?update' over apps+packages returned only a … | ADR0008-6 | M | P3 | [roadmap] Explicitly deferred (YAGNI until publish). ADR is a guardrail: whoever adds it must honor the 6 constraints (opt-in/default-off, no telemetry, non-bl… |
| `ADR0009-1` | Phased distribution roadmap (headline decision) — ships no code | ADR-0009 §Decision / Status line | ❌ | ADR self-declares 'Status: Accepted (plan only)' and '§Consequences: No frozen invariant moves and no code changes ship with this ADR.' Current state… | none (this is the umbrella; sub-items below are the work) | L | P3 | [roadmap] Intentional roadmap-only ADR. Builds on ADR-0008. Item recorded for completeness; the real work is ADR0009-2..6. [verify ✓: Umbrella roadmap ADR; shi… |
| `ADR0009-4` | Phase 3 — self-contained binary + `curl \| sh` installer | ADR-0009 §Decision table Phase 3; §Deferred bullet 1 | ❌ | Absence: `find . -not -path '*/node_modules/*' \( -name install.sh -o -name install -o -iname '*installer*' \)` → none; `grep -rnE 'prebuild\|pkg\|nexe… | ADR0009-5 (needs packaging mechanism that embeds the native… | L | P3 | [roadmap] Highest-effort rung; depends on native-dep resolution and a SEA/pkg packaging mechanism. [verify ✓: Confirmed not_implemented. bin/memoring.mjs is a … |
| `ADR0009-6` | Windows packaging specifics + signing / notarization for native installer | ADR-0009 §Deferred bullet 3 | ❌ | Absence: no installer/packaging artifacts exist at all (see ADR0009-4 grep); `ls .github/workflows` → directory absent, so no signing/notarization pi… | ADR0009-4 (only relevant once a native installer/binary exi… | M | P3 | [roadmap] Explicitly deferred. Cross-platform + code-signing concern, only meaningful at Phase 3. [verify ✓: Confirmed not_implemented. No native binary or ins… |
| `ADR0010-12` | Phase 2: explicit 'set active for CLI' action (validated + serialized + audited setCurrent) | ADR-0010 §4 / §6 Phase 2 | ❌ | setCurrent (packages/core/realm-registry.ts:101) is unlocked, no mutex/validation/audit; no server caller (grep 'setCurrent' apps/server → none). | ADR0010-8, ADR0010-11 (audit contract) | M | P3 | [roadmap] Only this action may write setCurrent; must validate id, serialize write, audit. Optional per §6. [verify ✓: Confirmed not_implemented. ADR-0010 §6 l… |
| `ADR0010-13` | Phase 2: passphrase-Realm local entry form (POST-body only, in-memory provider, never persisted/logged/audited) | ADR-0010 §4 Phase 2 / §6 | ❌ | grep -rniE 'passphrase\|passphraseProvider\|openActiveRealm' apps/server → none. Server uses openRealmLocal only (apps/server/main.ts:621). | ADR0010-8 (POST), ADR0010-7 (locked-state listing) | M | P3 | [roadmap] Passphrase via POST body only (never query/fragment); redact route body in any future request logging. [verify ✓: Confirmed not_implemented after adv… |
| `ADR0010-14` | Phase 2: forget / redact write actions | ADR-0010 §5 table / §6 Phase 2 | ❌ | grep -rniE 'forgetByPattern\|forgetClaim\|redactEventById\|deleteUndiluted\|forget\|redact' apps/server → no matches. | ADR0010-8, ADR0010-11 (audit) | M | P3 | [roadmap] Thin wrappers over existing core forget/redact fns; floor stays centralized in core. [verify ✓: Could not refute. Independent search agrees: Phase 2 … |
| `ADR0010-7` | Passphrase Realms shown 'locked' in phase 1 (passwordless-only openable) | ADR-0010 §4 Phase 1 / §6 | ❌ | grep -rniE 'passphrase\|key_mode\|locked' apps/server → no matches; server is openRealmLocal-only (:621). | ADR0010-6 (needs realm listing to surface lock state) | S | P3 | [roadmap] Display-only lock indicator; no unlock path in phase 1. [verify ✓: Status confirmed not_implemented for the web control panel (the ADR-0010 surface).… |
| `ADR0010-8` | Phase 2: owner writes via POST/PUT/DELETE behind Origin/Host+token | ADR-0010 §1 / §6 Phase 2 | ❌ | apps/server/main.ts:646-647 still returns 405 for every non-GET method (allow: GET). | ADR0010-1,2,3,4 (the entire write-security gate must preced… | M | P3 | [roadmap] Phase 2 by design; do not introduce mutating methods before the gate lands. [verify ✓: Confirmed not_implemented. Phase 2 owner-write (POST/PUT/DELET… |
| `ADR0010-9` | Phase 2: Realm create/connect/delete wrappers + audit at shared layer | ADR-0010 §5 table / §6 Phase 2 | ❌ | No write routes in apps/server (grep 'createReplicaAtRoot\|addRealm\|removeRealm' apps/server → none). Core fns exist (apps/cli/commands/realm.ts:65,71… | ADR0010-8 (write methods), ADR0010-11 (shared audited orche… | M | P3 | [roadmap] Must reuse core fns; preserve removeRealm + fs.rmSync ordering per §5. [verify ✓: Status confirmed not_implemented. Phase 2 realm create/connect/dele… |
| `ADR0011-10` | Agentic / multi-hop associative retrieval (LLM iterating queries, chaining associations) | ADR-0011 §2 + §Deferred | ❌ | grep -rni 'multi-hop\|multihop\|agentic\|associative retrieval\|iterate quer' over apps+packages returned nothing; askRealm does exactly one searchRealm … | ADR0011-9 (chat) likely first | L | P3 | [roadmap] Intentional — needs its own treatment; widens read surface. Deferred by §2. [verify ✓: Confirmed not_implemented after adversarial search. The only "… |
| `ADR0011-11` | Global cross-Realm 'whole-self' twin (one assistant across every Realm) | ADR-0011 §3 + §Deferred | ❌ | grep -rni 'whole-self\|whole_self\|cross-realm twin\|global twin' over apps+packages returned nothing | requires its own future ADR (conflicts with per-Realm invar… | L | P3 | [roadmap] Intentional — must not be smuggled in; needs dedicated ADR resolving the cross-Realm trust invariant. [verify ✓: Confirmed not_implemented. Audited t… |
| `ADR0011-12` | Write-back beyond read-only v1 (candidate-only, assistant origin, user-confirmed) | ADR-0011 §5d + §Deferred 'Any write-back' | ❌ | no write path in ask.ts (read ADR0011-4); grep 'write-back\|writeback' over apps+packages returned nothing | ADR0011-1 (output surface) shipped; needs design | M | P3 | [roadmap] Intentional — not designed here; must mirror ADR-0007/ADR-0010 candidate-only boundary if added. [verify ✓: Confirmed not_implemented. Adversarial pr… |
| `ADR0011-13` | Output role remote-DEFAULT-ON (egress-table amendment to §7.3/§7.5/policy.v2) | ADR-0011 §5 + §Deferred 'output role's remote default' + §Addendum | ❌ | output-provider.ts:77-80 keeps remote OFF-by-default behind MEMORING_LLM_REMOTE_OPT_IN; no §7.3/§7.5 amendment present | none — explicitly DECLINED | L | P3 | [roadmap] Intentional and explicitly NOT pursued per Addendum ('remote-default-on is not pursued'). Not a gap — a closed question. Reopening would need a new A… |
| `ADR0011-14` | §6 Per-role provider registry with dedicated MEMORING_ASK_* config split | ADR-0011 §6; output-provider.ts comment 'MEMORING_ASK_* is a follow-up' | 🟡 | present: per-role SEPARATION exists (distinct OutputProvider vs MemoryProvider, output-provider.ts:23-27). missing: shared registry + dedicated per-r… | none | S | P3 | [roadmap] Roles are separated by interface, but the 'one registry with per-role config' and MEMORING_ASK_* split are explicitly follow-up only. [verify ✓: Orig… |
| `ADR0011-15` | §7 Per-Realm user-defined persona config for the conversation voice | ADR-0011 §7; Invariants 'No predefined persona/category' | ❌ | grep -rni 'persona' over apps+packages returns no feature (only unrelated 'personal data' log/import strings); ask.ts uses fixed GROUNDING_INSTRUCTIO… | ADR0011-9 (chat surface) is the natural home | M | P3 | [roadmap] Negative invariant (no hard-coded persona) is honored by absence; the positive feature (owner-set voice config) is simply not built in the read-only … |
| `SPEC-PLAN-9.2-embed` | v0.1 roadmap: local embedding / vector index to STRENGTHEN semantic search (+ similar-label consolidation-candidate suggestion) | spec project_plan.md:207 §9.2; requirements.md:39; design_final.md:405 | ❌ | grep -rniE 'embedding\|vector\|cosine\|faiss\|hnsw' apps packages --include=*.ts -> only the recipe threshold constant merge_suggest_threshold.embedding … | none | L | P3 | [roadmap] v0.1 roadmap pillar #3 (alongside SPEC-PLAN-9.2-ingest and -mcppolish). Related to but NOT a duplicate of SPECP-004 (merge-candidate surfacing) or SP… |
| `SPEC-PLAN-9.2-mcppolish` | v0.1 roadmap: MCP server polish (refine the standard receptacle) | spec project_plan.md:208 §9.2 | 🟡 | Base MCP receptacle shipped in v0: packages/retrieval/mcp.ts (memoring_search + memoring_add_memory_candidate over stdio JSON-RPC, mcp.ts:139-161) ex… | none | M | P3 | [roadmap] Minimal MCP exists today; v0.1 refinement is additive and bounded by OUT-013 (no write beyond candidate). [verify ✓: Confirmed partial. The minimal 2… |
| `SPECP-001` | redacted_export — derivative export that may leave the key boundary (secret redacted, unknown/unclassified excluded) | spec §6.2 (memoring_specification.md:331,337) / design_final §14.x | 🟡 | PRESENT as enum + reserved purpose only: packages/core/schema/enums.ts:124 ('redacted_export'); CLI accepts the positional/flag but hard-rejects: app… | none | L | P3 | [roadmap] Spec is explicit this is 'constraints only … implementation left for a later stage'. policy.ts has a generic redacted flag (policy.ts:28,139) but no … |
| `SPECP-002` | dataset_export — training-purpose derivative export requiring lineage + consent | spec §6.2 (memoring_specification.md:331) / 281 (deny_raw note) | 🟡 | PRESENT as enum only: packages/core/schema/enums.ts:125 ('dataset_export'); CLI rejects same path as redacted (apps/cli/commands/export.ts:22-27, mes… | SPECP-001 (shares export-purpose pipeline) | L | P3 | [roadmap] Spec: 'In v0, constraints only.' Concrete capability (training dataset extraction w/ consent) deferred to later stage. [verify ✓: Confirmed partial a… |
| `SPECP-003` | Span/line-level masking of secrets in retrieval (vs whole-session safe-side exclusion) | detailed_design §ReDoS/masking (memoring_detailed_design.md:957) / design_final:1160 ('fu… | ❌ | Code only does session-level over-exclusion, no span masking. packages/security/secret-scan.ts:4 comment 'span-level masking in v0, OUT-014'. Proof o… | none | M | P3 | [roadmap] Close to OUT-014 but spec/design frame it in prose as 'a future ADR' capability (per-span masking to recover useful context dragged down by safe-side… |
| `SPECP-004` | Embedding-proximity merge-candidate surfacing for Labels/Claims (local embedding) | design_final §11.x (memoring_design_final.md:1280) / detailed_design:1512 ('consistent wi… | ❌ | Recipe defines an embedding threshold but nothing computes embeddings; merge dedup uses the STRING threshold only. packages/core/recipe.ts:129 merge_… | none | L | P3 | [roadmap] Spec says label normalization is deterministic/v0 but embedding-proximity merge surfacing 'requires local embedding and is therefore consistent with … |
| `SPECP-005` | Automatic Quality Loop (auto-tuning of Recipe thresholds/weights/reinforcement) | detailed_design §9 (memoring_detailed_design.md:1412) / design_final:1260 ('v0 does not i… | ❌ | Recipe values are a manual, version-managed constant table; no auto-tuning. packages/core/recipe.ts holds static PRUNE_RECIPE values. Proof of absenc… | none | L | P3 | [roadmap] Design explicitly defers the automatic loop; v0 reinforcement uses fixed Recipe numbers. Concrete deferred capability stated in prose, not an OUT id.… |
| `SPECP-008` | Generic JSONL / Markdown transcript Connector (v0.1 roadmap connector #4) | design_final §roadmap (memoring_design_final.md:401-405 connector list item 4) | ❌ | No generic transcript connector registered (registry.ts:7-10 only claude-code + import-ai). Proof of absence: grep -rniE 'generic.?jsonl\|jsonl.?conne… | none | M | P3 | [roadmap] Roadmap connector #4. The import-ai connector is a paste-import path (ADR-0007), not the generic transcript file Connector; counted as a distinct def… |
| `SPECP-009` | label split — split an over-merged Label into distinct vocabulary entries | spec §1.2 (memoring_specification.md:38, 'memoring label … split <label>') | 🟡 | PRESENT (surfacing-only stub): apps/cli/commands/label.ts:39-41 case 'split' prints 'label split: v0 surfaces split candidates only; use merge/rename… | none | S | P3 | [roadmap] Spec lists split as a label subcommand; v0 only surfaces candidates and tells the user to curate via merge/rename. Concrete capability (programmatic … |

### Group B — Intentionally out-of-scope for v0 (resuming requires a new ADR)

22 items. Their **absence is the intended state** (AGENTS.md §84). Listed so the roadmap is complete and so any future leak is caught against this baseline.

| ID | Item | Source | Status | Evidence (clipped) | Blockers | Size | Priority | Notes |
|---|---|---|---|:--:|---|:--:|:--:|---|
| `SPEC-OUT015` | No per-span context-injection tracking — v0 closes the whole session as context_injected; span-ization is v0.1 | spec OUT-015 (requirements.md:296); also design_final.md:381,999, specification.md:150 | ❌ | context_injected is a session/event boolean (core/schema/entities.ts:71,250; storage/schema-ddl.ts:27,83); ouroboros.ts:60 'fall an entire session to… | none | M | P2 | [out-of-scope] v0 over-exclusion is the safe-side fallback; span granularity explicitly deferred to v0.1. [verify ✓: Confirmed not_implemented. v0 uses session/even… |
| `SPEC-OUT016` | No pack-local alias citation IDs — v0 uses opaque IDs (clm_/evt_); aliases are v0.1 | spec OUT-016 (requirements.md:297); also design_final.md:382, implementation_instructions… | ❌ | core/schema/ids.ts:4-5 'Citations exposed to an AI (clm_/evt_) are these opaque IDs; v0 does not create pack-local alias IDs (OUT-016)'. forget.ts:57… | none | M | P2 | [out-of-scope] Opaque IDs only; alias citation layer deferred to v0.1. [verify ✓: Confirmed not_implemented. v0 exposes opaque clm_/evt_ IDs directly as citations a… |
| `SPEC-OUT018` | Vector search not mandatory in v0 | spec OUT-018 (requirements.md:299) [≡ NOTODO-15 AGENTS.md §82-99] | ❌ | No vector index: grep vector/faiss/hnsw/cosine → none in retrieval. claim/consolidation.ts:17 'needs embeddings and is out of v0 scope'. recipe.ts:12… | none | M | P2 | [out-of-scope] Embedding-based merge/search deferred; recipe holds the future threshold but no vector engine wired. [verify ✓: Confirmed. SPEC-OUT018 says vector se… |
| `ADR0008-8` | Auto-update mechanism — explicitly out of scope now and at v1 | ADR-0008 §Deferred | ❌ | grep 'auto.?update' over apps+packages returned NO MATCHES (only constraint prose in ADR) | none | S | P3 | [out-of-scope] Intentional permanent exclusion ('out of scope, now and at v1'). Absence is the correct state; would need a new ADR to ever resume. [verify ✓: Confir… |
| `SPEC-OUT001` | No predefined persona classification (personal/private/social/work/anonymous hardcoded) | spec OUT-001 (requirements.md:282) ; AGENTS.md §87-88; impl-instructions §5.1 L188 | ❌ | grep -rniE 'personal\|private\|social\|anonymous' apps packages → only secret-scan patterns (security/secret-scan.ts:23,49) and backup-warning copy (cli… | none | S | P3 | [out-of-scope] Prohibition correctly upheld; scope is by soft label not predefined persona. [verify ✓: Confirmed. The prohibition is correctly upheld in code: scope… |
| `SPEC-OUT002` | No automatic label(vocabulary) merge confirmation (surface candidates only; confirm by user/policy/rule) | spec OUT-002 (requirements.md:283) [≡ NOTODO-2 AGENTS.md §82-99] | ❌ | apps/cli/commands/label.ts:41 'v0 surfaces split candidates only; use merge/rename to curate' — merge/rename are explicit user commands. Claim auto-m… | none | S | P3 | [out-of-scope] Distinct from FR-035 claim consolidation; label confirmation stays user-gated. [verify ✓: Adversarial grep for auto.?merge\|automatic.*merge\|merge.*co… |
| `SPEC-OUT003` | No encryption boundary (Key Domain) within a Realm (separation is per-Realm) | spec OUT-003 (requirements.md:284) [≡ NOTODO-3 AGENTS.md §82-99] | ❌ | grep -rniE 'keydomain\|key.?domain\|per.?domain.*encrypt\|encryption boundary' apps packages → no implementation. Design decision (basic_design.md:273);… | none | S | P3 | [out-of-scope] Permanent design decision, not ADR-resumable. [verify ✓: Confirmed not_implemented — and intentionally so. Memoring has a full envelope-encryption sc… |
| `SPEC-OUT004` | No first-party cloud backup/sync (only a standard receiver) | spec OUT-004 (requirements.md:285) [≡ NOTODO-4 AGENTS.md §82-99] | ❌ | grep -rniE 'cloud\|upload\|sync.*server' apps packages → no upload/cloud-sync code. Only local backup_export exists (cli/commands/export.ts:7-8,65-66 '… | none | S | P3 | [out-of-scope] backup_export is a self-contained encrypted local archive (NFR-032), not a first-party cloud service. [verify ✓: backup_export is a self-contained lo… |
| `SPEC-OUT005` | No ReplicaManifest / root_hash sync / known-replica tracking | spec OUT-005 (requirements.md:286) | ❌ | grep -rniwE 'ReplicaManifest\|root_hash\|rootHash\|knownReplica' apps packages → zero matches. Honored. | none | S | P3 | [out-of-scope] No replica-tracking machinery present. [verify ✓: Confirmed absent after aggressive synonym search. No ReplicaManifest / root_hash sync / known-repli… |
| `SPEC-OUT006` | No review queue / manual approval | spec OUT-006 (requirements.md:287) [≡ NOTODO-5 AGENTS.md §82-99] | ❌ | grep -rniE 'review.?queue\|manual.?approv\|approval.?queue' apps packages → only a comment in security/audit.ts:4 'Because there is no review queue...'… | none | S | P3 | [out-of-scope] Absence is intentional and reflected in audit-target design (NFR-030). [verify ✓: Status correct (forbidden review queue NOT built; honored), but the… |
| `SPEC-OUT007` | No live multi-device sync | spec OUT-007 (requirements.md:288) ; AGENTS.md §93; impl-instructions §5.1 L194 | ❌ | grep -rniE 'multi.?device\|live.?sync\|p2p' apps packages → only the comment cli/commands/restore.ts:8 'no live multi-device merge (Prohibitions / NFR-… | none | S | P3 | [out-of-scope] local-first / single-user (NFR-031) upheld. [verify ✓: Confirmed not_implemented (deferral honored). No sync/replication/P2P/CRDT/websocket code in a… |
| `SPEC-OUT008` | No team / organization / admin | spec OUT-008 (requirements.md:289) ; AGENTS.md §93; impl-instructions §5.1 L195 | ❌ | grep -rniE 'team\|org\|organization\|admin\|tenant' apps packages (filtered) → no team/org/admin/tenant feature code. design_final.md:1339 confirms 'orga… | none | S | P3 | [out-of-scope] Single-user model only. [verify ✓: Confirmed not_implemented; deferral honored. Audited against worktree /Users/spesan/Documents/memoring-audit @ ori… |
| `SPEC-OUT009` | No desktop app | spec OUT-009 (requirements.md:290) ; AGENTS.md §94; impl-instructions §5.1 L196 | ❌ | grep -rniE 'electron\|tauri\|swiftui\|menubar\|tray' apps packages → zero matches. UI surface is a localhost read-only web panel (apps/server/main.ts:5 H… | none | S | P3 | [out-of-scope] Web control panel (ADR-0010) is a separate decision; not a packaged desktop app. [verify ✓: Confirmed not_implemented (deferral honored). Audited pin… |
| `SPEC-OUT010` | No browser scraping / dependence on non-public APIs | spec OUT-010 (requirements.md:291) [≡ NOTODO-9 AGENTS.md §82-99] | ❌ | grep -rniE 'puppeteer\|playwright\|scrape\|fetch\(\|axios\|cheerio' over packages/intake + connect/import → zero. Connectors read local files only (intake… | none | S | P3 | [out-of-scope] Intake is local-file/paste only; no network scraping path. [verify ✓: Confirmed, not refuted. Status maps to the auditor's negative-requirement conve… |
| `SPEC-OUT011` | No imports that circumvent a provider's access control | spec OUT-011 (requirements.md:292) | ❌ | apps/cli/commands/import.ts is paste/file/stdin-based (import.ts:4,72,93); no OAuth/token/provider-API fetch. import-ai parses user-pasted export tex… | none | S | P3 | [out-of-scope] User performs the export inside the provider UI; Memoring ingests the paste. [verify ✓: Could not refute. The two fetch() sites found (apps/server/ma… |
| `SPEC-OUT012` | No hook injection / real-time event capture | spec OUT-012 (requirements.md:293) ; AGENTS.md §95; impl-instructions §5.1 L199 | ❌ | grep -rniE 'hook.?inject\|realtime' apps packages → none. 'memoring watch' (cli/commands/watch.ts:1-6,44,91-108) is a debounced diff-driven fs.watch p… | none | S | P3 | [out-of-scope] Diff-driven watcher is an allowed FR; distinct from the prohibited hook injection. [verify ✓: Could not refute. watch.ts is a diff-driven fs.watch po… |
| `SPEC-OUT013` | No MCP write integration beyond add_memory_candidate | spec OUT-013 (requirements.md:294) ; AGENTS.md §96; impl-instructions §5.1 L200 | ❌ | packages/retrieval/mcp.ts:27 TOOLS = only memoring_search (read) + memoring_add_memory_candidate; handleAddCandidate forces status:'candidate' (mcp.t… | none | S | P3 | [out-of-scope] The single permitted write (candidate-only, non-user origin, no evidence authority) is exactly the carve-out. [verify ✓: Confirmed. The deferred broa… |
| `SPEC-OUT014` | No span / line-unit redaction (sensitivity is event-unit) | spec OUT-014 (requirements.md:295) [≡ NOTODO-12 AGENTS.md §82-99] | ❌ | grep -rniE 'span.?redact\|line.?redact\|partial.?redact\|span.?unit' apps packages → zero. Redaction is event-unit (CON-007/CON-008); forget.ts redacts … | none | S | P3 | [out-of-scope] Event-unit sensitivity enforced; no span partial-redaction. [verify ✓: OUT-014 is a deferral (negative requirement). Honored: sensitivity/redaction u… |
| `SPEC-OUT019` | No automatic tuning of ranking weights (manual Recipe only) | spec OUT-019 (requirements.md:300) [≡ NOTODO-16 AGENTS.md §82-99] | ❌ | grep -rniE 'auto.?tun\|autotune\|learn.*weight\|optimi.*weight\|gradient' apps packages → none (server CSS 'gradient' is the only hit). Weights are versi… | none | S | P3 | [out-of-scope] Recipe-owned tunables; no learned weight optimizer. [verify ✓: Confirmed not_implemented = deferral respected. Weights are human-curated, version-man… |
| `SPEC-OUT020` | No cross-Realm search / cross-Realm context | spec OUT-020 (requirements.md:301) | ❌ | grep -rniE 'cross.?realm\|all.?realms\|multiRealm\|across realms' apps packages → only intake/identity.ts:4 comment ('never ... across Realms'). searchR… | none | M | P3 | [out-of-scope] Each command binds to one active Realm; no cross-Realm join surface. [verify ✓: Confirmed not_implemented (deferral respected). The only realms-itera… |
| `SPEC-OUT021` | No direct S3 / R2 / Google Drive client | spec OUT-021 (requirements.md:302) | ❌ | grep -rniE 's3client\|aws-sdk\|@aws\|r2\|googleapis\|gdrive\|dropbox' apps packages → zero. Export writes to a local dest dir only (cli/commands/export.ts:… | none | S | P3 | [out-of-scope] User carries the encrypted archive to any storage manually. [verify ✓: Deferral honored/correct as a "not_implemented" requirement (OUT-021 is an exp… |
| `SPEC-OUT022` | No automatic crypto-shred propagation / backup re-key | spec OUT-022 (requirements.md:303) | ❌ | grep -rniE 'crypto.?shred\|shred.*propag\|backup.*re.?key\|rekey.*backup' apps packages → zero. rekey (cli/commands/rekey.ts) operates on the local Real… | none | M | P3 | [out-of-scope] Re-key is local-envelope only; backup re-key propagation deferred. [verify ✓: OUT-022 is an explicit non-goal (docs/v0/en/memoring_requirements.md:30… |

## Per-source detail

Each source's full item set (including `✅` shipped decisions) with complete verifier evidence.

### ADR-0001 — Passwordless default

*6 items — ✅ 3 · 🟡 1 · ❌ 2*

- ✅ **`ADR0001-1`** — Passwordless-by-default key mode (random unwrapped DEK in keys/key.json, 0600) + --passphrase opt-in + openActiveRealm auto-detect  
  _Source:_ ADR-0001 Decision · _Size:_ M · _Priority:_ P0  
  _Evidence:_ packages/security/key-lifecycle.ts:187 createLocalKeyMaterial (unwrapped DEK); apps/cli/commands/init.ts:50 atomicWriteFile(layout.keyFile,...,0o600) and init.ts:100 usePassphrase toggle; packages/core/runtime.ts:133 openActiveRealm prompts only in passphrase mode (runtime.ts:139-140); paths.ts:47 keyFile=keys/key.json  
  _Notes:_ Headline decision; shipped as 0.1.2 per ADR Consequences. Fully built across security/core/cli.  
  _Next step:_ None — verified shipped.
- ✅ **`ADR0001-2`** — Backward-compatible opening: a --passphrase replica (only keybundle.json) still opens via the passphrase path; no destructive migration  
  _Source:_ ADR-0001 Consequences · _Size:_ S · _Priority:_ P1  
  _Evidence:_ packages/core/runtime.ts:139-140 openActiveRealm — keyFile present -> openRealmLocal, else keyBundle present -> openRealm(passphrase); runtime.ts:86 isPassphraseMode = no keyFile and keyBundle exists; assertKeyModeUnambiguous (runtime.ts:78) rejects both-present  
  _Notes:_ Dual-format open path confirmed; opening only — no in-place format conversion (that is item ADR0001-3).  
  _Next step:_ None — verified shipped.
- ✅ **`ADR0001-3`** — memoring key enable-passphrase — convert an existing passwordless vault in place (wrap existing DEK without rebuild)  
  _Source:_ ADR-0001 Deferred + Consequences · _Size:_ M · _Priority:_ P2  
  _Evidence:_ packages/security/key-lifecycle.ts:253 upgradeLocalToPassphrase() reuses the SAME DEK (keyFile.dek :261) and re-wraps it under a scrypt KEK (aeadSeal(kekPp, dek) :275) — no rebuild. Wired to CLI: apps/cli/commands/rekey.ts:63-78 — `memoring rekey --passphrase` on a passwordless vault calls upgradeLocalToPassphrase(loadLocalKey(layout), ...), writes keybundle.json then removes key.json in place (fs.rmSync(layout.keyFile) :78). Output rekey.ts:81-82: "The DEK was re-wrapped, not changed, so all memory, identities, and Seals are preserved." main.ts:102-103 registers `rekey`. (was: not_implemente…  
  _Notes:_ Intentionally deferred. ADR notes derivation is unchanged (DEK + HKDF) so it can wrap an existing DEK without rebuild — groundwork present in key-lifecycle.ts. [VERIFY OVERRODE → implemented: The literal command name `memoring key enable-passphrase` and string `enable-passphrase` are absent (grep -rniE 'enable-passphrase\|enablePassphrase\|enable_passphrase' apps packages --include=*.ts -> exit=1; …  
  _Next step:_ Add `memoring key enable-passphrase` reusing createKeyMaterial to scrypt-wrap the loaded local DEK and swap key.json->keybundle.json.
- 🟡 **`ADR0001-4`** — export/import --bundle (single-file) and --encrypted (age/passphrase) backup  
  _Source:_ ADR-0001 Deferred · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ EXISTS: apps/cli/commands/export.ts:30 `export --purpose backup <dir>` (directory copy; export.ts:71 encryption='passphrase'\|'local_key_included', self-decrypting in local mode) + apps/cli/commands/restore.ts. MISSING: grep -rn -- '--bundle\|flags.bundle\|--encrypted\|flags.encrypted' apps packages --include=*.ts -> no matches; grep for age/x25519 crypto -> none (only NL-text 'age'). No single-file bundle, no age/passphrase re-encryption of a local-mode backup.  
  _Notes:_ Directory backup/restore shipped; the deferred *single-file bundle* and *--encrypted (age)* surface for protecting a self-decrypting local backup is absent. [verify ✓: Confirmed partial. ADR-0001:74 explicitly defers `export/import --bundle` and `--encrypted` (age/passphrase) backup, matching sourceRef. Directory backup_export + restore shipped (recursive fs.cpSync, no re-egress). Deferred single…  
  _Next step:_ Add `export --bundle <file> [--encrypted]` (age/passphrase) so local-mode backups are not self-decrypting.
- ❌ **`ADR0001-5`** — OS keychain / Secure Enclave wrapping of key.json (macOS Keychain, Linux Secret Service, Windows DPAPI)  
  _Source:_ ADR-0001 Deferred · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rni 'keychain\|secure.enclave\|dpapi\|secret.service\|libsecret\|security-framework\|keytar' apps packages --include=*.ts -> only openai-compatible.ts:9 comment (LLM API key from env/keychain), no key.json wrapping. key.json is written plain-0600 at init.ts:50.  
  _Notes:_ Per-platform native integration explicitly deferred for later revisit; mitigated today by FileVault/--passphrase guidance in ADR threat model. [verify ✓: Confirmed not_implemented. The only key protection shipped is application-level: plain 0o600 file in default/passwordless mode, or scrypt-derived KEK envelope-wrapping the DEK in --passphrase mode (key-lifecycle.ts, rekey.ts). Neither uses an OS…  
  _Next step:_ Spike macOS Keychain wrapping of key.json behind a platform-detect shim before committing to cross-platform scope.
- ❌ **`ADR0001-6`** — Device pairing, multi-device sync, daemon-/UI-premised auth  
  _Source:_ ADR-0001 Deferred · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rni 'device.pair\|pairing\|multi-device\|multidevice\|device-id\|daemon.*auth' apps packages --include=*.ts -> no matches (sync hits are only restore.ts:8 comment stating no first-party cloud sync / no live multi-device merge, NFR-032).  
  _Blockers:_ ADR0001-5 (keychain) likely a prerequisite for device-bound auth  
  _Notes:_ Carry-not-sync is the deliberate v0 posture (restore.ts:7-8). Daemon/UI auth ties into ADR-0010 web panel work, not key management v0. [verify ✓: Confirmed not_implemented. Device pairing, multi-device sync, and daemon-/UI-premised auth are all absent from code. The web server is loopback-bound and unauthenticated by design (read-only, 127.0.0.1) — it has no auth model at all, which is the opposi…  
  _Next step:_ Defer until a sync/daemon ADR defines the auth model; no key-management action needed now.

### ADR-0002 — LLM memory provider

*13 items — ✅ 8 · 🟡 2 · ❌ 3*

- ✅ **`ADR0002-1`** — MemoryProvider interface evolution: async abstract + egress field; abstractEvents/runLoop async  
  _Source:_ ADR-0002 Decision 1 · _Size:_ S · _Priority:_ P0  
  _Evidence:_ packages/claim/provider.ts:10 MaybePromise, :40 egress 'local'\|'remote', :45 abstract returns MaybePromise; packages/claim/extractor.ts:89 async abstractEvents; packages/core/loop.ts:42 async runLoop, :104 awaits abstractEvents  
  _Notes:_ Headline interface change, fully shipped. Sync Mode A unaffected (caller awaits).  
  _Next step:_ None — verified shipped.
- ✅ **`ADR0002-2`** — Vendor-neutral LlmMemoryProvider over LlmBackend adapter (@claim/llm-provider)  
  _Source:_ ADR-0002 Decision 2 · _Size:_ M · _Priority:_ P0  
  _Evidence:_ packages/claim/llm-provider.ts:109 class LlmMemoryProvider implements MemoryProvider; :17 LlmBackend interface (complete(prompt)->Promise<string>); :27 language-agnostic EXTRACTION_INSTRUCTION rejecting role/mission prompts; :70 defensive parseCandidates (kind in CLAIM_KINDS, non-empty statement, confidence clamped :90)  
  _Notes:_ Matches ADR: vendor-neutral, defensive parse, anti-role-prompt instruction.  
  _Next step:_ None — verified shipped.
- ✅ **`ADR0002-3`** — First adapter OpenAiCompatibleBackend (covers OpenAI/DeepSeek/Ollama/llama.cpp); unit-tested via injected fetchImpl, no live call enabled  
  _Source:_ ADR-0002 Decision 2 + Consequences · _Size:_ M · _Priority:_ P0  
  _Evidence:_ packages/integrations/llm/openai-compatible.ts:41 class OpenAiCompatibleBackend implements LlmBackend; :19 fetchImpl injectable; :54 egress inferred from loopback; :60 complete() POSTs /chat/completions temperature:0  
  _Notes:_ Single OpenAI-compatible adapter as specified.  
  _Next step:_ None — verified shipped.
- ✅ **`ADR0002-4`** — Pre-egress sensitivity gate: remote provider events must clear allowedSensitivity + allowedSensitivityState (same pair as output Gate)  
  _Source:_ ADR-0002 Decision 3 · _Size:_ M · _Priority:_ P0  
  _Evidence:_ packages/claim/extractor.ts:122-133 when provider.egress==='remote': allowedSensitivity (:123), allowedSensitivityState (:124), plus scope-axis allowedScopeState (:128), secret_scan re-check (:129), status active (:130), event-identity Seal (:131-133), pattern Seal (:137). local provider exempt (gate block guarded by remote check)  
  _Notes:_ Shipped STRONGER than ADR text: adds scope-state, secret-scan parity, and Seal/suppression checks beyond the two predicates named in the ADR.  
  _Next step:_ None — verified shipped (exceeds ADR scope).
- ✅ **`ADR0002-5`** — Authority/provenance: LLM candidate never reaches confirmed; mode->created_by mapping; Derivation records egress class + prompt_version  
  _Source:_ ADR-0002 Decision 4 · _Size:_ S · _Priority:_ P0  
  _Evidence:_ packages/claim/extractor.ts:214 created_by = (provider.id==='rule_based' && mode==='explicit') ? 'rule' : 'ai' (model output forced to ai/inferred bar even if mode=explicit); :65 model_provider=provider.egress; :69 prompt_version=provider.version; :202 status:'candidate' (never confirmed at creation)  
  _Notes:_ Model assertions held to ai_inferred_pattern bar; off-device/LLM derivations auditable.  
  _Next step:_ None — verified shipped.
- ✅ **`ADR0002-6`** — Mode A retained as always-on deterministic fallback, NOT extended with language-specific patterns  
  _Source:_ ADR-0002 Decision 5 · _Size:_ S · _Priority:_ P1  
  _Evidence:_ packages/claim/provider.ts:70 RuleBasedProvider implements MemoryProvider, egress='local' (:74); PATTERNS (:56-62) remain English-only regexes — no CJK/Japanese patterns added; apps/cli/provider.ts:20 default return new RuleBasedProvider()  
  _Notes:_ Intentionally not extended (the ADR's whole point). Fallback floor confirmed default in CLI.  
  _Next step:_ None — verified shipped.
- ✅ **`ADR0002-7`** — MEMORING_LLM_PROXY forces egress=remote so a forwarding/subscription-bridging loopback proxy cannot bypass the gate  
  _Source:_ ADR-0002 Threat model (Mode C) · _Size:_ S · _Priority:_ P1  
  _Evidence:_ apps/cli/provider.ts:28 proxy=isTruthy(MEMORING_LLM_PROXY); :36-51 proxy forces egress='remote' (overrides EGRESS=local with warning); :92 warnSubscriptionProxy loud notice. Mirrored for output layer in apps/cli/output-provider.ts:66  
  _Notes:_ Unsupported path is wired exactly as the threat model promises.  
  _Next step:_ None — verified shipped.
- 🟡 **`ADR0002-8`** — Live wiring (increment 2) — provider/model/base_url selection + CLI opt-in + real backfill run  
  _Source:_ ADR-0002 Deferred (increment 2) · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ PRESENT: apps/cli/provider.ts:18 resolveProvider() reads MEMORING_LLM_BASE_URL/MODEL/EGRESS, enforces remote default-off + MEMORING_LLM_REMOTE_OPT_IN (:56-59); wired into apps/cli/commands/backfill.ts:30, connect.ts:175, watch.ts:86 via runLoop. Real backfill run = `memoring backfill` (backfill.ts cmdBackfill). MISSING/DIVERGENT: selection is via ENV (MEMORING_LLM_*), NOT realm .toml config — RealmConfig (packages/core/realm.ts:31) has no llm/provider/model/base_url field (grep 'llm\|provider\|base_url\|model' over packages/core config = none)  
  _Notes:_ Deferred item largely shipped, but the mechanism is env-based not realm-config-based as the ADR phrased it; functionally equivalent opt-in/selection. Treat config-file selection as the only un-shipped slice. [verify ✓: Confirmed partial. Live wiring + selection + CLI opt-in + real backfill all shipped, but selection mechanism is ENV-based (MEMORING_LLM_*), not realm.toml [llm] config as the ADR p…  
  _Next step:_ Decide whether env-based selection satisfies the ADR or add a realm.toml [llm] block.
- 🟡 **`ADR0002-9`** — API key sourcing from env / OS keychain (never persisted in config)  
  _Source:_ ADR-0002 Deferred (increment 2) · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ PRESENT (env, never-persisted): apps/cli/provider.ts:64 apiKey: process.env.MEMORING_LLM_API_KEY; never written to RealmConfig (realm.ts:31 has no key field); main.ts:84 documents 'never persisted in config'. MISSING (OS keychain): grep -niE 'keychain\|keytar\|libsecret\|generic-password' over apps+packages returns only the openai-compatible.ts:9 COMMENT and unrelated security/key-lifecycle.ts 'WrongCredentialError' — no keychain integration code  
  _Notes:_ Env path shipped and is non-persisted as required; the OS-keychain half of the deferred item is not built (comment-only). [verify ✓: Confirmed partial. Env-sourced, never-persisted half is shipped and verified independently (key is structurally absent from the RealmConfig serialization path). OS-keychain half is comment-only, no integration code and no dependency. Minor evidence-string nit: the R…  
  _Next step:_ Add an OS keychain source (e.g. macOS Keychain) behind the same apiKey resolution, or drop the keychain claim from the comment.
- ❌ **`ADR0002-10`** — Anthropic (Claude) and Google (Gemini) LLM-memory backend adapters  
  _Source:_ ADR-0002 Decision 2 + Deferred · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ packages/integrations/llm/ contains ONLY openai-compatible.ts (ls). grep -niE 'anthropic\|gemini\|generativelanguage\|x-api-key' over apps+packages (excluding claude-code) hits ONLY the secret-scan pattern (security/secret-scan.ts:27) and the import-AI/ADR-0007 feature (integrations/import-ai/index.ts, intake/import-from-ai.ts) — no LlmBackend adapter for Anthropic or Gemini  
  _Blockers:_ ADR0002-3 (LlmBackend boundary — already shipped)  
  _Notes:_ Intentional defer. The Gemini/Claude matches are the unrelated import-from-AI feature, not memory backends. [verify ✓: Confirmed not_implemented. Every anthropic/gemini grep hit is unrelated: secret-scan pattern (security/secret-scan.ts:27), the ADR-0007 import-from-AI feature (integrations/import-ai/index.ts, intake/import-from-ai.ts), and a TODO-style comment in openai-compatible.ts:4 that itse…  
  _Next step:_ Add AnthropicBackend + GeminiBackend implementing LlmBackend behind @integrations/llm.
- ✅ **`ADR0002-11`** — Batched abstract calls (signature batch-capable; caller per-event)  
  _Source:_ ADR-0002 Deferred · _Size:_ S · _Priority:_ P3  
  _Evidence:_ packages/claim/extractor.ts:20 ABSTRACT_BATCH_SIZE=12; :142-146 loops eligible in slices of 12 and calls provider.abstract(batch.map(...)) once per batch; candidate.sourceIndex attributes each result to its input (:156). buildPrompt numbers turns [#N] (llm-provider.ts:57)  
  _Notes:_ The ADR listed this as deferred ('caller is still per-event'), but the caller now batches — this deferred item is actually SHIPPED.  
  _Next step:_ None — verified shipped (mark deferred item closed).
- ❌ **`ADR0002-12`** — Origin-aperture widening — feed tool_result/command_result/file_diff to abstract for fact/project_context/procedure  
  _Source:_ ADR-0002 Deferred · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ packages/claim/extractor.ts:120 `if (event.origin !== 'user') continue;` still restricts abstraction to user-origin only. grep 'tool_result\|command_result\|file_diff' over packages/claim returns nothing — non-user origins never reach abstract()  
  _Notes:_ Intentional defer — touches the ADR-4/G8 invariant and the ADR says it needs its own ADR to resume. [verify ✓: Confirmed not implemented. Notably the supporting infrastructure already exists: enums.ts:24-30 INDEPENDENT_EVIDENCE_ORIGINS includes tool_result/command_result/file_diff/external_artifact, and extractor.ts:119 isIndependentEvidenceOrigin() would admit them — but extractor.ts:120 then re…  
  _Next step:_ Open a follow-up ADR to widen origin aperture while preserving G8 (assistant/host/system still excluded).
- ❌ **`ADR0002-13`** — Non-determinism strategy for LLM-backed integration tests (golden transcripts / recorded responses)  
  _Source:_ ADR-0002 Deferred · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -niE 'golden\|recorded\|cassette\|nock\|fixture' over packages+apps finds no LLM response-recording harness (only unrelated 'recorded KDF params' crypto-primitives.ts:19 and ask.ts:25 'recorded policy digest'). LLM tests use the deterministic injected-mock backend only (openai-compatible.ts:19 fetchImpl)  
  _Blockers:_ ADR0002-10 (more adapters make recorded fixtures more valuable)  
  _Notes:_ Deterministic mock-backend unit tests exist; the 'beyond mock' golden/recorded-response layer is not built. [verify ✓: Confirmed not_implemented. Deterministic injected-mock unit tests exist (llm-provider.test.ts, ask.test.ts) but there is no recorded/golden-response fixture layer for LLM integration tests. The lone 'golden' match is a parser golden over a static input transcript, not an LLM-outp…  
  _Next step:_ Add a recorded-response fixture harness for LLM integration tests if/when live adapters land.

### ADR-0003 — Remote-AI egress gate

*5 items — ✅ 2 · 🟡 0 · ❌ 3*

- ✅ **`ADR0003-1`** — Seal/suppression-aware pre-egress gate (status active + event_identity Seal + pattern Seal) for remote providers  
  _Source:_ ADR-0003 §Decision 1 · _Size:_ S · _Priority:_ P0  
  _Evidence:_ packages/claim/extractor.ts:122 gates on provider.egress==='remote'; :130 `event.status !== 'active'` skip; :131-133 active event_identity Seal via activeSealRulesBySignature(eventSealSignature(...)); :137 matchesActivePatternSeal(ctx,text); plus sensitivity value+state floor :123-124, scope-state floor :128, secret_scan parity :129  
  _Notes:_ Headline decision — fully shipped. Brings remote path to output-Gate suppression parity (not_suppressed/not_redacted/not_deleted).  
  _Next step:_ None — verified shipped; no action.
- ✅ **`ADR0003-2`** — Remote AI default-OFF gated on explicit MEMORING_LLM_REMOTE_OPT_IN, with effective-egress resolution, Mode-A fallback, and proxy-forces-remote  
  _Source:_ ADR-0003 §Decision 2 · _Size:_ S · _Priority:_ P0  
  _Evidence:_ apps/cli/provider.ts:55 effectiveEgress = egress ?? (isLoopback ? local : remote); :56-58 if remote && !optIn → warnRemoteDefaultOff() + return new RuleBasedProvider() (Mode A); :79-87 loud warning names env var + Ollama alternative; :36-50 MEMORING_LLM_PROXY forces remote (rejects EGRESS=local) and then hits the same opt-in gate  
  _Notes:_ Headline decision — fully shipped. Same gate later reused by output layer (apps/cli/output-provider.ts:77, ADR-0011) — not in 0003 scope.  
  _Next step:_ None — verified shipped; no action.
- ❌ **`ADR0003-3`** — Per-scope (per-label) remote_ai_opt_in allow-list — replace realm-granularity opt-in with per-scope allow-list  
  _Source:_ ADR-0003 §Deferred · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ grep -rn 'remote_ai_opt_in\|remoteAiOptIn\|perScopeOptIn\|scopeOptIn\|optInScopes\|optInLabels\|allow-list' apps packages → only a comment at packages/claim/extractor.ts:115 noting it is v0.1/deferred; no code. Opt-in is realm-wide (single MEMORING_LLM_REMOTE_OPT_IN flag, provider.ts:56) authorizing all connected classified scopes.  
  _Notes:_ Intentional deferral — ADR text marks it as a future ADR; needs ADR to resume. Spec §7.5 scope opt-in is the target. [verify ✓: Confirmed not_implemented. Remote egress opt-in is realm-wide (one global flag authorizing all connected classified scopes); per-label/per-scope allow-list is explicitly an in-code-documented v0.1 deferral pointing at ADR-0003 Deferred. No implementing code exists under …  
  _Next step:_ Open a follow-up ADR defining per-label remote_ai_opt_in allow-list semantics before coding.
- ❌ **`ADR0003-4`** — Content-Seal-aware egress: evaluate content_signature Seals against raw event text in the pre-egress gate  
  _Source:_ ADR-0003 §Deferred · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ content_signature Seals exist generally (packages/claim/seal.ts:30 contentSealSignature; packages/security/redaction.ts:196 createSealRule 'content_signature'; entities.ts:224 match_type union) BUT grep -n 'content_signature\|contentSeal\|contentSealSignature' packages/claim/extractor.ts → no hits: the remote pre-egress gate consults only event_identity (extractor.ts:131-133) and pattern (extractor.ts:137) Seals, never content_signature against raw text.  
  _Notes:_ Intentional — ADR notes content Seals are keyed on (kind, normalized statement) not raw text; identity+pattern Seals cover reachable loop cases. Future ADR (paired with ADR0003-3). [verify ✓: Confirmed not_implemented; could not refute after aggressive search. Verified the only raw-text→remote egress path is extractor.ts's abstraction gate, which applies identity+pattern Seals but not content_sig…  
  _Next step:_ Defer with ADR0003-3; revisit only if a raw-text content-Seal egress gap is demonstrated.
- ❌ **`ADR0003-5`** — Full DEK rekey — re-encrypt DB blob + object store payload under a fresh DEK (vs. KEK rotation, which is shipped)  
  _Source:_ ADR-0003 §Deferred (DEK rekey, ADR-0001) · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ KEK rotation IS shipped: packages/security/key-lifecycle.ts:228 rekeyPassphrase (envelope re-encryption of the DEK only), wired via apps/cli/commands/rekey.ts:52. Payload DEK rekey is absent: grep 'payloadRekey\|reEncrypt payload\|fresh DEK\|rotateDek' → none; key-lifecycle.ts:221-222 explicitly documents full DEK rekey (re-encrypt blob+object store under a fresh DEK) as 'a separate, heavier operation' not done.  
  _Notes:_ Intentional deferral, cross-refs ADR-0001 rekey work. Heavy: full payload re-encryption of DB + object store. [verify ✓: Confirmed not_implemented. KEK rotation is shipped and intentionally preserves the same DEK/realm_key so identities/Seals survive; full DEK rekey (regenerate DEK + re-encrypt DB blob + object store payloads) has no implementing code anywhere in apps/packages. The codebase itsel…  
  _Next step:_ Track under ADR-0001 rekey roadmap; scope full payload re-encryption as its own effort when a key-compromise rotation requirement lands.

### ADR-0004 — v0.1 candidates

*8 items — ✅ 0 · 🟡 1 · ❌ 7*

- ❌ **`ADR0004-3`** — HTTP MCP beyond localhost (networked / remote MCP)  
  _Source:_ ADR-0004 §3 · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ Proof of absence: packages/retrieval/mcp.ts exposes only runStdioMcp (mcp.ts:187) as transport; grep for 'mcp.*http\|sse\|streamable\|createServer.*mcp\|listen' in MCP code → 0 transport hits (only comment strings). apps/cli/commands/mcp.ts:17 calls runStdioMcp exclusively. The MCP write surface is correctly limited to memoring_add_memory_candidate (mcp.ts:41,156). Even the Spec §4 localhost-opt-in HTTP binding is unbuilt — MCP is stdio-only.  
  _Notes:_ Intentional defer. Boundary: same Gate on every response, no write beyond add_memory_candidate, off-localhost needs localhost-equiv authn/authz PLUS egress-table adjudication (remote_ai). Note even in-scope localhost HTTP (Spec §4/OUT-013) is not yet implemented, only stdio. [verify ✓: Status holds. Adversarial nuance: an HTTP server DOES exist in the tree (apps/server/main.ts:693 http.createServ…  
  _Next step:_ If networked MCP is wanted, first ship localhost HTTP transport with auth token + origin check, then ADR-gate any off-localhost bind.
- ❌ **`ADR0004-7`** — Connector expansion: Codex, manual-import dir, generic JSONL, Markdown transcript  
  _Source:_ ADR-0004 §7 · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ None of the four named connectors exist. Registry (packages/intake/registry.ts) holds exactly claude_code + import_ai. grep -rni 'codex' packages/ apps/ → only doc/comment strings (apps/cli/main.ts:91, provider.ts:95), no connector. No connectorId for jsonl/markdown-transcript/manual-import-dir source connectors (claude-code/index.ts:22 PAYLOAD_FORMAT='jsonl' is the existing Claude Code connector, not a generic one). The Connector interface is stable (packages/intake/types.ts:23 DetectionResult etc.).  
  _Notes:_ The import_ai connector (packages/integrations/import-ai/index.ts, ADR-0007) is a SEPARATE foreign-AI paste connector — NOT one of ADR-0004's four. Boundary: every new connector must flow the same pipeline (G1 capture-raw-first, G2 parse-or-quarantine no raw loss, G11 realm_key-derived invariant identity, G12 detect→include/exclude, no whole-tool watch, no new egress/Gate bypass). [verify ✓: Conf…  
  _Next step:_ Add connectors incrementally (each registers in registry.ts via the stable Connector interface), preferably starting with generic JSONL/Markdown over guessed-format Codex.
- ❌ **`ADR0004-1`** — AI-native Collections view (AI-themed read model over recall)  
  _Source:_ ADR-0004 §1 · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Proof of absence: grep -rniE 'collections?[-_ ]?view\|collectionsView\|aiCollection' packages/ apps/ --include=*.ts → 0 hits. Also grep -niE 'group\|theme\|collection\|propose\|cluster' packages/retrieval/browse.ts → 0 hits; the only browse surface (apps/server/main.ts via @retrieval/browse listMemoriesForView) is a flat list, not AI-grouped.  
  _Notes:_ Intentional defer; admissible only behind its own ADR (read-only projection through the same Gate, AI may only suggest groupings as candidates, never persisted as authority/evidence). The shipped localhost web panel (apps/server/main.ts, ADR-0010) is a flat read-only view, NOT this collections surface. [verify ✓: Independent search agrees with the audited status. ADR-0004 §1 (docs/adr/0004-v0_1-c…  
  _Next step:_ When prioritized, draft the gating ADR proving same-Gate read-only projection before building grouping over @retrieval/browse.
- ❌ **`ADR0004-2`** — Distributed Realm / encrypted metadata sync across machines  
  _Source:_ ADR-0004 §2 · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Proof of absence: grep -rniE '\bsync\b\|replicaManifest\|multi.?device\|root_hash.*sync\|liveSync' packages/ apps/ --include=*.ts (minus fsync/async noise) → 0 hits. Only carry-not-sync exists: backup_export enum (packages/core/schema/enums.ts:126) + restore (apps/cli/commands/restore.ts:1), which is the boundary the ADR mandates, not the sync feature.  
  _Notes:_ Intentional defer (NFR-032 local-first, no first-party sync; NFR-003/CON-013 no per-domain key boundary inside a Realm). Boundary: no encryption boundary within a Realm, Realms stay unconnected, transport is a user-carried encrypted archive only. [verify ✓: Could not refute after aggressive synonym search (replication/distributed/merkle/p2p/crdt/federation/cloud-transport/cross-realm-link). apps/…  
  _Next step:_ Keep deferred; only revisit behind an ADR that keeps event_identity/content_fingerprint realm_key-derived and rotation/restore-invariant.
- ❌ **`ADR0004-4`** — Recall evaluation dashboard (UI/reporting over recall-quality metrics)  
  _Source:_ ADR-0004 §4 · _Size:_ S · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Dashboard absent: grep -rniE 'dashboard' packages/ apps/ --include=*.ts → 0 hits. The protected MEASUREMENT half DID ship as a test harness (not a service), exactly as the ADR intends: tests/recall-eval.test.ts:1-9 scores safety pass / constraint coverage / stale warning / token budget / opaque-citation consistency over the real Gate-First pipeline, run via `npm run eval`.  
  _Notes:_ Per ADR §Consequences the eval harness (safety-relevant part) lands in v0 as CI test; only the presentation dashboard is deferred. Boundary: a dashboard reads harness output only and must never feed scores back into ranking or the Gate. [verify ✓: Independent search agrees with the audit. The presentation dashboard is genuinely absent from apps/packages; the eval harness exists only as a test (te…  
  _Next step:_ Low value; if built, render tests/recall-eval.test.ts scorecard output read-only, never wire scores into ranking/Gate.
- ❌ **`ADR0004-5`** — Live multi-device sync (real-time Realm replication)  
  _Source:_ ADR-0004 §5 · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Proof of absence: grep -rniE 'multi.?device\|liveSync\|realtimeSync\|ReplicaManifest\|root_hash.*sync' packages/ apps/ --include=*.ts → 0 hits. apps/cli/commands/restore.ts:8 comment explicitly affirms 'no first-party cloud sync, no live multi-device merge (Prohibitions/NFR-032)'. Only backup_export→restore (carry-not-sync) exists.  
  _Blockers:_ ADR0004-2 (shares the sync/server-of-record machinery)  
  _Notes:_ Explicitly prohibited in v0 (NFR-032). Boundary: carry-not-sync — backup_export → user transport → restore of a self-contained client-side-encrypted archive (same_user), no always-on replica, no auto cross-device merge. [verify ✓: Confirmed not_implemented and explicitly prohibited in v0 (NFR-032 / Prohibitions). restore.ts:7-8 affirms "no first-party cloud sync, no live multi-device merge." No r…  
  _Next step:_ Keep prohibited; revisit only with an ADR resolving the conflict/merge + single-writer-Realm tension.
- ❌ **`ADR0004-6`** — Cloud-hosted Memoring service (server-side Realm storage/processing)  
  _Source:_ ADR-0004 §6 · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Proof of absence: no hosted backend; grep -rniE 'cloud\|zero.?knowledge\|rclone\|R2' packages/ apps/ --include=*.ts → only comment strings (e.g. apps/cli/provider.ts:54) and no service. remote_ai_processing exists ONLY as a Gate audience enum/policy axis (packages/core/schema/enums.ts:111; policy.ts:83,123; claim/extractor.ts:123-128) — i.e. the egress boundary, not a server.  
  _Blockers:_ ADR0004-3 (networked surface), ADR0004-2 (server-of-record/archive transport)  
  _Notes:_ Intentional defer; inverts the local-first/sovereign premise. Boundary: if ever offered, zero-knowledge carrier of encrypted archives only (ciphertext, like rclone/R2), never a plaintext processor / key boundary / evidence source; server-side AI = remote_ai_processing under the egress table (default-off, secret_scan_passed). [verify ✓: Could not refute. No hosted backend, no ciphertext upload car…  
  _Next step:_ Do not build; if pursued, ADR-gate as a dumb ciphertext store only, never plaintext processing.
- 🟡 **`ADR0004-8`** — v0 scope correction: v0 ships exactly ONE connector (Claude Code)  
  _Source:_ ADR-0004 §7 (scope correction) · _Size:_ S · _Priority:_ P3 · _roadmap_  
  _Evidence:_ The original claude_code connector is present and registered (packages/integrations/claude-code/index.ts:20; registry.ts). But the 'exactly ONE' assertion is now superseded: registry.ts registers TWO connectors (claude_code + import_ai), the second added later under ADR-0007. So the historical correction holds for the four ADR-0004 connectors, but the post-ADR connector count has moved to two.  
  _Notes:_ Documentation drift, not a code defect: ADR-0004's 'one connector' line is a v0 snapshot superseded by ADR-0007 (import_ai). No action needed beyond awareness that ADR-0004 §7 prose is stale on count. [verify ✓: Confirmed partial. ADR-0004 §7's 'exactly ONE connector (Claude Code)' was a v0 snapshot: claude_code is present and registered, but a second connector (import_ai, added under ADR-0007) i…  
  _Next step:_ Optional: note in ADR-0004 (or rely on ADR-0007) that the connector count advanced from one to two post-freeze.

### ADR-0005 — Design philosophy (FLOOR / B0-B5)

*12 items — ✅ 8 · 🟡 3 · ❌ 1*

- 🟡 **`ADR0005-6`** — B3 separate recall-event signal (last_recalled_at + recall counter) feeding reinforcement WITHOUT folding into valid_recall_count  
  _Source:_ ADR-0005 B3 (lines 122-127) · _Size:_ M · _Priority:_ P1 · _roadmap_  
  _Evidence:_ BUILT: packages/claim/recall.ts implements a separate claim_recall_count:<id> meta key (recall.ts:10-23), writes last_recalled_at (recall.ts:47) and recomputes reinforcement (recall.ts:33-52,54-61) without touching valid_recall_count (deliberate comment recall.ts:37). NOT DRIVEN: grep of recordRecall/recomputeReinforcement across packages/apps shows zero production callers — only recall.ts defs and tests/reinforcement.test.ts:71-73. cross-channel-egress.test.ts:217,275 asserts context.md/MCP recall keeps the counter at 0.  
  _Notes:_ The semantic boundary the ADR demands (separate signal, never overwrite valid_recall_count) is correctly built and unit-tested, but the counter is never incremented by any real recall surface — it fires only on an external re-confirmation path no command invokes yet. This is the live edge of B3/B4. [verify ✓: Confirmed partial; could not refute. The ADR-0005 B3 boundary (separate last_recalled_at…  
  _Next step:_ Wire recordRecall into the explicit external re-confirmation command path (not context.md inclusion).
- 🟡 **`ADR0005-7`** — B4 salience binding frontier: drive the wired-but-dormant signals (last_recalled_at, recall/age inputs to reinforcement(), supersedes chain)  
  _Source:_ ADR-0005 B4 (lines 129-141); Not-in-ADR roadmap lines 210-214 · _Size:_ L · _Priority:_ P1 · _roadmap_  
  _Evidence:_ supersedes IS now driven in production (packages/claim/extractor.ts:191,220 sets predecessor id on supersede during consolidation) — contradicting the ADR's 'always []' claim. age_decay + recall counter feed reinforcement() via recall.ts:34-44. STILL DORMANT: new claims init last_recalled_at:null (extractor.ts:217) and reinforcement_score:0 (extractor.ts:222); last_recalled_at/reinforcement update only via recordRecall, which has no production caller (see ADR0005-6). user_pin/correction_count/conflict_count passed 0 in recall.ts:39-42.  
  _Blockers:_ ADR0005-6  
  _Notes:_ ADR text is now partly stale: supersedes[] is populated and an associative proposer exists. Remaining gap is that recall/age/pin signals are computed but never triggered in production, so reinforcement stays static after creation. Each increment is admissible only behind its own ADR per lines 210-214. [verify ✓: Status "partial" CONFIRMED, but the claim's dormant-set is overstated. The claim says…  
  _Next step:_ Open the per-feature ADR (recall counter -> reinforcement, supersedes/age drivers) and wire signal increments to production recall.
- ✅ **`ADR0005-1`** — Failing structural test on every raw-text egress sink, including the export derivative surface (B1 named FLOOR-track work)  
  _Source:_ ADR-0005 B1 (lines 59-64) · _Size:_ S · _Priority:_ P2  
  _Evidence:_ tests/floor-callgraph.test.ts:51-82 pins the raw-text egress sink allowlist across packages/retrieval/context-pack.ts:writeContextFileSafely, packages/retrieval/search.ts:searchRealm, packages/claim/extractor.ts:remote-pre-egress, and apps/cli/commands/export.ts:backup-export-only (line 82 also asserts 'Only backup_export is implemented').  
  _Notes:_ ADR explicitly flagged this as 'FLOOR-track work, not a new invariant' — it has since shipped as a guardrail test. Test-residing under tests/ but pins production source files, so it governs real code.  
  _Next step:_ None; the named hardening test exists and covers all four current sinks.
- 🟡 **`ADR0005-12`** — Roadmap deferral: HOW to build the association/binding frontier (recall counter, supersedes chain, associative proposer, co-occurrence/semantic edges) is tracked by ADR-0004/0003 Deferred sections, each behind its own ADR  
  _Source:_ ADR-0005 Not-in-ADR (lines 210-214) · _Size:_ L · _Priority:_ P2 · _roadmap_  
  _Evidence:_ Recall counter (recall.ts) and supersedes chain (extractor.ts:191) and one-hop proposer (associate.ts) are built; co-occurrence and semantic-recall edges absent — grep -rn 'co.?occurrence\|cooccur\|semantic.*(recall\|edge)\|embedding' packages apps returns no production edge type beyond supersedes.  
  _Blockers:_ ADR0005-6  
  _Notes:_ Intentional staged delivery: supersedes-link + proposer shipped; co-occurrence/semantic association still deferred behind their own floor-clearing ADRs per the guardrail. [verify ✓: Confirmed partial. ADR-0005 lines 211-214 cite B4/B5 association frontier (recall counter, supersedes chain, associative proposer, co-occurrence edges, semantic recall) as roadmap tracked by ADR-0004/0003 Deferred sec…  
  _Next step:_ Land the per-feature ADR for co-occurrence/semantic edges before wiring them into the proposer.
- ✅ **`ADR0005-2`** — Seal mutator caller allowlist pinned by a structural test (caller ⊆ {redaction.ts, forget CLI})  
  _Source:_ ADR-0005 B1 (lines 85-90) · _Size:_ S · _Priority:_ P2  
  _Evidence:_ tests/floor-callgraph.test.ts:85-101 asserts createSealRule/releaseSealRule callers == ['apps/cli/commands/forget.ts','packages/security/redaction.ts'] and forbids them in retrieval/daemon/loop; seal authority comment at packages/claim/seal.ts:4.  
  _Notes:_ Matches the ADR's stated allowlist verbatim.  
  _Next step:_ None; structural pin matches the decided allowlist.
- ✅ **`ADR0005-3`** — Loop symbol-level guarantee: index-writers allowed, egress readers / Seal mutators forbidden  
  _Source:_ ADR-0005 B1 (lines 97-103); resolved tension lines 167-176 · _Size:_ S · _Priority:_ P2  
  _Evidence:_ tests/floor-callgraph.test.ts:103-127 asserts core/loop.ts imports only ['indexClaim','indexEvent'] from @retrieval/search and never searchRealm/buildContext/handleMcpRequest/createSealRule/releaseSealRule/redact*/forget*.  
  _Notes:_ Symbol-level (not module-level) pin exactly as the ADR describes the loop sharing a module with searchRealm.  
  _Next step:_ None; loop boundary is pinned.
- ✅ **`ADR0005-4`** — Crash-durable forget: tombstone-before-delete ordering + open-time reconciliation sweep (no live-row-to-vanished-blob, no orphan blob)  
  _Source:_ ADR-0005 B1 (lines 78-84) · _Size:_ S · _Priority:_ P2  
  _Evidence:_ packages/storage/encrypted-db.ts:157 reconcileObjects + open-time sweep at :219-248; tombstone-before-delete in packages/security/redaction.ts:27,148-156; storage/repositories.ts:425-428 tombstone upsert. Pinned by tests/storage-durability.test.ts:36 'repairs a crash window after object deletion but before DB flush' and :81 orphan-blob removal.  
  _Notes:_ Both persistence-domain hazards (orphan blob, dangling row) are covered and tested.  
  _Next step:_ None; reconciliation sweep and tombstone ordering exist and are tested.
- ✅ **`ADR0005-8`** — B5 associative proposer: one-hop link proposer on the buildContext path, each candidate individually gated, neighbor held to every()-in-active-scope, never on search/MCP path  
  _Source:_ ADR-0005 B5 (lines 143-160) · _Size:_ S · _Priority:_ P2  
  _Evidence:_ packages/retrieval/associate.ts:40-67 proposeNeighbors over supersedes links; gates each neighbor per-item (associate.ts:59 gate()), uses activeScopeContainsAll (every(), policy.ts:74-77) with crossScopeAllowed:false (associate.ts:44). Wired only into buildContext (context-pack.ts:20,207-214). Confirmed absent from search.ts/mcp.ts (grep -n 'associate\|proposeNeighbors' returned empty).  
  _Notes:_ ADR text ('Today this exists only as... one link type') understates current state: the proposer is built and correctly slotted on buildContext, exactly per B5's prescription incl. the stricter every() neighbor test.  
  _Next step:_ None for the prescribed slice; broader association (co-occurrence/semantic edges) remains roadmap behind its own ADR.
- ✅ **`ADR0005-9`** — B5 inert-by-construction edges: a link to a forgotten/redacted/sealed claim can never revive erased content (validity checked at read time, both endpoints live)  
  _Source:_ ADR-0005 B5 (lines 156-160) · _Size:_ S · _Priority:_ P2  
  _Evidence:_ packages/retrieval/associate.ts:10-16 traversableEndpoint rejects non-consolidated/superseded/conflicted status, conflict_reason==='forgotten', and isClaimSuppressed; both seed (associate.ts:50) and neighbor (associate.ts:55) endpoints re-checked at read time; cross-scope held closed (associate.ts:44).  
  _Notes:_ Read-time both-endpoints-live check makes a physically lingering supersedes ref inert, satisfying the forget-floor interaction the ADR requires.  
  _Next step:_ None; edge inertness is by construction.
- ❌ **`ADR0005-10`** — Self-extension forcing function: the first new structure (a link table, if/when added) must inherit the forget cascade by construction  
  _Source:_ ADR-0005 resolved tension (lines 167-176) · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ No standalone link/edge table exists. grep -rn 'link' packages/storage/schema-ddl.ts and grep for edge/link tables returns no dedicated link table — the only link type is the supersedes[] field on Claim (entities.ts:140), whose inertness is enforced at read time (associate.ts), not via a forget cascade on a separate table. This item is conditional ('if/when added').  
  _Notes:_ Intentional / conditional: the ADR scopes this to a future link table that does not yet exist. No defect today — supersedes lives on the Claim and dies with it. Becomes load-bearing only when a separate edge table is introduced. [verify ✓: Status confirmed after aggressive search. Item is explicitly conditional ("if/when added"); the future link table does not exist, so the forcing function canno…  
  _Next step:_ When introducing a dedicated link/edge table, add a structural test that it inherits the forget/redaction cascade.
- ✅ **`ADR0005-11`** — Headline decision B0/B1-B5 design constitution: maps existing invariants, adds NO new invariant/schema/mechanism  
  _Source:_ ADR-0005 Decision (lines 32-46) + Not-in-ADR (lines 202-209) · _Size:_ S · _Priority:_ P3  
  _Evidence:_ ADR self-scopes as a navigation layer adding no new invariant (lines 35-36, 204-205). Every cited floor mechanism is present: Gate predicate packages/core/policy.ts (activeScopeMatch:67, allowedScopeState:81), sensitivity floor enums.ts maxSensitivityOf, scope default-deny policy.ts:69, forget redaction.ts + storage durability, authority-by-origin claim/validator.ts + seal.ts, loop proposal-only core/loop.ts (pinned by floor-callgraph.test.ts).  
  _Notes:_ As a map ADR there is nothing new to ship; its job is to be accurate. Caveat: its B4 prose ('last_recalled_at only ever null', 'supersedes always []') is now stale vs code at 0e11b3e — see ADR0005-7/8.  
  _Next step:_ Optionally refresh B4 prose to reflect that supersedes is now populated and an associative proposer exists.
- ✅ **`ADR0005-5`** — MCP stdio surface must write via short-lived open->write->close envelopes, never hold the writer lock long-lived over a concurrent forget/Seal  
  _Source:_ ADR-0005 B1 (lines 91-96) · _Size:_ S · _Priority:_ P3  
  _Evidence:_ apps/cli/commands/mcp.ts opens via openResolvedRealm (line 12) and closes with ctx.close(true) (line 20); single-writer fail-closed lock pinned by tests/storage-durability.test.ts:10 'rejects a second live opener so a stale snapshot cannot overwrite a Seal'. mcp.ts uses searchRealm (index read), not buildContext writes.  
  _Notes:_ Envelope discipline holds; the long-lived-writer hazard the ADR warns about is not present.  
  _Next step:_ None; MCP uses read-path + short open/close.

### ADR-0006 — Multi-Realm registry

*13 items — ✅ 9 · 🟡 0 · ❌ 4*

- ✅ **`ADR0006-3`** — Recall resolution order: --realm > sole-base-replica back-compat > CWD unique match > Silence (never current)  
  _Source:_ ADR-0006 §Active root resolution (recall/data) · _Size:_ M · _Priority:_ P2  
  _Evidence:_ packages/core/runtime.ts:167-217 resolveActiveReplicaRoot: explicit --realm 171-178; base short-circuit only when realms.length<=1 (187-194); recall path falls to resolveActiveRealmByCwd (210-213) and returns Silence, never getCurrent; mgmt-only current at 201-208  
  _Notes:_ Recall commands wired via openResolvedRealm(commandClass default 'recall'), e.g. context.ts:24, search.ts:19, forget.ts:29, mcp.ts:12, export.ts:35.  
  _Next step:_ None.
- ✅ **`ADR0006-4`** — CWD match reads each Realm's own realm.toml root_paths + git_remotes before unlock; multi-match Silences  
  _Source:_ ADR-0006 §Active root resolution + CWD note · _Size:_ M · _Priority:_ P2  
  _Evidence:_ packages/core/realm.ts:110-129 resolveActiveRealmByCwd reads candidate.root/realm.toml; matchingProjectsForCwd realm.ts:86-100 matches root_paths (canonicalize) and git_remotes from plaintext .git/config (cwdGitRemotes realm.ts:66-84); 0 match and >1 match both -> silence (realm.ts:127-128)  
  _Notes:_ Reuses existing project matching; registry root field not used as resolution basis (reads per-Realm realm.toml).  
  _Next step:_ None.
- ✅ **`ADR0006-6`** — Back-compat: sole base replica precedence; lazy idempotent registration as 'default'; never moved; read-only base must not block direct access  
  _Source:_ ADR-0006 §Back compatibility · _Size:_ M · _Priority:_ P2  
  _Evidence:_ runtime.ts:180-195 base short-circuits only while sole Realm; ensureLegacyRegistered (realm-registry.ts:142-175) registers name='default' root=base, dedups by id/root, try/catch returns entry on write failure (line 170-174) so direct-root access survives read-only base; replica never relocated  
  _Notes:_ After 2nd Realm registered, base resolves like any other Realm (no longer swallows resolution).  
  _Next step:_ None.
- ✅ **`ADR0006-7`** — Daemon/watch binds one explicit Realm at launch; refuses CWD and current inference  
  _Source:_ ADR-0006 §Daemon/watch · _Size:_ S · _Priority:_ P2  
  _Evidence:_ apps/cli/commands/watch.ts:46-56 resolveActiveReplicaRoot with explicitOnly:true; runtime.ts:197-199 explicitOnly returns Silence before CWD/current tiers, allowing only --realm (explicit branch 171-178) or MEMORING_HOME-as-base sole replica (180-194); apps/daemon/main.ts:6 delegates to cmdWatch  
  _Notes:_ Daemon is a thin wrapper over watch; inherits explicit-only binding.  
  _Next step:_ None.
- ✅ **`ADR0006-8`** — `realm rm <name\|id> --yes`: removes dir+entry, audit ids-only, refuses last Realm / base / containing-other-Realm; repoint current to oldest by created_at, id tiebreak  
  _Source:_ ADR-0006 §Deletion semantics · _Size:_ M · _Priority:_ P2  
  _Evidence:_ apps/cli/commands/realm.ts:181-217 cmdRealmRm: refuse last (191-194), removalSafety base/containment guard with realpath canonical (realm.ts:295-306), confirm() headless/interactive, rmSync THEN removeRealm THEN appendAudit('realm_rm',{realm_id}); nextCurrent oldest-by-created_at + realm_id tiebreak (realm-registry.ts:177-183, invoked by removeRealm 122-130)  
  _Notes:_ Delete-first ordering documented for crash idempotency (realm.ts:202-208); audit only after success.  
  _Next step:_ None.
- ✅ **`ADR0006-1`** — Local plaintext registry realms.toml (0600) under base (0700), metadata-only  
  _Source:_ ADR-0006 §Registry layout · _Size:_ S · _Priority:_ P3  
  _Evidence:_ packages/core/paths.ts:28 registryPath -> base/realms.toml; packages/core/realm-registry.ts:82-89 writeRegistry: ensureDir(base,0o700) + atomicWriteFile(...,0o600); RealmRegistryEntry name/realm_id/root/created_at/key_mode at realm-registry.ts:13-19 (no secrets/payload)  
  _Notes:_ Fully shipped. Skips single malformed row instead of bricking (realm-registry.ts:70-77).  
  _Next step:_ None — verify in code only, no action.
- ❌ **`ADR0006-10`** — Deferred: Web/app UI for switching Realms  
  _Source:_ ADR-0006 §Deferred · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ apps/server/main.ts:7 binds single fixed `const ROOT = process.env.MEMORING_HOME`; grep -n 'listRealms\|registry\|realm use\|switch\|/realm' apps/server/main.ts returns no switching/enumeration endpoint (only withReadOnlyRealm(openRealmLocal(ROOT)) at 620-621)  
  _Notes:_ Intentionally deferred. Web panel is read-only single-Realm (ADR-0010); multi-Realm switch UI not built. [verify ✓: Confirmed not_implemented. Realm registry + switching are fully built but live in the CLI/core layer (`memoring realm use\|list\|...`), which is out of scope for this item. The web UI (apps/server/main.ts) is single-Realm read-only; its scope <select> (line 207) + /api/scopes (665, ct…  
  _Next step:_ Open an ADR to scope a Realm-picker in the web panel before building.
- ❌ **`ADR0006-11`** — Deferred: Cross-Realm features (search/context/listing-as-recall)  
  _Source:_ ADR-0006 §Deferred + §Consequences · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rniE 'cross.?realm\|crossRealm' apps packages -> only a comment in packages/intake/identity.ts:4 ('never ... across Realms'); no cross-Realm search/context code. resolveActiveRealmByCwd resolves exactly one root (realm.ts:123-128); listRealms is metadata enumeration only (realm-registry.ts:91-93)  
  _Notes:_ Intentional — explicitly out of v0; would need a new ADR to resume. [verify ✓: Confirmed not_implemented. No code searches, builds context, or recalls across multiple Realms; multiple-match resolution deliberately fails to Silence rather than merging. Note: original evidence mis-cited resolveActiveRealmByCwd as realm.ts:123-128 — that function is at packages/core/realm.ts:110-129; apps/cli/comman…  
  _Next step:_ Do not build without an ADR; cross-Realm crosses a trust boundary.
- ❌ **`ADR0006-12`** — Deferred: Sync / first-party backup / live multi-device replication  
  _Source:_ ADR-0006 §Deferred · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rniE 'sync\|replicat\|backup\|multi.?device' over apps/cli + packages finds no sync/replication engine for the registry; registry is local-only (paths.ts:23-32, realm-registry.ts). No device-sync code under apps/ or packages/  
  _Notes:_ Intentional roadmap item; out of this ADR's scope. [verify ✓: Status confirmed but original evidence is imprecise: the repo DOES ship a 'backup' feature — `memoring export --purpose backup` (apps/cli/commands/export.ts:1-83, FR-074/075) plus `memoring restore` (apps/cli/commands/restore.ts), producing a backup-manifest.json archive (export.ts:65-77). However this is a deliberately LOCAL, manual, …  
  _Next step:_ Defer to a dedicated sync ADR (likely depends on ADR-0009 distribution).
- ❌ **`ADR0006-13`** — Deferred: Moving/migrating an existing legacy direct replica into base/realms/  
  _Source:_ ADR-0006 §Deferred · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rniE 'migrat\|move.*replica\|relocat' apps packages (excluding migrate_pages/schema) returns nothing; ensureLegacyRegistered (realm-registry.ts:142-175) explicitly registers in place with root=base and never relocates the directory  
  _Notes:_ Intentional — legacy replica is registered in place as 'default', never moved. Migration is a separate future task. [verify ✓: Confirmed not_implemented. Legacy replica is registered in place as 'default' (root=base) and never moved into <base>/realms/. No realm migrate/move command or directory-relocation logic exists. Intentional deferral per ADR-0006 §Deferred. Audited evidence verified indepe…  
  _Next step:_ Defer; design an opt-in `realm migrate` ADR if relocation is later wanted.
- ✅ **`ADR0006-2`** — New Realms via `memoring realm new` live under base/realms/<slug>/  
  _Source:_ ADR-0006 §Registry layout · _Size:_ S · _Priority:_ P3  
  _Evidence:_ apps/cli/commands/realm.ts:48-93 cmdRealmNew; nextRealmRoot/slugify at realm.ts:235-250 -> registryRealmsDir (packages/core/paths.ts:31-32 base/realms); createReplicaAtRoot + addRealm + setCurrent  
  _Notes:_ De-dups slug with -2/-3 suffix; passphrase mode supported.  
  _Next step:_ None.
- ✅ **`ADR0006-5`** — Management commands (list/use/current/rename/rm) may default to registry current pointer  
  _Source:_ ADR-0006 §Active root resolution (mgmt) · _Size:_ S · _Priority:_ P3  
  _Evidence:_ apps/cli/commands/realm.ts:26-46 dispatch; cmdRealmCurrent uses commandClass 'mgmt' (realm.ts:132-136) which returns getCurrent root (runtime.ts:201-208); main.ts:32-36 usage lines; --realm overrides via resolveExplicitRealm (runtime.ts:171-178)  
  _Notes:_ realm use sets current (realm.ts:124); doctor also uses mgmt class (doctor.ts:16).  
  _Next step:_ None.
- ✅ **`ADR0006-9`** — Frozen open APIs unchanged; resolver computes root then calls them; Gate unchanged  
  _Source:_ ADR-0006 §Consequences · _Size:_ S · _Priority:_ P3  
  _Evidence:_ runtime.ts:107-147 openRealm/openRealmLocal/openActiveRealm/attachRealm signatures take root; resolveActiveReplicaRoot returns a root string consumed by openResolvedRealm (runtime.ts:219-231) -> openActiveRealm; replicaLayout(root) at paths.ts; no Gate changes in resolver  
  _Notes:_ Resolution is a pre-step that only selects which Realm to open.  
  _Next step:_ None.

### ADR-0007 — Import from AI

*14 items — ✅ 11 · 🟡 0 · ❌ 3*

- ✅ **`ADR0007-1`** — Headline: `memoring import` paste-export ingestion (host_memory Event + candidate Claim, user-promote authority)  
  _Source:_ ADR-0007 Decision / §a-b · _Size:_ L · _Priority:_ P0  
  _Evidence:_ apps/cli/commands/import.ts:28 cmdImport + main.ts:108 router; packages/intake/import-from-ai.ts:91 ingestImport creates host_memory Event via capture()/normalizeOccurrence() and candidate Claim (status:'candidate', created_by:'ai', evidence_event_identities:[] at :186-188); packages/integrations/import-ai/index.ts:227 origin:'host_memory'  
  _Notes:_ Fully shipped end-to-end; ADR Status already 'implemented'. Reuses existing pipeline + NON_EVIDENCE_ORIGINS floor.  
  _Next step:_ None — verify with tests/import-from-ai.test.ts in CI.
- ✅ **`ADR0007-10`** — Consequences: indexClaim/claimScopeState fallback to claim's own explicit_user Assignment when a consolidated claim has no evidence-derived labels  
  _Source:_ ADR-0007 Consequences (3rd bullet) · _Size:_ S · _Priority:_ P0  
  _Evidence:_ packages/retrieval/search.ts:84-86 label fallback `if (ids.size===0) ... listAssignmentsForTarget('claim', claim.claim_id)`; claimScopeState fallback at :97-99  
  _Notes:_ No-op for evidence-backed claims (their labels resolve from evidence above); makes evidence-less promoted imports recallable.  
  _Next step:_ None.
- ✅ **`ADR0007-2`** — §a Auto-consolidation skip guard: candidate carrying import:claim:<id> marker is neither consolidated nor rejected  
  _Source:_ ADR-0007 §a 'Where auto-consolidation stops' · _Size:_ S · _Priority:_ P0  
  _Evidence:_ packages/claim/consolidation.ts:95 `if (ctx.store.getMeta(importClaimMetaKey(c.claim_id)) !== undefined) continue;`; marker set at import-from-ai.ts:150  
  _Notes:_ The single line holding back the loop's authority machinery for imports — present and load-bearing.  
  _Next step:_ None.
- ✅ **`ADR0007-3`** — §a/Promotion: `import promote` confers user authority (consolidated, created_by:user, explicit_user scope Assignment, explicit sensitivity, index); `reject` settles rejected  
  _Source:_ ADR-0007 §a 'Promotion = user authority' · _Size:_ M · _Priority:_ P0  
  _Evidence:_ packages/intake/import-from-ai.ts:250 promoteImportedClaim (status:'consolidated' :284, created_by:'user' :285, explicit_user Assignment :273, sensitivity required :260) and rejectImportedClaim :301; CLI wiring apps/cli/commands/import.ts:148-181 with indexClaim at :164  
  _Notes:_ Per-item explicit human action enforced; no auto path to authority.  
  _Next step:_ None.
- ✅ **`ADR0007-4`** — §b Dedicated `import_ai` Connector reusing capture()/normalize(); detect()/read() return nothing so resident loop ignores imports  
  _Source:_ ADR-0007 §b · _Size:_ M · _Priority:_ P0  
  _Evidence:_ packages/integrations/import-ai/index.ts:199 importAiConnector with detect() returning sources:[] (:208) and read() returning [] (:214); ingestImport calls capture() then normalizeOccurrence() at import-from-ai.ts:96-97  
  _Notes:_ Capture-raw-first preserved (capture before parse).  
  _Next step:_ None.
- ✅ **`ADR0007-7`** — §e Sensitivity & double secret-scan: scan in normalizeOccurrence AND per-entry before candidate; secret entry creates no candidate; promote requires explicit --sensitivity  
  _Source:_ ADR-0007 §e · _Size:_ M · _Priority:_ P0  
  _Evidence:_ packages/intake/import-from-ai.ts:138 scanText(entry.statement)\|\|scanText(entry.quote) → secretSkipped, no candidate; Event-level scan inside normalizeOccurrence; candidates default 'unknown' (:200); promote sensitivity_required at :260  
  _Notes:_ Per-entry scan also covers the Gemini 根拠 quote (defense-in-depth beyond the Event scan).  
  _Next step:_ None.
- ✅ **`ADR0007-5`** — §c Tolerant parser parseExport: Claude format + Gemini format, auto-detect, quarantine on unrecognizable, category→kind map  
  _Source:_ ADR-0007 §c · _Size:_ M · _Priority:_ P1  
  _Evidence:_ packages/integrations/import-ai/index.ts:148 parseExport; parseClaude :88, parseGemini :107, isGeminiFormat :143, categoryToKind :49; quarantine on no entries via {ok:false} → normalize.ts:72 writes QuarantineRecord  
  _Notes:_ Only two parser formats ship (Claude+Gemini), exactly as §c says 'both shipped formats'. ChatGPT has NO dedicated parser — uses Claude-format parser + shared prompt; consistent with ADR, not a gap.  
  _Next step:_ None.
- ✅ **`ADR0007-6`** — §d Content-anchored stable identity & cross-re-export dedup: message_id=entry:<sha256(provider\|kind\|statement\|date)>, session=import:<provider>  
  _Source:_ ADR-0007 §d · _Size:_ M · _Priority:_ P1  
  _Evidence:_ packages/integrations/import-ai/index.ts:164 importMessageId, :173 importSessionId; eventIdentity HMAC under realm_key at import-from-ai.ts:122; per-entry idempotency via importEventClaimMetaKey check at import-from-ai.ts:131  
  _Notes:_ Session id deliberately NOT blob-derived (comment :168-172); raw-layer byte dedup via content_fingerprint in capture also relied on.  
  _Next step:_ None.
- ✅ **`ADR0007-8`** — §f Provenance tagging: host_memory origin as machine tag; import:claim:<id> marker stores {provider,date,source_event_identity}; quote in encrypted source_extra_ref  
  _Source:_ ADR-0007 §f · _Size:_ M · _Priority:_ P1  
  _Evidence:_ packages/integrations/import-ai/index.ts:227 origin:'host_memory' + extra import_provider/import_kind/import_quote/import_date (:236-242, never indexed); ImportProvenance written to import:claim meta at import-from-ai.ts:144-150; surfaced by import list (apps/cli/commands/import.ts:138)  
  _Notes:_ Promoted claim becomes created_by:user but import lineage retained for audit; carries no evidence events so never re-emitted as first-party evidence.  
  _Next step:_ None.
- ✅ **`ADR0007-11`** — §b/G12 `--dry-run` per-entry Inventory (parse + show, persist nothing)  
  _Source:_ ADR-0007 §b / FLOOR #4 (G12) · _Size:_ S · _Priority:_ P2  
  _Evidence:_ apps/cli/commands/import.ts:99-112 isDryRun branch prints per-entry Inventory and returns without persisting; dirty=false on dry-run (:52)  
  _Notes:_ Per-item include via promote, never whole-tool default — satisfies G12.  
  _Next step:_ None.
- ✅ **`ADR0007-9`** — §g Export-prompt helper `import --print-prompt <claude\|gemini\|chatgpt>` (pure local print, no egress)  
  _Source:_ ADR-0007 §g · _Size:_ S · _Priority:_ P2  
  _Evidence:_ packages/integrations/import-ai/index.ts:291 exportPromptFor (claude/chatgpt/openai→CLAUDE_EXPORT_PROMPT, gemini/google→GEMINI_EXPORT_PROMPT); CLI printPrompt at apps/cli/commands/import.ts:183 with --print-prompt handled before Realm open (:32-33)  
  _Notes:_ chatgpt maps to the generic English (Claude-style) prompt — matches §g/§c.  
  _Next step:_ None.
- ❌ **`ADR0007-12`** — Not in this ADR: UI for import operations (CLI is source of truth)  
  _Source:_ ADR-0007 'Not in this ADR' · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rn 'import' apps/server apps/daemon --include='*.ts' returns no import-command surface (only TS module imports); web/UI import write path deferred. Owner-write Web surface tracked separately in ADR-0010 (docs-only per MEMORY).  
  _Blockers:_ ADR0007-1 (shipped); needs ADR-0010 owner-write surface to land first  
  _Notes:_ Intentional — explicitly excluded; CLI is the operational source of truth. [verify ✓: Confirmed not_implemented (intentional exclusion). ADR-0007 'Not in this ADR' (0007-import-from-ai.md:221-223): "UI (the source of truth for operations is the CLI)." Independent search agrees: import list/promote/reject is CLI-only; the web server exposes no write/import path (GET-only read-only browser). Owner-…  
  _Next step:_ Defer until ADR-0010 owner-write Web surface ships, then expose import list/promote/reject there.
- ❌ **`ADR0007-13`** — Not in this ADR: Bulk / file-watched import directories  
  _Source:_ ADR-0007 'Not in this ADR' · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ import_ai Connector detect()/read() deliberately return empty (packages/integrations/import-ai/index.ts:208,214); grep -rn 'watch\|chokidar\|importDir\|bulk' packages/integrations/import-ai apps/cli/commands/import.ts → none  
  _Blockers:_ ADR0007-1  
  _Notes:_ Intentional — a paste has nothing to watch; forcing detect()/watch would be 'a lie' per §b. Would need its own ADR to resume. [verify ✓: Confirmed not implemented. Adversarial sweep surfaced one near-hit: apps/cli/commands/watch.ts:113-115 uses fs.watch recursively — but this is the daemon's connector-source consolidation loop (FR-008/037/038), watching transcript dirs derived from connector.dete…  
  _Next step:_ Leave deferred; open an ADR if file-watched bulk import is wanted.
- ❌ **`ADR0007-14`** — Not in this ADR: first-party export of Memoring's own memory as a foreign-AI prompt target (reverse direction beyond --print-prompt)  
  _Source:_ ADR-0007 'Not in this ADR' · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Only exportPromptFor (prints the prompt to run elsewhere) exists; grep -rn 'export.*memory\|exportMemory\|dumpClaims\|exportRealm' apps packages --include='*.ts' → no first-party memory-export-as-prompt path  
  _Notes:_ Intentional exclusion; the bidirectional helper stops at printing the prompt. Outbound memory export would cross egress concerns (Gate) and needs its own ADR. [verify ✓: Confirmed not_implemented. The bidirectional helper stops at printing the inbound export prompt (exportPromptFor). The existing `memoring export` is a separate durability/backup feature (encrypted vault copy), not the ADR-0007-ex…  
  _Next step:_ Leave deferred; requires a dedicated ADR (egress review) before building.

### ADR-0008 — CLI upgrade path

*8 items — ✅ 5 · 🟡 0 · ❌ 3*

- ✅ **`ADR0008-1`** — Single dynamic source of truth (version.ts: packageVersion, specVersion, versionLine)  
  _Source:_ ADR-0008 §Decision.1 · _Size:_ S · _Priority:_ P0  
  _Evidence:_ packages/core/version.ts:37,40,43 export packageVersion/specVersion/versionLine; reads relative to source via fileURLToPath at version.ts:21 (not cwd); VERSION file present (=1.0.0), package.json version=0.1.2  
  _Notes:_ Headline decision. Fully shipped; resolves the 4-string drift the ADR was written to fix.  
  _Next step:_ None — verified complete.
- ✅ **`ADR0008-2`** — `memoring version` / `--version` print versionLine()  
  _Source:_ ADR-0008 §Decision.1 · _Size:_ S · _Priority:_ P0  
  _Evidence:_ apps/cli/main.ts:150-152 cases 'version' and '--version' call console.log(versionLine()); import at apps/cli/main.ts:22  
  _Blockers:_ ADR0008-1  
  _Notes:_ ADR text only mandates 'version' and '--version'; grep for '-v' short flag in apps/cli/main.ts returned nothing, but ADR never required it, so not a gap.  
  _Next step:_ None — verified complete.
- ✅ **`ADR0008-3`** — MCP serverInfo.version reuses packageVersion  
  _Source:_ ADR-0008 §Decision.1 · _Size:_ S · _Priority:_ P0  
  _Evidence:_ packages/retrieval/mcp.ts:144 serverInfo: { name: 'memoring', version: packageVersion }; import at packages/retrieval/mcp.ts:9  
  _Blockers:_ ADR0008-1  
  _Notes:_ Prior hardcoded 'v0' removed; grep for 'v0'/'spec-v1.0'/'memoring v0' in apps+packages returned nothing.  
  _Next step:_ None — verified complete.
- ✅ **`ADR0008-4`** — vitest pins versionLine to package.json + VERSION so they cannot silently diverge  
  _Source:_ ADR-0008 §Decision.1 · _Size:_ S · _Priority:_ P0  
  _Evidence:_ tests/version.test.ts:9,13,15,24-26 reads package.json and VERSION independently and asserts versionLine() toContain both  
  _Blockers:_ ADR0008-1  
  _Notes:_ Test-only artifact, but ADR explicitly requires the test; lives at tests/version.test.ts.  
  _Next step:_ None — verified complete.
- ✅ **`ADR0008-5`** — Upgrade path now (pre-publish): git pull + conditional npm install, source-only via tsx  
  _Source:_ ADR-0008 §Decision.2 · _Size:_ S · _Priority:_ P3  
  _Evidence:_ package.json private:true (package.json:4) confirms still pre-publish source-only model; no build/relink step required — version.ts:21 resolves source live; this is a docs/process decision, no further code surface needed  
  _Notes:_ Process/docs decision, not a code feature. Current state (private:true) matches the documented now-model.  
  _Next step:_ None — process holds while private:true.
- ❌ **`ADR0008-6`** — Future v1 publish: flip private→false and npm publish  
  _Source:_ ADR-0008 §Decision.3 / §Deferred · _Size:_ S · _Priority:_ P3 · _roadmap_  
  _Evidence:_ package.json:4 still "private": true; grep 'npm publish\|npm install -g memoring\|npm update -g' over apps+packages returned NO MATCHES  
  _Notes:_ Intentionally deferred to v1 (ADR §Deferred: 'v1 work'). Correctly not built. [verify ✓: Independent search agrees with the audit. The v1 publish flip (private->false + npm publish) is intentionally deferred per ADR-0008 §Deferred ("v1 work") and is correctly absent. No publish/registry/CI automation exists to constitute even a partial implementation. Status stands as not_implemented; next step a…  
  _Next step:_ At v1 release, flip private→false and run npm publish.
- ❌ **`ADR0008-7`** — Opt-in update-notifier (registry compare, no telemetry, non-blocking, throttled, stderr-only, no auto-update) — the 6 constraints  
  _Source:_ ADR-0008 §Decision.4 / §Deferred · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rniE 'update.?notifier\|update.?check\|MEMORING_NO_UPDATE_CHECK\|registry.npmjs\|update available\|auto.?update' over apps+packages returned only a comment in packages/core/version.ts:6; no implementation  
  _Blockers:_ ADR0008-6  
  _Notes:_ Explicitly deferred (YAGNI until publish). ADR is a guardrail: whoever adds it must honor the 6 constraints (opt-in/default-off, no telemetry, non-blocking fail-silent, throttled ≤1/day cached, stderr-only, never auto-update). MEMORING_NO_UPDATE_CHECK env var not yet wired. [verify ✓: Confirmed not_implemented under adversarial search. Only reference is the explanatory comment in packages/core/ve…  
  _Next step:_ At publish time, implement notifier honoring §Decision.4's six constraints.
- ❌ **`ADR0008-8`** — Auto-update mechanism — explicitly out of scope now and at v1  
  _Source:_ ADR-0008 §Deferred · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep 'auto.?update' over apps+packages returned NO MATCHES (only constraint prose in ADR)  
  _Notes:_ Intentional permanent exclusion ('out of scope, now and at v1'). Absence is the correct state; would need a new ADR to ever resume. [verify ✓: Confirmed absent. The sole reference is a forward-looking comment in version.ts deferring an update-notifier to "a future opt-in" per ADR-0008; nothing implements an update check, download, or self-update. Intentional permanent exclusion; absence is the co…  
  _Next step:_ None — keep absent; requires new ADR to revisit.

### ADR-0009 — Distribution & install UX

*7 items — ✅ 0 · 🟡 0 · ❌ 7*

- ❌ **`ADR0009-2`** — Phase 1 — publish to npm (flip private→false + npm publish)  
  _Source:_ ADR-0009 §Decision table Phase 1; §Deferred bullet 1 · _Size:_ S · _Priority:_ P1 · _roadmap_  
  _Evidence:_ Absence: `grep -nE '"(private\|publishConfig\|provenance)"' package.json` → package.json:4 `"private": true`, no publishConfig, no provenance field. Phase 1 is explicitly deferred to v1 per ADR-0008.  
  _Blockers:_ none technically; ADR-0009 ties timing to v1 cut  
  _Notes:_ Cheapest rung, already specified by ADR-0008. Phase 1 still leaves the native-dep reliability gap (ADR0009-4). [verify ✓: Confirmed not_implemented. ADR-0009 §Decision table Phase 1 (line 50) and §Status (line 101) explicitly defer "flip private→false + npm publish (with provenance)" to v1 per ADR-0008; line 21 records package.json is currently private. No implementing code exists in apps/ or pac…  
  _Next step:_ At v1 cut: set package.json private:false, add npm publish (with provenance) to release.
- ❌ **`ADR0009-5`** — Native-dependency / SQLite-engine ADR (options a/b/c) — gates Phases 2-3  
  _Source:_ ADR-0009 §Gating prerequisite; §Deferred bullet 2 · _Size:_ L · _Priority:_ P1 · _roadmap_  
  _Evidence:_ Absence of resolution: `grep -rnE 'better-sqlite3\|node:sqlite' apps packages` → only packages/storage/encrypted-db.ts:8 `import Database from 'better-sqlite3'`; zero `node:sqlite` imports. package.json deps still list `better-sqlite3: ^11.8.1`. No dedicated ADR file beyond 0009. So option (a) migrate not done, no prebuild/CI coverage (b) (no .github/workflows dir at all), no bundling (c).  
  _Blockers:_ none — this is the gating decision itself  
  _Notes:_ Contract-level decision (storage invariants §5.1 / ADR-0001). Explicitly deferred to its own ADR; must precede Phase 2. This is the true critical-path blocker. [verify ✓: Confirmed not_implemented. This is the gating decision itself — explicitly deferred in ADR-0009 (lines 3, 57-73, 103). None of the three options (a node:sqlite migration, b guaranteed prebuilds + CI coverage, c bundle .node) has…  
  _Next step:_ Author the SQLite-engine ADR choosing among (a) node:sqlite, (b) guaranteed prebuilds, (c) bundle .node.
- ❌ **`ADR0009-3`** — Phase 2 — Homebrew formula / tap (brew install)  
  _Source:_ ADR-0009 §Decision table Phase 2; §Deferred bullet 1 · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ Absence: `find . -not -path '*/node_modules/*' \( -iname '*.rb' -o -ipath '*HomebrewFormula*' -o -iname '*formula*' \)` → no matches in repo.  
  _Blockers:_ ADR0009-5 (native-dependency strategy ADR must resolve first)  
  _Notes:_ Gated by the SQLite-engine decision per the ADR. [verify ✓: Confirmed not_implemented. Aggressive search (synonyms: brew, tap, formula, goreleaser, HomebrewFormula, .rb, CI release workflows) found zero implementing code in apps/packages. The single 'formula' hit in recall.ts is an unrelated scoring-field comment. Homebrew exists only as ADR-0009 Phase 2 prose, gated on ADR0009-5 (SQLite-engine/n…  
  _Next step:_ After ADR0009-5 lands, author a Homebrew formula/tap.
- ❌ **`ADR0009-7`** — Ethos constraints on installers (no init/no ~/.memoring touch, no telemetry, verifiable artifacts)  
  _Source:_ ADR-0009 §Distribution must not erode the ethos · _Size:_ S · _Priority:_ P2 · _roadmap_  
  _Evidence:_ Vacuous — no installer exists to carry the constraints. `grep -rniE 'telemetry\|analytics' apps packages` → zero (no telemetry present in code today, consistent with the constraint). No installer scripts exist (ADR0009-4). npm provenance not configured (package.json has no provenance field).  
  _Blockers:_ ADR0009-2 / ADR0009-4 (constraints attach to the not-yet-built install channels)  
  _Notes:_ Codebase is currently telemetry-free, which aligns with the constraint, but the constraint is unenforced because there is no installer artifact yet. Enforce when ADR0009-2/3/4 build. [verify ✓: Confirmed not_implemented. The constraint is vacuous because no install channel exists (blocked on ADR0009-2/4). The `memoring init` CLI command (apps/cli/commands/init.ts:87, main.ts:101) is a deliberate …  
  _Next step:_ When building any installer, add asserts: PATH-only, no init, npm provenance + published checksums.
- ❌ **`ADR0009-1`** — Phased distribution roadmap (headline decision) — ships no code  
  _Source:_ ADR-0009 §Decision / Status line · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ ADR self-declares 'Status: Accepted (plan only)' and '§Consequences: No frozen invariant moves and no code changes ship with this ADR.' Current state = Phase 0 only: root package.json:4 still `"private": true`; install is from-source (`bin`: bin/memoring.mjs, scripts run via tsx). No distribution code added.  
  _Blockers:_ none (this is the umbrella; sub-items below are the work)  
  _Notes:_ Intentional roadmap-only ADR. Builds on ADR-0008. Item recorded for completeness; the real work is ADR0009-2..6. [verify ✓: Umbrella roadmap ADR; ships no code by design (ADR §Consequences: "No frozen invariant moves and no code changes ship with this ADR"). Current state = Phase 0 only. Real work tracked in sub-items ADR0009-2..6. Independent search agrees with the audited status.]  
  _Next step:_ Track via the per-phase items below; no action on the umbrella itself.
- ❌ **`ADR0009-4`** — Phase 3 — self-contained binary + `curl \| sh` installer  
  _Source:_ ADR-0009 §Decision table Phase 3; §Deferred bullet 1 · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Absence: `find . -not -path '*/node_modules/*' \( -name install.sh -o -name install -o -iname '*installer*' \)` → none; `grep -rnE 'prebuild\|pkg\|nexe\|sea\|single-executable' apps packages` → only unrelated import-provenance hits, no packaging tooling.  
  _Blockers:_ ADR0009-5 (needs packaging mechanism that embeds the native binary)  
  _Notes:_ Highest-effort rung; depends on native-dep resolution and a SEA/pkg packaging mechanism. [verify ✓: Confirmed not_implemented. bin/memoring.mjs is a source-only tsx launcher (Phase 1 npm distribution), not a SEA/pkg single executable. No curl\|sh installer, no checksums, no Homebrew formula, no release CI anywhere in apps/packages. ADR-0009 §Deferred (line 99-102) explicitly defers Phase 3. Blocke…  
  _Next step:_ After ADR0009-5, choose a single-executable mechanism then build the curl\|sh installer + checksums.
- ❌ **`ADR0009-6`** — Windows packaging specifics + signing / notarization for native installer  
  _Source:_ ADR-0009 §Deferred bullet 3 · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Absence: no installer/packaging artifacts exist at all (see ADR0009-4 grep); `ls .github/workflows` → directory absent, so no signing/notarization pipeline.  
  _Blockers:_ ADR0009-4 (only relevant once a native installer/binary exists)  
  _Notes:_ Explicitly deferred. Cross-platform + code-signing concern, only meaningful at Phase 3. [verify ✓: Confirmed not_implemented. No native binary or installer exists at all (blocker ADR0009-4), so the downstream Windows-packaging/signing/notarization work cannot and does not exist. The four code grep hits are unrelated false positives. Original status and blocker stand.]  
  _Next step:_ Defer until Phase 3 binary exists; then add Windows build + signing/notarization.

### ADR-0010 — Web control panel

*16 items — ✅ 1 · 🟡 0 · ❌ 15*

- ✅ **`ADR0010-15`** — Audience/Gate read path unchanged (baseline invariant, must stay intact)  
  _Source:_ ADR-0010 §2 / Invariants · _Size:_ S · _Priority:_ P0  
  _Evidence:_ packages/retrieval/browse.ts:40 audience:'human_local_view', :43 crossScopeAllowed:false, :47 listClaimsByStatus(realm,'consolidated'); server reads via listMemoriesForView (apps/server/main.ts:3 import, :674-678 usage). Matches ADR's 'reads stay exactly as today'.  
  _Notes:_ Not a deferred item — it is the must-not-regress baseline; included so the invariant is on record. Verify it stays unchanged when writes land.  
  _Next step:_ Add a regression test pinning the consolidated-only/human_local_view read contract before phase 2.
- ❌ **`ADR0010-1`** — Host header allowlist on EVERY request, fail-closed (DNS-rebinding gate)  
  _Source:_ ADR-0010 §1 / §6 Phase 1 · _Size:_ S · _Priority:_ P1 · _roadmap_  
  _Evidence:_ grep -niE 'origin\|host header\|x-forwarded\|rebind' apps/server/main.ts → no matches. Handler at apps/server/main.ts:646 does method check then routes with no Host validation.  
  _Notes:_ ADR calls this closing a pre-existing read-only gap; sequenced first in phase 1. [verify ✓: Confirmed not_implemented via independent search across apps + packages on the worktree pinned to origin/main (HEAD 0e11b3e). No Host allowlist, no fail-closed rejection, no req.headers.host read anywhere. Handler is fail-OPEN to DNS-rebinding: it serves any Host because it ignores the inbound Host header …  
  _Next step:_ Reject unless Host is exactly 127.0.0.1:<port> or localhost:<port>, before routing.
- ❌ **`ADR0010-11`** — Close CLI audit gap: audit realm new/use/rename + connect at shared orchestration layer (phase-2 prerequisite)  
  _Source:_ ADR-0010 §1 / Consequences / §6 Phase 2 · _Size:_ M · _Priority:_ P1 · _roadmap_  
  _Evidence:_ Only realm_rm audits: apps/cli/commands/realm.ts:211 is the sole appendAudit; realm new/use/rename/connect emit none. No shared audited orchestrator (cmd dispatch at realm.ts:30-40 calls primitives directly). appendAudit takes free-form op:string (packages/security/audit.ts:12); 'realm_new'/'realm_use'/'realm_rename' appear nowhere in apps/packages (grep → none).  
  _Blockers:_ none (pure CLI/core change; gates ADR0010-9)  
  _Notes:_ ADR mandates audit live in shared creation orchestrator, NOT in addRealm/setCurrent primitives (would emit phantom records via ensureLegacyRegistered). [verify ✓: Confirmed not_implemented after adversarial search. Audited worktree /Users/spesan/Documents/memoring-audit (pinned to origin/main 0e11b3e). Full audit-op vocabulary in apps+packages = realm_rm, backup_export, redact, delete, seal_patte…  
  _Next step:_ Introduce shared audited orchestrator for realm new/connect and have CLI+web both call it.
- ❌ **`ADR0010-2`** — Origin allowlist when present (cross-site fetch defense)  
  _Source:_ ADR-0010 §1 · _Size:_ S · _Priority:_ P1 · _roadmap_  
  _Evidence:_ grep -rniE 'origin' apps/server → no header check (only CSS/JS string hits). No Origin comparison in apps/server/main.ts.  
  _Blockers:_ ADR0010-1 (same pre-routing gate block)  
  _Notes:_ Reject non-loopback Origin when present; token covers Origin-absent case. [verify ✓: Confirmed not_implemented. No Origin header check, no allowlist, no loopback-Origin rejection. The server's sole defense is binding to 127.0.0.1 (L5/L700). Cross-site fetch / DNS-rebinding is undefended (req.headers never read). Note: the blocker ADR0010-1 (Host gate) is also absent — L652 uses the HOST constant,…  
  _Next step:_ Add Origin check alongside the Host gate in the same pre-routing block.
- ❌ **`ADR0010-3`** — Per-session capability token (random, in-memory, fragment delivery, constant-time compare)  
  _Source:_ ADR-0010 §1 / §6 Phase 1 · _Size:_ M · _Priority:_ P1 · _roadmap_  
  _Evidence:_ grep -rniE 'token\|capability\|location.hash\|#t=\|fragment\|timingSafeEqual\|randomBytes\|crypto' apps/server → no matches. No token generation, delivery, or compare in apps/server/main.ts.  
  _Notes:_ 0600 file persistence optional+OFF by default; fragment-only delivery preferred per §1. [verify ✓: Confirmed not_implemented. Per-session capability token (random, in-memory, #t= fragment delivery, constant-time compare) is absent; the web panel relies solely on 127.0.0.1 binding with no token gate on /api/*. Audit's proof-of-absence is accurate and reproducible.]  
  _Next step:_ Generate per-process random token on serve, print URL with #t=, require on /api/*.
- ❌ **`ADR0010-4`** — Token required on every /api/* read+write; GET / token-exempt but still Host-checked  
  _Source:_ ADR-0010 §1 (Reads require the token too) · _Size:_ S · _Priority:_ P1 · _roadmap_  
  _Evidence:_ apps/server/main.ts:665 (/api/scopes) and :673 (/api/memories) serve with no auth; 401 path absent (grep '401' apps/server → none).  
  _Blockers:_ ADR0010-3 (token must exist), ADR0010-1 (Host gate)  
  _Notes:_ Missing/invalid token on /api/* = hard 401 regardless of method/Origin. [verify ✓: Confirmed not_implemented. Neither token enforcement, 401 path, nor Host gate exists on /api/*; both /api/scopes and /api/memories return 200 unauthenticated. apps/daemon/main.ts does not wrap or intercept the server. The token requirement (and its ADR0010-3/ADR0010-1 blockers) is documented as deferred future work…  
  _Next step:_ Enforce 401 on tokenless /api/* while exempting GET / from token only.
- ❌ **`ADR0010-0`** — Headline: turn read-only web panel into owner write surface (plan-only ADR)  
  _Source:_ ADR-0010 Status/§Decision · _Size:_ L · _Priority:_ P2 · _roadmap_  
  _Evidence:_ ADR line 3 'plan only — no code or behaviour change ships'. Server still read-only: apps/server/main.ts:646-647 rejects all non-GET with 405; routes are only GET /api/scopes (:665) and GET /api/memories (:673); opens single Realm via openRealmLocal(ROOT) at :621. No write surface exists.  
  _Blockers:_ none (it is the umbrella; sub-items below)  
  _Notes:_ Intentional — ADR is a boundary-fixing plan, no code by design. Tracks the whole effort. [verify ✓: Confirmed not_implemented. Independent search agrees with the audit; cited file:line evidence is accurate against worktree at 0e11b3e. ADR-0010 is intentionally a boundary-fixing plan with no shipping code — the umbrella item for the future write-surface effort.]  
  _Next step:_ Start phase-1 PR (Origin/Host + token scaffold) per §6.
- ❌ **`ADR0010-10`** — Phase 2: import paste→review→promote/reject on dedicated owner-only review endpoint + egress test  
  _Source:_ ADR-0010 §3 / §6 Phase 2 · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ grep -rniE 'listImportedCandidates\|ingestImport\|promoteImportedClaim\|candidate endpoint' apps/server → none (the :418 'candidate' hit is a JS array.find var, not import). listImportedCandidates exists only in core: packages/intake/import-from-ai.ts:219.  
  _Blockers:_ ADR0010-3/4 (token is SOLE guard on candidate plaintext), ADR0010-8  
  _Notes:_ Highest correctness risk per ADR: candidate plaintext has no Gate/audience filter (import-from-ai.ts:219), only the token guards it. Phase 2 MUST add tokenless-GET→401 egress test. [verify ✓: Confirmed not_implemented after adversarial search. Phase 2 (owner-only candidate-review endpoint with paste→review→promote/reject + token guard + egress test) does not exist in apps or packages. The entire …  
  _Next step:_ Build dedicated /api candidate-review endpoint with mandatory token + egress test.
- ❌ **`ADR0010-5`** — CSP on GET / shell (default-src 'self', bootstrap nonce only)  
  _Source:_ ADR-0010 §1 (token storage / CSP) · _Size:_ S · _Priority:_ P2 · _roadmap_  
  _Evidence:_ grep -rniE 'content-security-policy\|default-src\|csp\|nonce' apps/server → no matches. GET / shell response sets no CSP header.  
  _Blockers:_ ADR0010-3 (nonce pairs with bootstrap that reads token fragment)  
  _Notes:_ Bounds same-origin XSS token-theft introduced by phase-2 candidate rendering. [verify ✓: Confirmed not_implemented via independent search. The only HTML-serving path (sendHtml) sets exactly content-type and cache-control; CSP is delivered neither via response header nor via <meta http-equiv>. No default-src 'self' and no bootstrap nonce exist anywhere in apps/ or packages/. Claim stands.]  
  _Next step:_ Emit one-line CSP header on the GET / shell response.
- ❌ **`ADR0010-6`** — Realm selector: list Realms + active marker + key_mode, view-switch by explicit id (no setCurrent write)  
  _Source:_ ADR-0010 §4 / §6 Phase 1 · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ Server opens one fixed Realm: apps/server/main.ts:621 openRealmLocal(ROOT). grep 'listRealms\|getCurrent\|openResolvedRealm\|setCurrent' apps/server → none. No realm-list route.  
  _Blockers:_ ADR0010-3/4 (selector route is /api/*, needs token)  
  _Notes:_ View-switch must use openResolvedRealm({realm:id}); avoids unlocked setCurrent race (Ctx fact 1). [verify ✓: Refute attempt failed. The selector primitives DO exist (packages/core/realm-registry.ts:91 listRealms, :95 getCurrent, :101 setCurrent; packages/core/runtime.ts:219 openResolvedRealm) and are wired into the CLI (apps/cli/commands/realm.ts:98-124 lists Realms with active marker + key= + vi…  
  _Next step:_ Add /api/realms list route + per-request explicit-id resolution.
- ❌ **`ADR0010-12`** — Phase 2: explicit 'set active for CLI' action (validated + serialized + audited setCurrent)  
  _Source:_ ADR-0010 §4 / §6 Phase 2 · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ setCurrent (packages/core/realm-registry.ts:101) is unlocked, no mutex/validation/audit; no server caller (grep 'setCurrent' apps/server → none).  
  _Blockers:_ ADR0010-8, ADR0010-11 (audit contract)  
  _Notes:_ Only this action may write setCurrent; must validate id, serialize write, audit. Optional per §6. [verify ✓: Confirmed not_implemented. ADR-0010 §6 line 215 lists this as Phase 2 'Optional explicit set active for CLI (setCurrent, validated + serialized + audited)'; §4 lines 161-171 specify the guarded action validates id, serializes, audits. No such guarded action exists. Existing realm-registry.…  
  _Next step:_ Add guarded set-active endpoint that validates id, locks the write, and audits.
- ❌ **`ADR0010-13`** — Phase 2: passphrase-Realm local entry form (POST-body only, in-memory provider, never persisted/logged/audited)  
  _Source:_ ADR-0010 §4 Phase 2 / §6 · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rniE 'passphrase\|passphraseProvider\|openActiveRealm' apps/server → none. Server uses openRealmLocal only (apps/server/main.ts:621).  
  _Blockers:_ ADR0010-8 (POST), ADR0010-7 (locked-state listing)  
  _Notes:_ Passphrase via POST body only (never query/fragment); redact route body in any future request logging. [verify ✓: Confirmed not_implemented after adversarial search. The server has no POST surface at all (405 for non-GET) and no passphrase/unlock/form code; it can only open a local (passwordless) Realm. CLI passphrase plumbing exists (apps/cli, packages/core) but is unrelated to the ADR-0010 web …  
  _Next step:_ Add POST passphrase endpoint feeding an in-process provider to openActiveRealm.
- ❌ **`ADR0010-14`** — Phase 2: forget / redact write actions  
  _Source:_ ADR-0010 §5 table / §6 Phase 2 · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rniE 'forgetByPattern\|forgetClaim\|redactEventById\|deleteUndiluted\|forget\|redact' apps/server → no matches.  
  _Blockers:_ ADR0010-8, ADR0010-11 (audit)  
  _Notes:_ Thin wrappers over existing core forget/redact fns; floor stays centralized in core. [verify ✓: Could not refute. Independent search agrees: Phase 2 forget/redact write actions are absent from the web server. The server is the read-only browser (HTML self-describes "read-only"), and the claim's framing is accurate — the core forget/redact fns it would wrap (forgetByPattern/forgetClaim/redactEvent…  
  _Next step:_ Wrap forget/redact core fns behind write gate with audit.
- ❌ **`ADR0010-7`** — Passphrase Realms shown 'locked' in phase 1 (passwordless-only openable)  
  _Source:_ ADR-0010 §4 Phase 1 / §6 · _Size:_ S · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rniE 'passphrase\|key_mode\|locked' apps/server → no matches; server is openRealmLocal-only (:621).  
  _Blockers:_ ADR0010-6 (needs realm listing to surface lock state)  
  _Notes:_ Display-only lock indicator; no unlock path in phase 1. [verify ✓: Status confirmed not_implemented for the web control panel (the ADR-0010 surface). The ONLY 'locked' indicator in the codebase is the CLI `memoring realm list` at apps/cli/commands/realm.ts:260 (`if (realm.key_mode !== 'local') return ` sources=${sources} claims=locked``) — but that is the CLI command, not the ADR-0010 server sele…  
  _Next step:_ Render locked badge for key_mode:'passphrase' Realms in the selector.
- ❌ **`ADR0010-8`** — Phase 2: owner writes via POST/PUT/DELETE behind Origin/Host+token  
  _Source:_ ADR-0010 §1 / §6 Phase 2 · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ apps/server/main.ts:646-647 still returns 405 for every non-GET method (allow: GET).  
  _Blockers:_ ADR0010-1,2,3,4 (the entire write-security gate must precede writes)  
  _Notes:_ Phase 2 by design; do not introduce mutating methods before the gate lands. [verify ✓: Confirmed not_implemented. Phase 2 owner-write (POST/PUT/DELETE behind Origin/Host+token) is entirely absent: the lone server is GET-only/read-only and rejects all mutating methods with 405. No write-security gate primitives present either, consistent with the stated blockers (ADR0010-1..4) and the by-design de…  
  _Next step:_ After phase-1 gate ships, allow POST/PUT/DELETE behind the same gate.
- ❌ **`ADR0010-9`** — Phase 2: Realm create/connect/delete wrappers + audit at shared layer  
  _Source:_ ADR-0010 §5 table / §6 Phase 2 · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ No write routes in apps/server (grep 'createReplicaAtRoot\|addRealm\|removeRealm' apps/server → none). Core fns exist (apps/cli/commands/realm.ts:65,71) but only via CLI.  
  _Blockers:_ ADR0010-8 (write methods), ADR0010-11 (shared audited orchestrator)  
  _Notes:_ Must reuse core fns; preserve removeRealm + fs.rmSync ordering per §5. [verify ✓: Status confirmed not_implemented. Phase 2 realm create/connect/delete wrappers + audit at the shared/server layer do not exist; write paths remain CLI-only. Minor evidence correction: createReplicaAtRoot is a CLI helper at apps/cli/commands/init.ts:26 (not a core fn); only addRealm/removeRealm live in packages/core/…  
  _Next step:_ Wrap create/connect/delete core paths behind the write gate.

### ADR-0011 — Conversational output LLM

*15 items — ✅ 8 · 🟡 1 · ❌ 6*

- ❌ **`ADR0011-9`** — `memoring chat` multi-turn surface (dedicated later-phase output surface)  
  _Source:_ ADR-0011 §Deferred 'a dedicated memoring chat surface is a later phase' · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ grep -rni "memoring chat\|cmdChat\|chatRealm\|'chat'\|\"chat\"" over apps+packages returned nothing; main.ts has only 'ask' case, no 'chat'  
  _Blockers:_ none (builds on ADR0011-1/7 already shipped)  
  _Notes:_ Intentional — next phase per Addendum/MEMORY. v1 deliberately one-shot via `ask`. [verify ✓: Confirmed not_implemented. v1 deliberately ships one-shot `ask` (PR #27); a dedicated `memoring chat` multi-turn surface is the deferred next phase per ADR-0011. No chat command, no multi-turn session construct anywhere in apps/packages.]  
  _Next step:_ Add a `memoring chat` command with multi-turn session over askRealm, preserving one-Realm binding.
- ✅ **`ADR0011-1`** — Output-layer LLM surface: `memoring ask` (one-shot, read-only, grounded, downstream of Gate)  
  _Source:_ ADR-0011 §Addendum + §Deferred 'natural first rung' · _Size:_ M · _Priority:_ P3  
  _Evidence:_ apps/cli/commands/ask.ts:54-65 (askRealm core renderer); wired at apps/cli/main.ts:116-117 (case 'ask' -> cmdAsk); help line main.ts:60  
  _Notes:_ Headline slice shipped (PR #27, 0e11b3e). ADR Status said 'plan only/deferred' but Addendum records the first slice landed; code confirms.  
  _Next step:_ None — record as shipped; next ADR-0011 work is the multi-step `memoring chat` surface.
- ❌ **`ADR0011-10`** — Agentic / multi-hop associative retrieval (LLM iterating queries, chaining associations)  
  _Source:_ ADR-0011 §2 + §Deferred · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rni 'multi-hop\|multihop\|agentic\|associative retrieval\|iterate quer' over apps+packages returned nothing; askRealm does exactly one searchRealm call (ask.ts:61)  
  _Blockers:_ ADR0011-9 (chat) likely first  
  _Notes:_ Intentional — needs its own treatment; widens read surface. Deferred by §2. [verify ✓: Confirmed not_implemented after adversarial search. The only "associative" code is packages/retrieval/associate.ts proposeNeighbors — explicitly a DETERMINISTIC one-hop Claim-link proposal (line 1: "One-hop associative proposal"), used only by buildContext/context-pack.ts:207, NOT by the LLM/ask path, NOT itera…  
  _Next step:_ Open a follow-up ADR scoping multi-hop read-surface widening before any build.
- ❌ **`ADR0011-11`** — Global cross-Realm 'whole-self' twin (one assistant across every Realm)  
  _Source:_ ADR-0011 §3 + §Deferred · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rni 'whole-self\|whole_self\|cross-realm twin\|global twin' over apps+packages returned nothing  
  _Blockers:_ requires its own future ADR (conflicts with per-Realm invariant)  
  _Notes:_ Intentional — must not be smuggled in; needs dedicated ADR resolving the cross-Realm trust invariant. [verify ✓: Confirmed not_implemented. Audited the pinned worktree /Users/spesan/Documents/memoring-audit (0e11b3e [main], the clone at HEAD origin/main; task's 'undefined' paths were placeholders). The per-Realm invariant is actively enforced: shipped `memoring ask` binds to exactly one Realm and…  
  _Next step:_ Author a separate ADR for cross-Realm identity before any implementation.
- ❌ **`ADR0011-12`** — Write-back beyond read-only v1 (candidate-only, assistant origin, user-confirmed)  
  _Source:_ ADR-0011 §5d + §Deferred 'Any write-back' · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ no write path in ask.ts (read ADR0011-4); grep 'write-back\|writeback' over apps+packages returned nothing  
  _Blockers:_ ADR0011-1 (output surface) shipped; needs design  
  _Notes:_ Intentional — not designed here; must mirror ADR-0007/ADR-0010 candidate-only boundary if added. [verify ✓: Confirmed not_implemented. Adversarial probe surfaced one candidate refutation — Origin enum contains 'assistant' (core/schema/enums.ts:12) — but it is a pre-existing canonical provenance value (1 of the fixed 10, "Detailed Design §1.3.2") used only by the intake transcript parser (integrat…  
  _Next step:_ Design candidate-only write-back (assistant origin, explicit confirm) in a follow-up before coding.
- ❌ **`ADR0011-13`** — Output role remote-DEFAULT-ON (egress-table amendment to §7.3/§7.5/policy.v2)  
  _Source:_ ADR-0011 §5 + §Deferred 'output role's remote default' + §Addendum · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ output-provider.ts:77-80 keeps remote OFF-by-default behind MEMORING_LLM_REMOTE_OPT_IN; no §7.3/§7.5 amendment present  
  _Blockers:_ none — explicitly DECLINED  
  _Notes:_ Intentional and explicitly NOT pursued per Addendum ('remote-default-on is not pursued'). Not a gap — a closed question. Reopening would need a new ADR. [verify ✓: Confirmed not_implemented. Output role reuses the identical MEMORING_LLM_REMOTE_OPT_IN default-OFF gate; no remote-DEFAULT-ON, no opt-out flag, no egress-table/§7.3/§7.5/policy.v2 amendment exists in apps/packages. Only one commit (0e1…  
  _Next step:_ None — closed; do not pursue unless a future ADR reopens it.
- 🟡 **`ADR0011-14`** — §6 Per-role provider registry with dedicated MEMORING_ASK_* config split  
  _Source:_ ADR-0011 §6; output-provider.ts comment 'MEMORING_ASK_* is a follow-up' · _Size:_ S · _Priority:_ P3 · _roadmap_  
  _Evidence:_ present: per-role SEPARATION exists (distinct OutputProvider vs MemoryProvider, output-provider.ts:23-27). missing: shared registry + dedicated per-role env — v1 reuses MEMORING_LLM_* (output-provider.ts:51-57); grep 'MEMORING_ASK_\|providerRegistry\|roleRegistry' returned only the follow-up comment at output-provider.ts:16  
  _Notes:_ Roles are separated by interface, but the 'one registry with per-role config' and MEMORING_ASK_* split are explicitly follow-up only. [verify ✓: Original "partial" verdict confirmed by independent search. Roles are separated by interface (OutputProvider vs MemoryProvider) but both resolvers reuse the SAME MEMORING_LLM_* env; the "one registry with per-role config" and dedicated MEMORING_ASK_* spl…  
  _Next step:_ Add MEMORING_ASK_* (or a per-role registry) so output and loop providers can be configured independently.
- ❌ **`ADR0011-15`** — §7 Per-Realm user-defined persona config for the conversation voice  
  _Source:_ ADR-0011 §7; Invariants 'No predefined persona/category' · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rni 'persona' over apps+packages returns no feature (only unrelated 'personal data' log/import strings); ask.ts uses fixed GROUNDING_INSTRUCTION (ask.ts:31-37), no owner persona input  
  _Blockers:_ ADR0011-9 (chat surface) is the natural home  
  _Notes:_ Negative invariant (no hard-coded persona) is honored by absence; the positive feature (owner-set voice config) is simply not built in the read-only one-shot v1. [verify ✓: Confirmed not_implemented. The positive feature (owner-set per-Realm voice/persona config) is genuinely absent in the read-only one-shot v1; the only instruction is a fixed grounding/safety prompt, not a persona. The negative …  
  _Next step:_ When building `memoring chat`, add optional owner-defined persona config (never a fixed taxonomy).
- ✅ **`ADR0011-2`** — §4 Strict grounding + Silence extended to renderer (0 results -> no answer, no LLM call, no backfill)  
  _Source:_ ADR-0011 §4; Invariants 'Silence/fail-closed' · _Size:_ S · _Priority:_ P3  
  _Evidence:_ apps/cli/commands/ask.ts:62 (results.length===0 -> {grounded:false}, provider NEVER called); GROUNDING_INSTRUCTION ask.ts:31-37; no-grounded-answer print ask.ts:110-114  
  _Notes:_ Provider only invoked when retrieval returns >=1 gated excerpt; no rule-based fabrication fallback.  
  _Next step:_ None — behavior matches §4.
- ✅ **`ADR0011-3`** — §5c Ouroboros / self-ingestion marker on synthesized output  
  _Source:_ ADR-0011 §5c; Invariants 'Ouroboros' · _Size:_ S · _Priority:_ P3  
  _Evidence:_ apps/cli/commands/ask.ts:70-78 (askMarkerBlock signs + renders marker, appended to answer at ask.ts:64); primitives packages/security/ouroboros.ts:33 signMarker, :44 renderMarkerBlock, :9 OUROBOROS_TOKEN  
  _Notes:_ Re-ingested answer recognizable as Memoring-generated; cannot count as evidence/reinforcement.  
  _Next step:_ None — marker emitted on every grounded answer.
- ✅ **`ADR0011-4`** — §5d Start READ-ONLY (no write-back; Ouroboros risk zero)  
  _Source:_ ADR-0011 §5d; Invariants 'AI reaches only candidate' · _Size:_ S · _Priority:_ P3  
  _Evidence:_ apps/cli/commands/ask.ts — no Event/Claim/candidate write anywhere; ctx.close(false) ask.ts:119 (no flush); grep 'write-back\|writeback' over apps+packages returned nothing  
  _Notes:_ v1 is strictly read; any future candidate-only write-back is the deferred item ADR0011-9.  
  _Next step:_ None — read-only confirmed.
- ✅ **`ADR0011-5`** — §5 Egress posture: local-by-default, remote OPT-IN (settled Addendum, no §7.3/§7.5 amendment)  
  _Source:_ ADR-0011 §5(a)/(b) + §Addendum (2026-06-24) · _Size:_ M · _Priority:_ P3  
  _Evidence:_ apps/cli/output-provider.ts:76-80 (effectiveEgress via isLoopback; remote refused unless MEMORING_LLM_REMOTE_OPT_IN); proxy forced remote :66-72; calibrated remote disclosure warnOutputRemoteDefaultOff :114-124; loop opt-in untouched apps/cli/provider.ts:56  
  _Notes:_ Mirrors loop layer; remote-default-on path explicitly declined per Addendum. No force-local env var beyond loopback URL choice; disclosure is via warning only.  
  _Next step:_ None — matches settled Addendum posture.
- ✅ **`ADR0011-6`** — §5 mechanism floor: secret/unknown/confidential/out-of-scope never reach the renderer (rides remote_ai_processing Gate column via searchRealm)  
  _Source:_ ADR-0011 §5(mechanism); Invariants 'Gate First','No raw secret egress' · _Size:_ M · _Priority:_ P3  
  _Evidence:_ renderer reads only searchRealm (apps/cli/commands/ask.ts:61); packages/retrieval/search.ts:138 excludes secret/unknown/confidential; :112-118 in-scope-only (empty set excludes all); enum packages/core/schema/enums.ts:111 remote_ai_processing  
  _Notes:_ Floor enforced upstream by searchRealm, not by ask.ts; no new Gate primitive added (interface freeze).  
  _Next step:_ None — Gate-First preserved by construction.
- ✅ **`ADR0011-7`** — §6 Provider generate/chat capability (prerequisite), without mutating MemoryProvider  
  _Source:_ ADR-0011 §6; Consequences 'one concrete prerequisite' · _Size:_ M · _Priority:_ P3  
  _Evidence:_ apps/cli/output-provider.ts:23-27 (OutputProvider interface with generate()), :30-42 LlmOutputProvider wrapping LlmBackend.complete; ask.ts:63 provider.generate(...). MemoryProvider/abstract() untouched (separate apps/cli/provider.ts).  
  _Notes:_ Capability added as a NEW OutputProvider role, not by overloading MemoryProvider — exactly as §6 required.  
  _Next step:_ None — prerequisite satisfied without interface change.
- ✅ **`ADR0011-8`** — §3 Per-Realm scope binding; cross-Realm recall prohibited in a session  
  _Source:_ ADR-0011 §3; Invariants 'Identity/trust is per-Realm' · _Size:_ S · _Priority:_ P3  
  _Evidence:_ apps/cli/commands/ask.ts:87 openResolvedRealm (one Realm); :94-102 resolveActiveProjects fail-closed Silence on unresolved scope; :108 resolveActiveLabelIds scopes the search  
  _Notes:_ One invocation binds one Realm; scope resolved before provider reached.  
  _Next step:_ None — per-Realm invariant held.

### Spec — explicit OUT / CON / NFR markers

*26 items — ✅ 3 · 🟡 2 · ❌ 21*

- ❌ **`SPEC-OUT015`** — No per-span context-injection tracking — v0 closes the whole session as context_injected; span-ization is v0.1  
  _Source:_ spec OUT-015 (requirements.md:296); also design_final.md:381,999, specification.md:150 · _Size:_ M · _Priority:_ P2 · _out-of-scope (needs ADR)_  
  _Evidence:_ context_injected is a session/event boolean (core/schema/entities.ts:71,250; storage/schema-ddl.ts:27,83); ouroboros.ts:60 'fall an entire session to context_injected on the safe side (v0 over-excludes)'. No span-level tracking. v0.1 deferral honored.  
  _Notes:_ v0 over-exclusion is the safe-side fallback; span granularity explicitly deferred to v0.1. [verify ✓: Confirmed not_implemented. v0 uses session/event-unit context_injected boolean as the safe-side over-exclusion fallback; no per-span tracking exists in code. The only "span" mentions in non-UI code are comments explicitly deferring span granularity to v0.1 (ouroboros.ts:61, normalize.ts:137, secr…  
  _Next step:_ v0.1: refine context_injected from session-unit to span-unit.
- ❌ **`SPEC-OUT016`** — No pack-local alias citation IDs — v0 uses opaque IDs (clm_/evt_); aliases are v0.1  
  _Source:_ spec OUT-016 (requirements.md:297); also design_final.md:382, implementation_instructions.md:203 [≡ NOTODO-13 AGENTS.md §82-99] · _Size:_ M · _Priority:_ P2 · _out-of-scope (needs ADR)_  
  _Evidence:_ core/schema/ids.ts:4-5 'Citations exposed to an AI (clm_/evt_) are these opaque IDs; v0 does not create pack-local alias IDs (OUT-016)'. forget.ts:57-58 dispatches on clm_/evt_ prefixes. v0.1 deferral honored.  
  _Notes:_ Opaque IDs only; alias citation layer deferred to v0.1. [verify ✓: Confirmed not_implemented. v0 exposes opaque clm_/evt_ IDs directly as citations and consumes the same IDs for forget; there is no pack-local alias citation layer. The only "alias" code is for entity/label canonicalization (different concept), and ref_id is an internal FTS key set to the opaque event_id/claim_id. v0.1 deferral hon…  
  _Next step:_ v0.1: add manageable alias citation IDs.
- ✅ **`SPEC-OUT017`** — No full fine-tuning/dataset builder — only fix the constraints  
  _Source:_ spec OUT-017 (requirements.md:298) [≡ NOTODO-14 AGENTS.md §82-99] · _Size:_ L · _Priority:_ P2  
  _Evidence:_ Spec OUT-017 (docs/v0/ja/memoring_requirements.md:298) decides exactly "do NOT fully implement a fine-tuning dataset builder — only fix the constraints". The constraints ARE fixed in code: dataset_export enum present in EGRESS_PURPOSES (packages/core/schema/enums.ts:125), and apps/cli/commands/export.ts:18,22-26 gates it — purpose!=='backup' returns 1 with "v0 fixes only the constraints (no lineage/consent pipeline). Only backup_export is implemented." Absence of builder confirmed: grep -rniE "fine[-_ ]?tun\|datasetbuilder\|trainingset\|jsonl\|provenance\|consent" over apps/ packages/ *.ts yields …  
  _Notes:_ Intentionally constraint-only; the lineage/consent dataset pipeline is the deferred part. [VERIFY OVERRODE → implemented: The audited "partial" is debatable. The spec's decided scope is "no builder + fix constraints"; BOTH are satisfied (gate refuses dataset/redacted export; enum exists). The "missing builder" the audit cites as the deferred remainder is explicitly the part the spec says NOT to b…  
  _Next step:_ v0.1: implement dataset builder with provenance/consent pipeline.
- ❌ **`SPEC-OUT018`** — Vector search not mandatory in v0  
  _Source:_ spec OUT-018 (requirements.md:299) [≡ NOTODO-15 AGENTS.md §82-99] · _Size:_ M · _Priority:_ P2 · _out-of-scope (needs ADR)_  
  _Evidence:_ No vector index: grep vector/faiss/hnsw/cosine → none in retrieval. claim/consolidation.ts:17 'needs embeddings and is out of v0 scope'. recipe.ts:129 merge_suggest_threshold.embedding is a config constant only, not a live vector index. Search is exact + n-gram (NFR-018). Honored.  
  _Notes:_ Embedding-based merge/search deferred; recipe holds the future threshold but no vector engine wired. [verify ✓: Confirmed. SPEC-OUT018 says vector search is NOT mandatory in v0; no vector index was built, which is the spec-honored outcome. Every claimed evidence item verified independently at commit 0e11b3e. Aggressive synonym search (similarity/nearest/Float32Array/pgvector/sqlite-vss/lancedb/ch…  
  _Next step:_ v0.1: add local embedding / vector index (optional).
- 🟡 **`SPEC-PLAN-9.2-ingest`** — v0.1 roadmap: Ingesting ChatGPT/Claude/Gemini exports (broaden supported AI tools)  
  _Source:_ spec project_plan.md:204-206 §9.2 (v0.1 and Beyond); requirements.md:39 · _Size:_ L · _Priority:_ P2 · _roadmap_  
  _Evidence:_ Paste-based import pulled forward into v0 via ADR-0007: integrations/import-ai/index.ts parses Claude (parseClaude:88) and Gemini (parseGemini:107) formats. ChatGPT named in prompt helper (index.ts:294) but has NO dedicated parser — a ChatGPT paste falls through to parseClaude (index.ts:152). Live host-session connector range still narrow (intake/registry.ts:7-9: claude-code only).  
  _Notes:_ Roadmap item partially realized as manual paste import (Claude+Gemini); ChatGPT-specific parsing and broader live-connector coverage remain deferred. [verify ✓: Confirmed partial. Claude+Gemini paste parsers ship (dedicated functions); ChatGPT is "supported" only by reusing the English export prompt + parseClaude — no ChatGPT-format-aware parser, and provider hint only labels, does not select a p…  
  _Next step:_ v0.1: add a ChatGPT-format parser and broaden live connectors beyond claude-code.
- ✅ **`SPEC-NFR031`** — v0 limited to single-user / local-first / CLI + local daemon (boundary requirement)  
  _Source:_ spec NFR-031 (requirements.md:240); design_final §4 · _Size:_ S · _Priority:_ P3  
  _Evidence:_ CLI (apps/cli) + local daemon/server bound to loopback: apps/server/main.ts:5 HOST='127.0.0.1'. No multi-user/auth surface. Honored.  
  _Notes:_ Boundary NFR — included because it gates the OUT cloud/sync/team prohibitions.  
  _Next step:_ None — boundary upheld.
- ✅ **`SPEC-NFR032`** — v0 must not implement first-party cloud backup/sync; only local encrypted Realm + client-side-encrypted local export + local restore  
  _Source:_ spec NFR-032 (requirements.md:241) · _Size:_ S · _Priority:_ P3  
  _Evidence:_ Only local backup_export (cli/commands/export.ts) + local restore (cli/commands/restore.ts) exist; encrypted DB at-rest (storage/encrypted-db.ts:216 openOrCreate with DEK). No cloud-sync code (grep cloud/upload → none). Honored.  
  _Notes:_ Pairs with OUT-004/005/007 — the prohibition is enforced by what is built, not just absent.  
  _Next step:_ None — upheld.
- ❌ **`SPEC-OUT001`** — No predefined persona classification (personal/private/social/work/anonymous hardcoded)  
  _Source:_ spec OUT-001 (requirements.md:282) ; AGENTS.md §87-88; impl-instructions §5.1 L188 · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'personal\|private\|social\|anonymous' apps packages → only secret-scan patterns (security/secret-scan.ts:23,49) and backup-warning copy (cli/commands/export.ts:74,84); no persona taxonomy. Honored.  
  _Notes:_ Prohibition correctly upheld; scope is by soft label not predefined persona. [verify ✓: Confirmed. The prohibition is correctly upheld in code: scope is a free-form AI-assigned soft Label (correctable), not a hardcoded persona root category. "not_implemented" here means the prohibited taxonomy is correctly absent. Independent search (synonyms persona/taxonomy/classif, enum literals, 'work') found…  
  _Next step:_ None — deferral is being respected.
- ❌ **`SPEC-OUT002`** — No automatic label(vocabulary) merge confirmation (surface candidates only; confirm by user/policy/rule)  
  _Source:_ spec OUT-002 (requirements.md:283) [≡ NOTODO-2 AGENTS.md §82-99] · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ apps/cli/commands/label.ts:41 'v0 surfaces split candidates only; use merge/rename to curate' — merge/rename are explicit user commands. Claim auto-merge in claim/extractor.ts:176 is same-normalized-key Claim evidence-union (FR-035), NOT label-vocabulary auto-merge. Honored.  
  _Notes:_ Distinct from FR-035 claim consolidation; label confirmation stays user-gated. [verify ✓: Adversarial grep for auto.?merge\|automatic.*merge\|merge.*confirm\|vocabulary\|label.*merge across apps+packages returned only label.ts (explicit user cmds), claim/extractor.ts (FR-035 claim consolidation), and classify.ts getOrCreateLabel (dedup-on-create canonicalization). No fuzzy/automatic label-vocabulary …  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT003`** — No encryption boundary (Key Domain) within a Realm (separation is per-Realm)  
  _Source:_ spec OUT-003 (requirements.md:284) [≡ NOTODO-3 AGENTS.md §82-99] · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'keydomain\|key.?domain\|per.?domain.*encrypt\|encryption boundary' apps packages → no implementation. Design decision (basic_design.md:273); separation is 1 Realm = 1 key. Honored.  
  _Notes:_ Permanent design decision, not ADR-resumable. [verify ✓: Confirmed not_implemented — and intentionally so. Memoring has a full envelope-encryption scheme (DEK + KEK + realm_key), but the cryptographic boundary is strictly per-Realm: one DEK encrypts the entire DB blob + object store, one realmKey per Realm. There is no sub-Realm Key Domain. Scope labels are soft HMAC attributes (active-scope.ts:1…  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT004`** — No first-party cloud backup/sync (only a standard receiver)  
  _Source:_ spec OUT-004 (requirements.md:285) [≡ NOTODO-4 AGENTS.md §82-99] · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'cloud\|upload\|sync.*server' apps packages → no upload/cloud-sync code. Only local backup_export exists (cli/commands/export.ts:7-8,65-66 'Only backup_export is implemented'). Honored.  
  _Notes:_ backup_export is a self-contained encrypted local archive (NFR-032), not a first-party cloud service. [verify ✓: backup_export is a self-contained local encrypted archive (NFR-032), restorable only via `memoring restore` with no re-egress (restore.ts). It is a standard local "receiver," not a first-party cloud service. Deferral respected; original audit status confirmed.]  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT005`** — No ReplicaManifest / root_hash sync / known-replica tracking  
  _Source:_ spec OUT-005 (requirements.md:286) · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniwE 'ReplicaManifest\|root_hash\|rootHash\|knownReplica' apps packages → zero matches. Honored.  
  _Notes:_ No replica-tracking machinery present. [verify ✓: Confirmed absent after aggressive synonym search. No ReplicaManifest / root_hash sync / known-replica tracking machinery. The codebase is deliberately single-replica; the only sync-adjacent code is a comment honoring the prohibition. Note: docs/spec/requirements.md is not present in this worktree, but the claim concerns code absence, which holds.]  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT006`** — No review queue / manual approval  
  _Source:_ spec OUT-006 (requirements.md:287) [≡ NOTODO-5 AGENTS.md §82-99] · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'review.?queue\|manual.?approv\|approval.?queue' apps packages → only a comment in security/audit.ts:4 'Because there is no review queue...'. No queue implementation. Honored.  
  _Notes:_ Absence is intentional and reflected in audit-target design (NFR-030). [verify ✓: Status correct (forbidden review queue NOT built; honored), but the original evidence "No queue implementation" is an OVERSTATEMENT. A manual user-approval surface DOES exist for imports: apps/cli/commands/import.ts:5-7 (`import list`/`promote`/`reject`, help "List imported candidates awaiting review") backed by pac…  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT007`** — No live multi-device sync  
  _Source:_ spec OUT-007 (requirements.md:288) ; AGENTS.md §93; impl-instructions §5.1 L194 · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'multi.?device\|live.?sync\|p2p' apps packages → only the comment cli/commands/restore.ts:8 'no live multi-device merge (Prohibitions / NFR-032)'. No sync code. Honored.  
  _Notes:_ local-first / single-user (NFR-031) upheld. [verify ✓: Confirmed not_implemented (deferral honored). No sync/replication/P2P/CRDT/websocket code in apps or packages. Remote egress paths (apps/cli/provider.ts, output-provider.ts) are LLM-only, default-OFF, carry-not-sync — they never replicate memory state between devices. Audited the origin/main-pinned worktree /Users/spesan/Documents/memoring-au…  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT008`** — No team / organization / admin  
  _Source:_ spec OUT-008 (requirements.md:289) ; AGENTS.md §93; impl-instructions §5.1 L195 · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'team\|org\|organization\|admin\|tenant' apps packages (filtered) → no team/org/admin/tenant feature code. design_final.md:1339 confirms 'organization/team policy does not exist in v0'. Honored.  
  _Notes:_ Single-user model only. [verify ✓: Confirmed not_implemented; deferral honored. Audited against worktree /Users/spesan/Documents/memoring-audit @ origin/main 0e11b3e. No team/org/admin/tenant feature exists in apps or packages — no actor model, RBAC, accounts, membership, invites, or authorization layer. The product is single-user: 'Realm' (apps/cli/commands/realm.ts:1 'first-class local multi-Re…  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT009`** — No desktop app  
  _Source:_ spec OUT-009 (requirements.md:290) ; AGENTS.md §94; impl-instructions §5.1 L196 · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'electron\|tauri\|swiftui\|menubar\|tray' apps packages → zero matches. UI surface is a localhost read-only web panel (apps/server/main.ts:5 HOST='127.0.0.1'), per ADR-0010, not a native desktop app. Honored.  
  _Notes:_ Web control panel (ADR-0010) is a separate decision; not a packaged desktop app. [verify ✓: Confirmed not_implemented (deferral honored). Audited pinned worktree /Users/spesan/Documents/memoring-audit @ 0e11b3e (= origin/main); prompt's literal "undefined" path resolved to this worktree. No desktop-app framework, native shell, GUI windowing, or app-bundle packaging anywhere in apps/packages. The …  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT010`** — No browser scraping / dependence on non-public APIs  
  _Source:_ spec OUT-010 (requirements.md:291) [≡ NOTODO-9 AGENTS.md §82-99] · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'puppeteer\|playwright\|scrape\|fetch\(\|axios\|cheerio' over packages/intake + connect/import → zero. Connectors read local files only (intake/registry.ts:7-9: claude-code local sessions + import-ai paste). Honored.  
  _Notes:_ Intake is local-file/paste only; no network scraping path. [verify ✓: Confirmed, not refuted. Status maps to the auditor's negative-requirement convention ("not_implemented" = the prohibited behavior is absent = constraint honored). The original evidence's grep used --include glob patterns that fail under zsh; my recursive greps reproduce the zero result. One nuance the original understates: an o…  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT011`** — No imports that circumvent a provider's access control  
  _Source:_ spec OUT-011 (requirements.md:292) · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ apps/cli/commands/import.ts is paste/file/stdin-based (import.ts:4,72,93); no OAuth/token/provider-API fetch. import-ai parses user-pasted export text only (integrations/import-ai/index.ts:147-155). Honored.  
  _Notes:_ User performs the export inside the provider UI; Memoring ingests the paste. [verify ✓: Could not refute. The two fetch() sites found (apps/server/main.ts:552,563 hit Memoring's own /api/memories & /api/scopes; packages/integrations/llm/openai-compatible.ts:64 posts prompts to an LLM endpoint for `memoring ask`) are NOT provider-store reads and do not bypass any provider's access control — they a…  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT012`** — No hook injection / real-time event capture  
  _Source:_ spec OUT-012 (requirements.md:293) ; AGENTS.md §95; impl-instructions §5.1 L199 · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'hook.?inject\|realtime' apps packages → none. 'memoring watch' (cli/commands/watch.ts:1-6,44,91-108) is a debounced diff-driven fs.watch poller (FR-008, NFR-019/020), not host-hook injection or real-time event capture. Honored.  
  _Notes:_ Diff-driven watcher is an allowed FR; distinct from the prohibited hook injection. [verify ✓: Could not refute. watch.ts is a diff-driven fs.watch poller (allowed FR-008/037/038, NFR-019/020), categorically distinct from prohibited host-hook injection / real-time event capture. No implementing code anywhere in apps/packages. Deferral honored; not_implemented confirmed.]  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT013`** — No MCP write integration beyond add_memory_candidate  
  _Source:_ spec OUT-013 (requirements.md:294) ; AGENTS.md §96; impl-instructions §5.1 L200 · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ packages/retrieval/mcp.ts:27 TOOLS = only memoring_search (read) + memoring_add_memory_candidate; handleAddCandidate forces status:'candidate' (mcp.ts:107) and never auto-consolidates (mcp.ts:128). tools/call rejects any other name (mcp.ts:157). Honored.  
  _Notes:_ The single permitted write (candidate-only, non-user origin, no evidence authority) is exactly the carve-out. [verify ✓: Confirmed. The deferred broader MCP write integration was correctly NOT shipped; the lone permitted write (candidate-only, non-user 'ai' origin, no evidence authority, never auto-consolidates) is exactly the spec carve-out. Adversarial sweep for additional tool names, MCP SDK h…  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT014`** — No span / line-unit redaction (sensitivity is event-unit)  
  _Source:_ spec OUT-014 (requirements.md:295) [≡ NOTODO-12 AGENTS.md §82-99] · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'span.?redact\|line.?redact\|partial.?redact\|span.?unit' apps packages → zero. Redaction is event-unit (CON-007/CON-008); forget.ts redacts whole events (cli/commands/forget.ts:58,77,95). Honored.  
  _Notes:_ Event-unit sensitivity enforced; no span partial-redaction. [verify ✓: OUT-014 is a deferral (negative requirement). Honored: sensitivity/redaction unit is the event, never a span/line. Independent search found no partial-span redaction code; deferral markers (ouroboros.ts:61, intake/normalize.ts:137) confirm span-level explicitly punted to v0.1. Status not_implemented (deferral respected) confir…  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT019`** — No automatic tuning of ranking weights (manual Recipe only)  
  _Source:_ spec OUT-019 (requirements.md:300) [≡ NOTODO-16 AGENTS.md §82-99] · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'auto.?tun\|autotune\|learn.*weight\|optimi.*weight\|gradient' apps packages → none (server CSS 'gradient' is the only hit). Weights are versioned Recipe constants (core/recipe.ts), human-curated (CON-017). Honored.  
  _Notes:_ Recipe-owned tunables; no learned weight optimizer. [verify ✓: Confirmed not_implemented = deferral respected. Weights are human-curated, version-managed Recipe constants (owner/reason metadata, CON-016/017); no learned-weight optimizer, feedback loop, or adaptive mutation of recipe values anywhere in apps/packages. 'adapt'/'tune' hits are unrelated (LLM provider adapters, a token-estimate commen…  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT020`** — No cross-Realm search / cross-Realm context  
  _Source:_ spec OUT-020 (requirements.md:301) · _Size:_ M · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'cross.?realm\|all.?realms\|multiRealm\|across realms' apps packages → only intake/identity.ts:4 comment ('never ... across Realms'). searchRealm / MCP operate on a single RealmContext (retrieval/mcp.ts:64-72). Honored.  
  _Notes:_ Each command binds to one active Realm; no cross-Realm join surface. [verify ✓: Confirmed not_implemented (deferral respected). The only realms-iteration (registry.realms .map/.find) is local multi-Realm management — list/rename/remove in apps/cli/commands/realm.ts — never a query join. Server "search" (apps/server/main.ts:390) is a client-side filter over single-realm rows. searchRealm also fail…  
  _Next step:_ None — deferral respected (cross-Realm would need a new ADR).
- ❌ **`SPEC-OUT021`** — No direct S3 / R2 / Google Drive client  
  _Source:_ spec OUT-021 (requirements.md:302) · _Size:_ S · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 's3client\|aws-sdk\|@aws\|r2\|googleapis\|gdrive\|dropbox' apps packages → zero. Export writes to a local dest dir only (cli/commands/export.ts:77,79). Honored.  
  _Notes:_ User carries the encrypted archive to any storage manually. [verify ✓: Deferral honored/correct as a "not_implemented" requirement (OUT-021 is an explicit prohibition, satisfied by absence). No direct cloud-object-storage client anywhere in apps/packages. Backup/restore write to and read from a local destination directory only; user carries the encrypted archive manually. Could not refute after s…  
  _Next step:_ None — deferral respected.
- ❌ **`SPEC-OUT022`** — No automatic crypto-shred propagation / backup re-key  
  _Source:_ spec OUT-022 (requirements.md:303) · _Size:_ M · _Priority:_ P3 · _out-of-scope (needs ADR)_  
  _Evidence:_ grep -rniE 'crypto.?shred\|shred.*propag\|backup.*re.?key\|rekey.*backup' apps packages → zero. rekey (cli/commands/rekey.ts) operates on the local Realm envelope only; no propagation to backups. Honored.  
  _Notes:_ Re-key is local-envelope only; backup re-key propagation deferred. [verify ✓: OUT-022 is an explicit non-goal (docs/v0/en/memoring_requirements.md:303). Honored: rekey is local-envelope-only; backups are static snapshots that are never re-keyed/propagated. Status confirmed; not refuted.]  
  _Next step:_ None — deferral respected.
- 🟡 **`SPEC-PLAN-9.2-mcppolish`** — v0.1 roadmap: MCP server polish (refine the standard receptacle)  
  _Source:_ spec project_plan.md:208 §9.2 · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Base MCP receptacle shipped in v0: packages/retrieval/mcp.ts (memoring_search + memoring_add_memory_candidate over stdio JSON-RPC, mcp.ts:139-161) exposed via cli/commands/mcp.ts. 'Polish' (richer tooling) is the deferred increment beyond this minimal surface.  
  _Notes:_ Minimal MCP exists today; v0.1 refinement is additive and bounded by OUT-013 (no write beyond candidate). [verify ✓: Confirmed partial. The minimal 2-tool stdio receptacle shipped in v0 (file:line above); the §9.2 v0.1+ "refine the standard receptacle" increment (additional tooling, resources/prompts, transports) is not implemented (grep-none across apps+packages). Matches the partial definition:…  
  _Next step:_ v0.1: refine MCP receptacle within the OUT-013 write constraint.

### Spec — prose-level deferred capabilities

*9 items — ✅ 0 · 🟡 3 · ❌ 6*

- ❌ **`SPECP-006`** — Real-time capture via hooks / MCP events / app-server (event-source ingest)  
  _Source:_ design_final §10 (memoring_design_final.md:891 'Event source hooks / MCP events. Not required in v0', :921 'real-time capture via hooks / MCP / app-server is not a v0 requirement') · _Size:_ L · _Priority:_ P2 · _roadmap_  
  _Evidence:_ Ingest is filesystem watch/backfill only. apps/daemon/main.ts:4 wraps cmdWatch; packages/intake/types.ts:78 Connector.read does 'backfill = from 0; watch = tail' (FS cursor). Proof of absence: grep -rniE 'hooks.*capture\|capture.*hook\|event.?source\|app.?server' apps packages (excl test/md) → no event-source ingest path (only repositories.ts:42 unrelated 'write hook' comment).  
  _Notes:_ v0 ships FS-watch capture; hook/MCP/app-server push-ingest is the deferred concrete capability. Note: the READ-side MCP (packages/retrieval/mcp.ts) exists, but that is a retrieval surface, not the deferred event-source ingest. [verify ✓: Confirmed not_implemented after adversarial search. v0 ships FS-watch + manual paste/import + manually-invoked MCP candidate-write; none of these are the deferre…  
  _Next step:_ Confirm deferred; FS-watch is the only ingest channel for v0.
- ❌ **`SPECP-007`** — Codex local-session Connector (v0.1 roadmap connector #2)  
  _Source:_ design_final §roadmap (memoring_design_final.md:401-405, connector list 1-4) · _Size:_ M · _Priority:_ P2 · _roadmap_  
  _Evidence:_ Connector registry has only claude-code (FS capture) + import-ai (paste). packages/intake/registry.ts:7-10 REGISTRY = {claude-code, import-ai}; packages/integrations/ dir contains only claude-code, import-ai, llm. Proof of absence: grep -rniE 'codex' packages/integrations packages/intake (excl test/md/provider.ts) → no Codex connector (provider.ts:95 only mentions Codex as a risky bridge target).  
  _Notes:_ Roadmap lists 4 connectors (Claude Code, Codex, manual-import dir, generic JSONL/MD). Codex connector is a concrete deferred capability, distinct from the OUT-level export-format deferrals. [verify ✓: Confirmed not_implemented after adversarial search (codex/openai/chatgpt/gpt synonyms, host_tool enum, connector_id, .codex/jsonl session paths, generic-connector). packages/integrations/llm/openai-…  
  _Next step:_ Confirm Codex connector remains v0.1 scope.
- 🟡 **`SPECP-001`** — redacted_export — derivative export that may leave the key boundary (secret redacted, unknown/unclassified excluded)  
  _Source:_ spec §6.2 (memoring_specification.md:331,337) / design_final §14.x · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ PRESENT as enum + reserved purpose only: packages/core/schema/enums.ts:124 ('redacted_export'); CLI accepts the positional/flag but hard-rejects: apps/cli/commands/export.ts:22-27 (if purpose!=='backup' → prints 'v0 fixes only the constraints (no lineage/consent pipeline). Only backup_export is implemented.' and returns 1). MISSING: no redaction-export pipeline — grep -rniE 'redacted_export' apps packages returns only enums.ts:124 (no producing code).  
  _Notes:_ Spec is explicit this is 'constraints only … implementation left for a later stage'. policy.ts has a generic redacted flag (policy.ts:28,139) but no export-purpose adjudication. Matches OUT/constraint intent; flagged as prose-deferral because §6.2 names it a concrete future capability. [verify ✓: Could not refute. Status 'partial' is correct: the enum member + CLI flag-accept-then-reject (constra…  
  _Next step:_ Confirm with owner this stays deferred; no v0 work expected.
- 🟡 **`SPECP-002`** — dataset_export — training-purpose derivative export requiring lineage + consent  
  _Source:_ spec §6.2 (memoring_specification.md:331) / 281 (deny_raw note) · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ PRESENT as enum only: packages/core/schema/enums.ts:125 ('dataset_export'); CLI rejects same path as redacted (apps/cli/commands/export.ts:22-27, message cites 'no lineage/consent pipeline'). MISSING: no lineage/consent pipeline — grep -rniE 'dataset_export' apps packages returns only enums.ts:125.  
  _Blockers:_ SPECP-001 (shares export-purpose pipeline)  
  _Notes:_ Spec: 'In v0, constraints only.' Concrete capability (training dataset extraction w/ consent) deferred to later stage. [verify ✓: Confirmed partial after adversarial search with synonyms (lineage/consent/provenance/training/derivative/datasetExtract). The decided scope (training-purpose derivative export with lineage + consent) has its enum and CLI path present but is deliberately rejected; no li…  
  _Next step:_ Confirm deferred; depends on a lineage/consent subsystem not yet designed in code.
- ❌ **`SPECP-003`** — Span/line-level masking of secrets in retrieval (vs whole-session safe-side exclusion)  
  _Source:_ detailed_design §ReDoS/masking (memoring_detailed_design.md:957) / design_final:1160 ('future ADR') ; spec:586 · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Code only does session-level over-exclusion, no span masking. packages/security/secret-scan.ts:4 comment 'span-level masking in v0, OUT-014'. Proof of absence: grep -rniE 'span.?level\|spanLevel\|per.?span\|spanMask' apps packages → only doc-comment mentions (secret-scan.ts:4, ouroboros.ts:61, normalize.ts:137, validator.ts:39), no masking implementation.  
  _Notes:_ Close to OUT-014 but spec/design frame it in prose as 'a future ADR' capability (per-span masking to recover useful context dragged down by safe-side exclusion). Intentional v0 tradeoff. [verify ✓: Independent adversarial search agrees with audited status. Secret detection is boolean-only and emits no match positions, so per-span/line masking cannot exist; on detection the whole event's normalize…  
  _Next step:_ None for v0; revisit only via ADR if recall degradation is reported.
- ❌ **`SPECP-004`** — Embedding-proximity merge-candidate surfacing for Labels/Claims (local embedding)  
  _Source:_ design_final §11.x (memoring_design_final.md:1280) / detailed_design:1512 ('consistent with v0.1') · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Recipe defines an embedding threshold but nothing computes embeddings; merge dedup uses the STRING threshold only. packages/core/recipe.ts:129 merge_suggest_threshold:{embedding:0.88,string:0.92}; packages/claim/consolidation.ts:38 'const DUP_THRESHOLD = PRUNE_RECIPE.merge_suggest_threshold.string; // 0.92' (embedding branch unused); consolidation.ts:17 comment 'needs embeddings and is out of v0 scope'. Proof of absence: grep -rniE '\.embedding\|embedding\(\|computeEmbedding\|embed\(' apps packages (excl tests) → no embedding computation.  
  _Notes:_ Spec says label normalization is deterministic/v0 but embedding-proximity merge surfacing 'requires local embedding and is therefore consistent with v0.1'. Threshold constant is dead config for now. [verify ✓: Confirmed not_implemented after aggressive search (embedding/vector/cosine/knn/semantic synonyms, merge_suggest consumers, label-normalize callers, package manifests). No code computes embe…  
  _Next step:_ Leave deferred; the 0.88 embedding constant is reserved config, not wired.
- ❌ **`SPECP-005`** — Automatic Quality Loop (auto-tuning of Recipe thresholds/weights/reinforcement)  
  _Source:_ detailed_design §9 (memoring_detailed_design.md:1412) / design_final:1260 ('v0 does not implement an automatic Quality Loop') · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ Recipe values are a manual, version-managed constant table; no auto-tuning. packages/core/recipe.ts holds static PRUNE_RECIPE values. Proof of absence: grep -rniE 'quality.?loop\|qualityLoop\|auto.?reinforce\|autoReinforce\|automatic.*recipe' apps packages → no matches.  
  _Notes:_ Design explicitly defers the automatic loop; v0 reinforcement uses fixed Recipe numbers. Concrete deferred capability stated in prose, not an OUT id. [verify ✓: Confirmed not_implemented after aggressive synonym search. Recipe values are a manual, version-managed constant table; reinforcement uses fixed coefficients with no learning/feedback. No auto-tuning, no recipe-mutation path in apps/packag…  
  _Next step:_ None; intentional manual-Recipe stance for v0.
- ❌ **`SPECP-008`** — Generic JSONL / Markdown transcript Connector (v0.1 roadmap connector #4)  
  _Source:_ design_final §roadmap (memoring_design_final.md:401-405 connector list item 4) · _Size:_ M · _Priority:_ P3 · _roadmap_  
  _Evidence:_ No generic transcript connector registered (registry.ts:7-10 only claude-code + import-ai). Proof of absence: grep -rniE 'generic.?jsonl\|jsonl.?connector\|markdown.?connector' packages/integrations packages/intake (excl test/md/provider/main) → no matches. import-ai parses pasted exports (packages/integrations/import-ai/index.ts) but is provider-shaped (ChatGPT/Claude/Gemini), not a generic JSONL/MD watch connector.  
  _Notes:_ Roadmap connector #4. The import-ai connector is a paste-import path (ADR-0007), not the generic transcript file Connector; counted as a distinct deferred capability. [verify ✓: Confirmed not_implemented. Design roadmap (docs/v0/en/memoring_design_final.md:398) lists connector #4 = "generic JSONL / Markdown transcript Connector" among 4 v0 initial connectors, but only #1 (claude_code) is register…  
  _Next step:_ Confirm deferred; clarify overlap with import-ai if owner wants to collapse them.
- 🟡 **`SPECP-009`** — label split — split an over-merged Label into distinct vocabulary entries  
  _Source:_ spec §1.2 (memoring_specification.md:38, 'memoring label … split <label>') · _Size:_ S · _Priority:_ P3 · _roadmap_  
  _Evidence:_ PRESENT (surfacing-only stub): apps/cli/commands/label.ts:39-41 case 'split' prints 'label split: v0 surfaces split candidates only; use merge/rename to curate.'. MISSING: no actual split mutation — merge() (label.ts:53) and rename() are real, split performs no entity split. Usage line at label.ts:45 omits split.  
  _Notes:_ Spec lists split as a label subcommand; v0 only surfaces candidates and tells the user to curate via merge/rename. Concrete capability (programmatic split) deferred. [verify ✓: Confirmed partial. split is a decided v0 subcommand (spec §1.2 / FR-025 / FR-064) but only a surfacing-only stub ships: it performs no entity split, while merge/rename are real mutations. Not fully implemented (no programm…  
  _Next step:_ Confirm split-as-surfacing-only is the intended v0 behavior.

### Completeness critic — item missed by the extractor pass

*1 items — ✅ 0 · 🟡 0 · ❌ 1*

- ❌ **`SPEC-PLAN-9.2-embed`** — v0.1 roadmap: local embedding / vector index to STRENGTHEN semantic search (+ similar-label consolidation-candidate suggestion)  
  _Source:_ spec project_plan.md:207 §9.2; requirements.md:39; design_final.md:405 · _Size:_ L · _Priority:_ P3 · _roadmap_  
  _Evidence:_ grep -rniE 'embedding\|vector\|cosine\|faiss\|hnsw' apps packages --include=*.ts -> only the recipe threshold constant merge_suggest_threshold.embedding (packages/core/recipe.ts:129) + an out-of-scope comment (packages/claim/consolidation.ts:17); no vector/semantic-search engine  
  _Notes:_ v0.1 roadmap pillar #3 (alongside SPEC-PLAN-9.2-ingest and -mcppolish). Related to but NOT a duplicate of SPECP-004 (merge-candidate surfacing) or SPEC-OUT018 (negative boundary). Surfaced by the completeness critic; missing from the extractor pass.  
  _Next step:_ Defer to v0.1; gate a local embedding-index design behind its own ADR before building.

## Code markers (TODO / FIXME / deferred / v0.1 / future) and their mapping

12 parked-work markers found across `apps/`, `packages/`, `schemas/`. All but one map to a tracked ADR/spec item; the single orphan is descriptive prose, not parked work.

| Location | Marker text | Maps to |
|---|---|---|
| `apps/cli/output-provider.ts:16` | // (MEMORING_ASK_*) is a follow-up only (ADR-0011 §6). | ADR-0011 |
| `packages/core/runtime.ts:130` | * Keeping this in core (not scattered in CLI commands) is what lets a future UI reuse the same key handling. | ADR-0010 |
| `packages/core/version.ts:5` | // version (semver). This is what npm compares and what a future opt-in update-notifier would check against the registr… | ADR-0008 |
| `packages/core/schema/ids.ts:5` | // create pack-local alias IDs (OUT-016). | OUT-016 (requirements spec; v0.1 / ADR-0004) |
| `packages/core/recipe.ts:88` | // removed here, not wired speculatively; v0.1 reintroduces it together with its consumer (weighted recall / raw-excerp… | CON-017 (requirements spec; v0.1 / ADR-0004) |
| `packages/security/ouroboros.ts:61` | * span-level tracking is v0.1, OUT-015). | OUT-015 (requirements spec; v0.1 / ADR-0004) |
| `packages/security/secret-scan.ts:4` | // span-level masking in v0, OUT-014). Index build runs only after this scan. | OUT-014 (requirements spec; v0.1 / ADR-0004) |
| `packages/security/redaction.ts:244` | // A pattern SealRule suppresses future matches that re-enter via reprocess. | orphan (descriptive prose about SealRule behavior, not parked work) |
| `packages/intake/normalize.ts:137` | // whole session to the safe side (over-exclusion; span-level is v0.1). | OUT-015 (requirements spec; v0.1 / ADR-0004) |
| `packages/integrations/import-ai/index.ts:1` | // Foreign-AI export Connector (v0.1 connector #2, ADR-0007). Ingests a pasted | ADR-0007 |
| `packages/claim/consolidation.ts:3` | // queue (OUT-006). Safety is enforced at the output Gate, not by withholding | OUT-006 (requirements spec) |
| `packages/claim/extractor.ts:115` | // connected (classified) scopes — a per-label active-scope allow-list is v0.1 (ADR-0003 Deferred). | ADR-0003 (Deferred) / v0.1 / ADR-0004 |

## Appendix A — Verification overrides

The adversarial verification pass overrode 2 statuses after finding implementing code the
extractor missed. Both are documented here so the change of status is auditable.

### `ADR0001-3` — → ✅ implemented

**Item:** memoring key enable-passphrase — convert an existing passwordless vault in place (wrap existing DEK without rebuild)

**Evidence:** packages/security/key-lifecycle.ts:253 upgradeLocalToPassphrase() reuses the SAME DEK (keyFile.dek :261) and re-wraps it under a scrypt KEK (aeadSeal(kekPp, dek) :275) — no rebuild. Wired to CLI: apps/cli/commands/rekey.ts:63-78 — `memoring rekey --passphrase` on a passwordless vault calls upgradeLocalToPassphrase(loadLocalKey(layout), ...), writes keybundle.json then removes key.json in place (fs.rmSync(layout.keyFile) :78). Output rekey.ts:81-82: "The DEK was re-wrapped, not changed, so all memory, identities, and Seals are preserved." main.ts:102-103 registers `rekey`.

**Reasoning:** The literal command name `memoring key enable-passphrase` and string `enable-passphrase` are absent (grep -rniE 'enable-passphrase\|enablePassphrase\|enable_passphrase' apps packages --include=*.ts -> exit=1; no apps/cli/commands/key.ts). BUT the decided capability — the parenthetical scope "convert an existing passwordless vault in place, wrap existing DEK without rebuild" — is fully shipped under a different command name: `memoring rekey --passphrase` (key-lifecycle.ts:250-284 upgradeLocalToPassphrase + rekey.ts:62-91). This is not mere "groundwork" as the original note claims — it is a complete, CLI-reachable implementation that does exactly what the ADR-0001 deferred item describes. The ADR-0001:73 "Deferred" listing is stale relative to shipped code. Status corrected to implemented because the auditable capability exists; only the cosmetic command name differs.

### `SPEC-OUT017` — → ✅ implemented

**Item:** No full fine-tuning/dataset builder — only fix the constraints

**Evidence:** Spec OUT-017 (docs/v0/ja/memoring_requirements.md:298) decides exactly "do NOT fully implement a fine-tuning dataset builder — only fix the constraints". The constraints ARE fixed in code: dataset_export enum present in EGRESS_PURPOSES (packages/core/schema/enums.ts:125), and apps/cli/commands/export.ts:18,22-26 gates it — purpose!=='backup' returns 1 with "v0 fixes only the constraints (no lineage/consent pipeline). Only backup_export is implemented." Absence of builder confirmed: grep -rniE "fine[-_ ]?tun\|datasetbuilder\|trainingset\|jsonl\|provenance\|consent" over apps/ packages/ *.ts yields zero builder/pipeline code — all provenance hits are import/claim-validator lineage (packages/intake/import-from-ai.ts, packages/claim/validator.ts) and jsonl hits are the Claude Code transcript parser (packages/integrations/claude-code/index.ts), none a dataset/training emitter.

**Reasoning:** The audited "partial" is debatable. The spec's decided scope is "no builder + fix constraints"; BOTH are satisfied (gate refuses dataset/redacted export; enum exists). The "missing builder" the audit cites as the deferred remainder is explicitly the part the spec says NOT to build — so it is not a gap in this item but its intended exclusion. Against the decided scope this is fully implemented. If one insists on the literal future builder, "partial" is defensible, but the spec item itself is constraint-only and the constraints shipped, so I refute toward "implemented".

## Appendix B — Completeness-critic finding

A dedicated critic re-read the ADRs and spec against the assembled inventory to catch omissions.
It found one decided item the extractor pass had dropped (now added as `SPEC-PLAN-9.2-embed`):

- **spec project_plan.md:207 §9.2; requirements.md:39 ('local embedding / vector index ... placed on the v0.1-and-later roadmap'); design_final.md:405 ('Roadmap from v0.1 onward: local embedding / vector index')**
  - _Item:_ v0.1 roadmap: local embedding / vector index — build a local embedding/vector index to STRENGTHEN semantic search (and similar-label consolidation-candidate suggestion). This is the third v0.1 roadmap pillar alongside export-ingestion and MCP-polish, both of which the inventory tracks (SPEC-PLAN-9.2-ingest, SPEC-PLAN-9.2-mcppolish) — the embedding/vector-index pillar is dropped.
  - _Why it qualifies:_ Explicitly named as a deferred v0.1 roadmap item in three frozen-spec locations, and not implemented (grep -rniE 'embedding\|vector\|cosine\|faiss\|hnsw' over packages/ apps/ *.ts returns only a recipe threshold constant `merge_suggest_threshold.embedding` in packages/core/recipe.ts:129 and an out-of-scope comment in packages/claim/consolidation.ts:17 — no vector/semantic search engine). The inventory captures the OTHER two §9.2/requirements:39 pillars but not this one. It is NOT a duplicate of existing entries: SPECP-004 covers only embedding-proximity merge-candidate SURFACING for Labels/Claims (one facet, the consolidation-candidate side), and SPEC-OUT018/NOTODO-15 state only that 'vector search is not mandatory / not done in v0' (a negative scope boundary) — neither is the affirmative v0.1 roadmap commitment to build a local embedding/vector index that strengthens SEMANTIC SEARCH (the retrieval side).

---

*Generated from a 122-agent verification workflow over `origin/main` @ `0e11b3e`, 2026-06-24.
Statuses are code-verified at that commit; re-run against a later commit to refresh.*
