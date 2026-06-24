// Foreign-AI export Connector (v0.1 connector #2, ADR-0007). Ingests a pasted
// "what I know about you" export from another AI tool (ChatGPT / Claude / Gemini).
// Unlike a disk source there is nothing to detect() or read() — the blob arrives
// via `memoring import` and is captured raw-first, then handed to this parser. The
// parser is a best-effort UNSTABLE boundary (§3.2): an unrecognizable blob
// quarantines (raw is already safe in the Undiluted), and every entry is mapped to
// origin=host_memory so it can NEVER become independent evidence (ADR-0007 §a/§f).
import { createHash } from 'node:crypto';
import { normalizeLabel } from '@core/label-normalize';
import type { ClaimKind } from '@core/schema/enums';
import type {
  Connector,
  DetectionResult,
  OccurrenceInput,
  ParseResult,
  ParsedMessage,
} from '@intake/types';
import type { Occurrence, Undiluted } from '@core/schema/entities';

export const IMPORT_AI_CONNECTOR_ID = 'import_ai';
export const IMPORT_AI_PARSER_VERSION = 'import_ai.v1';
/** One provider-agnostic Source for all pastes — capture is raw-first (G1), so the
 *  Source is fixed before the provider is known. Provider is folded into each
 *  entry's message_id and the per-export session id instead, so identities never
 *  collide across providers even under a shared Source. */
export const IMPORT_AI_SOURCE_STABLE_ID = 'import_ai';
const PAYLOAD_FORMAT = 'import_export_text';

/** One parsed export entry, before it becomes a host_memory Event + candidate Claim. */
export interface ImportEntry {
  kind: ClaimKind;
  statement: string;
  /** Verbatim quote/根拠 backing the entry, when the source supplies one. */
  quote: string | null;
  /** Source-reported date (YYYY-MM-DD) or null when '[unknown]'/absent. */
  date: string | null;
}

export interface ParsedExport {
  provider: string;
  entries: ImportEntry[];
}

export type ExportParseResult = { ok: true; export: ParsedExport } | { ok: false; reason: string };

// ── Category → Claim kind ─────────────────────────────────────────────────────
// Tolerant keyword match over a normalized header (markdown / numbering stripped),
// covering Claude's English categories and Gemini's Japanese ones (ADR-0007 §c).
function categoryToKind(header: string): ClaimKind | null {
  const h = header.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => h.includes(k));
  if (has('instruction', 'カスタム指示', '指示')) return 'constraint';
  if (has('preference', '好み', 'working-style', 'working style')) return 'preference';
  if (has('project', 'プロジェクト', 'イベント', '計画', 'plan')) return 'project_context';
  if (has('procedure', '手順', 'workflow')) return 'procedure';
  if (has('decision', '決定', '意思決定')) return 'decision';
  // identity / career / interests / relationships → neutral fact
  if (has('identity', '属性', 'career', 'キャリア', '職業', 'interest', '興味', '関心', 'relationship', '人間関係', '関係'))
    return 'fact';
  return null;
}

const DATE_RE = /\[(\d{4}-\d{2}-\d{2}|unknown)\]/;
function extractDate(line: string): string | null {
  const m = line.match(DATE_RE);
  return m && m[1] !== 'unknown' ? m[1]! : null;
}

/** A markdown/structural header line (not an entry). Returns its text or null. */
function headerText(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  // `## X`, `### X`, `**X**`, `1. **X**`, `1. X:` — strip leading markup + numbering.
  const m = t.match(/^(#{1,6}\s+|\d+\.\s+|\*\*)/);
  if (!m && !/:\s*$/.test(t)) return null;
  const stripped = t
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/:\s*$/, '')
    .trim();
  // A header has no entry payload (no date bracket, no leading bullet).
  if (DATE_RE.test(stripped) || /^[*-]\s/.test(stripped)) return null;
  return stripped.length > 0 && stripped.length <= 80 ? stripped : null;
}

// ── Claude format: category headers + `[date] - entry` lines (in a code block) ──
function parseClaude(text: string): ImportEntry[] {
  const entries: ImportEntry[] = [];
  let kind: ClaimKind = 'fact';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('```')) continue;
    const entryMatch = line.match(/^\[(?:\d{4}-\d{2}-\d{2}|unknown)\]\s*-\s*(.+)$/);
    if (entryMatch) {
      const statement = entryMatch[1]!.trim();
      if (statement) entries.push({ kind, statement, quote: null, date: extractDate(line) });
      continue;
    }
    const header = headerText(line);
    if (header) kind = categoryToKind(header) ?? kind;
  }
  return entries;
}

