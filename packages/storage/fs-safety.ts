// Shared file-safety helpers. Atomic write + restrictive perms are used both for
// replica internals and for the context.md egress (Specification §3.5).
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Write atomically (tmp in same dir + rename) and chmod 0600. */
export function atomicWriteFile(filePath: string, data: Buffer | string, mode = 0o600, durable = false): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeFileSync(fd, data);
    if (durable) fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(tmp, mode);
  } catch {
    /* best-effort on platforms without chmod */
  }
  fs.renameSync(tmp, filePath);
  if (!durable) return;
  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    /* best-effort on filesystems that do not fsync directories */
  }
}

export function ensureDir(dir: string, mode = 0o700): void {
  const firstCreated = fs.mkdirSync(dir, { recursive: true });
  try {
    // chmod the leaf plus every intermediate that was newly created (from the
    // first created ancestor down), so nested paths are not left at the umask
    // default (e.g. 0755) — only the leaf was chmod'd before.
    let cur = dir;
    for (;;) {
      fs.chmodSync(cur, mode);
      if (!firstCreated || cur === firstCreated) break;
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  } catch {
    /* best-effort */
  }
}
