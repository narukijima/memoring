// Typed persistence over the encrypted DB. Each upsert stores the full entity as
// JSON in `doc` plus the few columns the loop/gate query on. Reads parse `doc`.
import type { Db } from './encrypted-db';
import type {
  Assignment,
  Chronicle,
  Claim,
  ConnectorInstance,
  ContextPack,
  Derivation,
  Label,
  MemEvent,
  Occurrence,
  Project,
  QuarantineRecord,
  SealRule,
  SecretScanResult,
  Session,
  Source,
  Undiluted,
} from '@core/schema/entities';

type Row = Record<string, string | number | null>;
const b = (v: boolean): number => (v ? 1 : 0);

export class Store {
  /** `onWrite` marks the encrypted DB dirty so the next flush persists. Every
   *  mutation funnels through upsert(), so this is the single write hook. */
  constructor(
    private readonly db: Db,
    private readonly onWrite: () => void = () => {},
  ) {}

  private upsert(table: string, row: Row): void {
    const cols = Object.keys(row);
    const placeholders = cols.map((c) => `@${c}`).join(', ');
    this.db
      .prepare(`INSERT OR REPLACE INTO ${table}(${cols.join(', ')}) VALUES (${placeholders})`)
      .run(row);
    this.onWrite();
  }

  private parseDoc<T>(r: { doc: string } | undefined): T | undefined {
    return r ? (JSON.parse(r.doc) as T) : undefined;
  }

  private parseDocs<T>(rows: { doc: string }[]): T[] {
    return rows.map((r) => JSON.parse(r.doc) as T);
  }

  // ── meta ─────────────────────────────────────────────────────────────────
  getMeta(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return r?.value;
  }
  setMeta(key: string, value: string): void {
    this.upsert('meta', { key, value });
  }

  // ── source / project / connector instance / session ───────────────────────
  putSource(s: Source): void {
    this.upsert('source', {
      source_id: s.source_id,
      realm_id: s.realm_id,
      source_stable_key_hmac: s.source_stable_key_hmac,
      source_stable_id: s.source_stable_id,
      doc: JSON.stringify(s),
    });
  }
  findSourceByStableId(realmId: string, stableId: string): Source | undefined {
    return this.parseDoc<Source>(
      this.db
        .prepare('SELECT doc FROM source WHERE realm_id = ? AND source_stable_id = ?')
        .get(realmId, stableId) as { doc: string } | undefined,
    );
  }
  getSource(id: string): Source | undefined {
    return this.parseDoc<Source>(
      this.db.prepare('SELECT doc FROM source WHERE source_id = ?').get(id) as
        | { doc: string }
        | undefined,
    );
  }

  putProject(p: Project): void {
    this.upsert('project', { project_id: p.project_id, realm_id: p.realm_id, name: p.name, doc: JSON.stringify(p) });
  }
  listProjects(realmId: string): Project[] {
    return this.parseDocs<Project>(
      this.db.prepare('SELECT doc FROM project WHERE realm_id = ?').all(realmId) as { doc: string }[],
    );
  }

  putConnectorInstance(ci: ConnectorInstance): void {
    this.upsert('connector_instance', {
      connector_instance_id: ci.connector_instance_id,
      realm_id: ci.realm_id,
      connector_id: ci.connector_id,
      doc: JSON.stringify(ci),
    });
  }
  listConnectorInstances(realmId: string): ConnectorInstance[] {
    return this.parseDocs<ConnectorInstance>(
      this.db.prepare('SELECT doc FROM connector_instance WHERE realm_id = ?').all(realmId) as {
        doc: string;
      }[],
    );
  }

  putSession(s: Session): void {
    this.upsert('session', {
      session_id: s.session_id,
      realm_id: s.realm_id,
      source_id: s.source_id,
      context_injected: b(s.context_injected),
      doc: JSON.stringify(s),
    });
  }
  getSession(id: string): Session | undefined {
    return this.parseDoc<Session>(
      this.db.prepare('SELECT doc FROM session WHERE session_id = ?').get(id) as
        | { doc: string }
        | undefined,
    );
  }

