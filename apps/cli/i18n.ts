// Locale for the interactive chat surface. Since the output model already answers in
// the user's language, the only hardcoded text is the CLI "chrome" (banner, /help,
// command output, feedback). Rather than pin it to one language, the whole surface
// follows the user's locale: MEMORING_LANG overrides; otherwise the standard
// LC_ALL / LC_MESSAGES / LANG environment is read. Everything is deterministic and
// model-free, so it stays instant and predictable.
export type Lang = 'ja' | 'en';

/** Resolve the surface language from the environment. Explicit MEMORING_LANG wins;
 *  otherwise the POSIX locale chain is consulted. Anything Japanese → 'ja', else 'en'. */
export function resolveLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const explicit = env.MEMORING_LANG?.trim().toLowerCase();
  if (explicit) return explicit.startsWith('ja') ? 'ja' : 'en';
  const locale = (env.LC_ALL || env.LC_MESSAGES || env.LANG || '').trim().toLowerCase();
  return locale.startsWith('ja') ? 'ja' : 'en';
}

export type MemoryOrder = 'recent' | 'oldest';

/** Every operator-facing string of the chat surface, in one place per language so a
 *  translator can see the whole surface at once and the two branches cannot drift. */
export interface ChatStrings {
  // banner / header
  tagline: string;
  realmLabel: string;
  scopeLabel: string;
  modelLabel: string;
  bannerHint: string;
  headerLine: string;
  // help
  commandsHeading: string;
  proseFooter: string;
  commandSummaries: Record<string, string>;
  // feedback
  cleared: string;
  markerOn: string;
  markerOff: string;
  scopeUsage: string;
  unknownCommand: (name: string) => string;
  syncing: string;
  emptyHint: string;
  turnError: (detail: string) => string;
  // memory list
  listTitle: (order: MemoryOrder, scope: string) => string;
  noVisibleMemories: string;
  scopeLine: (scope: string) => string;
  // scopes
  currentScopeLine: (scope: string) => string;
  availableScopesHeading: string;
  scopeSwitched: (name: string) => string;
  scopeNotResolved: (query: string) => string;
  andMore: (n: number) => string;
  // inventory
  inventoryVisible: (scope: string, n: number) => string;
  inventoryTotal: (n: number) => string;
  inventoryScopeNote: string;
  scopesLine: (list: string) => string;
  inventorySwitchHint: string;
  // last-memory detail
  noLastMemory: string;
  rawLabel: string;
  detailNeedsModel: string;
  detailRemoteWithheld: string[];
  targetLanguageName: string; // used inside the (English) model instruction
  // no grounded answer (interactive)
  noGroundedMiss: string;
  // no scope bound (the REPL opens without a resolved scope)
  noScopeNotice: string;
  scopeRequired: string;
  // in-chat /status (the standalone `memoring status` command stays English)
  statusMemory: (name: string, id: string) => string;
  statusStored: (claims: number, sources: number, scopes: number) => string;
  statusConnected: (summary: string) => string;
  statusModel: (model: string) => string;
  statusScopes: (list: string) => string;
  statusModelNotConfigured: string;
  statusConnectorsNone: string;
}

const JA: ChatStrings = {
  tagline: 'Memoring · ローカル記憶、根拠つきの回答',
  realmLabel: 'レルム',
  scopeLabel: 'スコープ',
  modelLabel: 'モデル',
  bannerHint: '自然言語で記憶に質問できます。コマンドは /help、終了は /exit。',
  headerLine: 'memoring — 根拠つき記憶チャット。自然言語で質問、/help でコマンド、/exit で終了。',
  commandsHeading: 'コマンド:',
  proseFooter: 'それ以外は、記憶への自然言語の質問として扱います。',
  commandSummaries: {
    status: '記憶・モデル・スコープの状態',
    recent: '現在のスコープの新しい記憶',
    oldest: '現在のスコープの古い記憶',
    inventory: 'ここで見える件数とRealm全体の件数',
    scopes: '利用可能なスコープ一覧',
    scope: 'アクティブなスコープを切り替える',
    raw: '直前に表示した記憶の原文',
    translate: '直前の記憶を翻訳（モデル使用）',
    explain: '直前の記憶を説明（モデル使用）',
    sync: '接続済みソースを取り込み直す',
    marker: '自己生成マーカーの表示/非表示',
    clear: 'この会話をクリア',
    help: 'このコマンド一覧',
    exit: '終了する',
  },
  cleared: '会話をクリアしました。',
  markerOn: 'マーカー: 表示',
  markerOff: 'マーカー: 非表示',
  scopeUsage: '使い方: /scope <名前>',
  unknownCommand: (name) => `不明なコマンド: /${name}。一覧は /help。`,
  syncing: '接続ソースを同期中…（これは記憶に書き込みます）',
  emptyHint: '(/help でコマンド一覧、またはそのまま質問を入力)',
  turnError: (detail) => `エラーが発生しました: ${detail}（このターンのみ。会話は続けられます）`,
  listTitle: (order, scope) => `${order === 'oldest' ? '一番古い記憶' : '最近の記憶'}（${scope}）:`,
  noVisibleMemories: 'このスコープで表示できる記憶はまだありません。',
  scopeLine: (scope) => `スコープ: ${scope}`,
  currentScopeLine: (scope) => `現在のスコープ: ${scope}`,
  availableScopesHeading: '利用可能なスコープ:',
  scopeSwitched: (name) => `スコープを切り替えました: ${name}`,
  scopeNotResolved: (query) => `スコープを特定できませんでした: ${query}`,
  andMore: (n) => `... 他${n}件`,
  inventoryVisible: (scope, n) => `今のスコープ（${scope}）で表示できる記憶: ${n}件`,
  inventoryTotal: (n) => `Realm全体の記憶: ${n}件`,
  inventoryScopeNote: '今の会話はスコープ固定なので、別スコープの本文はここでは混ぜて出していません。',
  scopesLine: (list) => `スコープ: ${list}`,
  inventorySwitchHint: '別スコープは /scope <名前> で切り替えられます。',
  noLastMemory: '直前に参照できる記憶がありません。まず /recent などで記憶を表示してください。',
  rawLabel: '記憶の原文:',
  detailNeedsModel: '翻訳/説明にはモデルが必要です。原文だけ表示します。',
  detailRemoteWithheld: [
    'この記憶の翻訳/説明には本文をモデルへ渡す必要があります。',
    '現在の出力モデルはremoteなので、本文は送らず原文だけ表示します。',
  ],
  targetLanguageName: 'Japanese',
  noGroundedMiss: 'その記憶は見つかりませんでした。記憶にあることだけ答えます。',
  noScopeNotice: 'スコープが未選択です。/scopes で一覧、/scope <名前> で選択できます。会話で「〇〇の記憶」と言えばアシスタントが切り替えます。',
  scopeRequired: '先にスコープを選んでください（/scopes 一覧、/scope <名前>）。',
  statusMemory: (name, id) => `記憶: ${name} (${id})`,
  statusStored: (claims, sources, scopes) => `保存済み: 記憶${claims}件、接続ソース${sources}件、スコープ${scopes}件`,
  statusConnected: (summary) => `接続: ${summary}`,
  statusModel: (model) => `モデル: ${model}`,
  statusScopes: (list) => `スコープ: ${list}`,
  statusModelNotConfigured: '未設定',
  statusConnectorsNone: 'なし',
};

