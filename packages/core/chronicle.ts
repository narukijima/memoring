// Append-only operation log. `sequence` is the monotonic intra-Realm order and
// the primary signal for supersede ordering (does not trust source timestamps,
// Detailed Design §1.7 / §4.16).
import { hmacHex } from '@security/crypto-primitives';
import type { Store } from '@storage/repositories';
import { newId } from './schema/ids';
import { SCHEMA_VERSION } from './schema/versions';
import type { ChronicleOpType } from './schema/enums';
import type { Chronicle } from './schema/entities';

export class Chronicler {
  constructor(
    private readonly store: Store,
    private readonly realmId: string,
    private readonly realmKey: Buffer,
  ) {}

  append(opType: ChronicleOpType, targetRef: string, now = new Date()): Chronicle {
    const sequence = this.store.maxChronicleSequence(this.realmId) + 1;
    const prev = this.store.lastChronicleId(this.realmId);
    const entry: Chronicle = {
      chronicle_id: newId('chronicle', now.getTime()),
      realm_id: this.realmId,
      sequence,
      prev_chronicle_id: prev,
      op_type: opType,
      target_ref: targetRef,
      payload_digest: hmacHex(this.realmKey, `${opType}\x1f${targetRef}\x1f${sequence}`),
      created_at: now.toISOString(),
      schema_version: SCHEMA_VERSION.chronicle,
    };
    this.store.putChronicle(entry);
    return entry;
  }

  nextSequence(): number {
    return this.store.maxChronicleSequence(this.realmId) + 1;
  }
}
