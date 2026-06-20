// `memoring claim list|pin|correct|expire` — reactive Claim governance
// (FR-064). pin strengthens reinforcement; correct edits the statement WITHOUT
// lowering sensitivity (no AI Declassify, G9); expire supersedes (drops from
// active recall).
import { replicaLayout } from '@core/paths';
import { openRealm, type RealmContext } from '@core/runtime';
import { reinforcement } from '@claim/lifecycle';
import { readClaimStatement } from '@claim/extractor';
import { indexClaim } from '@retrieval/search';
import { hmacHex } from '@security/crypto-primitives';
import { normalizeLabel } from '@core/label-normalize';
import { scanText } from '@security/secret-scan';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';

export async function cmdClaim(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const sub = flags._[0];
  const passphrase = await getPassphrase();
  const ctx = openRealm(passphrase, replicaLayout().root);
  let dirty = true;
  try {
    switch (sub) {
      case 'list': {
        dirty = false;
        const claims = ctx.store.listClaims(ctx.realmId);
        if (claims.length === 0) console.log('  No claims.');
        for (const c of claims) {
          const stmt = readClaimStatement(ctx, c).slice(0, 70);
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
  // Replace the statement; sensitivity is preserved (correction never declassifies).
  const ref = ctx.objects.put(`${c.claim_id}_stmt_corr`, Buffer.from(text, 'utf8')).ref;
  const secretDetected = scanText(text).detected;
  const updated = {
    ...c,
    statement_ref: ref,
    sensitivity: secretDetected ? 'secret' : c.sensitivity,
    sensitivity_classification_state: secretDetected ? 'inferred' : c.sensitivity_classification_state,
  };
  ctx.store.putClaim(updated);
  // Re-key the dedup map and reindex.
  ctx.store.setMeta(`claimkey:${hmacHex(ctx.realmKey, `${c.kind}\x1f${normalizeLabel(text)}`)}`, c.claim_id);
  if (secretDetected) ctx.store.indexDelete(c.claim_id);
  else if (updated.status === 'consolidated') indexClaim(ctx, updated);
  console.log(secretDetected ? `  Corrected ${id} (secret detected; output suppressed).` : `  Corrected ${id}.`);
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
