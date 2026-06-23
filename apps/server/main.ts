import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { openRealmLocal, type RealmContext } from '@core/runtime';
import { listMemoriesForView } from '@retrieval/browse';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4319;
const ROOT = process.env.MEMORING_HOME;

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Memoring</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #f5f7f4;
      --panel: #ffffff;
      --panel-soft: #f9fbf8;
      --ink: #121816;
      --muted: #64706a;
      --quiet: #8f9893;
      --line: #dfe5e0;
      --line-strong: #c3ccc6;
      --memory-black: #121816;
      --memory-green: #0f5d46;
      --memory-green-2: #28745a;
      --memory-green-soft: #e5f1eb;
      --memory-green-line: #aacbbb;
      --memory-silver: #d9ded9;
      --memory-gold: #b88a2e;
      --memory-gold-soft: #f7edd9;
      --green: var(--memory-green);
      --green-soft: var(--memory-green-soft);
      --green-line: var(--memory-green-line);
      --violet: #4f635c;
      --amber: var(--memory-gold);
      --blue: #3f6757;
      --slate: #68736d;
      --danger: #9c4f48;
      --shadow: 0 12px 30px rgba(18, 24, 22, 0.08);
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--ink);
    }
    main {
      max-width: 1280px;
      margin: 0 auto;
      padding: 22px 28px 34px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      min-height: 62px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }
    .brand {
      display: flex;
      align-items: center;
      min-width: 0;
    }
    h1 {
      margin: 0;
      color: var(--memory-black);
      font-size: 24px;
      line-height: 1.1;
      font-weight: 850;
      letter-spacing: 0;
    }
    .subline {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
    }
    .top-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }
    .badge,
    .chip,
    .kind-tab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: #3d4743;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 720;
      line-height: 1;
      white-space: nowrap;
    }
    .badge.safe {
      border-color: var(--green-line);
      background: var(--green-soft);
      color: var(--green);
    }
    .controls {
      display: grid;
      grid-template-columns: minmax(280px, 1fr) minmax(260px, 420px) auto;
      gap: 12px;
      align-items: end;
      padding: 18px 0;
    }
    label {
      display: grid;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 740;
    }
    select,
    input {
      width: 100%;
      height: 40px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: var(--panel);
      color: var(--ink);
      padding: 0 12px;
      font: inherit;
      font-size: 14px;
    }
    select:focus,
    input:focus,
    button:focus-visible {
      outline: 2px solid rgba(39, 105, 95, 0.22);
      outline-offset: 2px;
    }
    .clear-button {
      height: 40px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: var(--panel);
      color: #35403c;
      padding: 0 13px;
      font: inherit;
      font-size: 13px;
      font-weight: 750;
      cursor: pointer;
    }
    .clear-button:hover {
      border-color: #d8bd7d;
      color: #755616;
    }
    .filters {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding-bottom: 18px;
    }
    .tabs {
      display: flex;
      align-items: center;
      gap: 7px;
      overflow-x: auto;
      padding-bottom: 1px;
    }
    .kind-tab {
      cursor: pointer;
    }
    .kind-tab[aria-pressed="true"] {
      border-color: #d8bd7d;
      background: var(--memory-gold-soft);
      color: #755616;
    }
    .sensitivity-filter {
      width: 170px;
      flex: 0 0 auto;
    }
    .layout {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr) 320px;
      gap: 18px;
      align-items: start;
    }
    .sidebar,
    .content,
    .detail {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .sidebar,
    .detail {
      position: sticky;
      top: 18px;
      overflow: hidden;
    }
    .summary-head {
      padding: 18px;
      border-bottom: 1px solid var(--line);
    }
    .summary-title,
    .section-title {
      margin: 0;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.25;
    }
    .scope-name {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-bottom: 1px solid var(--line);
    }
    .stat {
      display: grid;
      gap: 4px;
      padding: 16px 18px;
      border-right: 1px solid var(--line);
    }
    .stat:last-child {
      border-right: 0;
    }
    .stat-value {
      font-size: 25px;
      line-height: 1;
      font-weight: 830;
    }
    .stat-label {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.3;
    }
    .kind-list {
      display: grid;
      gap: 0;
      padding: 8px 0;
    }
    .kind-line {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 34px;
      gap: 10px;
      align-items: center;
      padding: 9px 18px;
      color: var(--muted);
      font-size: 13px;
    }
    .kind-name {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .kind-dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: var(--kind-color, var(--green));
    }
    .kind-count {
      justify-self: end;
      color: var(--ink);
      font-weight: 760;
    }
    .content-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
    }
    .status {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
      text-align: right;
    }
    .rows {
      display: grid;
    }
    .memory {
      display: grid;
      grid-template-columns: 132px minmax(0, 1fr) 120px;
      gap: 16px;
      align-items: start;
      width: 100%;
      padding: 15px 18px;
      border: 0;
      border-top: 1px solid var(--line);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .memory:first-child {
      border-top: 0;
    }
    .memory:hover,
    .memory[aria-selected="true"] {
      background: var(--panel-soft);
    }
    .memory[aria-selected="true"] {
      box-shadow: inset 3px 0 0 var(--memory-gold);
    }
    .kind-pill,
    .sensitivity {
      width: max-content;
      max-width: 100%;
      border-radius: 8px;
      padding: 5px 8px;
      font-size: 11px;
      font-weight: 780;
      line-height: 1;
      text-transform: uppercase;
    }
    .kind-pill {
      border: 1px solid color-mix(in srgb, var(--kind-color, var(--green)) 30%, white);
      background: color-mix(in srgb, var(--kind-color, var(--green)) 10%, white);
      color: var(--kind-color, var(--green));
    }
    .statement {
      min-width: 0;
      color: var(--ink);
      font-size: 14px;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }
    .labels {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .label-chip {
      max-width: 190px;
      overflow: hidden;
      text-overflow: ellipsis;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--muted);
      padding: 4px 7px;
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
    }
    .sensitivity {
      justify-self: end;
      background: #edf2ef;
      color: #365e56;
    }
    .sensitivity.public {
      background: #e8f2ee;
      color: #27695f;
    }
    .sensitivity.internal {
      background: #e9edf3;
      color: #485f80;
    }
    .detail-head {
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
    }
    .detail-body {
      display: grid;
      gap: 18px;
      padding: 18px;
    }
    .detail-statement {
      color: var(--ink);
      font-size: 15px;
      font-weight: 700;
      line-height: 1.48;
      overflow-wrap: anywhere;
    }
    .detail-section {
      display: grid;
      gap: 9px;
    }
    .detail-label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      line-height: 1;
      text-transform: uppercase;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .meta-item {
      display: grid;
      gap: 4px;
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-soft);
      padding: 10px;
    }
    .meta-value {
      min-width: 0;
      color: var(--ink);
      font-size: 13px;
      font-weight: 760;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .relationship-list {
      display: grid;
      gap: 8px;
    }
    .relationship {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-soft);
      padding: 10px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .empty {
      padding: 26px 18px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }
    .kind-constraint { --kind-color: var(--violet); }
    .kind-preference { --kind-color: var(--green); }
    .kind-decision { --kind-color: var(--amber); }
    .kind-fact,
    .kind-project_context { --kind-color: var(--blue); }
    .kind-procedure { --kind-color: var(--slate); }
    @media (max-width: 960px) {
      main {
        padding: 18px;
      }
      .topbar,
      .filters {
        align-items: stretch;
        flex-direction: column;
      }
      .top-actions {
        justify-content: flex-start;
      }
      .controls,
      .layout {
        grid-template-columns: 1fr;
      }
      .content-head {
        align-items: flex-start;
        flex-direction: column;
      }
      .status {
        text-align: left;
      }
      .sidebar,
      .detail {
        position: static;
      }
      .memory {
        grid-template-columns: 1fr;
        gap: 9px;
      }
      .sensitivity {
        justify-self: start;
      }
      .sensitivity-filter {
        width: 100%;
      }
    }
    @media (max-width: 620px) {
      main {
        padding: 14px;
      }
      .top-actions,
      .tabs {
        gap: 6px;
      }
      .tabs {
        flex-wrap: wrap;
        overflow: visible;
      }
      .badge,
      .kind-tab {
        min-height: 28px;
        padding: 0 8px;
        font-size: 11px;
      }
      .controls {
        padding: 14px 0;
      }
      .filters {
        padding-bottom: 14px;
      }
      .summary-head,
      .content-head,
      .detail-head,
      .detail-body,
      .memory {
        padding-left: 14px;
        padding-right: 14px;
      }
      .stat-grid {
        grid-template-columns: 1fr;
      }
      .stat {
        border-right: 0;
        border-top: 1px solid var(--line);
      }
      .stat:first-child {
        border-top: 0;
      }
    }
  </style>
</head>
<body>
  <main>
    <header class="topbar">
      <div class="brand">
        <div>
          <h1>Memoring</h1>
          <div class="subline">Local read-only browser for scoped Claims after the Gate.</div>
        </div>
      </div>
      <div class="top-actions" aria-label="Runtime safeguards">
        <span class="badge safe">human_local_view</span>
        <span class="badge safe">standard Gate</span>
        <span class="badge">127.0.0.1</span>
        <span class="badge">read-only</span>
      </div>
    </header>

    <section class="controls" aria-label="Memory controls">
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
  </main>
  <script>
    const select = document.querySelector('#scopeSelect');
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
      constraint: '#4f635c',
      preference: '#0f5d46',
      decision: '#b88a2e',
      fact: '#3f6757',
      project_context: '#3f6757',
      procedure: '#68736d'
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
      const response = await fetch('/api/memories?' + params.toString());
      if (!response.ok) throw new Error('Failed to load memories');
      currentRows = await response.json();
      activeKind = 'all';
      selectedClaimId = currentRows[0]?.claim_id || null;
      searchInput.value = '';
      sensitivitySelect.value = 'all';
      render();
    }

    async function loadScopes() {
      const response = await fetch('/api/scopes');
      if (!response.ok) throw new Error('Failed to load scopes');
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

    loadScopes().catch((error) => {
      select.replaceChildren();
      select.disabled = true;
      clearSurface(error.message);
    });
  </script>
</body>
</html>
`;

function configuredPort(): number {
  const raw = process.env.MEMORING_SERVE_PORT;
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('MEMORING_SERVE_PORT must be an integer from 1 to 65535');
  }
  return port;
}

function withReadOnlyRealm<T>(read: (ctx: RealmContext) => T): T {
  const ctx = openRealmLocal(ROOT);
  try {
    return read(ctx);
  } finally {
    ctx.close(false);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(HTML);
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://' + HOST);
  try {
    if (url.pathname === '/') {
      sendHtml(res);
      return;
    }

    if (url.pathname === '/favicon.ico') {
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return;
    }

    if (url.pathname === '/api/scopes') {
      const scopes = withReadOnlyRealm((ctx) =>
        ctx.config.projects.map((project) => ({ project_id: project.project_id, name: project.name })),
      );
      sendJson(res, 200, scopes);
      return;
    }

    if (url.pathname === '/api/memories') {
      const rows = withReadOnlyRealm((ctx) =>
        listMemoriesForView(ctx, {
          scope: url.searchParams.get('scope') ?? undefined,
          project: url.searchParams.get('project') ?? undefined,
        }),
      );
      sendJson(res, 200, rows);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[memoring serve] request failed: ' + message);
    sendJson(res, 500, { error: 'internal_error' });
  }
}

const port = configuredPort();
const server = http.createServer(handleRequest);

server.on('error', (error) => {
  console.error('[memoring serve] ' + error.message);
  process.exitCode = 1;
});

server.listen(port, HOST, () => {
  console.log('Memoring browser listening at http://' + HOST + ':' + port);
});
