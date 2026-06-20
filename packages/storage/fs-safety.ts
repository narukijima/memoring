// Shared file-safety helpers. Atomic write + restrictive perms are used both for
// replica internals and for the context.md egress (Specification §3.5).
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Write atomically (tmp in same dir + rename) and chmod 0600. */
export function atomicWriteFile(filePath: string, data: Buffer | string, mode = 0o600): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
  fs.writeFileSync(tmp, data, { mode });
  try {
    fs.chmodSync(tmp, mode);
  } catch {
    /* best-effort on platforms without chmod */
  }
  fs.renameSync(tmp, filePath);
}

export function ensureDir(dir: string, mode = 0o700): void {
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.chmodSync(dir, mode);
  } catch {
    /* best-effort */
  }
}
