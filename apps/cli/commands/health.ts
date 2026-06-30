import { buildHealthReport, type HealthIssue, type HealthReport } from '@retrieval/health';
import { isActiveRealmSilence, openResolvedRealm } from '@core/runtime';
import { parseFlags } from '../args';
import { getPassphrase } from '../prompt';
import { printActiveRealmSilence } from './resolve';

function count(map: Record<string, number>, key: string): number {
  return map[key] ?? 0;
}

export function renderHealthReport(report: HealthReport, limit = 8): string[] {
  const lines: string[] = [];
  lines.push('Memoring health');
  lines.push(`  Realm: ${report.realmId}`);
  lines.push(
    `  Claims: candidate=${count(report.counts.claims, 'candidate')} consolidated=${count(
      report.counts.claims,
      'consolidated',
    )} conflicted=${count(report.counts.claims, 'conflicted')} superseded=${count(
      report.counts.claims,
      'superseded',
    )} rejected=${count(report.counts.claims, 'rejected')} redacted=${count(report.counts.claims, 'redacted')}`,
  );
  lines.push(
    `  Scope states: candidate=${count(report.counts.scopeStates, 'candidate')} inferred=${count(
      report.counts.scopeStates,
      'inferred',
    )} confirmed=${count(report.counts.scopeStates, 'confirmed')} conflicted=${count(
      report.counts.scopeStates,
      'conflicted',
    )} missing=${count(report.counts.scopeStates, 'missing')}`,
  );
  lines.push(
    `  Sensitivity: public=${count(report.counts.sensitivity, 'public')} internal=${count(
      report.counts.sensitivity,
      'internal',
    )} confidential=${count(report.counts.sensitivity, 'confidential')} secret=${count(
      report.counts.sensitivity,
      'secret',
    )} unknown=${count(report.counts.sensitivity, 'unknown')}`,
  );
  lines.push('');
  const groups: Array<[string, HealthIssue[]]> = [
    ['Conflicting claims', report.conflictingClaims],
    ['Stale claims', report.staleClaims],
    ['Weak evidence', report.weakEvidence],
    ['Orphan labels', report.orphanLabels],
    ['Missing / weak scope assignment', report.weakScopeAssignments],
    ['Unsafe output candidates', report.unsafeOutputCandidates],
    ['Reflection diagnostics', report.reflectionDiagnostics],
  ];
  for (const [title, issues] of groups) {
    lines.push(`${title}: ${issues.length}`);
    for (const issue of issues.slice(0, limit)) lines.push(`  - ${issue.id}: ${issue.message}`);
    if (issues.length > limit) lines.push(`  ... ${issues.length - limit} more`);
  }
  lines.push('');
  lines.push('Advisory only: health never changes Gate, ranking, Claim authority, or evidence.');
  return lines;
}

export async function cmdHealth(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  try {
    const report = buildHealthReport(ctx);
    for (const line of renderHealthReport(report)) console.log(line);
    return 0;
  } finally {
    ctx.close(false);
  }
}
