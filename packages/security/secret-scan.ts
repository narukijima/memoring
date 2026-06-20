// Deterministic event-level Secret Scan (Detailed Design §1.3.3 / §5.4).
// Silence/fail-closed: on undecidable/error, secret_scan_passed=false. On
// detection the whole event is forced to `secret` (CON-007, event-unit; no
// span-level masking in v0, OUT-014). Index build runs only after this scan.
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import type { SecretScanResult } from '@core/schema/entities';

export const SECRET_SCAN_VERSION = 'secretscan.v1';

interface SecretRule {
  id: string;
  re: RegExp;
}

// High-signal credential patterns. Conservative on purpose, but note the
// asymmetry: a false POSITIVE only costs recall (the event is dropped from
// context). A false NEGATIVE fails OPEN — on a project with an explicit
// default_sensitivity=public|internal, a missed secret is raised to that class
// and indexed/egressed (§4.11 floor `contains_secret_span ⇒ secret`). So gaps
// here cost confidentiality, not recall; prefer over-matching credential shapes.
const RULES: SecretRule[] = [
  { id: 'pem_private_key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: 'aws_access_key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'aws_secret_key', re: /\baws_secret_access_key\b\s*[:=]\s*['"]?[A-Za-z0-9/+]{40}\b/i },
  { id: 'openai_key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { id: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  // Underscore-prefixed SaaS keys (Stripe sk_live_/sk_test_/rk_live_, etc.).
  { id: 'underscore_secret_key', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { id: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { id: 'gitlab_token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'slack_token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'slack_app_token', re: /\bxapp-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google_api_key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { id: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
  // URL userinfo password: scheme://user:password@host (postgres://, redis://, …).
  // The scheme atom is length-bounded (schemes are short) so a long dotted token
  // that never reaches "://" cannot trigger quadratic backtracking (ReDoS).
  { id: 'connection_string', re: /\b[a-z][a-z0-9+.-]{0,32}:\/\/[^\s:@/]+:[^\s:@/]{6,}@/i },
  // Secret assignment — quoted (>=8) OR unquoted high-entropy value (>=12 chars).
  { id: 'generic_secret_assign', re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\b\s*[:=]\s*(?:['"][^'"\n]{8,}['"]|[^\s'"]{12,})/i },
];

export interface ScanOutcome {
  detected: boolean;
  matchedRuleIds: string[];
}

/** Pure detection over a piece of text. */
export function scanText(text: string): ScanOutcome {
  const matched: string[] = [];
  for (const rule of RULES) {
    if (rule.re.test(text)) matched.push(rule.id);
  }
  return { detected: matched.length > 0, matchedRuleIds: matched };
}

/**
 * Run the scan for an event. `text` is null when normalization produced no
 * text (e.g. raw-only) — treated as nothing-to-scan but a completed `passed`
 * scan. Throwing during scan would map to status='error' at the call site.
 */
export function runSecretScan(eventId: string, text: string | null, now = new Date()): SecretScanResult {
  let status: SecretScanResult['secret_scan_status'] = 'passed';
  let detected = false;
  try {
    if (text !== null) detected = scanText(text).detected;
  } catch {
    status = 'error';
  }
  return {
    secret_scan_id: newId('secretScan', now.getTime()),
    event_id: eventId,
    secret_scan_status: status,
    secret_scan_passed: status === 'passed',
    secret_detected: detected,
    secret_scan_version: SECRET_SCAN_VERSION,
    created_at: now.toISOString(),
    schema_version: SCHEMA_VERSION.secretScanResult,
  };
}
