import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cmdRealm } from '../apps/cli/commands/realm';
import { createReplicaAtRoot } from '../apps/cli/commands/init';
import { cmdSearch } from '../apps/cli/commands/search';
import { addRealm, ensureLegacyRegistered, listRealms, readRegistry, writeRegistry } from '@core/realm-registry';
import { basePath, registryPath, replicaLayout } from '@core/paths';
import { isActiveRealmSilence, openActiveRealm, openRealmLocal, resolveActiveReplicaRoot } from '@core/runtime';
import { readRealmConfig, writeRealmConfig } from '@core/realm';
import { newId } from '@core/schema/ids';
import { SCHEMA_VERSION } from '@core/schema/versions';
import { normalizeLabel } from '@core/label-normalize';
import { realmHmac } from '@security/crypto-primitives';
import { runSecretScan } from '@security/secret-scan';
import { eventIdentity, sessionIdentity, sourceIdentity } from '@intake/identity';
import { indexEvent } from '@retrieval/search';
import type { Assignment, Label, MemEvent } from '@core/schema/entities';

const noPass = async () => '';

describe('multi-Realm registry and CLI management', () => {
  const env = { ...process.env };
  const cwd = process.cwd();
  let tmp: string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-realms-'));
    process.env.MEMORING_HOME = path.join(tmp, 'home');
    delete process.env.MEMORING_PASSPHRASE;
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...env };
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reads and writes the registry with private permissions and duplicate-name lookup errors', () => {
    const base = basePath();
    const rootA = path.join(base, 'realms', 'a');
    const rootB = path.join(base, 'realms', 'b');
    addRealm({ name: 'dup', realm_id: 'realm_a', root: rootA, created_at: '2026-01-01T00:00:00.000Z', key_mode: 'local' }, base);
    addRealm({ name: 'dup', realm_id: 'realm_b', root: rootB, created_at: '2026-01-02T00:00:00.000Z', key_mode: 'local' }, base);

    expect(listRealms(base)).toHaveLength(2);
    expect(fs.statSync(base).mode & 0o777).toBe(0o700);
    expect(fs.statSync(registryPath(base)).mode & 0o777).toBe(0o600);

    const resolved = resolveActiveReplicaRoot({
      flags: { realm: 'dup' },
      cwd: tmp,
      commandClass: 'recall',
      base,
    });
    expect(isActiveRealmSilence(resolved)).toBe(true);
    expect(isActiveRealmSilence(resolved) ? resolved.silence : '').toContain('Multiple registered Realms');
  });

  it('does not let a torn registry brick direct replica access', async () => {
    const base = basePath();
    const created = createReplicaAtRoot({ root: base, name: 'legacy', usePassphrase: false });
    fs.writeFileSync(registryPath(base), '[[realms]\nnot valid toml', { mode: 0o600 });

    const resolved = resolveActiveReplicaRoot({ flags: {}, cwd: tmp, commandClass: 'recall', base });
    expect(resolved).toBe(base);
    const ctx = await openActiveRealm(base, noPass);
    try {
      expect(ctx.realmId).toBe(created.config.realm_id);
    } finally {
      ctx.close(false);
    }
  });

  it('auto-registers a legacy direct replica exactly once', () => {
    const base = basePath();
    const created = createReplicaAtRoot({ root: base, name: 'legacy-name', usePassphrase: false });

    ensureLegacyRegistered(base);
    ensureLegacyRegistered(base);

    const realms = listRealms(base);
    expect(realms).toHaveLength(1);
    expect(realms[0]).toMatchObject({
      name: 'default',
      realm_id: created.config.realm_id,
      root: base,
      key_mode: 'local',
    });

    writeRegistry({
      current: created.config.realm_id,
      realms: [{ ...realms[0]!, root: path.join(tmp, 'old-restore-source') }],
    }, base);
    ensureLegacyRegistered(base);
    expect(listRealms(base)).toHaveLength(1);
    expect(listRealms(base)[0]!.root).toBe(base);
  });

  it('creates, lists, switches, renames, and removes Realm directories', async () => {
    const base = basePath();
    expect(await cmdRealm(['new', 'alpha'])).toBe(0);
    expect(await cmdRealm(['new', 'beta'])).toBe(0);
    expect(readRegistry(base).realms.map((r) => r.name)).toEqual(['alpha', 'beta']);

    logs.length = 0;
    expect(await cmdRealm(['list', '--stats'])).toBe(0);
    expect(logs.join('\n')).toContain('claims=0');

    expect(await cmdRealm(['use', 'alpha'])).toBe(0);
    expect(await cmdRealm(['current'])).toBe(0);
    expect(logs.join('\n')).toContain('Current Realm: alpha');

    const alpha = readRegistry(base).realms.find((r) => r.name === 'alpha')!;
    expect(await cmdRealm(['rename', 'alpha', 'alpha-renamed'])).toBe(0);
    expect(readRealmConfig(replicaLayout(alpha.root).realmToml).name).toBe('alpha-renamed');

    const beta = readRegistry(base).realms.find((r) => r.name === 'beta')!;
    expect(await cmdRealm(['rm', 'beta', '--yes'])).toBe(0);
    expect(fs.existsSync(beta.root)).toBe(false);
    expect(readRegistry(base).realms.some((r) => r.realm_id === beta.realm_id)).toBe(false);
    expect(fs.readFileSync(path.join(base, 'logs', 'audit.log'), 'utf8')).toContain('"op":"realm_rm"');
    expect(() => openRealmLocal(beta.root)).toThrow(/No Memoring replica/);

    expect(await cmdRealm(['rm', 'alpha-renamed', '--yes'])).toBe(1);
    expect(errors.join('\n')).toContain('last registered Realm');
  });
});

