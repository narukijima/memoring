// Intake contracts (Detailed Design §3.1/§3.2). The Connector finds local
// accumulation and opens a mouth to it; the Parser is the best-effort boundary
// to the fixed schema. The host transcript format is NOT a stable API.
import type { CaptureMethod, Origin, Sensitivity } from '@core/schema/enums';
import type { MemEvent, Occurrence, QuarantineRecord, Undiluted } from '@core/schema/entities';

export interface DetectedSource {
  source_stable_id: string;
  connector_id: string;
  source_type: 'append' | 'snapshot' | 'event' | 'artifact';
  project_root: string | null;
  git_remote: string | null;
  account: string | null;
  transcript_path: string;
  last_modified: string | null;
  sensitivity_hint: Sensitivity;
  suggested_realm: string | null;
  host_tool: string;
  host_tool_version: string | null;
  format_version: string | null;
}

export interface DetectionResult {
  connector_id: string;
  host_tool: string;
  sources: DetectedSource[];
  notes: string[];
}

/** One unit of raw to be captured (yielded by backfill/watch). */
export interface OccurrenceInput {
  source_stable_id: string;
  payload_format: string;
  parser_hint: string;
  bytes: Buffer;
  cursor_start: number;
  cursor_end: number;
  capture_method: CaptureMethod;
  source_path: string;
}

/** A normalized message extracted by a Parser, before Event assembly. */
export interface ParsedMessage {
  /** Stable message id from the source if present (else null → content_anchor). */
  message_id: string | null;
  /** Stable source cursor/offset when no message id exists (append-source fallback). */
  source_position: string | null;
  host_session_stable_id: string;
  origin: Origin;
  role: string | null;
  event_type: string;
  text: string;
  source_timestamp: string | null;
  cwd: string | null;
  git_branch: string | null;
  /** Residual non-allowlisted source fields, preserved (encrypted) so a host
   *  change is not silently discarded (FR-015, §3.2/§5.3). null when none. */
  extra: Record<string, unknown> | null;
}

export type ParseResult =
  | {
      kind: 'messages';
      messages: ParsedMessage[];
      /** Lines intentionally skipped (valid but empty / structural). */
      skipped: number;
      /** Genuine JSON parse failures among the chunk's lines (surfaced, never
       *  silently dropped — FR-013). Raw is preserved in the Undiluted. */
      parseFailures: number;
    }
  | { kind: 'quarantine'; reason: string };

export interface Connector {
  id: string;
  displayName: string;
  sourceType: 'append' | 'snapshot' | 'event' | 'artifact';
  detect(): Promise<DetectionResult>;
  /** Read raw chunks for a source from a cursor (backfill = from 0; watch = tail). */
  read(source: DetectedSource, fromCursor: number, method: CaptureMethod): OccurrenceInput[];
  parse(raw: Undiluted, occurrence: Occurrence, rawBytes: Buffer): ParseResult;
}

export type { MemEvent, Occurrence, QuarantineRecord, Undiluted };
