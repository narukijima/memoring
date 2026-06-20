// Audit log (NFR-029/030, Detailed Design §8.2). Records only ids / counts /
// state — never content payload (NFR-004). Audited operations: ContextPack
// generation, MCP request, remote AI enrichment, export, delete/redact, policy
// override, key recovery, Recipe change. Because there is no review queue, the
// exposure / correction / Seal / delete of high-risk Claims are audited instead.
import fs from 'node:fs';
import path from 'node:path';
import { log } from '@core/log';

export type AuditFields = Record<string, string | number | boolean>;

export function appendAudit(logsDir: string, op: string, fields: AuditFields, isoTime: string): void {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const line = JSON.stringify({ ts: isoTime, op, ...fields }) + '\n';
    fs.appendFileSync(path.join(logsDir, 'audit.log'), line, { mode: 0o600 });
  } catch {
    // Auditing must never crash the operation it records, but a dropped audit
    // entry must not be silent (§8.2). Emit op only — no ids/payload (NFR-004).
    log.error('audit:write_failed', { op });
  }
}
