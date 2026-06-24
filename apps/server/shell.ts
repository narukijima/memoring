// The panel's HTML shell. Served by GET / (token-exempt, Host-checked) under a
// strict CSP whose script-src admits ONLY this request's nonce — so the bootstrap
// can read the capability token from the URL fragment, strip it from the address
// bar, and present it as an explicit header on every /api/* call. The token lives
// only in this in-memory closure (never localStorage / cookies).
export function renderShell(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Memoring</title>
  <style>
    :root {
      --bg: #061109;          /* PCB substrate (green-black) */
      --panel: #0a1a11;       /* raised board */
      --card: #0c2014;        /* chip card */
      --card-hi: #112b1b;     /* hover / selected */
      --line: #1c3a28;        /* etched trace seam */
      --line-soft: #14271b;
      --ink: #e7efe9;         /* silkscreen white */
      --ink-dim: #93a89c;     /* faded silkscreen */
      --ink-faint: #5d7066;
      --green: #2aa978;       /* live trace green */
      --green-deep: #0e5a3c;
      --gold: #c9a24b;        /* edge-contact gold */
      --gold-bright: #e6c479;
      --gold-dim: #7c6736;
      --danger: #d2725f;
      --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
      --sans: -apple-system, "SF Pro Text", system-ui, sans-serif;
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: var(--sans);
      color: var(--ink);
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
      font-size: 13.5px;
      line-height: 1.5;
    }
    main { max-width: 1240px; margin: 0 auto; padding: 22px 22px 40px; }
    h1, h2 { margin: 0; font-weight: 600; }
    ::selection { background: rgba(201,162,75,0.28); }

    /* ---- header: wordmark + a gold DIMM-contact comb ---- */
    .topbar {
      display: flex; align-items: flex-end; justify-content: space-between;
      gap: 16px; padding-bottom: 14px; margin-bottom: 18px;
      border-bottom: 1px solid var(--line);
      position: relative;
    }
    .topbar::after {
      content: ""; position: absolute; left: 0; bottom: -1px; height: 2px; width: 132px;
      background: repeating-linear-gradient(90deg, var(--gold) 0 7px, transparent 7px 12px);
      opacity: 0.9;
    }
    .brand h1 { font-size: 21px; letter-spacing: 0.06em; }
    .brand h1::before { content: "▚ "; color: var(--gold); font-size: 16px; letter-spacing: 0; }
    .subline { color: var(--ink-dim); font-size: 12px; margin-top: 3px; }
    .top-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .badge {
      font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.02em;
      color: var(--ink-dim); background: var(--panel);
      border: 1px solid var(--line); border-radius: 3px; padding: 3px 7px;
    }
    .badge.safe { color: var(--green); border-color: rgba(42,169,120,0.4); }

    /* ---- controls + filters ---- */
    .controls, .filters { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .controls { margin-bottom: 10px; }
    .filters { margin-bottom: 16px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-faint); }
    select, input[type="search"], input[type="text"], input[type="password"], textarea {
      font-family: var(--sans); font-size: 13px; color: var(--ink);
      background: var(--panel); border: 1px solid var(--line); border-radius: 5px;
      padding: 7px 10px; min-width: 200px; outline: none;
    }
    textarea { font-family: var(--mono); font-size: 12px; min-height: 96px; width: 100%; resize: vertical; }
    select:focus, input:focus, textarea:focus { border-color: var(--gold-dim); }
    input::placeholder, textarea::placeholder { color: var(--ink-faint); }
    .clear-button, button.act {
      align-self: flex-end; font-family: var(--mono); font-size: 11px;
      color: var(--ink-dim); background: transparent; border: 1px solid var(--line);
      border-radius: 5px; padding: 7px 12px; cursor: pointer;
    }
    .clear-button:hover, button.act:hover { color: var(--ink); border-color: var(--gold-dim); }
    button.act.danger { color: var(--danger); border-color: rgba(210,114,95,0.4); }

    .tabs { display: flex; gap: 4px; flex-wrap: wrap; }
    .kind-tab {
      font-family: var(--mono); font-size: 11px; color: var(--ink-dim);
      background: var(--panel); border: 1px solid var(--line); border-radius: 4px;
      padding: 5px 10px; cursor: pointer; transition: color .12s, border-color .12s;
    }
    .kind-tab:hover { color: var(--ink); }
    .kind-tab[aria-pressed="true"] {
      color: var(--bg); background: var(--kind-color, var(--gold)); border-color: var(--kind-color, var(--gold));
    }
    .sensitivity-filter { min-width: 150px; margin-left: auto; }

    /* ---- 3-pane board: panes separated by etched seams ---- */
    .layout {
      display: grid; grid-template-columns: 230px minmax(0, 1fr) 312px;
      gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 8px;
      overflow: hidden;
    }
    .sidebar, .content, .detail { background: var(--panel); padding: 16px; }
    .sidebar { display: flex; flex-direction: column; gap: 16px; }

    .summary-title, .section-title { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint); }
    .scope-name { font-family: var(--mono); font-size: 12px; color: var(--ink); margin-top: 5px; word-break: break-word; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .stat { background: var(--card); padding: 11px 12px; }
    .stat-value { font-family: var(--mono); font-size: 22px; font-weight: 600; color: var(--gold-bright); line-height: 1; }
    .stat-label { font-size: 10px; letter-spacing: 0.04em; color: var(--ink-faint); margin-top: 5px; }

    .kind-list { display: flex; flex-direction: column; gap: 1px; }
    .kind-line { display: flex; align-items: center; justify-content: space-between; padding: 7px 2px; border-bottom: 1px solid var(--line-soft); }
    .kind-name { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-dim); }
    .kind-dot { width: 7px; height: 7px; border-radius: 2px; background: var(--kind-color, var(--gold)); flex: none; }
    .kind-count { font-family: var(--mono); font-size: 12px; color: var(--ink-faint); }

    /* ---- claim list (the chips) ---- */
    .content { display: flex; flex-direction: column; gap: 0; }
    .content-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .status { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); }
    .rows { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 66vh; padding-right: 2px; }

    .memory {
      position: relative; text-align: left; width: 100%; cursor: pointer;
      display: flex; flex-direction: column; gap: 7px;
      background: var(--card); border: 1px solid var(--line); border-left: 2px solid var(--line);
      border-radius: 6px; padding: 11px 13px 11px 14px; color: var(--ink);
      transition: background .12s, border-color .12s;
    }
    .memory:hover { background: var(--card-hi); }
    .memory[aria-selected="true"] {
      background: var(--card-hi);
      border-color: var(--line); border-left: 2px solid var(--kind-color, var(--gold));
    }
    /* gold contact ticks on the selected chip's edge */
    .memory[aria-selected="true"]::before {
      content: ""; position: absolute; left: -1px; top: 10px; bottom: 10px; width: 2px;
      background: repeating-linear-gradient(180deg, var(--gold) 0 4px, transparent 4px 8px);
    }
    .kind-pill {
      align-self: flex-start; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--kind-color, var(--gold));
      border: 1px solid color-mix(in srgb, var(--kind-color, var(--gold)) 45%, transparent);
      border-radius: 3px; padding: 2px 6px;
    }
    .statement { font-size: 13.5px; color: var(--ink); line-height: 1.45; }
    .labels { display: flex; flex-wrap: wrap; gap: 4px; }
    .label-chip { font-family: var(--mono); font-size: 10px; color: var(--ink-dim); background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 2px 6px; }
    .sensitivity { align-self: flex-start; font-family: var(--mono); font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; border: 1px solid transparent; }
    .sensitivity.public { color: var(--green); border-color: rgba(42,169,120,0.35); }
    .sensitivity.internal { color: var(--gold); border-color: rgba(201,162,75,0.4); }

    /* ---- detail pane ---- */
    .detail { display: flex; flex-direction: column; gap: 16px; }
    .detail-section { display: flex; flex-direction: column; gap: 8px; padding-bottom: 14px; border-bottom: 1px solid var(--line-soft); }
    .detail-section:last-child { border-bottom: none; }
    .detail-statement { font-size: 14px; color: var(--ink); line-height: 1.45; padding-left: 9px; border-left: 2px solid var(--kind-color, var(--gold)); }
    .detail-label { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint); }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .meta-item { background: var(--card); padding: 9px 11px; }
    .meta-value { font-family: var(--mono); font-size: 12px; color: var(--ink); margin-top: 3px; word-break: break-all; }
    .relationship-list { display: flex; flex-direction: column; gap: 6px; }
    .relationship { font-family: var(--mono); font-size: 11px; color: var(--ink-dim); }
    .kind-pill, .label-chip, .sensitivity { white-space: nowrap; }

    .empty, .muted { color: var(--ink-faint); font-size: 12.5px; padding: 14px 2px; }

    /* ---- owner console (Phase 2 write surface) ---- */
    .owner { margin-top: 22px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    .owner > summary { cursor: pointer; padding: 14px 16px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gold); }
    .owner[open] > summary { border-bottom: 1px solid var(--line); }
    .owner-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1px; background: var(--line); }
    .owner-card { background: var(--panel); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .owner-card h3 { margin: 0; font-size: 12px; letter-spacing: 0.06em; color: var(--ink); }
    .owner-card .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
    .owner-card input, .owner-card select { min-width: 0; flex: 1 1 120px; }
    .owner-note { font-size: 11px; color: var(--ink-faint); }
    .console-out { font-family: var(--mono); font-size: 11px; color: var(--ink-dim); white-space: pre-wrap; word-break: break-word; padding: 10px 16px; border-top: 1px solid var(--line); min-height: 18px; }
    .cand { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
    .cand .stmt { font-size: 12.5px; color: var(--ink); }

    /* scrollbar */
    .rows::-webkit-scrollbar { width: 8px; }
    .rows::-webkit-scrollbar-thumb { background: var(--line); border-radius: 8px; }

    @media (max-width: 920px) {
      .layout { grid-template-columns: 1fr; }
      .sensitivity-filter { margin-left: 0; }
    }
  </style>
</head>
<body>
  <main>
    <header class="topbar">
      <div class="brand">
        <div>
          <h1>Memoring</h1>
          <div class="subline">Local control panel for scoped Claims after the Gate.</div>
        </div>
      </div>
      <div class="top-actions" aria-label="Runtime safeguards">
        <span class="badge safe">human_local_view</span>
        <span class="badge safe">token-gated</span>
        <span class="badge">127.0.0.1</span>
        <span id="tokenBadge" class="badge">no token</span>
      </div>
    </header>

    <section class="controls" aria-label="Memory controls">
      <label>
        Realm
        <select id="realmSelect" aria-label="Realm selector"></select>
      </label>
      <label>
        Scope
        <select id="scopeSelect" disabled>
          <option>Loading scopes...</option>
        </select>
      </label>
      <label>
        Search
        <input id="searchInput" type="search" placeholder="Filter visible Claim text or label id">
      </label>
      <button id="clearButton" class="clear-button" type="button">Clear</button>
    </section>

    <section class="filters" aria-label="Memory filters">
      <div id="kindTabs" class="tabs" aria-label="Kind filter"></div>
      <select id="sensitivitySelect" class="sensitivity-filter" aria-label="Sensitivity filter">
        <option value="all">All sensitivity</option>
        <option value="public">Public</option>
        <option value="internal">Internal</option>
      </select>
    </section>

    <div class="layout">
      <aside class="sidebar" aria-label="View summary">
        <div class="summary-head">
          <h2 class="summary-title">Active view</h2>
          <div id="scopeName" class="scope-name">No scope selected.</div>
        </div>
        <div class="stat-grid">
          <div class="stat">
            <div id="visibleCount" class="stat-value">0</div>
            <div id="visibleLabel" class="stat-label">visible after Gate</div>
          </div>
          <div class="stat">
            <div id="filteredCount" class="stat-value">0</div>
            <div class="stat-label">shown now</div>
          </div>
        </div>
        <div id="kindList" class="kind-list"></div>
      </aside>

      <section class="content" aria-label="Claim list">
        <div class="content-head">
          <h2 class="section-title">Claim list</h2>
          <div id="status" class="status"></div>
        </div>
        <div id="rows" class="rows"></div>
      </section>

      <aside class="detail" aria-label="Claim detail">
        <div class="detail-head">
          <h2 class="section-title">Claim detail</h2>
        </div>
        <div id="detailBody" class="detail-body"></div>
      </aside>
    </div>

    <details class="owner" aria-label="Owner console">
      <summary>Owner console — write actions (this Realm)</summary>
      <div class="owner-grid">
        <div class="owner-card">
          <h3>Passphrase (locked Realms)</h3>
          <input id="ownerPassphrase" type="password" placeholder="Only for passphrase Realms; never stored">
          <div class="owner-note">Held for this action only. Never persisted, logged, or audited.</div>
        </div>

        <div class="owner-card">
          <h3>Import from AI</h3>
          <textarea id="importText" placeholder="Paste an exported &quot;what I know about you&quot; blob"></textarea>
          <div class="row">
            <input id="importProvider" type="text" placeholder="provider hint (optional)">
            <button id="importBtn" class="act" type="button">Ingest</button>
            <button id="candidatesBtn" class="act" type="button">Review candidates</button>
          </div>
          <div id="candidateList"></div>
        </div>

        <div class="owner-card">
          <h3>Realm lifecycle</h3>
          <div class="row">
            <input id="newRealmName" type="text" placeholder="new Realm name">
            <button id="newRealmBtn" class="act" type="button">Create</button>
          </div>
          <div class="row">
            <button id="setActiveBtn" class="act" type="button">Set selected active (CLI)</button>
            <button id="deleteRealmBtn" class="act danger" type="button">Delete selected</button>
          </div>
        </div>

        <div class="owner-card">
          <h3>Forget / redact</h3>
          <div class="row">
            <input id="forgetId" type="text" placeholder="clm_… / evt_… / und_…">
            <button id="forgetBtn" class="act danger" type="button">Forget (seal)</button>
            <button id="redactBtn" class="act danger" type="button">Redact</button>
          </div>
        </div>
      </div>
      <div id="consoleOut" class="console-out"></div>
    </details>
  </main>
  <script nonce="${nonce}">
    // Bootstrap: lift the capability token out of the URL fragment, then strip the
    // fragment from the address bar so it never lands in history/Referer/logs.
    const TOKEN = (function () {
      const m = /[#&]t=([^&]+)/.exec(location.hash || '');
      const t = m ? decodeURIComponent(m[1]) : '';
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      return t;
    })();
    document.querySelector('#tokenBadge').textContent = TOKEN ? 'token loaded' : 'no token';

    function api(path, opts) {
      opts = opts || {};
      const headers = Object.assign({ 'x-memoring-token': TOKEN }, opts.headers || {});
      let body = opts.body;
      if (body !== undefined && typeof body !== 'string') {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(body);
      }
      return fetch(path, Object.assign({}, opts, { headers: headers, body: body }));
    }

    function realmParam() {
      return activeRealm ? '?realm=' + encodeURIComponent(activeRealm) : '';
    }

    const select = document.querySelector('#scopeSelect');
    const realmSelect = document.querySelector('#realmSelect');
    const searchInput = document.querySelector('#searchInput');
    const clearButton = document.querySelector('#clearButton');
    const sensitivitySelect = document.querySelector('#sensitivitySelect');
    const kindTabsEl = document.querySelector('#kindTabs');
    const kindListEl = document.querySelector('#kindList');
    const rowsEl = document.querySelector('#rows');
    const detailBodyEl = document.querySelector('#detailBody');
    const statusEl = document.querySelector('#status');
    const visibleCountEl = document.querySelector('#visibleCount');
    const filteredCountEl = document.querySelector('#filteredCount');
    const visibleLabelEl = document.querySelector('#visibleLabel');
    const scopeNameEl = document.querySelector('#scopeName');
    let scopes = [];
    let realms = [];
    let activeRealm = '';
    let currentRows = [];
    let activeKind = 'all';
    let selectedClaimId = null;

    const kindOrder = ['constraint', 'preference', 'decision', 'fact', 'project_context', 'procedure'];
    const kindLabels = {
      constraint: 'Constraints',
      preference: 'Preferences',
      decision: 'Decisions',
      fact: 'Facts',
      project_context: 'Project context',
      procedure: 'Procedures'
    };
    const kindColors = {
      constraint: '#c98a3c',
      preference: '#2aa978',
      decision: '#c9a24b',
      fact: '#3f9a82',
      project_context: '#5e8f78',
      procedure: '#8f9a6a'
    };

    function addText(parent, tag, text, className) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      el.textContent = text;
      parent.appendChild(el);
      return el;
    }

    function kindClass(kind) {
      return 'kind-' + String(kind).replace(/[^a-z0-9_]/g, '_');
    }

    function kindLabel(kind) {
      return kindLabels[kind] || String(kind).replace(/_/g, ' ');
    }

    function sortedGroups(rows) {
      const grouped = new Map();
      for (const row of rows) {
        const bucket = grouped.get(row.kind) || [];
        bucket.push(row);
        grouped.set(row.kind, bucket);
      }
      return Array.from(grouped.entries()).sort(([left], [right]) => {
        const l = kindOrder.indexOf(left);
        const r = kindOrder.indexOf(right);
        return (l < 0 ? 99 : l) - (r < 0 ? 99 : r) || left.localeCompare(right);
      });
    }

    function orderedKinds(rows) {
      return sortedGroups(rows).map(([kind]) => kind);
    }

    function renderKindTabs(rows) {
      const kinds = orderedKinds(rows);
      if (activeKind !== 'all' && !kinds.includes(activeKind)) activeKind = 'all';
      kindTabsEl.replaceChildren();
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'kind-tab';
      all.setAttribute('aria-pressed', String(activeKind === 'all'));
      all.textContent = 'All';
      all.addEventListener('click', () => {
        activeKind = 'all';
        render();
      });
      kindTabsEl.appendChild(all);

      for (const kind of kinds) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'kind-tab ' + kindClass(kind);
        tab.style.setProperty('--kind-color', kindColors[kind] || '#68737f');
        tab.setAttribute('aria-pressed', String(activeKind === kind));
        tab.textContent = kindLabel(kind);
        tab.addEventListener('click', () => {
          activeKind = kind;
          render();
        });
        kindTabsEl.appendChild(tab);
      }
    }

    function renderSummary(groups, total, filteredTotal, selected) {
      visibleCountEl.textContent = String(total);
      filteredCountEl.textContent = String(filteredTotal);
      visibleLabelEl.textContent = 'Claims after Gate';
      scopeNameEl.textContent = selected ? selected.name + ' / ' + selected.project_id : 'No scope selected.';
      kindListEl.replaceChildren();

      if (total === 0) {
        addText(kindListEl, 'div', 'No Claim kinds are visible in this scope.', 'empty');
        return;
      }

      for (const [kind, bucket] of groups) {
        const row = document.createElement('div');
        row.className = 'kind-line ' + kindClass(kind);
        row.style.setProperty('--kind-color', kindColors[kind] || '#68737f');
        const name = document.createElement('div');
        name.className = 'kind-name';
        addText(name, 'span', '', 'kind-dot');
        addText(name, 'span', kindLabel(kind));
        row.appendChild(name);
        addText(row, 'div', String(bucket.length), 'kind-count');
        kindListEl.appendChild(row);
      }
    }

    function filterRows(rows) {
      const query = searchInput.value.trim().toLowerCase();
      const sensitivity = sensitivitySelect.value;
      return rows.filter((row) => {
        if (activeKind !== 'all' && row.kind !== activeKind) return false;
        if (sensitivity !== 'all' && row.sensitivity !== sensitivity) return false;
        if (!query) return true;
        const haystack = [row.statement, row.kind, row.sensitivity, ...(row.labelIds || [])].join(' ').toLowerCase();
        return haystack.includes(query);
      });
    }

    function formatDate(value) {
      if (!value) return 'None';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toISOString().slice(0, 10);
    }

    function detailMeta(label, value) {
      const item = document.createElement('div');
      item.className = 'meta-item';
      addText(item, 'div', label, 'detail-label');
      addText(item, 'div', value, 'meta-value');
      return item;
    }

    function renderDetail(rows) {
      detailBodyEl.replaceChildren();
      const row = rows.find((candidate) => candidate.claim_id === selectedClaimId) || rows[0] || null;
      selectedClaimId = row ? row.claim_id : null;

      if (!row) {
        addText(detailBodyEl, 'div', 'Select a Claim to inspect gated metadata, evidence count, scope labels, and supersedes links.', 'muted');
        return;
      }

      const title = document.createElement('div');
      title.className = 'detail-section ' + kindClass(row.kind);
      title.style.setProperty('--kind-color', kindColors[row.kind] || '#68737f');
      addText(title, 'div', row.statement, 'detail-statement');
      const chips = document.createElement('div');
      chips.className = 'labels';
      addText(chips, 'span', kindLabel(row.kind), 'kind-pill');
      addText(chips, 'span', row.sensitivity, 'sensitivity ' + row.sensitivity);
      addText(chips, 'span', row.status || 'consolidated', 'label-chip');
      title.appendChild(chips);
      detailBodyEl.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'meta-grid';
      meta.appendChild(detailMeta('Claim', row.claim_id));
      meta.appendChild(detailMeta('Evidence Events', String(row.evidenceCount ?? 0)));
      meta.appendChild(detailMeta('Valid from', formatDate(row.validFrom)));
      meta.appendChild(detailMeta('Valid until', formatDate(row.validUntil)));
      detailBodyEl.appendChild(meta);

      const scope = document.createElement('div');
      scope.className = 'detail-section';
      addText(scope, 'div', 'Scope labels', 'detail-label');
      const labels = document.createElement('div');
      labels.className = 'labels';
      for (const labelId of row.labelIds || []) addText(labels, 'span', labelId, 'label-chip');
      if (!row.labelIds || row.labelIds.length === 0) addText(labels, 'span', 'No labels', 'label-chip');
      scope.appendChild(labels);
      detailBodyEl.appendChild(scope);

      const relations = document.createElement('div');
      relations.className = 'detail-section';
      addText(relations, 'div', 'Claim links', 'detail-label');
      const list = document.createElement('div');
      list.className = 'relationship-list';
      const supersedes = row.supersedes || [];
      if (supersedes.length === 0) {
        addText(list, 'div', 'No supersedes link. This Claim does not replace an older Claim.', 'relationship');
      } else {
        for (const claimId of supersedes) addText(list, 'div', 'Supersedes ' + claimId, 'relationship');
      }
      relations.appendChild(list);
      detailBodyEl.appendChild(relations);
    }

    function renderRows(rows) {
      rowsEl.replaceChildren();
      if (currentRows.length === 0) {
        addText(rowsEl, 'div', 'No consolidated Claims in this scope passed the Gate.', 'empty');
        renderDetail([]);
        return;
      }
      if (rows.length === 0) {
        addText(rowsEl, 'div', 'No visible Claims match the current filters.', 'empty');
        renderDetail([]);
        return;
      }

      if (!rows.some((row) => row.claim_id === selectedClaimId)) selectedClaimId = rows[0].claim_id;

      for (const row of rows) {
        const memory = document.createElement('button');
        memory.type = 'button';
        memory.id = row.claim_id;
        memory.className = 'memory ' + kindClass(row.kind);
        memory.style.setProperty('--kind-color', kindColors[row.kind] || '#68737f');
        memory.setAttribute('aria-selected', String(row.claim_id === selectedClaimId));
        addText(memory, 'div', kindLabel(row.kind), 'kind-pill');
        const body = document.createElement('div');
        addText(body, 'div', row.statement, 'statement');
        if (row.labelIds && row.labelIds.length > 0) {
          const labels = document.createElement('div');
          labels.className = 'labels';
          for (const labelId of row.labelIds.slice(0, 5)) {
            addText(labels, 'span', labelId, 'label-chip');
          }
          if (row.labelIds.length > 5) addText(labels, 'span', '+' + (row.labelIds.length - 5), 'label-chip');
          body.appendChild(labels);
        }
        memory.appendChild(body);
        addText(memory, 'div', row.sensitivity, 'sensitivity ' + row.sensitivity);
        memory.addEventListener('click', () => {
          selectedClaimId = row.claim_id;
          render();
        });
        rowsEl.appendChild(memory);
      }
      renderDetail(rows);
    }

    function render() {
      const selected = scopes.find((scope) => scope.project_id === select.value);
      const filteredRows = filterRows(currentRows);
      const groups = sortedGroups(currentRows);
      renderKindTabs(currentRows);
      renderSummary(groups, currentRows.length, filteredRows.length, selected);
      renderRows(filteredRows);
      const filters = [];
      if (activeKind !== 'all') filters.push(kindLabel(activeKind));
      if (sensitivitySelect.value !== 'all') filters.push(sensitivitySelect.value);
      if (searchInput.value.trim()) filters.push('search');
      statusEl.textContent =
        filteredRows.length + ' shown / ' + currentRows.length + ' gated Claims' + (filters.length ? ' · ' + filters.join(' · ') : '');
    }

    function clearSurface(message) {
      currentRows = [];
      kindTabsEl.replaceChildren();
      kindListEl.replaceChildren();
      rowsEl.replaceChildren();
      detailBodyEl.replaceChildren();
      visibleCountEl.textContent = '0';
      filteredCountEl.textContent = '0';
      scopeNameEl.textContent = 'No scope selected.';
      statusEl.textContent = message || '';
    }

    async function loadMemories() {
      const selected = scopes.find((scope) => scope.project_id === select.value);
      if (!selected) {
        clearSurface('Select a scope.');
        return;
      }

      statusEl.textContent = 'Loading...';
      const params = new URLSearchParams({ scope: selected.name, project: selected.project_id });
      if (activeRealm) params.set('realm', activeRealm);
      const response = await api('/api/memories?' + params.toString());
      if (!response.ok) throw new Error('Failed to load memories (' + response.status + ')');
      currentRows = await response.json();
      activeKind = 'all';
      selectedClaimId = currentRows[0]?.claim_id || null;
      searchInput.value = '';
      sensitivitySelect.value = 'all';
      render();
    }

    async function loadScopes() {
      const response = await api('/api/scopes' + realmParam());
      if (!response.ok) {
        select.replaceChildren();
        select.disabled = true;
        clearSurface(response.status === 423 ? 'This Realm is passphrase-locked. Browsing is passwordless-only.' : 'Failed to load scopes (' + response.status + ').');
        return;
      }
      scopes = await response.json();
      select.replaceChildren();

      if (scopes.length === 0) {
        const option = document.createElement('option');
        option.textContent = 'No scopes';
        select.appendChild(option);
        select.disabled = true;
        clearSurface('No configured scopes.');
        return;
      }

      for (const scope of scopes) {
        const option = document.createElement('option');
        option.value = scope.project_id;
        option.textContent = scope.name;
        select.appendChild(option);
      }
      select.disabled = false;
      await loadMemories();
    }

    async function loadRealms() {
      const response = await api('/api/realms');
      if (!response.ok) throw new Error('Failed to load Realms (' + response.status + ')');
      realms = await response.json();
      realmSelect.replaceChildren();
      const base = document.createElement('option');
      base.value = '';
      base.textContent = 'Active Realm (CLI default)';
      realmSelect.appendChild(base);
      for (const realm of realms) {
        const option = document.createElement('option');
        option.value = realm.realm_id;
        option.textContent = (realm.active ? '★ ' : '') + realm.name + ' [' + realm.key_mode + ']' + (realm.locked ? ' (locked)' : '');
        realmSelect.appendChild(option);
      }
    }

    function consoleOut(msg) {
      document.querySelector('#consoleOut').textContent = msg;
    }

    function ownerPassphrase() {
      const v = document.querySelector('#ownerPassphrase').value;
      return v ? { passphrase: v } : {};
    }

    async function postJson(path, payload) {
      const response = await api(path, { method: 'POST', body: payload });
      let data = {};
      try { data = await response.json(); } catch (e) { /* no body */ }
      return { ok: response.ok, status: response.status, data: data };
    }

    function bindOwnerConsole() {
      document.querySelector('#importBtn').addEventListener('click', async () => {
        const text = document.querySelector('#importText').value;
        if (!text.trim()) { consoleOut('Paste an export first.'); return; }
        const payload = Object.assign({ text: text, provider: document.querySelector('#importProvider').value || undefined }, ownerPassphrase());
        const r = await postJson('/api/import' + realmParam(), payload);
        consoleOut(r.ok ? 'Imported: candidates=' + r.data.candidates + ' events=' + r.data.events + ' secret_skipped=' + r.data.secret_skipped : 'Import failed: ' + (r.data.error || r.status));
      });

      document.querySelector('#candidatesBtn').addEventListener('click', loadCandidates);

      document.querySelector('#newRealmBtn').addEventListener('click', async () => {
        const name = document.querySelector('#newRealmName').value.trim();
        if (!name) { consoleOut('Enter a Realm name.'); return; }
        const r = await postJson('/api/realms', { name: name });
        if (r.ok) { consoleOut('Created Realm ' + r.data.name + ' (' + r.data.realm_id + ').'); await loadRealms(); }
        else consoleOut('Create failed: ' + (r.data.error || r.status));
      });

      document.querySelector('#setActiveBtn').addEventListener('click', async () => {
        if (!activeRealm) { consoleOut('Select a specific Realm first.'); return; }
        const r = await postJson('/api/realms/active', { realm: activeRealm });
        if (r.ok) { consoleOut('Set active: ' + r.data.name); await loadRealms(); }
        else consoleOut('Set-active failed: ' + (r.data.error || r.status));
      });

      document.querySelector('#deleteRealmBtn').addEventListener('click', async () => {
        if (!activeRealm) { consoleOut('Select a specific Realm to delete.'); return; }
        if (!confirm('Delete this Realm and its directory? This is irreversible.')) return;
        // DELETE carries a JSON body (realm id + explicit confirm).
        const del = await api('/api/realms', { method: 'DELETE', body: { realm: activeRealm, confirm: true } });
        let data = {}; try { data = await del.json(); } catch (e) {}
        if (del.ok) { consoleOut('Removed Realm.'); activeRealm = ''; realmSelect.value = ''; await loadRealms(); await loadScopes(); }
        else consoleOut('Delete failed: ' + (data.error || del.status));
      });

      document.querySelector('#forgetBtn').addEventListener('click', async () => {
        const id = document.querySelector('#forgetId').value.trim();
        if (!id) { consoleOut('Enter an id to forget.'); return; }
        if (!confirm('Forget ' + id + '? This is irreversible.')) return;
        const r = await postJson('/api/forget' + realmParam(), Object.assign({ id: id, confirm: true }, ownerPassphrase()));
        consoleOut(r.ok ? 'Forgot ' + (r.data.forgotten || 0) + ' record(s).' : 'Forget failed: ' + (r.data.error || r.status));
      });

      document.querySelector('#redactBtn').addEventListener('click', async () => {
        const id = document.querySelector('#forgetId').value.trim();
        if (!id) { consoleOut('Enter an id to redact.'); return; }
        if (!confirm('Redact ' + id + '?')) return;
        const r = await postJson('/api/redact' + realmParam(), Object.assign({ id: id, confirm: true }, ownerPassphrase()));
        consoleOut(r.ok ? 'Redacted ' + id + '.' : 'Redact failed: ' + (r.data.error || r.status));
      });
    }

    async function loadCandidates() {
      const listEl = document.querySelector('#candidateList');
      listEl.replaceChildren();
      const response = await api('/api/import/candidates' + realmParam());
      if (!response.ok) { consoleOut('Candidates failed: ' + response.status); return; }
      const items = await response.json();
      if (items.length === 0) { addText(listEl, 'div', 'No imported candidates awaiting review.', 'muted'); return; }
      for (const item of items) {
        const card = document.createElement('div');
        card.className = 'cand';
        addText(card, 'div', '[' + item.kind + '] from ' + item.provider, 'detail-label');
        addText(card, 'div', item.statement, 'stmt');
        const row = document.createElement('div');
        row.className = 'row';
        const scopeInput = document.createElement('input');
        scopeInput.type = 'text';
        scopeInput.placeholder = 'scope label';
        const sensSelect = document.createElement('select');
        for (const s of ['(declared)', 'public', 'internal', 'confidential']) {
          const o = document.createElement('option');
          o.value = s === '(declared)' ? '' : s;
          o.textContent = s;
          sensSelect.appendChild(o);
        }
        const promote = document.createElement('button');
        promote.type = 'button'; promote.className = 'act'; promote.textContent = 'Promote';
        promote.addEventListener('click', async () => {
          if (!scopeInput.value.trim()) { consoleOut('Enter a scope to promote.'); return; }
          const payload = Object.assign({ claim_id: item.claim_id, scope: scopeInput.value.trim(), sensitivity: sensSelect.value || undefined }, ownerPassphrase());
          const r = await postJson('/api/import/promote' + realmParam(), payload);
          if (r.ok) { consoleOut('Promoted ' + item.claim_id + '.'); await loadCandidates(); await loadScopes(); }
          else consoleOut('Promote failed: ' + (r.data.error || r.status));
        });
        const reject = document.createElement('button');
        reject.type = 'button'; reject.className = 'act danger'; reject.textContent = 'Reject';
        reject.addEventListener('click', async () => {
          const r = await postJson('/api/import/reject' + realmParam(), Object.assign({ claim_id: item.claim_id }, ownerPassphrase()));
          if (r.ok) { consoleOut('Rejected ' + item.claim_id + '.'); await loadCandidates(); }
          else consoleOut('Reject failed: ' + (r.data.error || r.status));
        });
        row.appendChild(scopeInput); row.appendChild(sensSelect); row.appendChild(promote); row.appendChild(reject);
        card.appendChild(row);
        listEl.appendChild(card);
      }
    }

    realmSelect.addEventListener('change', () => {
      activeRealm = realmSelect.value;
      loadScopes().catch((error) => clearSurface(error.message));
    });
    select.addEventListener('change', () => {
      loadMemories().catch((error) => clearSurface(error.message));
    });
    searchInput.addEventListener('input', render);
    sensitivitySelect.addEventListener('change', render);
    clearButton.addEventListener('click', () => {
      searchInput.value = '';
      sensitivitySelect.value = 'all';
      activeKind = 'all';
      render();
      searchInput.focus();
    });

    bindOwnerConsole();
    loadRealms()
      .then(loadScopes)
      .catch((error) => {
        select.replaceChildren();
        select.disabled = true;
        clearSurface(error.message);
      });
  </script>
</body>
</html>
`;
}
