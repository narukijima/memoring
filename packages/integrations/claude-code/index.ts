// Claude Code local transcript / session Connector (v0 initial connector #1).
// Transcripts live at ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl, one
// JSON object per line. The format is treated as a best-effort UNSTABLE parser
// (§3.2): unknown lines degrade to origin=unknown or are skipped; raw is never
// lost (the Undiluted is captured before parsing).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CaptureMethod } from '@core/schema/enums';
import type {
  Connector,
  DetectedSource,
  DetectionResult,
  OccurrenceInput,
  ParseResult,
  ParsedMessage,
} from '@intake/types';
import type { Occurrence, Undiluted } from '@core/schema/entities';

export const CLAUDE_CODE_CONNECTOR_ID = 'claude_code';
export const CLAUDE_CODE_PARSER_VERSION = 'claude_code_jsonl.v1';
const PAYLOAD_FORMAT = 'jsonl';

function claudeProjectsDir(): string {
  return process.env.MEMORING_CLAUDE_DIR ?? path.join(os.homedir(), '.claude', 'projects');
}

function readFirstLines(file: string, max = 50): string[] {
  try {
    const content = fs.readFileSync(file, 'utf8');
    return content.split('\n').filter((l) => l.trim()).slice(0, max);
  } catch {
    return [];
  }
}

interface RawLine {
  type?: string;
  uuid?: string;
  leafUuid?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  isMeta?: boolean;
  summary?: string;
  message?: { role?: string; content?: unknown };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>;
        if (typeof b.text === 'string') parts.push(b.text);
        else if (b.type === 'tool_use' && typeof b.name === 'string')
          parts.push(`[tool_use: ${b.name}] ${typeof b.input === 'object' ? JSON.stringify(b.input) : ''}`);
        else if (b.type === 'tool_result')
          parts.push(typeof b.content === 'string' ? b.content : extractText(b.content));
      }
    }
    return parts.join('\n').trim();
  }
  return '';
}

function hasToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((b) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'tool_result')
  );
}

function classifyOrigin(line: RawLine, text: string): ParsedMessage['origin'] {
  switch (line.type) {
    case 'assistant':
      return 'assistant';
    case 'summary':
      return 'host_summary';
    case 'system':
      return 'system';
    case 'user':
      if (hasToolResult(line.message?.content)) return 'tool_result';
      if (line.isMeta === true) return 'system';
      // Host-injected context (CLAUDE.md, environment, tool guidance) is delivered
      // as a type:'user' line whose content is a <system-reminder> block. It is
      // host system/config injection (§1.3.2 `system`), NOT a user utterance, and
      // must never become independent evidence — this closes the host-memory
      // laundering loop (§4.12 / G8) at the intake boundary. Gate on a leading
      // marker so a genuine user message that merely quotes the tag is not
      // over-excluded.
      if (text.trimStart().startsWith('<system-reminder>')) return 'system';
      return 'user';
    default:
      return 'unknown';
  }
}

function parseLine(raw: string, fallbackSession: string): ParsedMessage | null {
  let line: RawLine;
  try {
    line = JSON.parse(raw) as RawLine;
  } catch {
    return null;
  }
  const text = line.type === 'summary' ? (line.summary ?? '') : extractText(line.message?.content);
  const origin = classifyOrigin(line, text);
  // Skip empty non-summary structural lines (no usable content) — not a parse error.
  if (!text && origin !== 'host_summary') return null;
  return {
    message_id: line.uuid ?? line.leafUuid ?? null,
    host_session_stable_id: line.sessionId ?? fallbackSession,
    origin,
    role: line.message?.role ?? null,
    event_type: line.type ?? 'unknown',
    text,
    source_timestamp: line.timestamp ?? null,
    cwd: line.cwd ?? null,
    git_branch: line.gitBranch ?? null,
    extra: collectExtra(line),
  };
}

const KNOWN_LINE_FIELDS: ReadonlySet<string> = new Set([
  'type', 'uuid', 'leafUuid', 'sessionId', 'cwd', 'gitBranch', 'timestamp', 'isMeta', 'summary', 'message',
]);

/** Preserve non-allowlisted top-level fields so a host format change is not
 *  silently discarded (FR-015). Returned null when there is nothing extra. */