// ── Gemini format: bullets, each with a 根拠 (quote) + 日付 sub-bullet ───────────
function parseGemini(text: string): ImportEntry[] {
  const entries: ImportEntry[] = [];
  let kind: ClaimKind = 'fact';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^インポート元は/.test(line)) continue; // trailing provider line, handled separately
    const bullet = line.match(/^[*\-]\s+(.+)$/);
    if (bullet) {
      const body = bullet[1]!.trim();
      // A 根拠 (evidence) sub-bullet annotates the previous entry rather than starting one.
      if (/^根拠[:：]/.test(body) || body.startsWith('根拠')) {
        const last = entries[entries.length - 1];
        if (last) {
          last.quote = body.replace(/^根拠[:：]\s*/, '').replace(/。?\s*日付[:：].*$/, '').trim() || last.quote;
          last.date = extractDate(body) ?? last.date;
        }
        continue;
      }
      entries.push({ kind, statement: body.replace(/。$/, '。').trim(), quote: null, date: extractDate(body) });
      continue;
    }
    const header = headerText(line);
    if (header) kind = categoryToKind(header) ?? kind;
  }
  return entries;
}

function detectProvider(text: string, hint?: string): string {
  const m = text.match(/インポート元は\s*(.+?)\s*です/);
  if (m) return m[1]!.trim();
  const m2 = text.match(/import source is\s+(.+?)[.\n]/i);
  if (m2) return m2[1]!.trim();
  return hint && hint.trim() ? hint.trim() : 'unknown';
}

function isGeminiFormat(text: string): boolean {
  return /インポート元は/.test(text) || /根拠[:：]/.test(text);
}

/** Parse a pasted export blob into {provider, entries}, or fail (→ quarantine). */
export function parseExport(bytes: Buffer, providerHint?: string): ExportParseResult {
  const text = bytes.toString('utf8');
  if (!text.trim()) return { ok: false, reason: 'empty import payload' };
  const gemini = isGeminiFormat(text);
  const entries = gemini ? parseGemini(text) : parseClaude(text);
  if (entries.length === 0) return { ok: false, reason: 'no recognizable export entries' };
  return { ok: true, export: { provider: detectProvider(text, providerHint), entries } };
}

// ── Stable, realm-key-agnostic anchors (HMAC'd into event_identity later) ──────
function sha(input: string, len: number): string {
  return createHash('sha256').update(input).digest('hex').slice(0, len);
}

/** Stable per-entry message id → reprocess/restore-invariant event_identity (G11);
 *  re-pasting the same export dedups (ADR-0007 §d). */
export function importMessageId(provider: string, entry: Pick<ImportEntry, 'kind' | 'statement' | 'date'>): string {
  return `entry:${sha(`${provider}\x1f${entry.kind}\x1f${normalizeLabel(entry.statement)}\x1f${entry.date ?? ''}`, 32)}`;
}

/** Provider-stable session id: all imports from one provider share a Session. It is
 *  deliberately NOT blob-derived — folding the whole-blob hash in would flip every
 *  entry's event_identity on any cosmetic drift (a trailing newline, one reworded
 *  unrelated entry), defeating the content-anchored per-entry dedup on re-export.
 *  Keeping it provider-stable lets identical entries dedup across re-exports (§d). */
export function importSessionId(provider: string): string {
  return `import:${provider}`;
}

// ── Pending-import markers (meta keys) ─────────────────────────────────────────
// Defined here (a dependency leaf — no @claim/@intake value imports) so both the
// import orchestrator AND the consolidation guard reference one source of truth
// without a claim↔intake cycle. The PRESENCE of importClaimMetaKey is the guard:
// `consolidatePending` skips any candidate carrying it (ADR-0007 §a).
export const importClaimMetaKey = (claimId: string): string => `import:claim:${claimId}`;
export const importEventClaimMetaKey = (eventIdentity: string): string => `import:event_claim:${eventIdentity}`;

/** Build the OccurrenceInput for a pasted blob (the command captures this raw-first). */
export function importOccurrenceInput(bytes: Buffer): OccurrenceInput {
  return {
    source_stable_id: IMPORT_AI_SOURCE_STABLE_ID,
    payload_format: PAYLOAD_FORMAT,
    parser_hint: IMPORT_AI_PARSER_VERSION,
    bytes,
    cursor_start: 0,
    cursor_end: bytes.length,
    capture_method: 'manual',
    source_path: 'paste',
  };
}

