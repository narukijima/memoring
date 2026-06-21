// At-rest encrypted database (NFR-001, Detailed Design §7.1).
//
// Design choice: the SQLite database lives purely in memory and is persisted as
// a single AEAD-encrypted serialized blob. Because no on-disk SQLite file exists,
// every leak path enumerated by NFR-009 (WAL / rollback journal / temp store /
// FTS shadow / vacuum intermediate / backup) is closed by construction rather
// than patched after the fact; temp_store=MEMORY keeps intermediates off disk.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { aeadOpen, aeadSeal } from '@security/crypto-primitives';
import { STORE_FORMAT_VERSION } from '@core/schema/versions';
import { atomicWriteFile } from './fs-safety';
import { DDL } from './schema-ddl';

export type Db = Database.Database;

interface ReplicaLock {
  path: string;
  fd: number;
  token: string;
}

interface LockFile {
  pid?: number;
  token?: string;
  created_at?: string;
}

export class ReplicaLockError extends Error {
  constructor(lockPath: string, owner?: LockFile) {
    const ownerText = owner?.pid ? ` by pid ${owner.pid}` : '';
    super(`Memoring replica is already open${ownerText}: ${lockPath}`);
    this.name = 'ReplicaLockError';
  }
}

function readLockFile(lockPath: string): LockFile | undefined {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8')) as LockFile;
  } catch {
    return undefined;
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

const LOCK_RETRY_INTERVAL_MS = 100;
const DEFAULT_LOCK_MAX_WAIT_MS = 2000;

/** How long to wait through transient lock contention (e.g. a daemon mid-tick)
 *  before failing closed. Tunable for slow/networked disks and for tests. */
function lockMaxWaitMs(): number {
  const env = process.env.MEMORING_LOCK_MAX_WAIT_MS;
  if (env === undefined) return DEFAULT_LOCK_MAX_WAIT_MS;
  const n = Number(env);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LOCK_MAX_WAIT_MS;
}

/** Block briefly without busy-spin (so brief lock contention waits, not fails). */
function syncSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireReplicaLock(blobPath: string): ReplicaLock {
  const lockPath = `${blobPath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + lockMaxWaitMs();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, created_at: new Date().toISOString() }));
      return { path: lockPath, fd, token };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw e;
      const owner = readLockFile(lockPath);
      if (owner?.pid && !pidIsAlive(owner.pid)) {
        try {
          fs.unlinkSync(lockPath);
          continue; // stale lock cleared → retry immediately
        } catch {
          /* lost the unlink race → fall through to wait/retry */
        }
      }
      // Live owner (e.g. the daemon mid-tick): wait briefly and retry, then fail
      // closed — so a context build that races a tick waits instead of erroring.
      if (Date.now() >= deadline) throw new ReplicaLockError(lockPath, owner);
      syncSleep(LOCK_RETRY_INTERVAL_MS);
    }
  }
}

function releaseReplicaLock(lock: ReplicaLock): void {
  try {
    fs.closeSync(lock.fd);
  } catch {
    /* best-effort */
  }
  const owner = readLockFile(lock.path);
  if (owner?.token !== lock.token) return;
  try {
    fs.unlinkSync(lock.path);
  } catch {
    /* best-effort */
  }
}

export class EncryptedDb {
  private dirty = false;
  private closed = false;

  private constructor(
    readonly db: Db,
    private readonly dek: Buffer,
    private readonly blobPath: string,
    private readonly lock: ReplicaLock,
  ) {}

  private static configure(db: Db): void {
    db.pragma('temp_store = MEMORY'); // never spill plaintext intermediates to disk
    db.pragma('foreign_keys = OFF');
    db.exec(DDL);
  }

  /** Open an existing encrypted replica, or initialize a fresh in-memory DB. */
  static openOrCreate(blobPath: string, dek: Buffer): EncryptedDb {
    const lock = acquireReplicaLock(blobPath);
    let db: Db;
    try {
      if (fs.existsSync(blobPath)) {
        const plain = aeadOpen(dek, fs.readFileSync(blobPath));
        db = new Database(plain);
        // Fail fast on a vault written by a NEWER binary (format we cannot read):
        // the GCM tag authenticates contents but binds no format version, and the
        // idempotent CREATE-IF-NOT-EXISTS DDL would otherwise silently run against a
        // mismatched schema. (An older/equal version is accepted; migrations land here.)
        const row = db.prepare("SELECT value FROM meta WHERE key = 'store_format_version'").get() as
          | { value: string }
          | undefined;
        const onDisk = row ? Number(row.value) : 0;
        if (Number.isFinite(onDisk) && onDisk > STORE_FORMAT_VERSION) {
          throw new Error(
            `Vault store_format_version ${onDisk} is newer than this build supports (${STORE_FORMAT_VERSION}); upgrade memoring.`,
          );
        }
        // Re-apply config + idempotent DDL so format upgrades land on open.
        EncryptedDb.configure(db);
      } else {
        db = new Database(':memory:');
        EncryptedDb.configure(db);
        db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
          'store_format_version',
          String(STORE_FORMAT_VERSION),
        );
      }
    } catch (e) {
      releaseReplicaLock(lock);
      throw e;
    }
    return new EncryptedDb(db, dek, blobPath, lock);
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Serialize → AEAD seal → atomic write. */
  flush(force = false): void {
    if (this.closed) return;
    if (!this.dirty && !force) return;
    const serialized = this.db.serialize();
    atomicWriteFile(this.blobPath, aeadSeal(this.dek, serialized), 0o600, true);
    this.dirty = false;
  }

  /** Run fn in a transaction; mark dirty on success. */
  tx<T>(fn: () => T): T {
    const wrapped = this.db.transaction(fn);
    const result = wrapped();
    this.markDirty();
    return result;
  }

  close(persist = true): void {
    if (this.closed) return;
    try {
      if (persist) this.flush(false);
    } finally {
      try {
        this.db.close();
      } finally {
        this.closed = true;
        releaseReplicaLock(this.lock);
      }
    }
  }
}
