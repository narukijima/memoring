// Memoring CLI entry point. The primary surface of v0; the lead command is
// `context build`, not `search` (Specification §1).
import { cmdInit } from './commands/init';
import { cmdConnect } from './commands/connect';
import { cmdBackfill } from './commands/backfill';
import { cmdContextBuild } from './commands/context';
import { cmdDoctor } from './commands/doctor';
import { cmdSearch } from './commands/search';
import { cmdAsk } from './commands/ask';
import { cmdChat } from './commands/chat';
import { cmdIndex } from './commands/reindex';
import { cmdForget, cmdDelete, cmdRedact, cmdSuppress } from './commands/forget';
import { cmdClaim } from './commands/claim';
import { cmdLabel } from './commands/label';
import { cmdReprocess } from './commands/reprocess';
import { cmdWatch } from './commands/watch';
import { cmdExport } from './commands/export';
import { cmdRestore } from './commands/restore';
import { cmdMcp } from './commands/mcp';
import { cmdRekey } from './commands/rekey';
import { cmdRealm } from './commands/realm';
import { cmdImport } from './commands/import';
import { cmdConfig } from './commands/config';
import { cmdConfigure } from './commands/configure';
import { cmdModels } from './commands/models';
import { cmdStatus } from './commands/status';
import { cmdHealth } from './commands/health';
import { cmdAtlas } from './commands/atlas';
import { versionLine } from '@core/version';

const QUICK_HELP = `Memoring

Start:
  memoring                 open the chat (natural language; type /help inside)
  Memoring

Ask memory:
  memoring "what did we decide about X?"
  memoring ask "what did we decide about X?"

Update memory:
  memoring sync

Check setup:
  memoring status

Advanced:
  memoring help
`;

