// Physical table layout for the in-memory SQLite. Each table carries the few
// columns the loop/gate query on, plus a `doc` JSON column holding the full
// entity for fidelity. The whole DB is serialized and AEAD-encrypted at rest,
// so these columns are confidential by construction (no plaintext DB on disk).
export const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS undiluted (
  undiluted_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_undiluted_fp ON undiluted(realm_id, content_fingerprint);

CREATE TABLE IF NOT EXISTS occurrence (
  occurrence_id TEXT PRIMARY KEY, undiluted_id TEXT NOT NULL, source_id TEXT NOT NULL,
  source_cursor TEXT, status TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_occ_source ON occurrence(source_id);

CREATE TABLE IF NOT EXISTS event (
  event_id TEXT PRIMARY KEY, event_identity TEXT NOT NULL, realm_id TEXT NOT NULL,
  session_id TEXT NOT NULL, origin TEXT NOT NULL, sequence INTEGER NOT NULL,
  sensitivity TEXT NOT NULL, sensitivity_state TEXT NOT NULL,
  context_injected INTEGER NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_identity ON event(realm_id, event_identity);
CREATE INDEX IF NOT EXISTS idx_event_seq ON event(realm_id, sequence);

CREATE TABLE IF NOT EXISTS secret_scan (
  secret_scan_id TEXT PRIMARY KEY, event_id TEXT NOT NULL,
  secret_scan_passed INTEGER NOT NULL, secret_detected INTEGER NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_event ON secret_scan(event_id);

CREATE TABLE IF NOT EXISTS label (
  label_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, normalized_key TEXT NOT NULL,
  state TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_label_norm ON label(realm_id, normalized_key);

CREATE TABLE IF NOT EXISTS assignment (
  assignment_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, target_type TEXT NOT NULL,
  target_id TEXT NOT NULL, classification_state TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asg_target ON assignment(target_type, target_id);

CREATE TABLE IF NOT EXISTS claim (
  claim_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, kind TEXT NOT NULL,
  status TEXT NOT NULL, sensitivity TEXT NOT NULL, sensitivity_state TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claim_status ON claim(realm_id, status);

CREATE TABLE IF NOT EXISTS derivation (
  derivation_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_pack (
  context_pack_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact (
  artifact_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chronicle (
  chronicle_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, sequence INTEGER NOT NULL,
  op_type TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chronicle_seq ON chronicle(realm_id, sequence);

CREATE TABLE IF NOT EXISTS seal_rule (
  suppression_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, match_type TEXT NOT NULL,
  target_signature TEXT NOT NULL, active INTEGER NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seal_sig ON seal_rule(realm_id, target_signature, active);

CREATE TABLE IF NOT EXISTS session (
  session_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, source_id TEXT NOT NULL,
  context_injected INTEGER NOT NULL, doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source (
  source_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL,
  source_stable_key_hmac TEXT NOT NULL, source_stable_id TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_stable ON source(realm_id, source_stable_id);

CREATE TABLE IF NOT EXISTS project (
  project_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, name TEXT NOT NULL, doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_instance (
  connector_instance_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL,
  connector_id TEXT NOT NULL, doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quarantine (
  quarantine_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL,
  occurrence_id TEXT NOT NULL, doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tombstone (
  tombstone_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, deleted_ref TEXT NOT NULL, doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY, realm_id TEXT NOT NULL, stage TEXT NOT NULL,
  target_id TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, doc TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(realm_id, state, stage);

-- Search index. Lives INSIDE the encrypted DB blob, so it is encrypted at rest
-- and never written as a plaintext file (NFR-005/008). norm_text powers exact /
-- substring (LIKE), doc_fts powers n-gram (trigram) fallback incl. CJK (NFR-018).
-- index build happens only after Secret Scan; secret/unknown are never indexed.
CREATE TABLE IF NOT EXISTS doc_index (
  ref_id TEXT PRIMARY KEY, ref_type TEXT NOT NULL, realm_id TEXT NOT NULL,
  label_ids TEXT NOT NULL, sensitivity TEXT NOT NULL, scope_state TEXT NOT NULL,
  norm_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_realm ON doc_index(realm_id);
CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(norm_text, ref_id UNINDEXED, tokenize='trigram');
`;
