// Envelope key scheme (NFR-010..016, Detailed Design §7.4).
//
//   recovery material (R, 32B, shown once, never stored)
//     ├─ realm_root_secret = HKDF(R, "realm-root")     ← rotation-invariant
//     │     └─ realm_key    = HKDF(root, "realm-key")   ← HMAC identity/fingerprint
//     └─ KEK_recovery = scrypt(R)        ─┐ wrap DEK (recovery path)
//   passphrase ─ KEK_passphrase = scrypt ─┘ wrap DEK (normal path)
//   DEK (32B, random)  → at-rest AEAD of DB blob + object store (rekey-able)
//        └─ realm_root_secret stored AEAD(DEK, root) so passphrase unlock reaches realm_key
//
// The plaintext key never touches disk: only wrapped forms live in the bundle.
import {
  aeadOpen,
  aeadSeal,
  defaultScryptParams,
  deriveKeyFromSecret,
  hkdf,
  randomSecret,
  type KdfParams,
} from './crypto-primitives';
import { newId } from '@core/schema/ids';

const ROOT_INFO = 'memoring/realm-root';
const REALM_KEY_INFO = 'memoring/realm-key';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const KEY_BUNDLE_VERSION = 1;

export interface KeyBundle {
  version: number;
  dek_id: string;
  kdf_passphrase: KdfParams;
  kdf_recovery: KdfParams;
  dek_wrapped_passphrase: string; // base64 AEAD(KEK_pp, DEK)
  dek_wrapped_recovery: string; // base64 AEAD(KEK_rec, DEK)
  realm_root_secret_enc: string; // base64 AEAD(DEK, realm_root_secret)
  created_at: string;
}

export class WrongCredentialError extends Error {
  constructor(kind: 'passphrase' | 'recovery') {
    super(`Unlock failed: incorrect ${kind} (or corrupted key bundle).`);
    this.name = 'WrongCredentialError';
  }
}

/** In-memory, unlocked key material. Held only in process memory (§7.4 / §7.5). */
export class Keyring {
  constructor(
    readonly dek: Buffer,
    readonly realmKey: Buffer,
    readonly dekId: string,
  ) {}

  /** Best-effort wipe of plaintext key material from memory. */
  dispose(): void {
    this.dek.fill(0);
    this.realmKey.fill(0);
  }
}

function encodeRecovery(raw: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of raw) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  // Group into 4-char blocks for human transcription.
  return out.match(/.{1,4}/g)!.join('-');
}

function decodeRecovery(code: string): Buffer {
  const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx < 0) throw new WrongCredentialError('recovery');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export interface CreatedKeyMaterial {
  bundle: KeyBundle;
  recoveryCode: string;
  keyring: Keyring;
}

/** init: mandatorily generate passphrase wrapping + recovery material (FR-083). */
export function createKeyMaterial(passphrase: string, now = new Date()): CreatedKeyMaterial {
  const dek = randomSecret();
  const recovery = randomSecret();
  const realmRootSecret = hkdf(recovery, ROOT_INFO);
  const realmKey = hkdf(realmRootSecret, REALM_KEY_INFO);

  const kdfPp = defaultScryptParams();
  const kdfRec = defaultScryptParams();
  const kekPp = deriveKeyFromSecret(passphrase, kdfPp);
  const kekRec = deriveKeyFromSecret(recovery, kdfRec);

  const bundle: KeyBundle = {
    version: KEY_BUNDLE_VERSION,
    dek_id: newId('source'), // a stable opaque id for the data key
    kdf_passphrase: kdfPp,
    kdf_recovery: kdfRec,
    dek_wrapped_passphrase: aeadSeal(kekPp, dek).toString('base64'),
    dek_wrapped_recovery: aeadSeal(kekRec, dek).toString('base64'),
    realm_root_secret_enc: aeadSeal(dek, realmRootSecret).toString('base64'),
    created_at: now.toISOString(),
  };

  kekPp.fill(0);
  kekRec.fill(0);
  realmRootSecret.fill(0);

  return { bundle, recoveryCode: encodeRecovery(recovery), keyring: new Keyring(dek, realmKey, bundle.dek_id) };
}