const HELP = `Memoring — Sovereign Memory Loop (v0)

Usage:
  memoring init [--passphrase]            Create the local replica (passwordless by default;
                                          --passphrase = strong vault + one-time recovery code).
  memoring rekey [--passphrase] [--recovery]
                                          Rotate the KEK: change the passphrase (or, with --recovery,
                                          reset a LOST passphrase using your one-time recovery code),
                                          or upgrade a passwordless vault to a passphrase one (the DEK,
                                          identities, and Seals are unchanged).
  memoring realm new <name> [--passphrase] Create and switch to a new local Realm.
  memoring realm list [--stats]           List local Realm registry entries.
  memoring realm use <name|id>            Set the sticky current Realm for management commands.
  memoring realm current                  Show the resolved current Realm.
  memoring realm rename <name|id> <name>  Rename a Realm in registry and realm.toml.
  memoring realm rm <name|id> --yes       Remove a Realm directory and registry entry.
  memoring config show                    Show non-secret Realm operator config.
  memoring config set local-model --base-url <url> --model <id>
                                          Persist a loopback local LLM default in realm.toml.
  memoring config unset local-model       Clear the persisted local LLM default.
  memoring config validate                Validate realm.toml / realms.toml metadata.
  memoring configure                      Guided local-first setup for Realm + local model.
  memoring models status                  Show effective loop/output model configuration.
  memoring connect <connector> [opts]    Detect sources, choose include/exclude + Realm assignment.
      connectors: claude-code
      --all | --source <id>              Selection (no whole-tool default).
      --default-sensitivity <s>          public|internal|confidential (project policy; default internal).
      --backfill                         Run the loop after connecting.
  memoring import [provider] [opts]      Import a pasted foreign-AI export (ChatGPT/Claude/Gemini)
                                          into the active Realm as NON-authoritative candidates.
      --file <path> | --text <s> | stdin  Source of the pasted export (default: stdin).
      --default-sensitivity <s>          public|internal|confidential (else candidates stay unknown).
      --dry-run                          Show the parsed entry Inventory; persist nothing.
      --realm <id>                       Target Realm.
      list                               List imported candidates awaiting review.
      promote <id> --scope <label> [--sensitivity <s>]   Confirm a candidate (USER authority) → recallable.
      reject <id>                        Drop a candidate from review.
      --print-prompt <provider>          Print the export prompt to run in claude|gemini|chatgpt.
  memoring backfill                      Ingest history from registered sources (runs the loop).
  memoring sync                          Friendly alias for backfill.
  memoring status                        Show the current memory, model, and scopes.
  memoring health                        Read-only advisory diagnostics for claims, scopes, and Gate candidates.
  memoring atlas build                   Generate .memoring/atlas/ read-only Markdown projection.
  memoring watch                         Resident diff-driven loop; holds the key/lock only per diff.
  memoring context build [opts]          Generate .memoring/context.md through the Gate (main exit).
      --out <path>                       Default .memoring/context.md
      --aperture strict|standard|permissive   Default standard.
      --scope <label> | --project <id>   Active scope (else resolved from CWD; Silence if ambiguous).
      --realm <id>                       Select Active Realm.
  memoring search <query> [--scope <l>]  Exact / FTS / n-gram search (classified, non-secret, in-scope).
  memoring ask <question> [--scope <l>] [--show-marker]
                                          Grounded natural-language answer over gated memory (output-layer
                                          LLM; downstream of the Gate, read-only). Local model by default;
                                          remote stays opt-in. Silence on no grounded match (ADR-0011).
      --save artifact                    Save the post-gate answer as a derived artifact
                                          (authority=derived, can_be_evidence=false).
  memoring chat [--scope <l>] [--show-marker]
                                          Interactive chat with ONE Realm. Natural-language prose is a
                                          GROUNDED memory question (same gated/grounded guarantees as ask).
                                          Slash commands are deterministic local operations (no model call)
                                          — EXCEPT /translate and /explain (phrase a shown memory via the
                                          output model) and /sync (runs the ingest loop; the only command
                                          that WRITES to memory): /status /recent /oldest /inventory /scopes
                                          /scope <name> /raw /translate /explain /sync /marker /clear /help
                                          /exit. Interactive on a TTY (type / for the live command menu);
                                          reads piped lines from stdin otherwise.
  memoring index rebuild                 Rebuild the search index from lower layers.
  memoring claim list|pin|correct|expire Reactive Claim governance.
  memoring label list|merge|rename       Label (vocabulary) governance.
  memoring forget <id>|--pattern <re>    Redact + Seal (irreversible; needs --yes when headless).
  memoring delete <id> | redact <id>     Delete (cascade) / redact a record (needs --yes when headless).
  memoring suppress list|remove <id>     Inspect / release SealRules (user-only).
  memoring reprocess                     Re-parse stored raw (event_identity stays stable).
  memoring export --purpose backup <dir> Full backup copy (incl. secret/unknown; sealed only with --passphrase).
  memoring restore <backup-dir>          Restore a backup archive into MEMORING_HOME (no re-egress; refuses to clobber).
  memoring mcp                           Start the read-only MCP stdio server (optional, experimental).
  memoring doctor                        Inspect compatibility + file safety (warns only).

Environment:
  MEMORING_PASSPHRASE   Use instead of prompting (headless/tests).
  MEMORING_RECOVERY_CODE  Recovery code for "rekey --recovery" instead of prompting (headless/tests).
  MEMORING_HOME         Replica root (default ~/.memoring).
  MEMORING_LANG         Chat surface language (ja|en). Default: follows the OS locale
                        (LC_ALL/LC_MESSAGES/LANG). Grounded answers always follow the
                        language of your question, regardless of this setting.
  MEMORING_CLAUDE_DIR   Claude Code projects dir (default ~/.claude/projects).
  MEMORING_LLM_BASE_URL OpenAI-compatible endpoint to use an LLM classifier (Mode B/C).
                        Unset = deterministic rule-based provider (Mode A, default).
                        e.g. https://api.deepseek.com/v1 · https://api.openai.com/v1
                             · http://127.0.0.1:11434/v1 (local Ollama → on-device)
  MEMORING_LLM_MODEL    Model id (e.g. deepseek-chat, gpt-4o-mini, qwen2.5:3b).
  MEMORING_LLM_API_KEY  API key for a remote endpoint (never persisted in config).
  MEMORING_LLM_EGRESS   Force local|remote (default: remote unless the URL is loopback).
  MEMORING_ASK_BASE_URL Per-role override for the output-layer LLM (ask / chat): let the
  MEMORING_ASK_MODEL    conversational renderer use a DIFFERENT model than the loop classifier.
  MEMORING_ASK_API_KEY  Each falls back to the matching MEMORING_LLM_* when unset. The remote
  MEMORING_ASK_EGRESS   opt-in stays MEMORING_LLM_REMOTE_OPT_IN (local default, remote opt-in).
  MEMORING_LLM_REMOTE_OPT_IN  Remote (off-device) AI is DEFAULT-OFF (§7.3). Set =1 to permit
                        sending raw history to a remote endpoint; otherwise Memoring falls back
                        to the on-device rule-based provider. A loopback (local) model needs no
                        opt-in. The per-event egress is still gated (sensitivity + Seal).
  MEMORING_LLM_PROXY    Opt in to an UNSUPPORTED subscription-bridging proxy (e.g. a local
                        Claude Code / Codex bridge) to avoid an API key. HIGH RISK: likely
                        violates the provider's ToS (account ban) and is fragile. Egress is
                        forced to remote (raw history still leaves the device). Prefer a real
                        local model (Ollama) instead — keyless, free, and actually on-device.
`;

