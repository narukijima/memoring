// `memoring import` — bring a pasted foreign-AI export ("what I know about you")
// into the active Realm as non-authoritative candidates, then review / promote /
// reject (ADR-0007). The CLI is the source of truth for operations.
//   memoring import [provider] [--file f | --text s | <stdin>] [--default-sensitivity s] [--dry-run]
//   memoring import list
//   memoring import promote <id> --scope <label> [--sensitivity public|internal|confidential]
//   memoring import reject <id>
//   memoring import --print-prompt <claude|gemini|chatgpt>
import fs from 'node:fs';
import { isActiveRealmSilence, openResolvedRealm, type RealmContext } from '@core/runtime';
import { readClaimStatement } from '@claim/extractor';
import { indexClaim } from '@retrieval/search';
import {
  ingestImport,
  listImportedCandidates,
  promoteImportedClaim,
  rejectImportedClaim,
  type DeclaredSensitivity,
} from '@intake/import-from-ai';
import { exportPromptFor, parseExport } from '@integrations/import-ai/index';
import { getPassphrase } from '../prompt';
import { parseFlags, type Flags } from '../args';
import { isDryRun } from './connect';
import { printActiveRealmSilence } from './resolve';

const RESERVED = new Set(['list', 'promote', 'reject']);

export async function cmdImport(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);

  // --print-prompt needs no Realm: pure local string print (no egress).
  const printProvider = flags['print-prompt'];
  if (typeof printProvider === 'string') return printPrompt(printProvider);

  const sub = flags._[0];
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  let dirty = false;
  try {
    switch (sub) {
      case 'list':
        return cmdList(ctx);
      case 'promote':
        dirty = true;
        return cmdPromote(ctx, flags);
      case 'reject':
        dirty = true;
        return cmdReject(ctx, flags._[1]);
      default: {
        const code = await cmdIngest(ctx, flags);
        dirty = !isDryRun(flags) && code === 0;
        return code;
      }
    }
  } finally {
    ctx.close(dirty);
  }
}

function readInput(flags: Flags): Buffer | null {
  if (typeof flags.file === 'string') {
    try {
      return fs.readFileSync(flags.file);
    } catch (e) {
      console.error(`  Cannot read --file ${flags.file}: ${(e as Error).message}`);
      return null;
    }
  }
  if (typeof flags.text === 'string') return Buffer.from(flags.text, 'utf8');
  try {
    const buf = fs.readFileSync(0); // stdin (fd 0)
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/** First positional is an optional provider hint (claude / gemini / chatgpt). */
function providerHint(flags: Flags): string | undefined {
  const p = flags._[0];
  return p && !RESERVED.has(p) ? p : undefined;
}

function declaredSensitivity(flags: Flags, key: string): DeclaredSensitivity | undefined {
  const v = flags[key];
  return v === 'public' || v === 'internal' || v === 'confidential' ? v : undefined;
}

async function cmdIngest(ctx: RealmContext, flags: Flags): Promise<number> {
  const bytes = readInput(flags);
  if (!bytes || bytes.length === 0) {
    console.error('  No import payload. Provide --file <path>, --text "<export>", or pipe via stdin.');
    return 1;
  }
  const hint = providerHint(flags);

  // --dry-run: parse + show the per-entry Inventory, persist nothing (G12).
  if (isDryRun(flags)) {
    const parsed = parseExport(bytes, hint);
    if (!parsed.ok) {
      console.log(`  [dry-run] Unparseable export (${parsed.reason}). It would be QUARANTINED (raw kept, no loss).`);
      return 0;
    }
    console.log(`  [dry-run] No changes will be made. Provider: ${parsed.export.provider}`);
    console.log(`  Inventory — ${parsed.export.entries.length} entr(ies) would stage as candidates:`);
    parsed.export.entries.forEach((e, i) => {
      console.log(`    [${i}] ${e.kind.padEnd(15)} ${e.date ?? 'unknown'.padEnd(10)}  ${e.statement.slice(0, 64)}`);
    });
    console.log('  [dry-run] Re-run without --dry-run to ingest, then `memoring import list` to review.');
    return 0;
  }

  const result = ingestImport(ctx, bytes, {
    providerHint: hint,
    defaultSensitivity: declaredSensitivity(flags, 'default-sensitivity'),
  });
  console.log(
    `  Imported from ${result.provider}: events=${result.events} candidates=${result.candidates} ` +
      `deduped=${result.deduped} quarantined=${result.quarantined} secret_skipped=${result.secretSkipped}`,
  );
  if (result.candidates > 0) {
    console.log('  These are NON-authoritative candidates (not recalled until you promote them).');
    console.log('  Next: `memoring import list`, then `memoring import promote <id> --scope <label>`.');
  } else if (result.quarantined > 0) {
    console.log('  Nothing parseable — the raw paste was quarantined (kept, no loss).');
  }
  return 0;
}

function cmdList(ctx: RealmContext): number {
  const pending = listImportedCandidates(ctx);
  if (pending.length === 0) {
    console.log('  No imported candidates awaiting review.');
    return 0;
  }
  console.log(`  ${pending.length} imported candidate(s) awaiting review:`);
  for (const { claim, provenance } of pending) {
    const stmt = readClaimStatement(ctx, claim).slice(0, 64);
    const from = provenance?.provider ?? 'unknown';
    const date = provenance?.date ?? 'unknown';
    console.log(`  ${claim.claim_id} [${claim.kind}] from=${from} date=${date}  ${stmt}`);
  }
  console.log('  Promote: `memoring import promote <id> --scope <label> [--sensitivity internal]`');
  return 0;
}

function cmdPromote(ctx: RealmContext, flags: Flags): number {
  const id = flags._[1];
  const scope = typeof flags.scope === 'string' ? flags.scope : undefined;
  if (!id || !scope) {
    console.error('  Usage: memoring import promote <id> --scope <label> [--sensitivity public|internal|confidential]');
    return 1;
  }
  const outcome = promoteImportedClaim(ctx, id, { scope, sensitivity: declaredSensitivity(flags, 'sensitivity') });
  if (!outcome.ok) {
    if (outcome.reason === 'sensitivity_required') {
      console.error('  This candidate has no declared sensitivity. Pass --sensitivity public|internal|confidential.');
    } else {
      console.error(`  Cannot promote ${id}: ${outcome.reason}`);
    }
    return 1;
  }
  indexClaim(ctx, outcome.claim); // now recallable under the chosen scope
  console.log(`  Promoted ${id} → consolidated (scope=${scope}, sensitivity=${outcome.claim.sensitivity}, by user).`);
  return 0;
}

function cmdReject(ctx: RealmContext, id?: string): number {
  if (!id) {
    console.error('  Usage: memoring import reject <id>');
    return 1;
  }
  const outcome = rejectImportedClaim(ctx, id);
  if (!outcome.ok) {
    console.error(`  Cannot reject ${id}: ${outcome.reason}`);
    return 1;
  }
  console.log(`  Rejected ${id} (dropped from review).`);
  return 0;
}

function printPrompt(provider: string): number {
  const prompt = exportPromptFor(provider);
  if (!prompt) {
    console.error(`  No export prompt for "${provider}". Try: claude | gemini | chatgpt.`);
    return 1;
  }
  console.log(prompt);
  return 0;
}
