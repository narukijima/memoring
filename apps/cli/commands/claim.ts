// `memoring claim list|pin|correct|expire` — reactive Claim governance
// (FR-064). pin strengthens reinforcement; correct edits the statement WITHOUT
// lowering sensitivity (no AI Declassify, G9); expire supersedes (drops from
// active recall).
import { normalizeLabel } from '@core/label-normalize';
import { isActiveRealmSilence, openResolvedRealm, type RealmContext } from '@core/runtime';
import { newId } from '@core/schema/ids';
import { reinforcement } from '@claim/lifecycle';
import { claimKeyMeta, readClaimStatement } from '@claim/extractor';
import { indexClaim } from '@retrieval/search';
import { scanText } from '@security/secret-scan';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import type { Claim } from '@core/schema/entities';
import { printActiveRealmSilence } from './resolve';

export async function cmdClaim(argv: string[]): Promise<number> {
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
        const claims = ctx.store.listClaims(ctx.realmId);
        if (claims.length === 0) console.log('  No claims.');
        for (const c of claims) {
          const stmt = claimListStatement(ctx, c);
          console.log(`  ${c.claim_id} [${c.kind}/${c.status}] r=${c.reinforcement_score.toFixed(2)} ${stmt}`);
        }
        return 0;
      }
      case 'pin':
        return pin(ctx, flags._[1]);
      case 'correct':
        return correct(ctx, flags._[1], flags._.slice(2).join(' '));
      case 'expire':
        return expire(ctx, flags._[1]);
      default:
        dirty = false;
        console.error('Usage: memoring claim list | pin <id> | correct <id> <text> | expire <id>');
        return 1;
    }
  } finally {
    ctx.close(dirty);
  }
}

function claimListStatement(ctx: RealmContext, claim: Claim): string {
  if (claim.status === 'redacted') return '[redacted]';
  if (claim.sensitivity === 'secret' || claim.sensitivity === 'unknown' || claim.sensitivity === 'confidential') {
    return `[suppressed:${claim.sensitivity}]`;
  }
  return readClaimStatement(ctx, claim).slice(0, 70);
}

function pin(ctx: RealmContext, id?: string): number {
  if (!id) return usage();
  const c = ctx.store.getClaim(id);
  if (!c) return notFound(id);
  const score = reinforcement({
    current: c.reinforcement_score,
    valid_recall_count: 0,
    user_pin: 1,
    independent_evidence_count: c.evidence_count,
    correction_count: 0,
    conflict_count: 0,
    age_decay: 0,
  });
  ctx.store.putClaim({ ...c, reinforcement_score: score });
  console.log(`  Pinned ${id} (reinforcement=${score.toFixed(2)}).`);
  return 0;
}

function correct(ctx: RealmContext, id?: string, text?: string): number {
  if (!id || !text) return usage();
  const c = ctx.store.getClaim(id);
  if (!c) return notFound(id);
  const oldStatement = readClaimStatement(ctx, c);
  const ref = ctx.objects.put(`${c.claim_id}_stmt_corr`, Buffer.from(text, 'utf8')).ref;
  const secretDetected = scanText(text).detected;
  const sensitivity = secretDetected ? 'secret' : c.sensitivity;
  const sensitivityState = secretDetected ? 'inferred' : c.sensitivity_classification_state;

  ctx.store.deleteMeta(claimKeyMeta(ctx.realmKey, c.kind, oldStatement, c.project_ids));
  if (normalizeLabel(oldStatement) === normalizeLabel(text)) {
    const updated: Claim = {
      ...c,
      statement_ref: ref,
      sensitivity,
      sensitivity_classification_state: sensitivityState,
    };
    ctx.store.putClaim(updated);
    ctx.store.setMeta(claimKeyMeta(ctx.realmKey, c.kind, text, c.project_ids), c.claim_id);
    if (secretDetected) ctx.store.indexDelete(c.claim_id);
    else if (updated.status === 'consolidated') indexClaim(ctx, updated);
    console.log(secretDetected ? `  Corrected ${id} (secret detected; output suppressed).` : `  Corrected ${id}.`);
    return 0;
  }

  const nowIso = new Date().toISOString();
  const replacement: Claim = {
    ...c,
    claim_id: newId('claim'),
    statement_ref: ref,
    created_by: 'user',
    created_at: nowIso,
    last_recalled_at: null,
    valid_from: nowIso,
    valid_until: null,
    supersedes: [c.claim_id],
    sensitivity,
    sensitivity_classification_state: sensitivityState,
  };
  ctx.store.putClaim({ ...c, status: 'superseded', valid_until: nowIso });
  ctx.store.putClaim(replacement);
  ctx.store.setMeta(claimKeyMeta(ctx.realmKey, c.kind, text, c.project_ids), replacement.claim_id);
  ctx.store.indexDelete(c.claim_id);
  if (!secretDetected && replacement.status === 'consolidated') indexClaim(ctx, replacement);
  console.log(
    secretDetected
      ? `  Corrected ${id} -> ${replacement.claim_id} (secret detected; output suppressed).`
      : `  Corrected ${id} -> ${replacement.claim_id}.`,
  );
  return 0;
}

function expire(ctx: RealmContext, id?: string): number {
  if (!id) return usage();
  const c = ctx.store.getClaim(id);
  if (!c) return notFound(id);
  ctx.store.putClaim({ ...c, status: 'superseded', valid_until: new Date().toISOString() });
  ctx.store.indexDelete(id);
  console.log(`  Expired ${id} (removed from active recall).`);
  return 0;
}

function usage(): number {
  console.error('Usage: memoring claim list | pin <id> | correct <id> <text> | expire <id>');
  return 1;
}
function notFound(id: string): number {
  console.error(`  Not found: ${id}`);
  return 1;
}
