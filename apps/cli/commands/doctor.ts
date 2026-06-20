// `memoring doctor` — inspect compatibility (host/format/Parser versions) and
// file safety, and only warn/suggest. It must NOT change the host tool's
// settings, retention, or permissions (FR-084).
import fs from 'node:fs';
import { replicaLayout } from '@core/paths';
import { openRealm, replicaExists } from '@core/runtime';
import { listConnectors } from '@intake/registry';
import { getPassphrase } from '../prompt';

export async function cmdDoctor(): Promise<number> {
  const layout = replicaLayout();
  console.log(`  Replica: ${layout.root}`);
  if (!replicaExists()) {
    console.log('  [warn] No replica found. Run `memoring init`.');
    return 0;
  }
  console.log('  [ok] realm.toml and key bundle present.');

  // Permission check on the replica root (best-effort).
  try {
    const mode = fs.statSync(layout.root).mode & 0o777;
    if (mode & 0o077) console.log(`  [warn] replica dir mode is ${mode.toString(8)}; 0700 recommended.`);
    else console.log('  [ok] replica dir permissions are 0700.');
  } catch {
    /* ignore */
  }

  // Host/Parser compatibility — detect only, never modify the host.
  for (const connector of listConnectors()) {
    const det = await connector.detect();
    console.log(`  [info] ${connector.displayName}: ${det.sources.length} source(s) detected.`);
    for (const note of det.notes) console.log(`         - ${note}`);
  }

  const passphrase = await getPassphrase('Passphrase (to inspect realm contents, or Ctrl-C to skip): ');
  try {
    const ctx = openRealm(passphrase, layout.root);
    try {
      const consolidated = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').length;
      const candidates = ctx.store.listClaimsByStatus(ctx.realmId, 'candidate').length;
      const quarantined = ctx.store.countQuarantine(ctx.realmId);
      console.log(
        `  [info] projects=${ctx.config.projects.length} connectors=${ctx.config.connectors.length} ` +
          `consolidated_claims=${consolidated} candidate_claims=${candidates} quarantined=${quarantined}`,
      );
    } finally {
      ctx.close(false);
    }
  } catch (e) {
    console.log(`  [warn] could not open realm: ${(e as Error).message}`);
  }
  return 0;
}
