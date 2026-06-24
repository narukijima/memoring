// Reactive governance — destructive operations (FR-064..073, gate 10). The user
// governs after the fact; these are the only irreversible operations and require
// explicit confirmation (Specification §8.2).
import { isActiveRealmSilence, openResolvedRealm, type RealmContext } from '@core/runtime';
import {
  deleteUndiluted,
  forgetByPattern,
  forgetClaim,
  redactEventById,
  releaseSealRule,
} from '@security/redaction';
import { ask, getPassphrase } from '../prompt';
import { parseFlags, type Flags } from '../args';
import { printActiveRealmSilence } from './resolve';

export async function confirm(flags: Flags, what: string): Promise<boolean> {
  if (flags.yes === true) return true;
  if (process.env.MEMORING_PASSPHRASE) {
    console.error(`Refusing destructive op without --yes (headless): ${what}`);
    return false;
  }
  const a = await ask(`  This is irreversible: ${what}. Type 'yes' to proceed: `);
  return a.trim() === 'yes';
}

type WithRealmResult<T> = { kind: 'value'; value: T } | { kind: 'exit'; code: number };

async function withRealm<T>(flags: Flags, fn: (ctx: RealmContext) => T): Promise<WithRealmResult<T>> {
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return { kind: 'exit', code: printActiveRealmSilence(opened) };
  const ctx = opened;
  try {
    const r = fn(ctx);
    ctx.flush();
    return { kind: 'value', value: r };
  } finally {
    ctx.close(true);
  }
}

export async function cmdForget(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  if (typeof flags.pattern === 'string') {
    if (!(await confirm(flags, `forget all claims matching /${flags.pattern}/`))) return 1;
    const n = await withRealm(flags, (ctx) => forgetByPattern(ctx, flags.pattern as string));
    if (n.kind === 'exit') return n.code;
    console.log(`  Forgot ${n.value} claim(s) and sealed the pattern.`);
    return 0;
  }
  const id = flags._[0];
  if (!id) {
    console.error('Usage: memoring forget <claim_id|event_id|undiluted_id> | --pattern <regex>');
    return 1;
  }
  if (!(await confirm(flags, `forget ${id}`))) return 1;
  const ok = await withRealm(flags, (ctx) => {
    if (id.startsWith('clm_')) return forgetClaim(ctx, id, { seal: true });
    if (id.startsWith('evt_')) return redactEventById(ctx, id, { seal: true });
    if (id.startsWith('und_')) return deleteUndiluted(ctx, id, { seal: true }).found;
    return false;
  });
  if (ok.kind === 'exit') return ok.code;
  console.log(ok.value ? `  Forgot ${id} (sealed).` : `  Not found: ${id}`);
  return ok.value ? 0 : 1;
}

export async function cmdDelete(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const id = flags._[0];
  if (!id) {
    console.error('Usage: memoring delete <undiluted_id|event_id|claim_id>');
    return 1;
  }
  if (!(await confirm(flags, `delete ${id} and cascade`))) return 1;
  const ok = await withRealm(flags, (ctx) => {
    if (id.startsWith('und_')) return deleteUndiluted(ctx, id, { seal: false }).found;
    if (id.startsWith('evt_')) return redactEventById(ctx, id, { seal: false });
    if (id.startsWith('clm_')) return forgetClaim(ctx, id, { seal: false });
    return false;
  });
  if (ok.kind === 'exit') return ok.code;
  console.log(ok.value ? `  Deleted ${id} (cascaded).` : `  Not found: ${id}`);
  return ok.value ? 0 : 1;
}

export async function cmdRedact(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const id = flags._[0];
  if (!id) {
    console.error('Usage: memoring redact <event_id|claim_id>');
    return 1;
  }
  if (!(await confirm(flags, `redact ${id}`))) return 1;
  const ok = await withRealm(flags, (ctx) => {
    if (id.startsWith('evt_')) return redactEventById(ctx, id, { seal: false });
    if (id.startsWith('clm_')) return forgetClaim(ctx, id, { seal: false });
    return false;
  });
  if (ok.kind === 'exit') return ok.code;
  console.log(ok.value ? `  Redacted ${id}.` : `  Not found: ${id}`);
  return ok.value ? 0 : 1;
}

export async function cmdSuppress(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const sub = flags._[0];
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  try {
    if (sub === 'list') {
      const rules = ctx.store.listSealRules(ctx.realmId);
      if (rules.length === 0) console.log('  No SealRules.');
      for (const r of rules) {
        console.log(`  ${r.suppression_id} [${r.match_type}] active=${r.active} created_at=${r.created_at}`);
      }
      return 0;
    }
    if (sub === 'remove') {
      const id = flags._[1];
      if (!id) {
        console.error('Usage: memoring suppress remove <suppression_id>');
        return 1;
      }
      const ok = releaseSealRule(ctx, id);
      ctx.flush();
      console.log(ok ? `  Released ${id}.` : `  Not found: ${id}`);
      return ok ? 0 : 1;
    }
    console.error('Usage: memoring suppress list | remove <id>');
    return 1;
  } finally {
    ctx.close(true);
  }
}
