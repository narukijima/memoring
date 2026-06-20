// At-rest encrypted database (NFR-001, Detailed Design §7.1).
//
// Design choice: the SQLite database lives purely in memory and is persisted as
// a single AEAD-encrypted serialized blob. Because no on-disk SQLite file exists,
// every leak path enumerated by NFR-009 (WAL / rollback journal / temp store /
// FTS shadow / vacuum intermediate / backup) is closed by construction rather
// than patched after the fact; temp_store=MEMORY keeps intermediates off disk.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { aeadOpen, aeadSeal } from '@security/crypto-primitives';
import { STORE_FORMAT_VERSION } from '@core/schema/versions';
import { atomicWriteFile } from './fs-safety';
import { DDL } from './schema-ddl';

export type Db = Database.Database;

export class EncryptedDb {
  private dirty = false;

  private constructor(
    readonly db: Db,
    private readonly dek: Buffer,
    private readonly blobPath: string,
  ) {}

  private static configure(db: Db): void {
    db.pragma('temp_store = MEMORY'); // never spill plaintext intermediates to disk
    db.pragma('foreign_keys = OFF');
    db.exec(DDL);
  }

  /** Open an existing encrypted replica, or initialize a fresh in-memory DB. */
  static openOrCreate(blobPath: string, dek: Buffer): EncryptedDb {
    let db: Db;
    if (fs.existsSync(blobPath)) {
      const plain = aeadOpen(dek, fs.readFileSync(blobPath));
      db = new Database(plain);
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
    return new EncryptedDb(db, dek, blobPath);
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Serialize → AEAD seal → atomic write. */
  flush(force = false): void {
    if (!this.dirty && !force) return;
    const serialized = this.db.serialize();
    atomicWriteFile(this.blobPath, aeadSeal(this.dek, serialized));
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
    if (persist) this.flush(false);
    this.db.close();
  }
}
