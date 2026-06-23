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
      color: #1f2933;
      background: #f7f8fa;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
    }
    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 650;
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
    section {
      margin-top: 24px;
    }
    h2 {
      margin: 28px 0 10px;
      font-size: 15px;
      font-weight: 650;
      color: #323f4b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border: 1px solid #d9e2ec;
      border-radius: 8px;
      overflow: hidden;
    }
    th,
    td {
      border-bottom: 1px solid #e4e7eb;
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
      line-height: 1.45;
    }
    th {
      width: 128px;
      background: #f0f4f8;
      color: #52606d;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 700;
    }
    tr:last-child td,
    tr:last-child th {
      border-bottom: 0;
    }
    .status {
      color: #627d98;
      font-size: 14px;
    }
    .empty {
      padding: 18px 0;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Memoring</h1>
      <label>
        Scope
        <select id="scopeSelect" disabled>
          <option>Loading scopes...</option>
        </select>
      </label>
    </header>
    <div id="status" class="status"></div>
    <section id="memoryGroups"></section>
  </main>
  <script>
    const select = document.querySelector('#scopeSelect');
    const statusEl = document.querySelector('#status');
    const groupsEl = document.querySelector('#memoryGroups');
    let scopes = [];

    function setStatus(message) {
      statusEl.textContent = message || '';
    }

    function clearGroups() {
      groupsEl.replaceChildren();
    }

    function addText(parent, tag, text, className) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      el.textContent = text;
      parent.appendChild(el);
      return el;
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

    function renderRows(rows) {
      clearGroups();
      if (rows.length === 0) {
        addText(groupsEl, 'div', 'No memories in this scope.', 'status empty');
        return;
      }

      for (const [kind, bucket] of groupByKind(rows)) {
        addText(groupsEl, 'h2', kind);
        const table = document.createElement('table');
        const tbody = document.createElement('tbody');
        for (const row of bucket) {
          const tr = document.createElement('tr');
          const sensitivity = document.createElement('th');
          sensitivity.scope = 'row';
          sensitivity.textContent = row.sensitivity;
          const statement = document.createElement('td');
          statement.textContent = row.statement;
          tr.append(sensitivity, statement);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        groupsEl.appendChild(table);
      }
    }

    async function loadMemories() {
      const selected = scopes.find((scope) => scope.project_id === select.value);
      if (!selected) {
        clearGroups();
        setStatus('Select a scope.');
        return;
      }

      setStatus('Loading memories...');
      const params = new URLSearchParams({ scope: selected.name, project: selected.project_id });
      const response = await fetch('/api/memories?' + params.toString());
      if (!response.ok) throw new Error('Failed to load memories');
      const rows = await response.json();
      renderRows(rows);
      setStatus(rows.length + ' visible memories');
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
        clearGroups();
        setStatus(error.message);
      });
    });

    loadScopes().catch((error) => {
      clearGroups();
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
