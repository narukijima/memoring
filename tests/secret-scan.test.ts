import { describe, expect, it } from 'vitest';
import { runSecretScan, scanText } from '@security/secret-scan';
import { allowedSensitivity } from '@core/policy';
import { maxSensitivity } from '@core/schema/enums';

describe('Secret Scan (G3 / CON-007)', () => {
  it('detects common credential shapes', () => {
    expect(scanText('token sk-abc1234567890ABCDEFGHIJ1234567890').detected).toBe(true);
    expect(scanText('AKIAIOSFODNN7EXAMPLE in config').detected).toBe(true);
    expect(scanText('-----BEGIN RSA PRIVATE KEY-----').detected).toBe(true);
    expect(scanText('ghp_0123456789abcdefghijklmnopqrstuvwx').detected).toBe(true);
    expect(scanText('password: "hunter2hunter2"').detected).toBe(true);
  });

  it('detects credential shapes that previously slipped through (fail-open closed)', () => {
    // Underscore-prefixed SaaS keys (the sk- rule required a hyphen).
    expect(scanText(`STRIPE_SECRET=sk_live_${'A'.repeat(24)}`).detected).toBe(true);
    expect(scanText('key rk_test_0123456789ABCDEFGHIJ').detected).toBe(true);
    // Unquoted secret assignments (the generic rule required quotes).
    expect(scanText('password=hunter2hunter2longenough').detected).toBe(true);
    expect(scanText('DATABASE_PASSWORD=hunter2hunter2longenough').detected).toBe(true);
    expect(scanText('MY_ACCESS_TOKEN=abcdefghijklmnopqrstuvwxyz').detected).toBe(true);
    expect(scanText(`OPENAI_API_KEY=sk-proj-${'A'.repeat(48)}`).detected).toBe(true);
    // Connection-string userinfo passwords.
    expect(scanText('DATABASE_URL=postgres://admin:SuperSecret123@db.example.com/app').detected).toBe(true);
    // GitLab / Slack-app tokens.
    expect(scanText('glpat-ABCDEFGHIJKLMNOPQRST in ci').detected).toBe(true);
    expect(scanText('xapp-1-ABCDEFGHIJ-0987654321').detected).toBe(true);
    // Modern hyphenated API-key families and encrypted PEM headers.
    expect(scanText(`sk-proj-${'A'.repeat(48)}`).detected).toBe(true);
    expect(scanText(`sk-svcacct-${'A'.repeat(48)}`).detected).toBe(true);
    expect(scanText('-----BEGIN ENCRYPTED PRIVATE KEY-----').detected).toBe(true);
  });

  it('passes clean text without detection', () => {
    expect(scanText('I prefer 2-space indentation.').detected).toBe(false);
    expect(scanText('we will use postgres://localhost/dev for local work').detected).toBe(false);
    expect(scanText('the password field is required on the form').detected).toBe(false);
  });

  it('records a passed scan with secret_scan_passed=true when clean', () => {
    const r = runSecretScan('evt_1', 'just normal text');
    expect(r.secret_scan_status).toBe('passed');
    expect(r.secret_scan_passed).toBe(true);
    expect(r.secret_detected).toBe(false);
  });

  it('forces secret detection on credential text (event-unit, CON-007)', () => {
    const r = runSecretScan('evt_1', 'here: sk-abc1234567890ABCDEFGHIJ1234567890');
    expect(r.secret_detected).toBe(true);
    expect(r.secret_scan_passed).toBe(true); // scan completed; sensitivity is forced secret upstream
  });

  it('pins the owner-accepted low-default-sensitivity boundary for matched credentials', () => {
    const r = runSecretScan('evt_1', `OPENAI_API_KEY=sk-proj-${'A'.repeat(48)}`);
    expect(r.secret_detected).toBe(true);

    // Current v0 contract: RULES-matched credential shapes force the whole Event
    // to secret upstream. Span masking is OUT-014; unmatched shapes may follow the
    // explicit project default, so the rule set is the fail-open boundary.
    expect(allowedSensitivity('secret', 'ai_tool', 'standard')).toBe(false);
    expect(allowedSensitivity('secret', 'remote_ai_processing', 'standard')).toBe(false);
    expect(allowedSensitivity('secret', 'export', 'standard')).toBe(false);
    expect(allowedSensitivity('secret', 'human_local_view', 'full_access')).toBe(false);
    expect(maxSensitivity('secret', 'internal')).toBe('secret'); // classify.ts never lowers secret
  });

  it('scans a long dotted token in linear time (no connection_string ReDoS)', () => {
    // A pasted dependency tree / dotted class dump with no "://" must not trigger
    // quadratic backtracking in the connection_string rule.
    const huge = 'redis' + '.child'.repeat(11000); // ~66k chars, no scheme separator
    const start = performance.now();
    expect(scanText(huge).detected).toBe(false);
    expect(performance.now() - start).toBeLessThan(250); // linear ~1ms; quadratic would be ~1s
  });

  it('scans a long name-char run before a keyword in linear time (no generic_secret_assign ReDoS)', () => {
    // A long dash/underscore run containing a keyword but with no trailing
    // assignment operator must not backtrack quadratically (bounded {0,40} runs).
    const evil = '-'.repeat(200_000) + 'api_key'; // keyword present, no `=`/value
    const start = performance.now();
    expect(scanText(evil).detected).toBe(false);
    expect(performance.now() - start).toBeLessThan(250); // ~ms bounded; unbounded was ~17s
    // The bound must not cost recall: real assignments are still caught.
    expect(scanText('MY_API_KEY=abcdefghijklmnopqrstuvwx').detected).toBe(true);
    expect(scanText('db_secret: "hunter2hunter2"').detected).toBe(true);
  });

  it('null text is a completed scan with nothing to flag', () => {
    const r = runSecretScan('evt_1', null);
    expect(r.secret_scan_passed).toBe(true);
    expect(r.secret_detected).toBe(false);
  });
});
