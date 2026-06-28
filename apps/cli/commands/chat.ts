// `memoring chat` — the natural-language control surface (LLM-as-operator). A
// conversation with ONE Realm where:
//   - plain prose is handled by the AGENT LOOP (apps/cli/agent.ts): the LLM drives
//     Memoring by calling gated tools (browse/search/read/list_scopes/switch_scope/
//     status) and answers from their results. Every memory-reading tool is strictly
//     downstream of the Gate — secret / confidential / unknown / out-of-scope /
//     unclassified / sealed memory never appears, and an empty scope reads nothing
//     (fail-closed). The agent is read-only here; writing (/sync) is human-initiated.
//   - the answer is instructed to use ONLY tool results (no general-knowledge backfill)
//     and to answer in the user's language. NOTE: unlike the legacy one-shot `ask`
//     path, grounding is not HARD-enforced by a 0-results→no-call gate — it relies on
//     the agent prompt + the gated tools (an open product trade-off of the agentic
//     surface). The signed `memoring:ouroboros` self-generation marker is attached to
//     every generated answer and shown with `--show-marker` / `/marker on` (hidden by
//     default for human readability — a pre-existing CLI choice, not new here).
//   - structured operations are explicit, deterministic slash commands (`/status`,
//     `/recent`, `/scope`, …) that run locally with NO model call and never egress.
//   - turns create no Events / Claims / candidates (§5d); only /sync writes.
// The Realm + scope bind the session; cross-Realm recall is impossible by construction
// (§3). The REPL opens even when no scope resolves — the LLM can switch_scope, and all
// retrieval stays fail-closed until a scope is bound.
import readline from 'node:readline';
import { isActiveRealmSilence, openResolvedRealm, type RealmContext } from '@core/runtime';
import { runLoop } from '@core/loop';
import { resolveActiveProjects } from '@core/realm';
import { activeScopeContainsAll, gate, type GateRequest } from '@core/policy';
import { toGateItem, toScopedClaim } from '@retrieval/context-pack';
import { resolveActiveLabelIds } from '@retrieval/active-scope';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';
import { printActiveRealmSilence } from './resolve';
import { resolveProvider } from '../provider';
import { resolveOutputProvider, type OutputProvider } from '../output-provider';
import { renderRendererMarker } from '../output-render';
import { searchAudienceFor } from '../egress';
import { chatStrings, resolveLang, type ChatStrings, type Lang } from '../i18n';
import { runAgentTurn, type AgentToolContext } from '../agent';
import { promptWithMenu } from '../slash-menu';
import { printLoopStats } from './connect';
import { memoryStatusLines } from './status';

// Identifies the multi-turn renderer in the Ouroboros marker (distinct from 'ask.v1').
const CHAT_RENDERER_RECIPE = 'chat.v1';

/** One completed, grounded exchange — kept ONLY to give the model conversational
 *  continuity. `answer` is the clean synthesized prose (NOT the marker block): every
 *  fact in it was itself grounded in that turn's gated excerpts, so re-showing it
 *  introduces nothing the Gate did not already release. */
export interface ChatTurn {
  question: string;
  answer: string;
}

export type MemoryListOrder = 'recent' | 'oldest';
export type LastMemoryDetailMode = 'raw' | 'translate' | 'explain';

// ── Slash-command surface ───────────────────────────────────────────────────
// Plain prose is a grounded memory question (handled by the agent loop, runAgentTurn);
// every structured operation is one of these explicit slash commands, dispatched
// deterministically with NO model call. parseChatInput + CHAT_COMMANDS are the
// single source of truth, kept pure/exported so routing stays unit-testable.

export type ChatInput =
  | { kind: 'empty' }
  | { kind: 'exit' }
  | { kind: 'command'; name: string; arg: string }
  | { kind: 'prose'; text: string };

/** Classify one REPL line. A leading '/' (or the legacy ':exit'/':quit') is a
 *  command; everything else is a natural-language memory question. */
