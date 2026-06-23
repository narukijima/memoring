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
      --bg: #f6f7f5;
      --panel: #ffffff;
      --ink: #1d2421;
      --muted: #69736f;
      --quiet: #9aa39f;
      --line: #dde3df;
      --line-strong: #c8d2cd;
      --green: #2d7267;
      --green-soft: #e5f0ec;
      --violet: #7661a8;
      --amber: #b2763a;
      --blue: #50749e;
      --slate: #68737f;
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
      max-width: 1120px;
      margin: 0 auto;
      padding: 28px 28px 40px;
    }
    .topbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 24px;
      align-items: end;
      margin-bottom: 22px;
    }
    .eyebrow {
      color: var(--green);
      font-size: 12px;
      font-weight: 780;
      letter-spacing: 0;
    }
    h1 {
      margin: 5px 0 0;
      font-size: 34px;
      line-height: 1.05;
      font-weight: 820;
      letter-spacing: 0;
    }
    .subline {
      margin-top: 9px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }
    label {
      display: grid;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
    }
    select {
      min-width: 260px;
      height: 38px;
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      background: var(--panel);
      color: var(--ink);
      padding: 0 14px;
      font: inherit;
      font-size: 14px;
    }
    select:focus {
      outline: 2px solid rgba(45, 114, 103, 0.22);
      outline-offset: 2px;
    }
    .surface {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.74);
      padding: 24px;
    }
    .ring-row {
      display: grid;
      grid-template-columns: minmax(430px, 1fr) 300px;
      gap: 26px;
      align-items: center;
    }
    .ring-wrap {
      position: relative;
      min-height: 500px;
    }
    .ring {
      position: absolute;
      left: 50%;
      top: 50%;
      z-index: 1;
      width: 410px;
      height: 410px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      border: 1px solid rgba(45, 114, 103, 0.24);
      background:
        radial-gradient(circle, var(--bg) 0 45%, transparent 46%),
        conic-gradient(from -75deg, rgba(45, 114, 103, 0.92), rgba(80, 116, 158, 0.72), rgba(118, 97, 168, 0.68), rgba(178, 118, 58, 0.72), rgba(45, 114, 103, 0.92));
      box-shadow: inset 0 0 0 31px rgba(255, 255, 255, 0.82);
    }
    .ring::before,
    .ring::after {
      content: "";
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
    }
    .ring::before {
      inset: 58px;
      border: 1px solid rgba(29, 36, 33, 0.10);
    }
    .ring::after {
      inset: -34px;
      border: 1px solid rgba(200, 210, 205, 0.60);
    }
    .core {
      position: absolute;
      left: 50%;
      top: 50%;
      z-index: 2;
      width: 196px;
      min-height: 150px;
      transform: translate(-50%, -50%);
      border: 1px solid var(--line);
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.95);
      display: grid;
      place-items: center;
      text-align: center;
      padding: 24px;
    }
    .core-kicker {
      color: var(--green);
      font-size: 11px;
      font-weight: 780;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .core-name {
      width: 100%;
      margin-top: 6px;
      font-size: 21px;
      line-height: 1.08;
      font-weight: 810;
      overflow-wrap: anywhere;
    }
    .core-count {
      margin-top: 7px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .gate-mark {
      position: absolute;
      right: 5%;
      top: 50%;
      z-index: 3;
      width: 86px;
      transform: translateY(-50%);
      border: 1px solid rgba(45, 114, 103, 0.28);
      border-radius: 999px;
      background: var(--green-soft);
      color: #285f57;
      padding: 7px 10px;
      text-align: center;
      font-size: 12px;
      font-weight: 760;
    }
    .gate-mark::before {
      content: "";
      position: absolute;
      left: -76px;
      top: 50%;
      width: 75px;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(45, 114, 103, 0.45));
    }
    .seed {
      position: absolute;
      left: 50%;
      top: 50%;
      z-index: 4;
      width: 10px;
      height: 10px;
      transform: translate(-50%, -50%);
      border: 2px solid var(--panel);
      border-radius: 50%;
      background: var(--kind-color, var(--green));
      box-shadow: 0 0 0 5px rgba(45, 114, 103, 0.08);
    }
    .ring-empty {
      position: absolute;
      left: 50%;
      top: 76%;
      transform: translateX(-50%);
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }
    .summary {
      align-self: stretch;
      display: grid;
      align-content: center;
      gap: 18px;
      border-left: 1px solid var(--line);
      padding-left: 26px;
    }
    .stat {
      display: grid;
      gap: 4px;
    }
    .stat-value {
      font-size: 32px;
      line-height: 1;
      font-weight: 820;
    }
    .stat-label {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }
    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.64);
      color: #46504c;
      padding: 5px 9px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .kind-list {
      display: grid;
      gap: 9px;
    }
    .kind-line {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr) 28px;
      gap: 9px;
      align-items: center;
      color: var(--muted);
      font-size: 12px;
    }
    .bar {
      height: 6px;
      overflow: hidden;
      border-radius: 999px;
      background: #e8ece9;
    }
    .bar > span {
      display: block;
      height: 100%;
      width: 0;
      border-radius: inherit;
      background: var(--kind-color, var(--green));
    }
    .list-section {
      margin-top: 18px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--panel);
      overflow: hidden;
    }
    .list-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: center;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
    }
    h2 {
      margin: 0;
      font-size: 17px;
      font-weight: 810;
      letter-spacing: 0;
    }
    .status {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
      white-space: nowrap;
    }
    .groups {
      display: grid;
      gap: 0;
    }
    .group {
      padding: 16px 18px 18px;
      border-top: 1px solid var(--line);
    }
    .group:first-child {
      border-top: 0;
    }
    .group-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 9px;
      color: #343d39;
      font-size: 13px;
      font-weight: 780;
    }
    .group-name {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .group-name::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--kind-color, var(--green));
    }
    .group-count {
      color: var(--quiet);
      font-size: 12px;
      font-weight: 700;
    }
    .memory {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr);
      gap: 14px;
      padding: 11px 0;
      border-top: 1px solid #edf0ee;
    }
    .memory:first-of-type {
      border-top: 0;
    }
    .sensitivity {
      align-self: start;
      width: max-content;
      max-width: 100%;
      border-radius: 999px;
      background: #edf2ef;
      color: #365e56;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 760;
      text-transform: uppercase;
    }
    .sensitivity.internal {
      background: #e9edf3;
      color: #485f80;
    }
    .statement {
      min-width: 0;
      color: var(--ink);
      font-size: 14px;
      line-height: 1.52;
      overflow-wrap: anywhere;
    }
    .empty {
      padding: 18px;
      color: var(--muted);
      font-size: 14px;
    }
    .kind-constraint { --kind-color: var(--violet); }
    .kind-preference { --kind-color: var(--green); }
    .kind-decision { --kind-color: var(--amber); }
    .kind-fact,
    .kind-project_context { --kind-color: var(--blue); }
    .kind-procedure { --kind-color: var(--slate); }
    @media (max-width: 900px) {
      main {
        padding: 20px;
      }
      .topbar,
      .ring-row,
      .list-head {
        grid-template-columns: 1fr;
      }
      .summary {
        border-left: 0;
        border-top: 1px solid var(--line);
        padding-left: 0;
        padding-top: 20px;
      }
      .ring-wrap {
        min-height: 460px;
      }
      .ring {
        width: 360px;
        height: 360px;
      }
      .gate-mark {
        right: 0;
      }
    }
  </style>