const EN: ChatStrings = {
  tagline: 'Memoring · local memory, grounded answers',
  realmLabel: 'realm',
  scopeLabel: 'scope',
  modelLabel: 'model',
  bannerHint: 'Ask in natural language. Type /help for commands, /exit to quit.',
  headerLine: 'memoring — grounded memory chat. Ask in natural language; /help for commands; /exit to quit.',
  commandsHeading: 'Commands:',
  proseFooter: 'Anything else is a natural-language question over your memory.',
  commandSummaries: {
    status: 'memory, model, and scopes',
    recent: 'latest memories in the active scope',
    oldest: 'earliest memories in the active scope',
    inventory: 'how much is visible here vs stored in the realm',
    scopes: 'list available scopes',
    scope: 'switch the active scope',
    raw: 'show the last listed memory verbatim',
    translate: 'translate the last listed memory (uses the model)',
    explain: 'explain the last listed memory (uses the model)',
    sync: 'refresh connected memory sources',
    marker: 'show or hide the self-generation marker',
    clear: 'clear this conversation',
    help: 'show this list',
    exit: 'end the session',
  },
  cleared: 'Conversation cleared.',
  markerOn: 'marker on',
  markerOff: 'marker off',
  scopeUsage: 'Usage: /scope <name>',
  unknownCommand: (name) => `Unknown command: /${name}. Type /help for the list.`,
  syncing: 'Syncing connected sources… (this writes to memory)',
  emptyHint: '(type /help for commands, or just ask a question)',
  turnError: (detail) => `Something went wrong: ${detail} (this turn only — you can keep going).`,
  listTitle: (order, scope) => `${order === 'oldest' ? 'Oldest memories' : 'Recent memories'} (${scope}):`,
  noVisibleMemories: 'No memories are visible in this scope yet.',
  scopeLine: (scope) => `Scope: ${scope}`,
  currentScopeLine: (scope) => `Current scope: ${scope}`,
  availableScopesHeading: 'Available scopes:',
  scopeSwitched: (name) => `Switched scope: ${name}`,
  scopeNotResolved: (query) => `Could not resolve a scope: ${query}`,
  andMore: (n) => `... +${n} more`,
  inventoryVisible: (scope, n) => `Visible in this scope (${scope}): ${n}`,
  inventoryTotal: (n) => `Stored in the realm: ${n}`,
  inventoryScopeNote: 'This session is scope-locked, so memories from other scopes are not mixed in here.',
  scopesLine: (list) => `Scopes: ${list}`,
  inventorySwitchHint: 'Switch scopes with /scope <name>.',
  noLastMemory: 'No memory to act on yet. Show some with /recent first.',
  rawLabel: 'Memory (verbatim):',
  detailNeedsModel: 'Translation/explanation needs a model; showing the verbatim text only.',
  detailRemoteWithheld: [
    'Translating/explaining this memory would send its text to the model.',
    'The current output model is remote, so the text is withheld; showing the verbatim text only.',
  ],
  targetLanguageName: 'English',
  noGroundedMiss: 'I could not find that in memory. I only answer from stored memory.',
  noScopeNotice: 'No scope is selected. Use /scopes to list and /scope <name> to pick one — or just ask (e.g. "show my <name> memories") and the assistant will switch.',
  scopeRequired: 'Pick a scope first (/scopes to list, /scope <name>).',
  statusMemory: (name, id) => `Memory: ${name} (${id})`,
  statusStored: (claims, sources, scopes) => `Stored: ${claims} memories, ${sources} connected source(s), ${scopes} scope(s)`,
  statusConnected: (summary) => `Connected: ${summary}`,
  statusModel: (model) => `Model: ${model}`,
  statusScopes: (list) => `Scopes: ${list}`,
  statusModelNotConfigured: 'not configured',
  statusConnectorsNone: 'none',
};

export function chatStrings(lang: Lang): ChatStrings {
  return lang === 'ja' ? JA : EN;
}
