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
  memoring init [--passphrase]            Create the local replica (passwordless by default;
                                          --passphrase = strong vault + one-time recovery code).
  memoring connect <connector> [opts]    Detect sources, choose include/exclude + Realm assignment.
      connectors: claude-code
      --all | --source <id>              Selection (no whole-tool default).
      --default-sensitivity <s>          public|internal|confidential (project policy; default internal).
      --backfill                         Run the loop after connecting.
  memoring backfill                      Ingest history from registered sources (runs the loop).
  memoring watch                         Resident diff-driven loop; holds the key/lock only per diff.
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
  memoring export --purpose backup <dir> Full backup copy (incl. secret/unknown; sealed only with --passphrase).
  memoring mcp                           Start the read-only MCP stdio server (optional, experimental).
  memoring doctor                        Inspect compatibility + file safety (warns only).

Environment:
  MEMORING_PASSPHRASE   Use instead of prompting (headless/tests).
  MEMORING_HOME         Replica root (default ~/.memoring).
  MEMORING_CLAUDE_DIR   Claude Code projects dir (default ~/.claude/projects).
  MEMORING_LLM_BASE_URL OpenAI-compatible endpoint to use an LLM classifier (Mode B/C).
                        Unset = deterministic rule-based provider (Mode A, default).
                        e.g. https://api.deepseek.com/v1 · https://api.openai.com/v1
                             · http://127.0.0.1:11434/v1 (local Ollama → on-device)
  MEMORING_LLM_MODEL    Model id (e.g. deepseek-chat, gpt-4o-mini, qwen2.5:3b).
  MEMORING_LLM_API_KEY  API key for a remote endpoint (never persisted in config).
  MEMORING_LLM_EGRESS   Force local|remote (default: remote unless the URL is loopback).
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
