// Thin, dependency-free wrappers over node:crypto. All at-rest confidentiality
// and all identity/fingerprint HMACs flow through here so the crypto choices
// stay in one auditable place.
import {
  createHmac,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';

export const AEAD_ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const KEY_BYTES = 32;

/** Recorded KDF parameters make re-derivation deterministic (NFR-012). */
export interface KdfParams {
  algorithm: 'scrypt';
  N: number;
  r: number;
  p: number;
  saltB64: string;
  keyBytes: number;
}

export function defaultScryptParams(saltB64?: string): KdfParams {
  return {
    algorithm: 'scrypt',
    N: 1 << 15, // 32768
    r: 8,
    p: 1,
    saltB64: saltB64 ?? randomBytes(16).toString('base64'),
    keyBytes: KEY_BYTES,
  };
}

export function deriveKeyFromSecret(secret: Buffer | string, params: KdfParams): Buffer {
  const salt = Buffer.from(params.saltB64, 'base64');
  const material = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret;
  return scryptSync(material, salt, params.keyBytes, {
    N: params.N,
    r: params.r,
    p: params.p,
    // scrypt needs maxmem large enough for the chosen N (128*N*r bytes).
    maxmem: 256 * params.N * params.r,
  });
}

/** HKDF-SHA256 to fork purpose-specific subkeys (realm_root_secret, realm_key). */
export function hkdf(ikm: Buffer, info: string, length = KEY_BYTES): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.from(info, 'utf8'), length));
}

/** AEAD seal → packed buffer [iv | tag | ciphertext]. Unique random IV per call. */
export function aeadSeal(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AEAD_ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function aeadOpen(key: Buffer, packed: Buffer): Buffer {
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = packed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(AEAD_ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Realm-keyed HMAC for content_fingerprint / *_identity / normalized_key. */
export function realmHmac(realmKey: Buffer, ...parts: (string | Buffer)[]): string {
  const h = createHmac('sha256', realmKey);
  for (const p of parts) {
    h.update(typeof p === 'string' ? Buffer.from(p, 'utf8') : p);
    h.update('\x1f'); // unit separator: avoid concat ambiguity across parts
  }
  return `hmac-sha256:${h.digest('hex')}`;
}

/** Detached signing HMAC (e.g. Ouroboros marker, policy_digest). */
export function hmacHex(key: Buffer, data: string | Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function randomSecret(bytes = KEY_BYTES): Buffer {
  return randomBytes(bytes);
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
