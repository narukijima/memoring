// Encrypted object store for Undiluted payloads and Artifacts (Basic Design §2.2).
// Each object is an independent AEAD blob sealed with the DEK; plaintext raw is
// never written to disk (NFR-002). Refs are opaque and carry no semantic name.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { aeadOpen, aeadSeal, realmHmac } from '@security/crypto-primitives';
import { atomicWriteFile } from './fs-safety';

const OBJECT_REF_RE = /^objects\/[0-9a-f]{2}\/[0-9a-f]{2}\/[A-Za-z0-9_-]+$/;

export function validateObjectRef(ref: string): void {
  if (!OBJECT_REF_RE.test(ref)) throw new Error(`Invalid object ref: ${ref}`);
}

export function objectAbsFromRef(objectsDir: string, ref: string): string {
  validateObjectRef(ref);
  const rel = ref.slice('objects/'.length);
  const root = path.resolve(objectsDir);
  const abs = path.resolve(root, rel);
  const containment = path.relative(root, abs);
  if (containment.startsWith('..') || path.isAbsolute(containment)) {
    throw new Error(`Object ref escapes objects dir: ${ref}`);
  }
  return abs;
}

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

  /** Seal a payload; returns { ref, content_fingerprint }. */
  put(objectId: string, payload: Buffer): { ref: string; fingerprint: string } {
    const ref = this.refFor(objectId);
    const abs = objectAbsFromRef(this.objectsDir, ref);
    atomicWriteFile(abs, aeadSeal(this.dek, payload));
    return { ref, fingerprint: realmHmac(this.realmKey, payload) };
  }

  get(ref: string): Buffer {
    const abs = objectAbsFromRef(this.objectsDir, ref);
    return aeadOpen(this.dek, fs.readFileSync(abs));
  }

  exists(ref: string): boolean {
    return fs.existsSync(objectAbsFromRef(this.objectsDir, ref));
  }

  /** Physical deletion of the encrypted object (delete cascade, §7.3). */
  delete(ref: string): void {
    const abs = objectAbsFromRef(this.objectsDir, ref);
    if (fs.existsSync(abs)) fs.rmSync(abs);
  }
}