</head>
<body>
  <main>
    <header class="topbar">
      <div>
        <div class="eyebrow">local memory browser</div>
        <h1>Memoring</h1>
        <div class="subline">Scoped memories orbit the active project. Only rows that pass the local-view Gate are visible.</div>
      </div>
      <label>
        Scope
        <select id="scopeSelect" disabled>
          <option>Loading scopes...</option>
        </select>
      </label>
    </header>

    <section class="surface" aria-label="Memory ring">
      <div class="ring-row">
        <div id="ring" class="ring-wrap"></div>
        <aside class="summary" aria-label="View summary">
          <div class="stat">
            <div id="visibleCount" class="stat-value">0</div>
            <div id="visibleLabel" class="stat-label">visible memories</div>
          </div>
          <div class="chips" aria-label="Safeguards">
            <span class="chip">127.0.0.1</span>
            <span class="chip">read-only</span>
            <span class="chip">standard Gate</span>
          </div>
          <div id="kindList" class="kind-list"></div>
        </aside>
      </div>
    </section>

    <section class="list-section" aria-label="Gated memories">
      <div class="list-head">
        <h2>Gated memories</h2>
        <div id="status" class="status"></div>
      </div>
      <div id="groups" class="groups"></div>
    </section>
  </main>
  <script>
    const select = document.querySelector('#scopeSelect');
    const ringEl = document.querySelector('#ring');
    const kindListEl = document.querySelector('#kindList');
    const groupsEl = document.querySelector('#groups');
    const statusEl = document.querySelector('#status');
    const visibleCountEl = document.querySelector('#visibleCount');
    const visibleLabelEl = document.querySelector('#visibleLabel');
    let scopes = [];

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
      constraint: '#7661a8',
      preference: '#2d7267',
      decision: '#b2763a',
      fact: '#50749e',
      project_context: '#50749e',
      procedure: '#68737f'
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

    function pointOnRing(index, total) {
      const angle = (-95 + (360 / total) * index + (index % 2) * 4) * Math.PI / 180;
      const radius = 33 + (index % 3) * 4;
      return {
        left: 50 + radius * Math.cos(angle),
        top: 50 + radius * Math.sin(angle)
      };
    }

    function renderRing(rows, selected) {
      ringEl.replaceChildren();
      const ring = document.createElement('div');
      ring.className = 'ring';
      const core = document.createElement('div');
      core.className = 'core';
      addText(core, 'div', 'Active scope', 'core-kicker');
      addText(core, 'div', selected ? selected.name : '-', 'core-name');
      addText(core, 'div', rows.length + ' visible after Gate', 'core-count');
      const gate = addText(ringEl, 'div', 'Gate', 'gate-mark');
      gate.setAttribute('aria-label', 'human_local_view standard Gate');
      ringEl.append(ring, core);

      if (rows.length === 0) {
        addText(ringEl, 'div', 'Nothing visible in this scope.', 'ring-empty');
        return;
      }

      const seeds = rows.slice(0, 36);
      seeds.forEach((row, index) => {
        const point = pointOnRing(index, seeds.length);
        const seed = document.createElement('button');
        seed.type = 'button';
        seed.className = 'seed ' + kindClass(row.kind);
        seed.style.left = point.left + '%';
        seed.style.top = point.top + '%';
        seed.style.setProperty('--kind-color', kindColors[row.kind] || '#68737f');
        seed.setAttribute('aria-label', kindLabel(row.kind));
        seed.addEventListener('click', () => {
          const target = document.getElementById(row.claim_id);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        ringEl.appendChild(seed);
      });
    }

    function renderSummary(groups, total) {
      visibleCountEl.textContent = String(total);
      visibleLabelEl.textContent = total === 1 ? 'visible memory' : 'visible memories';
      kindListEl.replaceChildren();

      if (total === 0) {
        addText(kindListEl, 'div', 'No visible kinds.', 'status');
        return;
      }

      for (const [kind, bucket] of groups) {
        const row = document.createElement('div');
        row.className = 'kind-line ' + kindClass(kind);
        row.style.setProperty('--kind-color', kindColors[kind] || '#68737f');
        addText(row, 'div', kindLabel(kind));
        const bar = document.createElement('div');
        bar.className = 'bar';
        const fill = document.createElement('span');
        fill.style.width = Math.max(8, Math.round((bucket.length / total) * 100)) + '%';
        bar.appendChild(fill);
        addText(row, 'div', String(bucket.length));
        row.insertBefore(bar, row.children[1]);
        kindListEl.appendChild(row);
      }
    }

    function renderRows(rows, selected) {
      const groups = sortedGroups(rows);
      renderRing(rows, selected);
      renderSummary(groups, rows.length);
      groupsEl.replaceChildren();
      statusEl.textContent = rows.length + ' rows / human_local_view standard';

      if (rows.length === 0) {
        addText(groupsEl, 'div', 'No memories in this scope passed the Gate.', 'empty');
        return;
      }

      for (const [kind, bucket] of groups) {
        const group = document.createElement('section');
        group.className = 'group ' + kindClass(kind);
        group.style.setProperty('--kind-color', kindColors[kind] || '#68737f');
        const title = document.createElement('div');
        title.className = 'group-title';
        addText(title, 'div', kindLabel(kind), 'group-name');
        addText(title, 'div', bucket.length + ' visible', 'group-count');
        group.appendChild(title);

        for (const row of bucket) {
          const memory = document.createElement('article');
          memory.id = row.claim_id;
          memory.className = 'memory';
          addText(memory, 'div', row.sensitivity, 'sensitivity ' + row.sensitivity);
          addText(memory, 'div', row.statement, 'statement');
          group.appendChild(memory);
        }
        groupsEl.appendChild(group);
      }
    }

    function clearSurface(message) {
      ringEl.replaceChildren();
      kindListEl.replaceChildren();
      groupsEl.replaceChildren();
      visibleCountEl.textContent = '0';
      visibleLabelEl.textContent = 'visible memories';
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
      const rows = await response.json();
      renderRows(rows, selected);
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
