// Schema versions are pinned from the first commit (Implementation Instructions
// §8.2). The architecture is stable; schemas are versioned (Core Principle 14).
export const SCHEMA_VERSION = {
  undiluted: 'undiluted.v1',
  occurrence: 'occurrence.v1',
  event: 'event.v1',
  session: 'session.v1',
  label: 'label.v1',
  assignment: 'assignment.v1',
  claim: 'claim.v1',
  derivation: 'derivation.v1',
  contextPack: 'contextpack.v1',
  artifact: 'artifact.v1',
  chronicle: 'chronicle.v1',
  sealRule: 'sealrule.v1',
  policy: 'policy.v1',
  secretScanResult: 'secretscanresult.v1',
  quarantine: 'quarantine.v1',
  tombstone: 'tombstone.v1',
  source: 'source.v1',
  project: 'project.v1',
  connectorInstance: 'connectorinstance.v1',
  backfillCandidate: 'backfillcandidate.v1',
  reflectionReport: 'reflectionreport.v1',
  evalReport: 'evalreport.v1',
  rankingMetadata: 'rankingmetadata.v1',
} as const;

/** Bump when the encrypted-DB physical table layout changes. */
export const STORE_FORMAT_VERSION = 2;
