# ADR 0010 — Web control panel: read-only browser → owner write surface

- Status: Accepted (plan only — fixes the security boundary; no code or behaviour change ships with this ADR)
- Date: 2026-06-24
- Scope: how the local web server (`apps/server/main.ts`, `npm run serve`) gains owner **write**
  surfaces for the multi-Realm (ADR-0006) and import-from-AI (ADR-0007) features, without crossing a
  v0 floor. This ADR settles the write-security boundary **before** any code is written.
- Relates to: ADR-0006 (multi-Realm registry / Realm resolution), ADR-0007 (import floor:
  no-AI-authority / candidate review / user promote), ADR-0003 (the Gate is the sole egress
  mechanism), ADR-0004 §3 (HTTP-MCP-beyond-localhost OUT — the **precedent** for "localhost + auth
  token + origin check") and §6 (cloud OUT), ADR-0001 (passwordless default / passphrase mode).

## Context

CLI features ① multi-Realm (`memoring realm new/list/use/rename/rm`) and ② import-from-AI
(`memoring import / list / promote / reject`) are merged and reviewed. The owner now wants them
reflected in the local Web UI. The fixed principle: **the CLI is the source of truth; the Web is a
thin local control panel over the SAME core functions.**

Today's server is strictly **read-only**:

- Binds `127.0.0.1:4319` (`apps/server/main.ts:5-6`; port via `MEMORING_SERVE_PORT`,
  `configuredPort()`), opens a **single** Realm at `ROOT = MEMORING_HOME` via `openRealmLocal(ROOT)`
  (`:621`, `:7`) — **passwordless only**.
- Rejects every non-`GET` with `405` (`:646-649`). Routes: `GET /` (HTML shell), `GET /favicon.ico`,
  `GET /api/scopes`, `GET /api/memories`, `404` fallback.
- `GET /api/memories` reads through `listMemoriesForView(ctx, …)` (`:674-678`), which iterates
  `listClaimsByStatus(realm, 'consolidated')` **only** and gates every row with audience
  `human_local_view` + aperture `standard`, `crossScopeAllowed: false` (`packages/retrieval/browse.ts`).
  Candidates never appear.
- Has **no `Origin`/`Host` header check** and **no auth token** of any kind. Localhost bind is the
  only access control.

Reflecting ①②'s **management/write** actions in this server crosses a real security boundary: a local
write server reachable by a browser is attackable by any web page the owner happens to visit
(cross-site `fetch`, DNS-rebinding) and by any other local process. That boundary must be designed
before code exists. ADR-0004 §3 already fixed the shape of the answer for the parallel case of
localhost HTTP MCP — *"HTTP is opt-in localhost-only with auth token + origin check"* — so this ADR
**generalizes an existing floor** rather than inventing one.

Two facts found in the current code drive the design and must not be glossed:

1. **`setCurrent()` is unlocked.** The active-Realm pointer lives in `~/.memoring/realms.toml`.
   `setCurrent` (`packages/core/realm-registry.ts:101-104`) has no mutex; it delegates to
   `writeRegistry`, which silently drops an unknown `id` to `current:undefined` (`:84-86`), so setting
   an unregistered id is a silent no-op. A web server that mutates the global pointer on every view
   change races the CLI and corrupts shared state.
2. **`listImportedCandidates()` does not filter by audience.** It returns **every** pending candidate
   in the Realm (no audience filter, no Gate; `packages/intake/import-from-ai.ts:219`), each carrying a
   `statement_ref` that trivially derefs to plaintext via `readClaimStatement`. The Gate does not
   protect this path. Whatever guards candidate plaintext from non-owners is the panel's
   responsibility (the token), not the core's.

Audit is also **non-uniform** today: only `realm_rm` calls `appendAudit` (`apps/cli/commands/realm.ts:211`);
`realm new/use/rename` and `connect` do not. `import`/`promote`/`reject` audit inside the core via
`ctx.audit(...)` (`import-from-ai.ts:154,294,307`). The audit op vocabulary already in use is:
`backup_export, backup_restore, context_pack_generate, delete, import, import_promote, import_reject,
mcp_request, redact, realm_rm, seal_pattern, seal_release` (`packages/security/audit.ts`, fields are
scalar-only, `0o600 audit.log`, `realm_id` auto-injected by `RealmContext.audit`).

## Decision

Build the panel in two phases behind a single binding constraint, settling six points.

### 1. Write-security model (the crux)

The server stays a **localhost-only** process; the threat is the browser, not the network. Three
independent layers gate every request, applied as the first thing in the handler **before routing**:

- **Bind unchanged.** Keep `127.0.0.1:<port>`. Binding off-localhost is **out** (ADR-0004 §3: an
  off-localhost bind would additionally require egress-table adjudication; not in scope here).
- **`Host` + `Origin` allowlist on EVERY request, fail-closed** (closes a **pre-existing gap** in the
  read-only server — it has neither today):
  - Reject unless the `Host` header is **exactly** `127.0.0.1:<port>` or `localhost:<port>`, on
    **every** request including `GET /`, **unconditionally** (never "when present"). This is the
    **DNS-rebinding** gate — a rebound name resolving to loopback presents an attacker `Host` — so it
    must not depend on header presence or be skipped for the shell, and it is checked **before** the
    token is consulted.
  - When an `Origin` header **is** present, reject unless it is `http://127.0.0.1:<port>` or
    `http://localhost:<port>` (defeats **cross-site `fetch`**). When `Origin` is **absent** (simple /
    sub-resource / no-CORS requests carry none), the **token** carries the CSRF defense — sound because
    the token is never an ambient credential.
  - On `/api/*`, a **missing or invalid token is a hard `401`** regardless of method (including `GET`)
    or `Origin` presence — fail-closed. A cross-site no-`Origin` `GET` to `/api/*` is therefore denied.
- **Per-session capability token, no ambient credentials.** On `memoring serve`, generate a fresh
  random token bound to that process (not persisted across restarts):
  - **Delivery:** print the panel URL with the token in the **fragment**
    (`http://127.0.0.1:<port>/#t=<token>`) so it never appears in `Referer`, server access logs, or
    proxy logs; the shell's bootstrap JS reads `location.hash`, strips it, and presents the token as
    an explicit request header on every `/api/*` call.
  - **Storage:** the token lives **only** in a non-persisted in-memory JS variable in the shell
    (**never** `localStorage`/`sessionStorage`). Persisting it to a `0600` file is **optional and OFF
    by default**: a same-uid file grants **any local process running as the owner** read access for
    the serve lifetime — exactly the "another local process" the token exists to distinguish — so it
    **weakens** the threat model justifying the token. Prefer fragment-only delivery.
  - **No cookies** — the token is never an ambient credential, so a cross-site page cannot ride it
    (the anti-CSRF property, paired with the `Origin` check). The `GET /` shell additionally sets a
    one-line CSP (`default-src 'self'`; no inline script except the bootstrap nonce) to bound the
    same-origin-XSS token-theft path that phase-2 candidate/import rendering introduces — the `Origin`
    check does **not** stop a same-origin XSS.
  - **Reads require the token too.** Decision: **yes.** The panel surfaces full consolidated
    statements and (phase 2) candidate plaintext that must be owner-only; the localhost bind alone
    does not distinguish the owner from another local process. The **only** exception is `GET /`,
    which is exempt from the **token** (so the browser can fetch the static, data-free shell and read
    the fragment) but is **still `Host`-checked** like every other request. Every `/api/*` request —
    read **and** write — requires the `Host`/`Origin` allowlist **and** a valid token (constant-time
    compare).
- **Owner writes use POST/PUT/DELETE**, all behind the same `Origin`/`Host` + token gate (phase 2).
- **Every mutating request is audited** via the existing `appendAudit` contract, with the **same op
  vocabulary** as the CLI (`import_promote`, `import_reject`, `redact`, `delete`, `realm_rm`, …).
  Because the CLI audit trail is non-uniform today (`realm new/use/rename`, `connect` don't audit),
  the write floor is satisfied by placing the audit call in the **shared creation orchestrator** (the
  function `realm new` and the panel both call) — **not** in the low-level `addRealm`/`setCurrent`
  primitives, which are reused by `ensureLegacyRegistered` and idempotent re-adds and would emit
  phantom `realm_new` records. The audited invariant ("an owner created a Realm") lives at the
  command/orchestration layer; `addRealm`/`setCurrent` stay audit-free. Closing the CLI gap is part of
  the phase-2 write work, not a second web-only audit path.

### 2. Audience / Gate unchanged

Reads stay exactly as today: `listMemoriesForView` → `listClaimsByStatus(realm, 'consolidated')` →
Gate with audience `human_local_view`, aperture `standard`, `crossScopeAllowed: false`. Only
consolidated, in-scope, non-secret rows are returned. Writes call the **same** core functions the CLI
calls — **no divergent business logic and no Gate bypass**. The Gate remains the sole egress
mechanism (ADR-0003).

### 3. Import (②) review surface

Flow mirrors `memoring import` exactly: **paste export → `ingestImport` → candidates → review →
`promoteImportedClaim`(scope + sensitivity) / `rejectImportedClaim`**.

- **Never auto-promote.** `ingestImport` lands every entry as a `host_memory` Event plus a
  `status:'candidate'`, `created_by:'ai'`, `evidence_event_identities:[]` Claim carrying the
  `import:claim:<id>` marker; `consolidatePending` skips marked candidates (ADR-0007). The panel adds
  no path that confers authority except an explicit per-item owner `promote`.
- **Promote requires explicit scope + sensitivity.** `promoteImportedClaim` requires a `scope` as a
  **mandatory call argument** (`PromoteOptions.scope: string`) and rejects at **runtime** with
  `sensitivity_required` when no sensitivity is supplied and the candidate's is `unknown`
  (`import-from-ai.ts:250-296`). Sensitivity is `public|internal|confidential` only — never a
  synthesized default, never `unknown`/`secret`. The panel surfaces both as required form fields; it
  cannot promote on the owner's behalf.
- **Candidate text is owner-only — and the token is its *sole* guard.** `listImportedCandidates`
  applies **no audience filter and no Gate**; candidate plaintext bypasses the Gate entirely (a
  returned `Claim` carries a `statement_ref` that derefs to plaintext via `readClaimStatement`). The
  per-session **token is the SOLE access control** on this surface, with **none of the Gate's
  defense-in-depth** — the `human_local_view` read path is protected by ~12 AND-clauses in core; this
  pane is protected by exactly one bespoke check in transport code. That asymmetry is the single
  largest correctness risk in the design and is named here, not smoothed over. Consequently the pane is
  served on a **dedicated review endpoint**, **MUST NOT** appear in the normal `/api/memories`
  (consolidated) pane, and is **never** an AI/MCP audience or a remote egress — a local human view
  only. **Phase 2 MUST** cover this endpoint with an explicit egress test (assert a tokenless `GET`
  returns `401` and leaks no statement text), mirroring the existing red-green egress tests. The
  durable fix — giving `listImportedCandidates` an audience parameter so the guard lives in core, not
  transport — is a core change beyond this ADR.
- `ingestImport`/`promote`/`reject` already audit via `ctx.audit` — reused verbatim.

### 4. Realm switching + keys

- **Listing.** The panel lists Realms from the registry (`listRealms`), marks the active one
  (`getCurrent`), and shows each Realm's `key_mode` (`local` | `passphrase`).
- **Switching the *view* ≠ mutating the *global pointer*.** To avoid the unlocked-`setCurrent` race
  (Context fact 1), the panel switches **which Realm it is viewing** by passing an **explicit Realm
  id** in the flags to the real resolver signature — `openResolvedRealm({ realm: id }, getPassphrase,
  'recall')` (the realm flag rides in the `flags` object; the explicit-realm branch in
  `resolveActiveReplicaRoot` short-circuits **before** any CWD / `current`-pointer logic, per
  ADR-0006) — and reads each Realm's own `realm.toml`. View-switching therefore performs **no
  `setCurrent` write**. (On a cold first resolve the explicit-id path runs `resolveExplicitRealm` →
  `ensureLegacyRegistered`, which may perform a **one-time, idempotent** legacy registration write; it
  is failure-tolerant, is **not** the unlocked-`setCurrent` race, and is safe.) A separate, explicit
  "set active for the CLI" action (phase 2) is the only thing that calls `setCurrent`, and it
  validates the id exists, serializes the write, and audits it.
- **Passphrase Realms.** The server is passwordless-only today (`openRealmLocal`). Decision:
  - **Phase 1** scopes the panel to **passwordless (`key_mode:'local'`) Realms**; passphrase Realms
    are listed with a clear **"locked"** indicator and are not openable in the browser.
  - **Phase 2** adds a **local passphrase-entry form** served over `127.0.0.1` behind the
    `Origin`/token gate, feeding an in-process `passphraseProvider` to `openActiveRealm(root,
    provider)` (`runtime.ts`). The passphrase is accepted **only via a POST body** (never a query
    string or URL fragment, given the fragment-logging concern that drove the token delivery choice)
    and held in memory for the request/unlock only — **never** written to disk, **never** logged, and
    **never** recorded in audit fields (audit stores ids/counts only, per NFR-004); any future request
    logging MUST redact the passphrase route's body.

### 5. CLI is the source of truth (binding constraint)

The web endpoints are **thin wrappers** over the existing core functions and add only transport,
auth, origin-checking, and (shared-layer) audit — never business logic:

| Panel action | Core function reused (no reimplementation) |
| --- | --- |
| list / switch-view / set-active Realm | `listRealms`, `getCurrent`, `resolveActiveReplicaRoot` / `openResolvedRealm`, `setCurrent` |
| create / connect / delete Realm | `createReplicaAtRoot` + `addRealm` + `setCurrent`; `connect` core path; `removeRealm` (+ `fs.rmSync` ordering preserved) |
| import paste / review / promote / reject | `ingestImport`, `listImportedCandidates`, `promoteImportedClaim`, `rejectImportedClaim` |
| forget / redact | `forgetByPattern`, `forgetClaim`, `redactEventById`, `deleteUndiluted` |

All floor enforcement (no-auto-promote, scope+sensitivity-required, secret-scan, confirm-on-destroy,
Gate) stays **centralized in core**, so there is no second place a floor could be relaxed.

### 6. Phasing

**Phase 1 — low risk, mostly read-only (a later PR).**
- Add the `Origin`/`Host` allowlist to **every** request (closes the pre-existing read-only gap).
- Add the per-session token scaffold (generate, deliver via fragment URL — `0600` file optional and
  off by default; in-memory only in the shell; require on every `/api/*`; `GET /` token-exempt but
  still `Host`-checked).
- Add a Realm selector driven by the registry; view-switching resolves an **explicit Realm id** and
  performs **no** `setCurrent` write.
- Passphrase Realms shown **locked**. Data stays `GET`-only; no owner writes yet.

**Phase 2 — owner writes behind the write floor (a later PR).**
- Introduce `POST/PUT/DELETE` behind `Origin`/`Host` + token.
- Realm **create / connect / delete** (wrap the same core fns; add audit at the shared layer, closing
  the CLI audit gap).
- Import **paste → review → promote / reject** (dedicated owner-only review endpoint).
- **forget / redact**.
- Optional explicit **"set active for CLI"** (`setCurrent`, validated + serialized + audited).
- **Passphrase-Realm local entry form** (in-memory provider; never persisted).

### How each invariant is preserved (point-by-point)

- **No-AI-authority (ADR-0007).** The panel exposes no path that consolidates imported content except
  an explicit per-item owner `promote` with required scope + sensitivity; `ingestImport` stays
  candidate-only, `host_memory` stays a non-evidence origin, `consolidatePending` still skips marked
  candidates. The web layer touches none of these — it calls the same core fns.
- **Gate-sole-egress (ADR-0003 / 0004).** Reads go through the unchanged `human_local_view` Gate;
  consolidated-only, in-scope, non-secret. No new egress channel is added; the panel is a local human
  view, not an AI/MCP audience and not a remote egress. Candidate plaintext is owner-only behind the
  token, never reachable by a tool.
- **Local-only (ADR-0004 §3/§6).** Bind stays `127.0.0.1`. No off-localhost bind, no cloud, no sync.
  The token + `Origin`/`Host` checks harden the local surface; they do not open a network surface.
- **Audited.** Every mutating request audits via the existing `appendAudit` contract and op
  vocabulary, placed in the shared orchestration layer (not the `addRealm`/`setCurrent` primitives) so
  CLI and web share one trail (the phase-2 work closes the current CLI audit gaps rather than forking a
  web-only logger).
- **No cross-Realm (ADR-0006).** One Realm is opened per request via explicit-id resolution; Realms
  stay unconnected; the panel offers no cross-Realm search/join. View-switching never mutates the
  shared `current` pointer.
- **CLI-source-of-truth.** Endpoints are thin wrappers over the listed core functions; no divergent
  business logic; floor enforcement remains centralized (§5 table).

## Consequences

- A single, written boundary for turning the read-only panel into an owner write surface, anchored to
  the auth-token-plus-origin-check precedent ADR-0004 §3 already set.
- Two latent hazards in today's code are named and designed around: the unlocked `setCurrent` race
  (solved by explicit-id view resolution) and the unguarded candidate plaintext (solved by the token +
  dedicated owner-only endpoint).
- The pre-existing read-only gap (no `Origin`/`Host` check) is scheduled to close in **phase 1**,
  before any write endpoint exists.
- The CLI audit non-uniformity becomes a phase-2 prerequisite (audit in the shared orchestration
  layer), keeping a single audit contract across both surfaces.

## Out of scope (stated explicitly)

- **All implementation / code.** This ADR fixes the boundary only.
- **New dependencies.**
- **HTTP / MCP beyond localhost** (ADR-0004 §3) — any off-localhost bind requires egress-table
  adjudication and is a separate ADR.
- **Cloud hosting** (ADR-0004 §6) — only ever a zero-knowledge carrier of encrypted archives, never a
  plaintext processor.
- **Cross-Realm features** (search/join across Realms; ADR-0006).
- **Gate / key-model changes** (ADR-0003 / ADR-0001) — audience, aperture, and the AEAD/passphrase key
  model are unchanged.
