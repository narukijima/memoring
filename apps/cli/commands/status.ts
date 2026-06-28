// `memoring status` — a human-sized setup check. This is intentionally a thin
// read-only wrapper over the existing Realm/runtime state, not a new authority
// path.
import { replicaLayout } from '@core/paths';
import { isActiveRealmSilence, openActiveRealm, replicaExists, resolveActiveReplicaRoot } from '@core/runtime';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { chatStrings, type ChatStrings, type Lang } from '../i18n';

function sourceCount(sourceIds: string[][]): number {
  return new Set(sourceIds.flat()).size;
}

function connectorSummary(connectors: { connector_id: string; source_stable_ids: string[] }[], s: ChatStrings): string {
  if (connectors.length === 0) return s.statusConnectorsNone;
  return connectors.map((c) => `${c.connector_id.replace(/_/g, '-')}: ${c.source_stable_ids.length}`).join(', ');
}

function formatModel(llm: { base_url: string; model: string; egress?: 'local' | 'remote' } | undefined, s: ChatStrings): string {
  if (!llm) return s.statusModelNotConfigured;
  return `${llm.model} (${llm.egress ?? 'auto'}, ${llm.base_url})`;
}

// The standalone `memoring status` command stays English (the operational CLI
// surface); the interactive chat passes its session language so in-chat `/status`
// matches the rest of the chat surface.
export function memoryStatusLines(
  ctx: {
    realmId: string;
    config: {
      name: string;
      connectors: { connector_id: string; source_stable_ids: string[] }[];
      llm?: { base_url: string; model: string; egress?: 'local' | 'remote' };
    };
    store: {
      listLabels(realmId: string): { state: string; canonical_name: string }[];
      listClaimsByStatus(realmId: string, status: string): unknown[];
    };
  },
  lang: Lang = 'en',
): string[] {
  const s = chatStrings(lang);
  const labels = ctx.store
    .listLabels(ctx.realmId)
    .filter((l) => l.state === 'active')
    .map((l) => l.canonical_name)
    .sort((a, b) => a.localeCompare(b));
  const claims = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').length;
  const configuredSources = sourceCount(ctx.config.connectors.map((c) => c.source_stable_ids));
  const lines = [
    s.statusMemory(ctx.config.name, ctx.realmId),
    s.statusStored(claims, configuredSources, labels.length),
    s.statusConnected(connectorSummary(ctx.config.connectors, s)),
    s.statusModel(formatModel(ctx.config.llm, s)),
  ];
  if (labels.length > 0) {
    const shown = labels.slice(0, 12);
    const more = labels.length > shown.length ? `, +${labels.length - shown.length} more` : '';
    lines.push(s.statusScopes(`${shown.join(', ')}${more}`));
  }
  return lines;
}

export async function cmdStatus(argv: string[] = []): Promise<number> {
  const flags = parseFlags(argv);
  const resolved = resolveActiveReplicaRoot({ flags, cwd: process.cwd(), commandClass: 'mgmt' });
  if (isActiveRealmSilence(resolved)) {
    console.log('Memoring');
    console.log(`  Memory: not ready (${resolved.silence})`);
    console.log('  Next: memoring init');
    return 0;
  }

  const layout = replicaLayout(resolved);
  console.log('Memoring');
  console.log(`  Memory: ${layout.root}`);
  if (!replicaExists(layout.root)) {
    console.log('  Status: not initialized');
    console.log('  Next: memoring init');
    return 0;
  }

  const ctx = await openActiveRealm(layout.root, () =>
    getPassphrase('Passphrase (to inspect memory status, or Ctrl-C to skip): '),
  );
  try {
    for (const line of memoryStatusLines(ctx)) console.log(`  ${line}`);
    console.log('');
    console.log('Use:');
    console.log('  memoring "what did we decide about X?"');
    console.log('  memoring sync');
    console.log('  memoring context build');
    const labels = ctx.store
      .listLabels(ctx.realmId)
      .filter((l) => l.state === 'active')
      .map((l) => l.canonical_name)
      .sort((a, b) => a.localeCompare(b));
    if (labels.length > 0) {
      console.log('');
      console.log('Tip: add --scope <name> when asking about a specific project.');
    }
    return 0;
  } finally {
    ctx.close(false);
  }
}
