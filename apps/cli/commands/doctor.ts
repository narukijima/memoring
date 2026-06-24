// `memoring doctor` — inspect the replica (file safety / permissions, source
// detection, claim + quarantine counts) and only warn/suggest. v0 does NOT compare
// host-tool versions (there is no supported-version table yet); an incompatible host
// format degrades safely through the parser's quarantine arm (G2), surfaced as a
// count below. doctor must NOT change the host tool's settings, retention, or
// permissions (FR-084).
import fs from 'node:fs';
import { replicaLayout } from '@core/paths';
import { isActiveRealmSilence, openActiveRealm, replicaExists, resolveActiveReplicaRoot } from '@core/runtime';
import { listConnectors } from '@intake/registry';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';

export async function cmdDoctor(argv: string[] = []): Promise<number> {
  const flags = parseFlags(argv);
  const resolved = resolveActiveReplicaRoot({ flags, cwd: process.cwd(), commandClass: 'mgmt' });
  if (isActiveRealmSilence(resolved)) {
    console.log(`  [warn] ${resolved.silence}. Run \`memoring init\` or \`memoring realm new <name>\`.`);
    return 0;
  }
  const layout = replicaLayout(resolved);
  console.log(`  Replica: ${layout.root}`);
  if (!replicaExists(layout.root)) {
    console.log('  [warn] No replica found. Run `memoring init`.');
    return 0;
  }
  console.log('  [ok] realm.toml and key present.');

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

  try {
    const ctx = await openActiveRealm(layout.root, () =>
      getPassphrase('Passphrase (to inspect realm contents, or Ctrl-C to skip): '),
    );
    try {
      const consolidated = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').length;
      const candidates = ctx.store.listClaimsByStatus(ctx.realmId, 'candidate').length;
      const quarantined = ctx.store.countQuarantine(ctx.realmId);
      console.log(
        `  [info] projects=${ctx.config.projects.length} connectors=${ctx.config.connectors.length} ` +
          `consolidated_claims=${consolidated} candidate_claims=${candidates} quarantined=${quarantined}`,
      );
      if (quarantined > 0) {
        console.log(
          `  [warn] ${quarantined} record(s) quarantined (unparseable / unknown format; raw is preserved, ` +
            'never lost). After a parser update, `memoring reprocess` re-derives them.',
        );
      }
    } finally {
      ctx.close(false);
    }
  } catch (e) {
    console.log(`  [warn] could not open realm: ${(e as Error).message}`);
  }
  return 0;
}
