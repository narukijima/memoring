// Memoring CLI entry point. The primary surface of v0; the lead command is
// `context build`, not `search` (Specification §1).
import { cmdInit } from './commands/init';
import { cmdConnect } from './commands/connect';
import { cmdBackfill } from './commands/backfill';
import { cmdContextBuild } from './commands/context';
import { cmdDoctor } from './commands/doctor';
import { cmdSearch } from './commands/search';
import { cmdIndex } from './commands/reindex';
import { cmdForget, cmdDelete, cmdRedact, cmdSuppress } from './commands/forget';
import { cmdClaim } from './commands/claim';
import { cmdLabel } from './commands/label';
import { cmdReprocess } from './commands/reprocess';
import { cmdWatch } from './commands/watch';
import { cmdExport } from './commands/export';
import { cmdMcp } from './commands/mcp';

const HELP = `Memoring — Sovereign Memory Loop (v0)

Usage:
  memoring init                          Create the encrypted replica (passphrase + recovery code).
  memoring connect <connector> [opts]    Detect sources, choose include/exclude + Realm assignment.
      connectors: claude-code
      --all | --source <id>              Selection (no whole-tool default).
      --default-sensitivity <s>          public|internal|confidential (project policy; default internal).
      --backfill                         Run the loop after connecting.
  memoring backfill                      Ingest history from registered sources (runs the loop).
  memoring watch [--idle-timeout <s>]    Resident diff-driven loop; idle discards the key.
  memoring context build [opts]          Generate .memoring/context.md through the Gate (main exit).
      --out <path>                       Default .memoring/context.md
      --aperture strict|standard|permissive   Default standard.
      --scope <label> | --project <id>   Active scope (else resolved from CWD; Silence if ambiguous).
      --realm <id>                       Select Active Realm.
  memoring search <query> [--scope <l>]  Exact / FTS / n-gram search (classified, non-secret, in-scope).
  memoring index rebuild                 Rebuild the search index from lower layers.
  memoring claim list|pin|correct|expire Reactive Claim governance.
  memoring label list|merge|rename       Label (vocabulary) governance.
  memoring forget <id>|--pattern <re>    Redact + Seal (irreversible; needs --yes when headless).
  memoring delete <id> | redact <id>     Delete (cascade) / redact a record (needs --yes when headless).
  memoring suppress list|remove <id>     Inspect / release SealRules (user-only).
  memoring reprocess                     Re-parse stored raw (event_identity stays stable).
  memoring export --purpose backup <dir> Full encrypted backup copy (incl. secret/unknown).
  memoring mcp                           Start the read-only MCP stdio server (optional, experimental).
  memoring doctor                        Inspect compatibility + file safety (warns only).

Environment:
  MEMORING_PASSPHRASE   Use instead of prompting (headless/tests).
  MEMORING_HOME         Replica root (default ~/.memoring).
  MEMORING_CLAUDE_DIR   Claude Code projects dir (default ~/.claude/projects).
`;

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'init':
      return cmdInit(rest);
    case 'connect':
      return cmdConnect(rest);
    case 'backfill':
      return cmdBackfill(rest);
    case 'context':
      return cmdContextBuild(rest); // `build` arrives as a positional and is ignored
    case 'search':
      return cmdSearch(rest);
    case 'index':
      return cmdIndex(rest);
    case 'forget':
      return cmdForget(rest);
    case 'delete':
      return cmdDelete(rest);
    case 'redact':
      return cmdRedact(rest);
    case 'suppress':
      return cmdSuppress(rest);
    case 'claim':
      return cmdClaim(rest);
    case 'label':
      return cmdLabel(rest);
    case 'reprocess':
      return cmdReprocess(rest);
    case 'watch':
      return cmdWatch(rest);
    case 'export':
      return cmdExport(rest);
    case 'mcp':
      return cmdMcp();
    case 'doctor':
      return cmdDoctor();
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      return command === undefined ? 1 : 0;
    case 'version':
    case '--version':
      console.log('memoring v0 (spec-v1.0)');
      return 0;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`Error: ${(err as Error).message}`);
    if (process.env.MEMORING_DEBUG) console.error((err as Error).stack);
    process.exit(1);
  });
