import { describe, expect, it } from 'vitest';
import {
  allowedScopeState,
  allowedSensitivity,
  allowedSensitivityState,
  gate,
  type GateItem,
  type GateRequest,
} from '@core/policy';

function item(overrides: Partial<GateItem> = {}): GateItem {
  return {
    kind: 'claim',
    id: 'clm_x',
    captured: true,
    deleted: false,
    redacted: false,
    suppressed: false,
    conflicted: false,
    labelIds: ['lbl_a'],
    scopeState: 'inferred',
    sensitivity: 'internal',
    sensitivityState: 'inferred',
    hasRequiredProvenance: true,
    selfGeneratedContext: false,
    ...overrides,
  };
}

const req = (o: Partial<GateRequest> = {}): GateRequest => ({
  audience: 'ai_tool',
  aperture: 'standard',
  activeLabelIds: ['lbl_a'],
  ...o,
});

describe('allowedSensitivity — hard floor (G5)', () => {
  it('secret raw is never allowed at any aperture / audience', () => {
    for (const ap of ['strict', 'standard', 'permissive', 'full_access'] as const) {
      for (const au of ['ai_tool', 'remote_ai_processing', 'export', 'human_local_view'] as const) {
        expect(allowedSensitivity('secret', au, ap, true)).toBe(false);
      }
    }
  });
  it('unknown is never allowed', () => {
    expect(allowedSensitivity('unknown', 'ai_tool', 'standard')).toBe(false);
    expect(allowedSensitivity('unknown', 'human_local_view', 'full_access')).toBe(false);
  });
  it('confidential is dropped under strict/standard, permissive only with one-shot confirm', () => {
    expect(allowedSensitivity('confidential', 'ai_tool', 'standard')).toBe(false);
    expect(allowedSensitivity('confidential', 'ai_tool', 'strict')).toBe(false);
    expect(allowedSensitivity('confidential', 'ai_tool', 'permissive', false)).toBe(false);
    expect(allowedSensitivity('confidential', 'ai_tool', 'permissive', true)).toBe(true);
  });
  it('public/internal pass under standard', () => {
    expect(allowedSensitivity('public', 'ai_tool', 'standard')).toBe(true);
    expect(allowedSensitivity('internal', 'ai_tool', 'standard')).toBe(true);
  });
});

describe('allowedScopeState / allowedSensitivityState', () => {
  it('candidate scope allowed at standard, not at strict', () => {
    expect(allowedScopeState('candidate', 'ai_tool', 'standard')).toBe(true);
    expect(allowedScopeState('candidate', 'ai_tool', 'strict')).toBe(false);
  });
  it('external audiences require inferred/confirmed', () => {
    expect(allowedScopeState('candidate', 'remote_ai_processing', 'standard')).toBe(false);
    expect(allowedSensitivityState('candidate', 'export', 'standard')).toBe(false);
    expect(allowedSensitivityState('inferred', 'export', 'standard')).toBe(true);
  });
});

describe('gate predicate (G3/G4)', () => {
  it('passes a well-formed in-scope internal claim', () => {
    expect(gate(item(), req()).pass).toBe(true);
  });
  it('drops unclassified (no scope state) before sensitivity judgment', () => {
    const r = gate(item({ scopeState: null }), req());
    expect(r.pass).toBe(false);
    expect(r.failed).toContain('classified');
  });
  it('drops secret claims', () => {
    expect(gate(item({ sensitivity: 'secret' }), req()).failed).toContain('allowed_sensitivity');
  });
  it('drops unknown claims', () => {
    expect(gate(item({ sensitivity: 'unknown' }), req()).failed).toContain('allowed_sensitivity');
  });
  it('drops out-of-active-scope claims', () => {
    expect(gate(item({ labelIds: ['lbl_other'] }), req()).failed).toContain('active_scope_match');
  });
  it('drops conflicted claims from normal recall', () => {
    expect(gate(item({ conflicted: true }), req()).failed).toContain('not_conflicted_for_request');
  });
  it('drops suppressed (sealed) claims', () => {
    expect(gate(item({ suppressed: true }), req()).failed).toContain('not_suppressed');
  });
  it('drops self-generated context as evidence', () => {
    expect(gate(item({ selfGeneratedContext: true }), req()).failed).toContain(
      'not_self_generated_context_as_evidence',
    );
  });
});
