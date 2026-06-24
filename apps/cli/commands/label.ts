// `memoring label list|merge|rename|split` — Label (vocabulary) governance
// (FR-023..027). Confirmation authority is user/policy/rule only; AI never
// confirms a merge. merge unions evidence (re-points assignments) and never
// silently drops.
import { isActiveRealmSilence, openResolvedRealm, type RealmContext } from '@core/runtime';
import { rebuildIndex } from '@retrieval/search';
import { normalizeLabel } from '@core/label-normalize';
import { realmHmac } from '@security/crypto-primitives';
import type { Label } from '@core/schema/entities';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { printActiveRealmSilence } from './resolve';

function findLabel(ctx: RealmContext, nameOrId: string): Label | undefined {
  if (nameOrId.startsWith('lbl_')) return ctx.store.getLabel(nameOrId);
  return ctx.store.findLabelByNormalizedKey(ctx.realmId, realmHmac(ctx.realmKey, normalizeLabel(nameOrId)));
}

export async function cmdLabel(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const sub = flags._[0];
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  let dirty = true;
  try {
    switch (sub) {
      case 'list': {
        dirty = false;
        const labels = ctx.store.listLabels(ctx.realmId);
        if (labels.length === 0) console.log('  No labels.');
        for (const l of labels) console.log(`  ${l.label_id} ${l.canonical_name} [${l.state}]`);
        return 0;
      }
      case 'merge':
        return merge(ctx, flags._[1], flags._[2]);
      case 'rename':
        return rename(ctx, flags._[1], flags._[2]);
      case 'split':
        dirty = false;
        console.log('  label split: v0 surfaces split candidates only; use merge/rename to curate.');
        return 0;
      default:
        dirty = false;
        console.error('Usage: memoring label list | merge <from> <into> | rename <label> <newName>');
        return 1;
    }
  } finally {
    ctx.close(dirty);
  }
}

function merge(ctx: RealmContext, fromName?: string, intoName?: string): number {
  if (!fromName || !intoName) {
    console.error('Usage: memoring label merge <from> <into>');
    return 1;
  }
  const from = findLabel(ctx, fromName);
  const into = findLabel(ctx, intoName);
  if (!from || !into) {
    console.error('  Label(s) not found.');
    return 1;
  }
  if (from.label_id === into.label_id) {
    console.log('  Nothing to merge.');
    return 0;
  }
  // Re-point every assignment that references `from` onto `into` (union, dedup).
  let repointed = 0;
  for (const a of ctx.store.listAssignmentsByLabel(ctx.realmId, from.label_id)) {
    const next = [...new Set(a.label_ids.map((l) => (l === from.label_id ? into.label_id : l)))];
    ctx.store.putAssignment({ ...a, label_ids: next });
    repointed += 1;
  }
  ctx.store.putLabel({ ...from, state: 'merged', merged_into: into.label_id });
  ctx.chronicler.append('scope_confirm', from.label_id);
  // The search index stores label_ids as a snapshot taken at index time, so a merge
  // leaves stale `from` ids in doc_index until rebuilt — context (live assignments)
  // would see the new scope while search lagged. Rebuild deterministically so both
  // surfaces agree immediately.
  rebuildIndex(ctx);
  console.log(`  Merged ${from.canonical_name} → ${into.canonical_name} (${repointed} assignment(s) re-pointed).`);
  return 0;
}

function rename(ctx: RealmContext, nameOrId?: string, newName?: string): number {
  if (!nameOrId || !newName) {
    console.error('Usage: memoring label rename <label> <newName>');
    return 1;
  }
  const label = findLabel(ctx, nameOrId);
  if (!label) {
    console.error('  Label not found.');
    return 1;
  }
  const newKey = realmHmac(ctx.realmKey, normalizeLabel(newName));
  const collision = ctx.store.findLabelByNormalizedKey(ctx.realmId, newKey);
  if (collision && collision.label_id !== label.label_id) {
    console.error(`  A label with that normalized name already exists (${collision.label_id}). Use merge instead.`);
    return 1;
  }
  ctx.store.putLabel({
    ...label,
    canonical_name: newName,
    normalized_key: newKey,
    aliases: [...new Set([...label.aliases, label.canonical_name])],
  });
  ctx.chronicler.append('scope_confirm', label.label_id);
  console.log(`  Renamed ${label.canonical_name} → ${newName}.`);
  return 0;
}