export const importAiConnector: Connector = {
  id: IMPORT_AI_CONNECTOR_ID,
  displayName: 'Imported from AI',
  sourceType: 'artifact',

  async detect(): Promise<DetectionResult> {
    return {
      connector_id: this.id,
      host_tool: 'import_ai',
      sources: [],
      notes: ['Imports are pasted via `memoring import`; there is nothing to detect on disk.'],
    };
  },

  // Nothing to read from disk — a paste is delivered to the command directly.
  read(): OccurrenceInput[] {
    return [];
  },

  parse(_raw: Undiluted, occurrence: Occurrence, rawBytes: Buffer): ParseResult {
    const result = parseExport(rawBytes);
    if (!result.ok) return { kind: 'quarantine', reason: result.reason };
    const { provider, entries } = result.export;
    const session = importSessionId(provider);
    const messages: ParsedMessage[] = entries.map((e) => ({
      message_id: importMessageId(provider, e),
      source_position: null,
      host_session_stable_id: session,
      origin: 'host_memory', // foreign-AI memory store → never independent evidence (§f)
      role: null,
      event_type: 'import_entry',
      text: e.statement,
      source_timestamp: e.date ? `${e.date}T00:00:00.000Z` : null,
      cwd: null,
      git_branch: null,
      // Provenance preserved (encrypted, never indexed): which AI, the verbatim
      // quote, the date, and the mapped kind.
      extra: {
        import_provider: provider,
        import_kind: e.kind,
        ...(e.quote ? { import_quote: e.quote } : {}),
        ...(e.date ? { import_date: e.date } : {}),
        parser_hint: occurrence.parser_hint,
      },
    }));
    return { kind: 'messages', messages, skipped: 0, parseFailures: 0 };
  },
};

// ── (g) Export-prompt helper: hand the user the prompt to run elsewhere ─────────
const CLAUDE_EXPORT_PROMPT = `Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim where possible, especially for instructions and preferences.

## Categories (output in this order):

1. **Instructions**: Rules I've explicitly asked you to follow going forward — tone, format, style, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

2. **Identity**: Name, age, location, education, family, relationships, languages, and personal interests.

3. **Career**: Current and past roles, companies, and general skill areas.

4. **Projects**: Projects I meaningfully built or committed to. Ideally ONE entry per project. Include what it does, current status, and any key decisions. Use the project name or a short descriptor as the first words of the entry.

5. **Preferences**: Opinions, tastes, and working-style preferences that apply broadly.

## Format:
Use section headers for each category. Within each category, list one entry per line, sorted by oldest date first. Format each line as:
[YYYY-MM-DD] - Entry content here.
If no date is known, use [unknown] instead.

## Output:
- Wrap the entire export in a single code block for easy copying.
- After the code block, state whether this is the complete set or if more remain.`;

const GEMINI_EXPORT_PROMPT = `あなたは、ある AI アシスタントから別の AI アシスタントへコンテキストを移行するのを手伝っています。あなたの仕事は、これまでの会話を確認し、私について知っていることを要約することです。
出力では、一人称代名詞（「私」）と二人称代名詞（「あなた」）は使用しないでください。代わりに、あなたが学習した個人を「ユーザー」と呼ぶか、中立的な表現を使用してください。
特に指示や好みの設定については、可能であればユーザーの言葉をそのまま使用してください。
カテゴリ（この順序で出力してください）:
1. ユーザー属性情報: 使用する名前、職業、学歴、居住地域。
2. 興味 / 関心: 継続的かつ積極的に関わっているもの（所有しているだけのものや一度だけ購入したものを除く）。
3. 人間関係: 確認されている継続的な関係。
4. 日付があるイベント、プロジェクト、計画: 最近の重要なアクティビティのログ。
5. カスタム指示: 今後従うよう明示的に指示したルール（「常に X を行う」、「決して Y を行わない」、動作の修正）。保存されたメモリーからのルールのみを含め、チャットからのルールは含めないでください。
形式:
上記のカテゴリを使用して、コンテンツをラベル付きセクションに分割してください。各エントリの根拠となるプロンプトからの引用をそのまま含めるようにしてください。各エントリを次の形式で構成してください:
* ユーザーの名前は <name> です。
    * 根拠: ユーザーは「<name> と呼んで」と言いました。日付: [YYYY-MM-DD]。
出力:
- リクエストされた情報のみを出力してください。会話のつなぎ言葉や前置き、結びの挨拶などは一切含めないでください。
最後に、「インポート元は <name> です」という文を完成させてください。<name> には、ChatGPT、Claude、Grok などの名前が入ります。これは、必ず回答の一番最後に配置してください。`;

/** Print-ready export prompt for the named provider, or null if unknown. ChatGPT
 *  reuses the generic English (Claude-style) prompt. */
export function exportPromptFor(provider: string): string | null {
  switch (provider.toLowerCase()) {
    case 'claude':
    case 'chatgpt':
    case 'openai':
      return CLAUDE_EXPORT_PROMPT;
    case 'gemini':
    case 'google':
      return GEMINI_EXPORT_PROMPT;
    default:
      return null;
  }
}