function collectExtra(line: RawLine): Record<string, unknown> | null {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(line as Record<string, unknown>)) {
    if (!KNOWN_LINE_FIELDS.has(k)) extra[k] = v;
  }
  return Object.keys(extra).length > 0 ? extra : null;
}

export const claudeCodeConnector: Connector = {
  id: CLAUDE_CODE_CONNECTOR_ID,
  displayName: 'Claude Code',
  sourceType: 'append',

  async detect(): Promise<DetectionResult> {
    const root = claudeProjectsDir();
    const notes: string[] = [];
    const sources: DetectedSource[] = [];
    if (!fs.existsSync(root)) {
      return { connector_id: this.id, host_tool: 'claude_code', sources, notes: [`No directory at ${root}`] };
    }
    for (const projectDir of fs.readdirSync(root)) {
      const abs = path.join(root, projectDir);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      for (const file of fs.readdirSync(abs)) {
        if (!file.endsWith('.jsonl')) continue;
        const transcriptPath = path.join(abs, file);
        const firstLines = readFirstLines(transcriptPath, 10);
        let cwd: string | null = null;
        let session: string | null = null;
        for (const l of firstLines) {
          try {
            const o = JSON.parse(l) as RawLine;
            cwd = cwd ?? o.cwd ?? null;
            session = session ?? o.sessionId ?? null;
          } catch {
            /* skip */
          }
          if (cwd && session) break;
        }
        let mtime: string | null = null;
        try {
          mtime = fs.statSync(transcriptPath).mtime.toISOString();
        } catch {
          /* ignore */
        }
        const stableId = file.replace(/\.jsonl$/, '');
        sources.push({
          source_stable_id: stableId,
          connector_id: this.id,
          source_type: 'append',
          project_root: cwd,
          git_remote: null,
          account: null,
          transcript_path: transcriptPath,
          last_modified: mtime,
          sensitivity_hint: 'unknown',
          suggested_realm: null,
          host_tool: 'claude_code',
          host_tool_version: null,
          format_version: CLAUDE_CODE_PARSER_VERSION,
        });
      }
    }
    if (sources.length === 0) notes.push('No Claude Code transcripts found.');
    return { connector_id: this.id, host_tool: 'claude_code', sources, notes };
  },

  read(source: DetectedSource, fromCursor: number, method: CaptureMethod): OccurrenceInput[] {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(source.transcript_path);
    } catch {
      return [];
    }
    if (fromCursor >= buf.length) return [];
    const slice = buf.subarray(fromCursor);
    // Newline-align so we never split a JSON object across captures.
    const lastNl = slice.lastIndexOf(0x0a);
    const end = lastNl >= 0 ? fromCursor + lastNl + 1 : buf.length;
    const bytes = buf.subarray(fromCursor, end);
    if (bytes.length === 0) return [];
    return [
      {
        source_stable_id: source.source_stable_id,
        payload_format: PAYLOAD_FORMAT,
        parser_hint: CLAUDE_CODE_PARSER_VERSION,
        bytes,
        cursor_start: fromCursor,
        cursor_end: end,
        capture_method: method,
        source_path: source.transcript_path,
      },
    ];
  },

  parse(_raw: Undiluted, _occurrence: Occurrence, rawBytes: Buffer): ParseResult {
    const text = rawBytes.toString('utf8');
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { kind: 'quarantine', reason: 'empty payload' };
    const messages: ParsedMessage[] = [];
    let skipped = 0;
    let jsonFailures = 0;
    for (const line of lines) {
      const parsed = parseLine(line, 'unknown_session');
      if (parsed) messages.push(parsed);
      else {
        // Distinguish "valid JSON but no content" (a structural skip) from "not
        // JSON at all" (a genuine parse failure that must be surfaced, FR-013).
        try {
          JSON.parse(line);
          skipped += 1;
        } catch {
          jsonFailures += 1;
        }
      }
    }
    // Whole chunk is non-JSON → quarantine (raw is already safe in Undiluted).
    if (messages.length === 0 && jsonFailures === lines.length) {
      return { kind: 'quarantine', reason: 'no parseable JSONL lines' };
    }
    return { kind: 'messages', messages, skipped, parseFailures: jsonFailures };
  },
};
