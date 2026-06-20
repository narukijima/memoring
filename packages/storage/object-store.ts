// Encrypted object store for Undiluted payloads and Artifacts (Basic Design §2.2).
// Each object is an independent AEAD blob sealed with the DEK; plaintext raw is
// never written to disk (NFR-002). Refs are opaque and carry no semantic name.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { aeadOpen, aeadSeal, realmHmac } from '@security/crypto-primitives';
import { atomicWriteFile } from './fs-safety';

export class ObjectStore {
  constructor(
    private readonly objectsDir: string,
    private readonly dek: Buffer,
    private readonly realmKey: Buffer,
  ) {}

  /** Shard ref by a hash of the id: objects/<aa>/<bb>/<id>. */
  private refFor(objectId: string): string {
    const h = createHash('sha256').update(objectId).digest('hex');
    return path.posix.join('objects', h.slice(0, 2), h.slice(2, 4), objectId);
  }

  private absFromRef(ref: string): string {
    // ref is "objects/aa/bb/id"; objectsDir already ends with "objects".
    const rel = ref.replace(/^objects\//, '');
    return path.join(this.objectsDir, rel);
  }

  /** Seal a payload; returns { ref, content_fingerprint }. */
  put(objectId: string, payload: Buffer): { ref: string; fingerprint: string } {
    const ref = this.refFor(objectId);
    const abs = this.absFromRef(ref);
    atomicWriteFile(abs, aeadSeal(this.dek, payload));
    return { ref, fingerprint: realmHmac(this.realmKey, payload) };
  }

  get(ref: string): Buffer {
    const abs = this.absFromRef(ref);
    return aeadOpen(this.dek, fs.readFileSync(abs));
  }

  exists(ref: string): boolean {
    return fs.existsSync(this.absFromRef(ref));
  }

  /** Physical deletion of the encrypted object (delete cascade, §7.3). */
  delete(ref: string): void {
    const abs = this.absFromRef(ref);
    if (fs.existsSync(abs)) fs.rmSync(abs);
  }
}
