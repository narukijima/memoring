// Opaque, time-sortable identifiers. Every entity gets a typed prefix so that
// IDs are self-describing in logs (ids/counts/state only — never payload).
//
// Citations exposed to an AI (clm_ / evt_) are these opaque IDs; v0 does not
// create pack-local alias IDs (OUT-016).
import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(now: number, len = 10): string {
  let t = now;
  let out = '';
  for (let i = len - 1; i >= 0; i--) {
    const mod = t % 32;
    out = CROCKFORD[mod] + out;
    t = (t - mod) / 32;
  }
  return out;
}

function encodeRandom(len = 16): string {
  const b = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CROCKFORD[b[i]! & 31];
  return out;
}

/** Crockford base32 ULID-like token: 48-bit time prefix + 80-bit randomness. */
export function ulid(now = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export const ID_PREFIX = {
  realm: 'realm',
  undiluted: 'und',
  occurrence: 'occ',
  event: 'evt',
  session: 'ses',
  turn: 'turn',
  label: 'lbl',
  assignment: 'asg',
  claim: 'clm',
  derivation: 'der',
  contextPack: 'ctx',
  artifact: 'art',
  chronicle: 'chr',
  sealRule: 'seal',
  source: 'src',
  project: 'proj',
  connectorInstance: 'ci',
  policy: 'pol',
  tombstone: 'tomb',
  quarantine: 'quar',
  secretScan: 'scan',
  job: 'job',
} as const;

export type EntityKind = keyof typeof ID_PREFIX;

export function newId(kind: EntityKind, now = Date.now()): string {
  return `${ID_PREFIX[kind]}_${ulid(now)}`;
}
