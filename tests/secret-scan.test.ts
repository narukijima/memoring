import { describe, expect, it } from 'vitest';
import { runSecretScan, scanText } from '@security/secret-scan';

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
    // Connection-string userinfo passwords.
    expect(scanText('DATABASE_URL=postgres://admin:SuperSecret123@db.example.com/app').detected).toBe(true);
    // GitLab / Slack-app tokens.
    expect(scanText('glpat-ABCDEFGHIJKLMNOPQRST in ci').detected).toBe(true);
    expect(scanText('xapp-1-ABCDEFGHIJ-0987654321').detected).toBe(true);
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

  it('null text is a completed scan with nothing to flag', () => {
    const r = runSecretScan('evt_1', null);
    expect(r.secret_scan_passed).toBe(true);
    expect(r.secret_detected).toBe(false);
  });
});