  // ── undiluted / occurrence ─────────────────────────────────────────────────
  putUndiluted(u: Undiluted): void {
    this.upsert('undiluted', {
      undiluted_id: u.undiluted_id,
      realm_id: u.realm_id,
      content_fingerprint: u.content_fingerprint,
      status: u.status,
      doc: JSON.stringify(u),
    });
  }
  findUndilutedByFingerprint(realmId: string, fp: string): Undiluted | undefined {
    return this.parseDoc<Undiluted>(
      this.db
        .prepare('SELECT doc FROM undiluted WHERE realm_id = ? AND content_fingerprint = ?')
        .get(realmId, fp) as { doc: string } | undefined,
    );
  }
  getUndiluted(id: string): Undiluted | undefined {
    return this.parseDoc<Undiluted>(
      this.db.prepare('SELECT doc FROM undiluted WHERE undiluted_id = ?').get(id) as
        | { doc: string }
        | undefined,
    );
  }

  putOccurrence(o: Occurrence): void {
    this.upsert('occurrence', {
      occurrence_id: o.occurrence_id,
      undiluted_id: o.undiluted_id,
      source_id: o.source_id,
      source_cursor: o.source_cursor,
      status: o.status,
      doc: JSON.stringify(o),
    });
  }

  // ── event / secret scan ────────────────────────────────────────────────────
  putEvent(e: MemEvent): void {
    this.upsert('event', {
      event_id: e.event_id,
      event_identity: e.event_identity,
      realm_id: e.realm_id,
      session_id: e.session_id,
      origin: e.origin,
      sequence: e.sequence,
      sensitivity: e.sensitivity,
      sensitivity_state: e.sensitivity_classification_state,
      context_injected: b(e.context_injected),
      status: e.status,
      doc: JSON.stringify(e),
    });
  }
  getEvent(id: string): MemEvent | undefined {
    return this.parseDoc<MemEvent>(
      this.db.prepare('SELECT doc FROM event WHERE event_id = ?').get(id) as
        | { doc: string }
        | undefined,
    );
  }
  findEventByIdentity(realmId: string, identity: string): MemEvent | undefined {
    return this.parseDoc<MemEvent>(
      this.db
        .prepare('SELECT doc FROM event WHERE realm_id = ? AND event_identity = ?')
        .get(realmId, identity) as { doc: string } | undefined,
    );
  }
  listEvents(realmId: string): MemEvent[] {
    return this.parseDocs<MemEvent>(
      this.db
        .prepare("SELECT doc FROM event WHERE realm_id = ? AND status = 'active' ORDER BY sequence")
        .all(realmId) as { doc: string }[],
    );
  }

  putSecretScan(s: SecretScanResult): void {
    this.upsert('secret_scan', {
      secret_scan_id: s.secret_scan_id,
      event_id: s.event_id,
      secret_scan_passed: b(s.secret_scan_passed),
      secret_detected: b(s.secret_detected),
      doc: JSON.stringify(s),
    });
  }
  getSecretScanForEvent(eventId: string): SecretScanResult | undefined {
    return this.parseDoc<SecretScanResult>(
      this.db.prepare('SELECT doc FROM secret_scan WHERE event_id = ?').get(eventId) as
        | { doc: string }
        | undefined,
    );
  }

  // ── label / assignment ─────────────────────────────────────────────────────
  putLabel(l: Label): void {
    this.upsert('label', {
      label_id: l.label_id,
      realm_id: l.realm_id,
      normalized_key: l.normalized_key,
      state: l.state,
      doc: JSON.stringify(l),
    });
  }
  findLabelByNormalizedKey(realmId: string, key: string): Label | undefined {
    return this.parseDoc<Label>(
      this.db
        .prepare('SELECT doc FROM label WHERE realm_id = ? AND normalized_key = ?')
        .get(realmId, key) as { doc: string } | undefined,
    );
  }
  getLabel(id: string): Label | undefined {
    return this.parseDoc<Label>(
      this.db.prepare('SELECT doc FROM label WHERE label_id = ?').get(id) as
        | { doc: string }
        | undefined,
    );
  }
  listLabels(realmId: string): Label[] {
    return this.parseDocs<Label>(
      this.db.prepare('SELECT doc FROM label WHERE realm_id = ?').all(realmId) as { doc: string }[],
    );
  }

