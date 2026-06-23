import { activeScopeContainsAll, gate, type GateRequest } from '@core/policy';
import type { Claim } from '@core/schema/entities';
import type { RealmContext } from '@core/runtime';
import { resolveActiveLabelIds } from './active-scope';
import { toGateItem, toScopedClaim } from './context-pack';

export interface BrowseOptions {
  scope?: string;
  project?: string;
}

export interface MemoryRow {
  claim_id: string;
  kind: Claim['kind'];
  statement: string;
  sensitivity: Claim['sensitivity'];
  labelIds: string[];
}

function resolveProjectIds(ctx: RealmContext, projectIdOrName: string): string[] {
  const project = ctx.config.projects.find((p) => p.project_id === projectIdOrName || p.name === projectIdOrName);
  return project ? [project.project_id] : [];
}

export function listMemoriesForView(ctx: RealmContext, opts: BrowseOptions): MemoryRow[] {
  if (!opts.scope || !opts.project) return [];

  const projectIds = resolveProjectIds(ctx, opts.project);
  if (projectIds.length === 0) return [];

  const activeLabelIds = resolveActiveLabelIds(ctx, projectIds, opts.scope);
  if (activeLabelIds.length === 0) return [];

  const req: GateRequest = {
    audience: 'human_local_view',
    aperture: 'standard',
    activeLabelIds,
    crossScopeAllowed: false,
  };
  const rows: MemoryRow[] = [];

  for (const claim of ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')) {
    const sc = toScopedClaim(ctx, claim);
    if (!activeScopeContainsAll(sc.labelIds, activeLabelIds)) continue;
    if (!gate(toGateItem(ctx, sc), req).pass) continue;
    rows.push({
      claim_id: claim.claim_id,
      kind: claim.kind,
      statement: sc.statement,
      sensitivity: claim.sensitivity,
      labelIds: sc.labelIds,
    });
  }

  return rows;
}
