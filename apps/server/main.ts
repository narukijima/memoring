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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #17202a;
      background: #f5f7fa;
    }
    body {
      margin: 0;
      padding: 28px 32px 40px;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
    }
    .app-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 22px;
    }
    h1 {
      margin: 0;
      font-size: 26px;
      font-weight: 700;
    }
    .subtitle {
      margin-top: 7px;
      color: #5f6f82;
      font-size: 14px;
    }
    .control-row {
      display: flex;
      align-items: flex-end;
      gap: 12px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: #52606d;
    }
    select {
      min-width: 280px;
      height: 36px;
      border: 1px solid #cbd2d9;
      border-radius: 6px;
      background: #fff;
      color: #1f2933;
      padding: 0 10px;
      font: inherit;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      border-radius: 999px;
      padding: 0 10px;
      background: #e6f4ef;
      color: #1f6f50;
      font-size: 12px;
      font-weight: 700;
    }
    .overview {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin: 18px 0 24px;
    }
    .metric {
      min-height: 96px;
      border: 1px solid #d8e0ea;
      border-radius: 8px;
      background: #fff;
      padding: 16px;
    }
    .metric-label {
      color: #66788a;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .metric-value {
      margin-top: 8px;
      font-size: 28px;
      font-weight: 750;
    }
    .metric-note {
      margin-top: 6px;
      color: #627387;
      font-size: 13px;
      line-height: 1.35;
    }
    .workspace {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 20px;
      align-items: start;
    }
    .panel,
    .memory-column {
      min-width: 0;
    }
    .panel {
      position: sticky;
      top: 24px;
      border: 1px solid #d8e0ea;
      border-radius: 8px;
      background: #fff;
      padding: 16px;
    }
    .section-title {
      margin: 0 0 12px;
      color: #344356;
      font-size: 14px;
      font-weight: 700;
    }
    .kind-row {
      display: grid;
      gap: 6px;
      margin-top: 14px;
    }
    .kind-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: #405166;
      font-size: 13px;
      font-weight: 650;
    }
    .bar-track {
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: #edf1f5;
    }
    .bar-fill {
      height: 100%;
      border-radius: inherit;
      background: #2f7e77;
    }
    .status {
      color: #627387;
      font-size: 14px;
    }
    .group {
      margin-bottom: 22px;
    }
    .group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 10px;
    }
    .group-title {
      margin: 0;
      color: #253243;
      font-size: 16px;
      font-weight: 750;
    }
    .count {
      color: #323f4b;
      font-size: 12px;
      font-weight: 700;
      background: #eef2f6;
      border-radius: 999px;
      padding: 4px 9px;
    }
    .memory-card {
      display: grid;
      grid-template-columns: 5px minmax(0, 1fr);
      border: 1px solid #d8e0ea;
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
      margin-bottom: 8px;
    }
    .memory-rail {
      background: #2f7e77;
    }
    .memory-body {
      padding: 14px 16px;
    }
    .memory-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .sensitivity {
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .sensitivity.internal {
      background: #e7eef8;
      color: #315f99;
    }
    .sensitivity.public {
      background: #e6f4ef;
      color: #1f6f50;
    }
    .claim-id {
      color: #7b8794;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }
    .statement {
      color: #17202a;
      font-size: 15px;
      line-height: 1.5;
    }
    .empty {
      border: 1px dashed #cbd5df;
      border-radius: 8px;
      padding: 24px;
      color: #627387;
      font-size: 14px;
      background: #fff;
    }
    .kind-constraint .memory-rail,
    .kind-constraint .bar-fill {
      background: #8a5cf6;
    }
    .kind-preference .memory-rail,
    .kind-preference .bar-fill {
      background: #2f7e77;
    }
    .kind-decision .memory-rail,
    .kind-decision .bar-fill {
      background: #c26a2e;
    }
    .kind-fact .memory-rail,
    .kind-fact .bar-fill,
    .kind-project_context .memory-rail,
    .kind-project_context .bar-fill {
      background: #3f7db8;
    }
    .kind-procedure .memory-rail,
    .kind-procedure .bar-fill {
      background: #65758b;
    }
  </style>
</head>
<body>
  <main>
    <header class="app-header">
      <div>
        <h1>Memoring</h1>
        <div class="subtitle">Local owner view for scoped memories.</div>
      </div>
      <div class="control-row">
        <span class="pill">Read-only</span>
        <label>
          Scope
          <select id="scopeSelect" disabled>
            <option>Loading scopes...</option>
          </select>
        </label>
      </div>
    </header>
    <section id="overview" class="overview"></section>
    <div class="workspace">
      <aside class="panel">
        <h2 class="section-title">Kind mix</h2>
        <div id="kindChart"></div>
      </aside>
      <section class="memory-column">
        <div class="group-header">
          <h2 class="section-title">Memories</h2>
          <div id="status" class="status"></div>
        </div>
        <div id="memoryGroups"></div>
      </section>
    </div>
  </main>
  <script>
    const select = document.querySelector('#scopeSelect');
    const overviewEl = document.querySelector('#overview');
    const chartEl = document.querySelector('#kindChart');
    const statusEl = document.querySelector('#status');
    const groupsEl = document.querySelector('#memoryGroups');
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

    function setStatus(message) {
      statusEl.textContent = message || '';
    }

    function clearSurface() {
      overviewEl.replaceChildren();
      chartEl.replaceChildren();
      groupsEl.replaceChildren();
    }

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

    function groupByKind(rows) {
      const grouped = new Map();
      for (const row of rows) {
        const bucket = grouped.get(row.kind) || [];
        bucket.push(row);
        grouped.set(row.kind, bucket);
      }
      return grouped;
    }

    function sortedGroups(rows) {
      const grouped = groupByKind(rows);
      return Array.from(grouped.entries()).sort(([left], [right]) => {
        const l = kindOrder.indexOf(left);
        const r = kindOrder.indexOf(right);
        return (l < 0 ? 99 : l) - (r < 0 ? 99 : r) || left.localeCompare(right);
      });
    }

    function metric(label, value, note) {
      const item = document.createElement('div');
      item.className = 'metric';
      addText(item, 'div', label, 'metric-label');
      addText(item, 'div', value, 'metric-value');
      addText(item, 'div', note, 'metric-note');
      overviewEl.appendChild(item);
    }

    function renderOverview(rows, selected) {
      overviewEl.replaceChildren();
      const kinds = new Set(rows.map((row) => row.kind));
      metric('Visible memories', String(rows.length), 'After active scope and Gate');
      metric('Scope', selected ? selected.name : '-', selected ? selected.project_id : 'No active scope');
      metric('Sensitivity', 'Standard', 'Public and internal only');
      metric('Kinds', String(kinds.size), 'Grouped below');
    }

    function renderChart(groups, total) {
      chartEl.replaceChildren();
      if (total === 0) {
        addText(chartEl, 'div', 'No visible memory kinds.', 'status');
        return;
      }

      for (const [kind, bucket] of groups) {
        const row = document.createElement('div');
        row.className = 'kind-row ' + kindClass(kind);
        const meta = document.createElement('div');
        meta.className = 'kind-meta';
        addText(meta, 'span', kindLabels[kind] || kind);
        addText(meta, 'span', String(bucket.length));
        const track = document.createElement('div');
        track.className = 'bar-track';
        const fill = document.createElement('div');
        fill.className = 'bar-fill';
        fill.style.width = Math.max(6, Math.round((bucket.length / total) * 100)) + '%';
        track.appendChild(fill);
        row.append(meta, track);
        chartEl.appendChild(row);
      }
    }

    function renderRows(rows, selected) {
      const groups = sortedGroups(rows);
      renderOverview(rows, selected);
      renderChart(groups, rows.length);
      groupsEl.replaceChildren();

      if (rows.length === 0) {
        addText(groupsEl, 'div', 'No memories in this scope.', 'empty');
        return;
      }

      for (const [kind, bucket] of groups) {
        const group = document.createElement('section');
        group.className = 'group ' + kindClass(kind);
        const header = document.createElement('div');
        header.className = 'group-header';
        addText(header, 'h3', kindLabels[kind] || kind, 'group-title');
        addText(header, 'span', bucket.length + ' visible', 'count');
        group.appendChild(header);

        for (const row of bucket) {
          const card = document.createElement('article');
          card.className = 'memory-card ' + kindClass(row.kind);
          const rail = document.createElement('div');
          rail.className = 'memory-rail';
          const body = document.createElement('div');
          body.className = 'memory-body';
          const meta = document.createElement('div');
          meta.className = 'memory-meta';
          const sensitivity = addText(meta, 'span', row.sensitivity, 'sensitivity ' + row.sensitivity);
          const id = addText(meta, 'span', row.claim_id, 'claim-id');
          const statement = addText(body, 'div', row.statement, 'statement');
          body.prepend(meta);
          card.append(rail, body);
          group.appendChild(card);
        }

        groupsEl.appendChild(group);
      }
    }

    async function loadMemories() {
      const selected = scopes.find((scope) => scope.project_id === select.value);
      if (!selected) {
        clearSurface();
        setStatus('Select a scope.');
        return;
      }

      setStatus('Loading memories...');
      const params = new URLSearchParams({ scope: selected.name, project: selected.project_id });
      const response = await fetch('/api/memories?' + params.toString());
      if (!response.ok) throw new Error('Failed to load memories');
      const rows = await response.json();
      renderRows(rows, selected);
      setStatus(rows.length + ' visible');
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
        clearSurface();
        setStatus('No configured scopes.');
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
      loadMemories().catch((error) => {
        clearSurface();
        setStatus(error.message);
      });
    });

    loadScopes().catch((error) => {
      clearSurface();
      select.replaceChildren();
      select.disabled = true;
      setStatus(error.message);
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

  const url = new URL(req.url ?? '/', `http://${HOST}`);
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
    console.error(`[memoring serve] request failed: ${message}`);
    sendJson(res, 500, { error: 'internal_error' });
  }
}

const port = configuredPort();
const server = http.createServer(handleRequest);

server.on('error', (error) => {
  console.error(`[memoring serve] ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, HOST, () => {
  console.log(`Memoring browser listening at http://${HOST}:${port}`);
});