function shouldTreatAsQuestion(command: string | undefined, rest: string[]): command is string {
  if (!command || command.startsWith('-')) return false;
  if (rest.length > 0) return true;
  return /[^\x00-\x7F]/.test(command) || /[?？\s]/.test(command);
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  // Leading-flag invocation (e.g. `memoring --scope X`, `memoring --show-marker`) is
  // the default chat surface WITH those flags — mirrors bare `memoring`. Only the
  // global help/version flags are handled by the switch below; everything else is a
  // chat flag, never an unknown command.
  if (command && command.startsWith('-') && !['--help', '-h', '--version'].includes(command)) {
    return cmdChat(process.argv.slice(2));
  }
  switch (command) {
    case 'init':
      return cmdInit(rest);
    case 'rekey':
      return cmdRekey(rest);
    case 'realm':
      return cmdRealm(rest);
    case 'config':
      return cmdConfig(rest);
    case 'configure':
      return cmdConfigure(rest);
    case 'models':
      return cmdModels(rest);
    case 'connect':
      return cmdConnect(rest);
    case 'import':
      return cmdImport(rest);
    case 'backfill':
      return cmdBackfill(rest);
    case 'sync':
      return cmdBackfill(rest, { friendly: true });
    case 'status':
      return cmdStatus(rest);
    case 'health':
      return cmdHealth(rest);
    case 'atlas':
      return cmdAtlas(rest);
    case 'context':
      return cmdContextBuild(rest); // `build` arrives as a positional and is ignored
    case 'search':
      return cmdSearch(rest);
    case 'ask':
      return cmdAsk(rest);
    case 'chat':
      return cmdChat(rest);
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
    case 'restore':
      return cmdRestore(rest);
    case 'mcp':
      return cmdMcp(rest);
    case 'doctor':
      return cmdDoctor(rest);
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    case undefined:
      if (process.stdin.isTTY) return cmdChat([]);
      console.log(QUICK_HELP);
      return 0;
    case 'version':
    case '--version':
      console.log(versionLine());
      return 0;
    default:
      if (shouldTreatAsQuestion(command, rest)) return cmdAsk([command, ...rest]);
      console.error(`Unknown command: ${command}\n`);
      console.log(QUICK_HELP);
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