  putAssignment(a: Assignment): void {
    this.upsert('assignment', {
      assignment_id: a.assignment_id,
      realm_id: a.realm_id,
      target_type: a.target_type,
      target_id: a.target_id,
      classification_state: a.classification_state,
      doc: JSON.stringify(a),
    });
  }
  listAssignmentsForTarget(targetType: string, targetId: string): Assignment[] {
    return this.parseDocs<Assignment>(
      this.db
        .prepare('SELECT doc FROM assignment WHERE target_type = ? AND target_id = ?')
        .all(targetType, targetId) as { doc: string }[],
    );
  }

  // ── claim ──────────────────────────────────────────────────────────────────
  putClaim(c: Claim): void {
    this.upsert('claim', {
      claim_id: c.claim_id,
      realm_id: c.realm_id,
      kind: c.kind,
      status: c.status,
      sensitivity: c.sensitivity,
      sensitivity_state: c.sensitivity_classification_state,
      doc: JSON.stringify(c),
    });
  }
  getClaim(id: string): Claim | undefined {
    return this.parseDoc<Claim>(
      this.db.prepare('SELECT doc FROM claim WHERE claim_id = ?').get(id) as
        | { doc: string }
        | undefined,
    );
  }
  listClaimsByStatus(realmId: string, status: string): Claim[] {
    return this.parseDocs<Claim>(
      this.db.prepare('SELECT doc FROM claim WHERE realm_id = ? AND status = ?').all(realmId, status) as {
        doc: string;
      }[],
    );
  }
  listClaims(realmId: string): Claim[] {
    return this.parseDocs<Claim>(
      this.db.prepare('SELECT doc FROM claim WHERE realm_id = ?').all(realmId) as { doc: string }[],
    );
  }

  // ── derivation / context pack ───────────────────────────────────────────────
  putDerivation(d: Derivation): void {
    this.upsert('derivation', { derivation_id: d.derivation_id, realm_id: d.realm_id, doc: JSON.stringify(d) });
  }
  putContextPack(c: ContextPack): void {
    this.upsert('context_pack', {
      context_pack_id: c.context_pack_id,
      realm_id: c.realm_id,
      doc: JSON.stringify(c),
    });
  }

  // ── chronicle ────────────────────────────────────────────────────────────────
  putChronicle(c: Chronicle): void {
    this.upsert('chronicle', {
      chronicle_id: c.chronicle_id,
      realm_id: c.realm_id,
      sequence: c.sequence,
      op_type: c.op_type,
      doc: JSON.stringify(c),
    });
  }
  maxChronicleSequence(realmId: string): number {
    const r = this.db
      .prepare('SELECT MAX(sequence) AS m FROM chronicle WHERE realm_id = ?')
      .get(realmId) as { m: number | null };
    return r.m ?? 0;
  }
  lastChronicleId(realmId: string): string | null {
    const r = this.db
      .prepare('SELECT chronicle_id FROM chronicle WHERE realm_id = ? ORDER BY sequence DESC LIMIT 1')
      .get(realmId) as { chronicle_id: string } | undefined;
    return r?.chronicle_id ?? null;
  }

  // ── seal rule ──────────────────────────────────────────────────────────────
  putSealRule(s: SealRule): void {
    this.upsert('seal_rule', {
      suppression_id: s.suppression_id,
      realm_id: s.realm_id,
      match_type: s.match_type,
      target_signature: s.target_signature,
      active: b(s.active),
      doc: JSON.stringify(s),
    });
  }
  activeSealRulesBySignature(realmId: string, signature: string): SealRule[] {
    return this.parseDocs<SealRule>(
      this.db
        .prepare(
          'SELECT doc FROM seal_rule WHERE realm_id = ? AND target_signature = ? AND active = 1',
        )
        .all(realmId, signature) as { doc: string }[],
    );
  }

  // ── quarantine ──────────────────────────────────────────────────────────────
  putQuarantine(q: QuarantineRecord): void {
    this.upsert('quarantine', {
      quarantine_id: q.quarantine_id,
      realm_id: q.realm_id,
      occurrence_id: q.occurrence_id,
      doc: JSON.stringify(q),
    });
  }
  countQuarantine(realmId: string): number {
    const r = this.db
      .prepare('SELECT COUNT(*) AS c FROM quarantine WHERE realm_id = ?')
      .get(realmId) as { c: number };
    return r.c;
  }
}