export function unlockWithPassphrase(bundle: KeyBundle, passphrase: string): Keyring {
  const kek = deriveKeyFromSecret(passphrase, bundle.kdf_passphrase);
  let dek: Buffer;
  try {
    dek = aeadOpen(kek, Buffer.from(bundle.dek_wrapped_passphrase, 'base64'));
  } catch {
    throw new WrongCredentialError('passphrase');
  } finally {
    kek.fill(0);
  }
  const realmRootSecret = aeadOpen(dek, Buffer.from(bundle.realm_root_secret_enc, 'base64'));
  const realmKey = hkdf(realmRootSecret, REALM_KEY_INFO);
  realmRootSecret.fill(0);
  return new Keyring(dek, realmKey, bundle.dek_id);
}

export function unlockWithRecovery(bundle: KeyBundle, recoveryCode: string): Keyring {
  const recovery = decodeRecovery(recoveryCode);
  const kek = deriveKeyFromSecret(recovery, bundle.kdf_recovery);
  let dek: Buffer;
  try {
    dek = aeadOpen(kek, Buffer.from(bundle.dek_wrapped_recovery, 'base64'));
  } catch {
    throw new WrongCredentialError('recovery');
  } finally {
    kek.fill(0);
  }
  const realmRootSecret = hkdf(recovery, ROOT_INFO);
  const realmKey = hkdf(realmRootSecret, REALM_KEY_INFO);
  recovery.fill(0);
  realmRootSecret.fill(0);
  return new Keyring(dek, realmKey, bundle.dek_id);
}

// ── Passwordless local-key mode (default) ───────────────────────────────────
// The vault stays AEAD(DEK)-encrypted, but the DEK + root secret are stored
// UNWRAPPED in a 0600 local key file instead of being scrypt-wrapped behind a
// passphrase. Goal: no password to forget. This is NOT strong at-rest crypto —
// anyone who can read the key file can open the vault — but it avoids plaintext
// SQLite/WAL and protects against leaking the vault blob alone. Derivation is
// identical to the passphrase path, so a later `--passphrase` upgrade can reuse
// the same DEK + root. See docs/adr/0001-passwordless-default.md.
export const LOCAL_KEY_FORMAT = 'memoring-key-v0';

export interface LocalKeyFile {
  format: typeof LOCAL_KEY_FORMAT;
  dek_id: string;
  dek: string; // base64 raw DEK (local key file, 0600, only)
  root_secret: string; // base64 raw root secret R (realm_key derives from this)
  created_at: string;
}

/** init (default mode): generate an unwrapped local key (no passphrase, no recovery code). */
export function createLocalKeyMaterial(now = new Date()): { keyFile: LocalKeyFile; keyring: Keyring } {
  const dek = randomSecret();
  const root = randomSecret();
  const realmRootSecret = hkdf(root, ROOT_INFO);
  const realmKey = hkdf(realmRootSecret, REALM_KEY_INFO);
  const dekId = newId('source');
  const keyFile: LocalKeyFile = {
    format: LOCAL_KEY_FORMAT,
    dek_id: dekId,
    dek: dek.toString('base64'),
    root_secret: root.toString('base64'),
    created_at: now.toISOString(),
  };
  root.fill(0);
  realmRootSecret.fill(0);
  return { keyFile, keyring: new Keyring(dek, realmKey, dekId) };
}

export function unlockFromLocalKey(keyFile: LocalKeyFile): Keyring {
  if (keyFile.format !== LOCAL_KEY_FORMAT) {
    throw new Error(`Unsupported local key format: ${String(keyFile.format)}`);
  }
  const root = Buffer.from(keyFile.root_secret, 'base64');
  const dek = Buffer.from(keyFile.dek, 'base64');
  const realmRootSecret = hkdf(root, ROOT_INFO);
  const realmKey = hkdf(realmRootSecret, REALM_KEY_INFO);
  root.fill(0);
  realmRootSecret.fill(0);
  return new Keyring(dek, realmKey, keyFile.dek_id);
}