describe('multi-Realm active resolution', () => {
  const env = { ...process.env };
  const cwd = process.cwd();
  let tmp: string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-resolution-'));
    process.env.MEMORING_HOME = path.join(tmp, 'home');
    delete process.env.MEMORING_PASSPHRASE;
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...env };
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('uses --realm, direct MEMORING_HOME, CWD unique match, then Silence for recall commands', async () => {
    const base = basePath();
    const projectA = path.join(tmp, 'project-a');
    const projectB = path.join(tmp, 'project-b');
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(projectA, { recursive: true });
    fs.mkdirSync(projectB, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });

    const realmA = createSearchRealm(path.join(base, 'realms', 'a'), 'alpha', projectA, 'alpha unique memory');
    const realmB = createSearchRealm(path.join(base, 'realms', 'b'), 'beta', projectB, 'beta unique memory');
    addRealm(registryEntry(realmA), base);
    addRealm(registryEntry(realmB), base);
    writeRegistry({ ...readRegistry(base), current: realmA.config.realm_id }, base);

    process.chdir(outside);
    expect(await cmdSearch(['alpha', 'unique', '--realm', 'alpha', '--scope', 'alpha'])).toBe(0);
    expect(logs.join('\n')).toContain('alpha unique memory');

    logs.length = 0;
    process.chdir(projectB);
    expect(await cmdSearch(['beta', 'unique'])).toBe(0);
    expect(logs.join('\n')).toContain('beta unique memory');
    expect(logs.join('\n')).not.toContain('alpha unique memory');

    logs.length = 0;
    process.chdir(outside);
    expect(await cmdSearch(['alpha', 'unique'])).toBe(0);
    expect(logs.join('\n')).not.toContain('alpha unique memory');
    expect(errors.join('\n')).toContain('Active Realm unresolved');

    process.env.MEMORING_HOME = realmA.layout.root;
    errors.length = 0;
    const direct = resolveActiveReplicaRoot({
      flags: {},
      cwd: outside,
      commandClass: 'recall',
      base: realmA.layout.root,
    });
    expect(direct).toBe(realmA.layout.root);
  });

  it('watch launch resolution refuses CWD/current inference', () => {
    const base = basePath();
    const project = path.join(tmp, 'watch-project');
    fs.mkdirSync(project, { recursive: true });
    const realm = createSearchRealm(path.join(base, 'realms', 'watch'), 'watch', project, 'watch memory');
    addRealm(registryEntry(realm), base);
    writeRegistry({ ...readRegistry(base), current: realm.config.realm_id }, base);

    const inferred = resolveActiveReplicaRoot({
      flags: {},
      cwd: project,
      commandClass: 'recall',
      explicitOnly: true,
      base,
    });
    expect(isActiveRealmSilence(inferred)).toBe(true);

    const explicit = resolveActiveReplicaRoot({
      flags: { realm: 'watch' },
      cwd: project,
      commandClass: 'recall',
      explicitOnly: true,
      base,
    });
    expect(explicit).toBe(realm.layout.root);
  });
});