export function parseChatInput(raw: string): ChatInput {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  if (text === ':exit' || text === ':quit') return { kind: 'exit' };
  if (text.startsWith('/')) {
    const body = text.slice(1).trim();
    const sp = body.search(/\s/);
    const name = (sp < 0 ? body : body.slice(0, sp)).toLowerCase();
    const arg = sp < 0 ? '' : body.slice(sp + 1).trim();
    return { kind: 'command', name, arg };
  }
  return { kind: 'prose', text };
}

export interface ChatCommandSpec {
  name: string;
  arg?: string;
}

/** The slash surface, in display order. Used by /help AND the dispatcher, so the
 *  two can never drift. Operations are local-only except /translate and /explain,
 *  which phrase the already-displayed memory and so need the output model. The
 *  human-readable summary for each comes from the i18n catalog (keyed by name). */
export const CHAT_COMMANDS: ChatCommandSpec[] = [
  { name: 'status' },
  { name: 'recent' },
  { name: 'oldest' },
  { name: 'inventory' },
  { name: 'scopes' },
  { name: 'scope', arg: '<name>' },
  { name: 'raw' },
  { name: 'translate' },
  { name: 'explain' },
  { name: 'sync' },
  { name: 'marker', arg: '[on|off]' },
  { name: 'clear' },
  { name: 'help' },
  { name: 'exit' },
];

/** Render the /help block in the surface language, command column padded to align. */
export function helpLines(lang: Lang = resolveLang()): string[] {
  const s = chatStrings(lang);
  const labels = CHAT_COMMANDS.map((c) => `/${c.name}${c.arg ? ` ${c.arg}` : ''}`);
  const width = Math.max(...labels.map((l) => l.length));
  const rows = CHAT_COMMANDS.map((c, i) => `${labels[i]!.padEnd(width)}   ${s.commandSummaries[c.name] ?? ''}`);
  return [s.commandsHeading, ...rows, '', s.proseFooter];
}

function printIndentedLines(reply: string | string[]): void {
  const lines = Array.isArray(reply) ? reply : reply.split(/\r?\n/);
  for (const line of lines) console.log(`  ${line}`);
}

export interface DisplayedMemoryRow {
  createdAt: string;
  kind: string;
  statement: string;
}

export interface MemoryListOutput {
  lines: string[];
  rows: DisplayedMemoryRow[];
}

function shorten(value: string, max = 150): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

export function memoryList(
  ctx: RealmContext,
  activeLabelIds: string[],
  opts: { order?: MemoryListOrder; limit?: number; lang?: Lang } = {},
): MemoryListOutput {
  const order = opts.order ?? 'recent';
  const limit = opts.limit ?? 5;
  const s = chatStrings(opts.lang ?? resolveLang());
  const req: GateRequest = {
    audience: 'human_local_view',
    aperture: 'standard',
    activeLabelIds,
    crossScopeAllowed: false,
  };
  const rows: DisplayedMemoryRow[] = [];
  for (const claim of ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated')) {
    const scoped = toScopedClaim(ctx, claim);
    if (!activeScopeContainsAll(scoped.labelIds, activeLabelIds)) continue;
    if (!gate(toGateItem(ctx, scoped), req).pass) continue;
    rows.push({
      createdAt: claim.created_at,
      kind: claim.kind,
      statement: scoped.statement,
    });
  }

  rows.sort((a, b) => (order === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)));
  if (rows.length === 0) {
    return {
      lines: [s.noVisibleMemories, s.scopeLine(activeScopeNameList(ctx, activeLabelIds))],
      rows: [],
    };
  }

  const shown = rows.slice(0, limit);
  return {
    lines: [
      s.listTitle(order, activeScopeNameList(ctx, activeLabelIds)),
      ...shown.map((row) => `- ${row.createdAt.slice(0, 10)} [${row.kind}] ${shorten(row.statement)}`),
    ],
    rows: shown,
  };
}

export function recentMemoryLines(ctx: RealmContext, activeLabelIds: string[], limit = 5, lang?: Lang): string[] {
  return memoryList(ctx, activeLabelIds, { order: 'recent', limit, lang }).lines;
}

