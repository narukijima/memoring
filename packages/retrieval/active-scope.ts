// Active label resolution shared by context build and search: the labels that
// belong to the active project(s) (Detailed Design §3.4 step 3). A --scope names
// a label directly. Labels are looked up by realm_key-HMAC normalized_key.
import { normalizeLabel } from '@core/label-normalize';
import { realmHmac } from '@security/crypto-primitives';
import type { RealmContext } from '@core/runtime';

export function resolveActiveLabelIds(ctx: RealmContext, projectIds: string[], scope?: string): string[] {
  if (scope) {
    const lbl = ctx.store.findLabelByNormalizedKey(ctx.realmId, realmHmac(ctx.realmKey, normalizeLabel(scope)));
    return lbl ? [lbl.label_id] : [];
  }
  const ids: string[] = [];
  for (const pid of projectIds) {
    const project = ctx.config.projects.find((p) => p.project_id === pid);
    if (!project) continue;
    const lbl = ctx.store.findLabelByNormalizedKey(ctx.realmId, realmHmac(ctx.realmKey, normalizeLabel(project.name)));
    if (lbl) ids.push(lbl.label_id);
  }
  return ids;
}