function registryEntry(created: ReturnType<typeof createSearchRealm>) {
  return {
    name: created.config.name,
    realm_id: created.config.realm_id,
    root: created.layout.root,
    created_at: created.config.created_at,
    key_mode: created.keyMode,
  } as const;
}

function createSearchRealm(root: string, name: string, projectRoot: string, text: string) {
  const created = createReplicaAtRoot({ root, name, usePassphrase: false });
  const ctx = openRealmLocal(root);
  try {
    const projectId = `proj_${name}`;
    const labelId = `lbl_${name}`;
    ctx.config.projects.push({
      project_id: projectId,
      name,
      root_paths: [projectRoot],
      git_remotes: [],
      default_sensitivity: 'internal',
    });
    const label: Label = {
      label_id: labelId,
      realm_id: ctx.realmId,
      canonical_name: name,
      normalized_key: realmHmac(ctx.realmKey, normalizeLabel(name)),
      aliases: [],
      state: 'active',
      merged_into: null,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION.label,
    };
    ctx.store.putLabel(label);

    const src = sourceIdentity(ctx.realmKey, 'test', `${name}-source`);
    const ses = sessionIdentity(ctx.realmKey, src, `${name}-session`);
    const eventId = newId('event');
    const textRef = ctx.objects.put(`${eventId}_text`, Buffer.from(text, 'utf8')).ref;
    const event: MemEvent = {
      event_id: eventId,
      event_identity: eventIdentity(ctx.realmKey, src, ses, `${name}-message`, text),
      realm_id: ctx.realmId,
      occurrence_ids: [newId('occurrence')],
      session_id: `ses_${name}`,
      turn_id: null,
      event_type: 'message',
      role: 'user',
      origin: 'user',
      created_at: new Date().toISOString(),
      source_timestamp: null,
      timestamp_confidence: 'capture_observed',
      sequence: 1,
      text_ref: textRef,
      source_extra_ref: null,
      sensitivity: 'internal',
      sensitivity_classification_state: 'inferred',
      context_injected: false,
      context_pack_digest: null,
      parser_version: 'test.v1',
      status: 'active',
      schema_version: SCHEMA_VERSION.event,
    };
    const assignment: Assignment = {
      assignment_id: newId('assignment'),
      realm_id: ctx.realmId,
      target_type: 'event',
      target_id: eventId,
      label_ids: [labelId],
      project_ids: [projectId],
      classification_state: 'confirmed',
      assigned_by: 'rule:path_git_remote',
      confidence: 1,
      evidence: [event.occurrence_ids[0]!],
      created_by_derivation_id: null,
      created_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION.assignment,
    };
    ctx.store.putEvent(event);
    ctx.store.putSecretScan(runSecretScan(event.event_id, text));
    ctx.store.putAssignment(assignment);
    indexEvent(ctx, event);
    writeRealmConfig(ctx.layout.realmToml, ctx.config);
    ctx.flush();
  } finally {
    ctx.close(true);
  }
  return created;
}