function activeScopeNameList(ctx: RealmContext, activeLabelIds: string[]): string {
  const names = activeLabelIds
    .map((id) => ctx.store.getLabel(id)?.canonical_name)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(', ') : '(none)';
}

function availableScopeList(ctx: RealmContext, s: ChatStrings): string {
  const labels = ctx.store
    .listLabels(ctx.realmId)
    .filter((l) => l.state === 'active')
    .map((l) => l.canonical_name)
    .sort((a, b) => a.localeCompare(b));
  const shown = labels.slice(0, 12);
  const more = labels.length > shown.length ? `, ${s.andMore(labels.length - shown.length).replace(/^\.\.\.\s*/, '')}` : '';
  return `${shown.join(', ')}${more}`;
}

function activeScopeLabels(ctx: RealmContext): { id: string; name: string }[] {
  return ctx.store
    .listLabels(ctx.realmId)
    .filter((l) => l.state === 'active')
    .map((l) => ({ id: l.label_id, name: l.canonical_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeScopeText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

export function scopeListLines(ctx: RealmContext, activeLabelIds: string[], lang: Lang = resolveLang()): string[] {
  const s = chatStrings(lang);
  const current = activeScopeNameList(ctx, activeLabelIds);
  const labels = activeScopeLabels(ctx);
  return [s.currentScopeLine(current), s.availableScopesHeading, ...labels.map((l) => `- ${l.name}`)];
}

export function switchScopeLines(
  ctx: RealmContext,
  requestedScope: string,
  lang: Lang = resolveLang(),
): { activeLabelIds?: string[]; lines: string[] } {
  const s = chatStrings(lang);
  const requested = normalizeScopeText(requestedScope);
  const labels = activeScopeLabels(ctx);
  const exact = labels.find((l) => normalizeScopeText(l.name) === requested);
  const partial = exact
    ? exact
    : labels.filter((l) => {
        const normalized = normalizeScopeText(l.name);
        return normalized.includes(requested) || requested.includes(normalized);
      });
  const match = Array.isArray(partial) ? (partial.length === 1 ? partial[0] : undefined) : partial;
  if (!match) {
    return {
      lines: [
        s.scopeNotResolved(requestedScope),
        s.availableScopesHeading,
        ...labels.slice(0, 12).map((l) => `- ${l.name}`),
        ...(labels.length > 12 ? [s.andMore(labels.length - 12)] : []),
      ],
    };
  }
  return {
    activeLabelIds: [match.id],
    lines: [s.scopeSwitched(match.name)],
  };
}

export function memoryInventoryLines(ctx: RealmContext, activeLabelIds: string[], lang: Lang = resolveLang()): string[] {
  const s = chatStrings(lang);
  const currentRows = memoryList(ctx, activeLabelIds, { limit: Number.MAX_SAFE_INTEGER, lang }).rows;
  const total = ctx.store.listClaimsByStatus(ctx.realmId, 'consolidated').length;
  const scope = activeScopeNameList(ctx, activeLabelIds);
  const lines = [s.inventoryVisible(scope, currentRows.length), s.inventoryTotal(total)];
  if (currentRows.length < total) {
    lines.push(s.inventoryScopeNote);
    lines.push(s.scopesLine(availableScopeList(ctx, s)));
    lines.push(s.inventorySwitchHint);
  }
  return lines;
}

export function buildLastMemoryDetailPrompt(
  row: DisplayedMemoryRow,
  input: string,
  mode: LastMemoryDetailMode,
  lang: Lang = resolveLang(),
): string {
  const target = chatStrings(lang).targetLanguageName;
  const task =
    mode === 'translate'
      ? `Translate the stored memory into natural ${target}. Do not add facts.`
      : `Explain what the stored memory says in natural ${target}. Do not add facts.`;
  return [
    'You are Memoring. Answer only from the already-displayed stored memory below.',
    'Do not use outside knowledge. Do not infer beyond the text.',
    task,
    '',
    `Stored memory kind: ${row.kind}`,
    `Stored memory date: ${row.createdAt}`,
    `Stored memory text: ${row.statement}`,
    '',
    `User follow-up: ${input}`,
    'Answer:',
  ].join('\n');
}

export async function lastMemoryDetailLines(
  provider: OutputProvider | null,
  row: DisplayedMemoryRow | undefined,
  mode: LastMemoryDetailMode,
  input: string,
  lang: Lang = resolveLang(),
): Promise<string[]> {
  const s = chatStrings(lang);
  if (!row) return [s.noLastMemory];
  if (mode === 'raw') return [s.rawLabel, row.statement];
  if (!provider) return [s.detailNeedsModel, row.statement];
  if (provider.egress === 'remote') {
    return [...s.detailRemoteWithheld, row.statement];
  }
  const raw = await provider.generate(buildLastMemoryDetailPrompt(row, input, mode, lang));
  return raw.trim().split(/\r?\n/);
}

/** The REPL prompt carries the active scope so a mid-session reader always knows which
 *  scope every answer and /recent listing is bound to. Refreshed on each /scope switch. */
function chatPrompt(scope: string): string {
  return scope && scope !== '(none)' ? `memoring (${scope}) › ` : 'memoring › ';
}

/** The interactive intro: a compact Claude-Code-style header in the surface language.
 *  Printed to stderr so it never contaminates the grounded-answer stream on stdout. */
export function bannerLines(realmName: string, scope: string, model: string, lang: Lang = resolveLang()): string[] {
  const s = chatStrings(lang);
  const label = (key: string) => key.padEnd(Math.max(s.realmLabel.length, s.scopeLabel.length, s.modelLabel.length));
  return [
    '',
    `  ${s.tagline}`,
    '',
    `  ${label(s.realmLabel)}   ${realmName}`,
    `  ${label(s.scopeLabel)}   ${scope}`,
    `  ${label(s.modelLabel)}   ${model}`,
    '',
    `  ${s.bannerHint}`,
    '',
  ];
}

function modelLabel(llm: { model: string; egress?: 'local' | 'remote' } | undefined): string {
  return llm ? `${llm.model} (${llm.egress ?? 'auto'})` : 'not configured';
}

export async function cmdChat(argv: string[], input: NodeJS.ReadableStream = process.stdin): Promise<number> {
  const flags = parseFlags(argv);
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  let persist = false;
  try {
    // The REPL OPENS even when no scope resolves: the user can pick one with /scope,
    // or just ask and the assistant calls switch_scope. Retrieval stays fail-closed
    // until a scope is bound — browse/search return nothing for an empty scope, so no
    // Realm-wide read ever happens (§3/G4). `activeLabelIds` is null = "no scope bound".
    const res = resolveActiveProjects(ctx.config, {
      cwd: process.cwd(),
      scope: flags.scope as string | undefined,
      project: flags.project as string | undefined,
    });
    let activeLabelIds: string[] | null = null;
    if (res.kind === 'resolved') {
      const ids = resolveActiveLabelIds(ctx, res.projectIds, flags.scope as string | undefined);
      if (ids.length > 0) activeLabelIds = ids;
    }
    const scopeName = (): string => activeScopeNameList(ctx, activeLabelIds ?? []);
    let showMarker = flags['show-marker'] === true;
    const interactive = Boolean((input as NodeJS.ReadStream).isTTY);
    // The whole surface follows the user's language (MEMORING_LANG / OS locale),
    // resolved ONCE for the session. The grounded answers themselves already follow
    // the user's question language via the model.
    const lang = resolveLang();
    const s = chatStrings(lang);

    // The output model is resolved LAZILY. The REPL is fully usable for local
    // operations (/status, /recent, /scopes, /raw, /sync) with NO model at all; only
    // a prose memory question or /translate · /explain needs generation. When none is
    // usable (unset, or remote without opt-in), resolveOutputProvider prints the
    // calibrated guidance once and the turn is skipped — the session keeps going. The
    // remote-default-off egress gate is unchanged; it just fires at generation time
    // instead of locking the owner out of the whole REPL.
    let providerResolved = false;
    let providerCache: OutputProvider | null = null;
    const outputProvider = (): OutputProvider | null => {
      if (!providerResolved) {
        providerCache = resolveOutputProvider(ctx.config.llm);
        providerResolved = true;
      }
      return providerCache;
    };

    if (interactive) {
      for (const line of bannerLines(ctx.config.name, scopeName(), modelLabel(ctx.config.llm), lang)) {
        console.error(line);
      }
    } else {
      console.error(`  ${s.headerLine}`);
    }
    if (!activeLabelIds) console.error(`  ${s.noScopeNotice}`);

    const history: ChatTurn[] = [];
    let lastDisplayed: DisplayedMemoryRow[] = [];
    let emptyHinted = false;
    // One REPL line → dispatch. Returns 'stop' to end the session. Prompting is owned
    // by the input loop (the live menu for a TTY, readline for pipes/tests).
    const handleLine = async (raw: string): Promise<'stop' | void> => {
      const parsed = parseChatInput(raw);
      if (parsed.kind === 'empty') {
        if (interactive && !emptyHinted) {
          printIndentedLines([s.emptyHint]);
          emptyHinted = true;
        }
        return;
      }
      if (parsed.kind === 'exit') return 'stop';

      if (parsed.kind === 'command') {
        switch (parsed.name) {
          case '':
          case 'help':
          case '?':
            printIndentedLines(helpLines(lang));
            return;
          case 'status':
            printIndentedLines(memoryStatusLines(ctx, lang));
            return;
          case 'recent':
          case 'oldest': {
            if (!activeLabelIds) return void printIndentedLines([s.scopeRequired]);
            const listed = memoryList(ctx, activeLabelIds, { order: parsed.name === 'oldest' ? 'oldest' : 'recent', lang });
            lastDisplayed = listed.rows;
            printIndentedLines(listed.lines);
            return;
          }
          case 'inventory':
            if (!activeLabelIds) return void printIndentedLines([s.scopeRequired]);
            printIndentedLines(memoryInventoryLines(ctx, activeLabelIds, lang));
            return;
          case 'scopes':
            printIndentedLines(scopeListLines(ctx, activeLabelIds ?? [], lang));
            return;
          case 'scope': {
            if (!parsed.arg) {
              printIndentedLines([...scopeListLines(ctx, activeLabelIds ?? [], lang), s.scopeUsage]);
              return;
            }
            const switched = switchScopeLines(ctx, parsed.arg, lang);
            if (switched.activeLabelIds) {
              activeLabelIds = switched.activeLabelIds;
              lastDisplayed = [];
            }
            printIndentedLines(switched.lines);
            return;
          }
          case 'raw':
            printIndentedLines(await lastMemoryDetailLines(null, lastDisplayed[0], 'raw', parsed.arg, lang));
            return;
          case 'translate':
          case 'explain': {
            const provider = outputProvider();
            if (!provider) return; // resolveOutputProvider already printed guidance
            const mode = parsed.name === 'translate' ? 'translate' : 'explain';
            printIndentedLines(await lastMemoryDetailLines(provider, lastDisplayed[0], mode, parsed.arg, lang));
            return;
          }
          case 'sync': {
            // Immediate feedback so a multi-second backfill never looks hung, and an
            // explicit note that this is the one command that writes to memory.
            printIndentedLines([s.syncing]);
            // runLoop flushes its own writes on success (loop.ts). Set persist AFTER it
            // so that if runLoop throws before that flush, persist stays false and
            // ctx.close(false) discards the uncommitted in-memory mutations (§5d).
            const stats = await runLoop(ctx, { method: 'backfill', provider: resolveProvider(ctx.config.llm) });
            persist = true;
            printLoopStats(stats, { friendly: true });
            return;
          }
          case 'marker': {
            const a = parsed.arg.toLowerCase();
            showMarker = a === 'on' ? true : a === 'off' ? false : !showMarker;
            printIndentedLines([showMarker ? s.markerOn : s.markerOff]);
            return;
          }
          case 'clear':
            history.length = 0;
            lastDisplayed = [];
            printIndentedLines([s.cleared]);
            return;
          case 'exit':
          case 'quit':
          case 'q':
            return 'stop';
          default:
            printIndentedLines([s.unknownCommand(parsed.name)]);
            return;
        }
      }

      // Natural-language prose → the LLM OPERATES Memoring via tools (agent loop):
      // it browses/searches/reads the scope's gated memory itself and answers. This is
      // the user-model path (user → CLI → LLM → Memoring → LLM → CLI → user); the tools
      // enforce the Gate, so the LLM can never reach raw/secret/out-of-scope.
      const provider = outputProvider();
      if (!provider) return;
      const audience = searchAudienceFor(provider.egress);
      // The session exposes Memoring to the LLM: live scope (so a switch_scope mid-turn
      // takes effect) and switch_scope. The CLI owns the side effects; the LLM only
      // orchestrates. NO write tool — ingest stays the human-initiated /sync (review #3).
      const session: AgentToolContext = {
        ctx,
        audience,
        get activeLabelIds() {
          return activeLabelIds ?? [];
        },
        switchScope: (name: string): string => {
          const switched = switchScopeLines(ctx, name, lang);
          if (switched.activeLabelIds) {
            activeLabelIds = switched.activeLabelIds;
            lastDisplayed = [];
          }
          return switched.lines.join(' ');
        },
      };
      const result = await runAgentTurn(provider, session, history, parsed.text, {
        onTool: interactive ? (name) => console.error(`  · ${name}`) : undefined,
        fallbackAnswer: s.noGroundedMiss,
      });
      const marked = `${result.answer}\n\n${renderRendererMarker(ctx, CHAT_RENDERER_RECIPE, new Date())}`;
      console.log(showMarker ? marked : result.answer);
      history.push({ question: parsed.text, answer: result.answer });
    };

    // Per-turn error boundary: a transient model/network error (Ollama 500, timeout,
    // restart) or a failed /sync must not tear down the session — without this the
    // rejection unwinds through the realm-closing finally and exits the whole REPL.
    // Catch at the turn level, report, and keep prompting. The agent/answer paths are
    // read-only and /sync only sets persist=true AFTER it resolves, so a caught failure
    // commits nothing partial.
    const runTurn = async (raw: string): Promise<'stop' | void> => {
      try {
        return await handleLine(raw);
      } catch (err) {
        printIndentedLines([s.turnError((err as Error).message)]);
        if (process.env.MEMORING_DEBUG) console.error((err as Error).stack);
      }
    };

    if (interactive) {
      // Live slash-menu input (Claude Code / Codex style): a raw-mode reader so typing
      // `/` pops a filtered command palette. Ctrl-C / Ctrl-D resolve null → clean exit
      // that runs the outer finally and releases the realm lock.
      const stdin = input as NodeJS.ReadStream;
      readline.emitKeypressEvents(stdin);
      if (stdin.isTTY) stdin.setRawMode(true);
      const inputHistory: string[] = [];
      try {
        for (;;) {
          const raw = await promptWithMenu({
            input: stdin,
            output: process.stdout,
            prompt: chatPrompt(scopeName()),
            commands: CHAT_COMMANDS,
            summary: (n) => s.commandSummaries[n] ?? '',
            history: inputHistory,
          });
          if (raw === null) break;
          const trimmed = raw.trim();
          if (trimmed && trimmed !== inputHistory[inputHistory.length - 1]) inputHistory.push(trimmed);
          if ((await runTurn(raw)) === 'stop') break;
        }
      } finally {
        if (stdin.isTTY) stdin.setRawMode(false);
      }
    } else {
      const rl = readline.createInterface({ input, terminal: false });
      try {
        for await (const raw of rl) {
          if ((await runTurn(raw)) === 'stop') break;
        }
      } finally {
        rl.close();
      }
    }
    return 0;
  } finally {
    ctx.close(persist);
  }
}
