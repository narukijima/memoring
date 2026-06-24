// `npm run serve` entry: generate a fresh per-session capability token, start the
// localhost panel, and print the panel URL with the token in the fragment so it
// never lands in Referer / access logs / proxy logs. The token lives only in this
// process (in-memory); optional 0600-file persistence is OFF by default — see
// MEMORING_SERVE_TOKEN_FILE below. All security/routing logic lives in ./panel.
import fs from 'node:fs';
import { generateToken, startPanelServer, PANEL_DEFAULT_PORT, PANEL_HOST } from './panel';

function configuredPort(): number {
  const raw = process.env.MEMORING_SERVE_PORT;
  if (!raw) return PANEL_DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('MEMORING_SERVE_PORT must be an integer from 1 to 65535');
  }
  return port;
}

/** Optional convenience: persist the token to a 0600 file. OFF by default and
 *  discouraged — a same-uid file grants any local process running as the owner
 *  read access for the serve lifetime, weakening the very threat model the token
 *  exists to address (ADR-0010 §1). Prefer fragment-only delivery. */
function maybePersistToken(token: string): void {
  const file = process.env.MEMORING_SERVE_TOKEN_FILE;
  if (!file) return;
  fs.writeFileSync(file, token, { mode: 0o600 });
  console.log(`  Token also written (0600) to ${file} — any local process as you can read it.`);
}

const token = generateToken();
maybePersistToken(token);

startPanelServer({ token, port: configuredPort(), root: process.env.MEMORING_HOME })
  .then(({ url }) => {
    console.log('Memoring control panel listening at http://' + PANEL_HOST + ':' + configuredPort());
    console.log('Open (token in fragment, not logged): ' + url);
  })
  .catch((error: Error) => {
    console.error('[memoring serve] ' + error.message);
    process.exitCode = 1;
  });
