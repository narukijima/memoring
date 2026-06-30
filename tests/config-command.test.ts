import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cmdConfig } from '../apps/cli/commands/config';
import { cmdModels } from '../apps/cli/commands/models';
import { createReplicaAtRoot } from '../apps/cli/commands/init';
import { replicaLayout } from '@core/paths';
import { readRealmConfig, writeRealmConfig } from '@core/realm';

describe('memoring config local-model', () => {
  const savedHome = process.env.MEMORING_HOME;
  const savedProxy = process.env.MEMORING_LLM_PROXY;
  let root: string;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-config-'));
    process.env.MEMORING_HOME = root;
    createReplicaAtRoot({ root, name: 'default', usePassphrase: false });
    logs = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => logs.push(args.map(String).join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => errors.push(args.map(String).join(' ')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedHome === undefined) delete process.env.MEMORING_HOME;
    else process.env.MEMORING_HOME = savedHome;
    if (savedProxy === undefined) delete process.env.MEMORING_LLM_PROXY;
    else process.env.MEMORING_LLM_PROXY = savedProxy;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('persists a loopback local model in realm.toml without opening the encrypted DB', async () => {
    const code = await cmdConfig([
      'set',
      'local-model',
      '--base-url',
      'http://127.0.0.1:11434/v1',
      '--model',
      'gemma4:latest',
    ]);
    expect(code).toBe(0);

    const config = readRealmConfig(replicaLayout(root).realmToml);
    expect(config.llm).toEqual({
      base_url: 'http://127.0.0.1:11434/v1',
      model: 'gemma4:latest',
      egress: 'local',
    });
  });

  it('refuses to persist a non-loopback URL through local-model', async () => {
    const code = await cmdConfig([
      'set',
      'local-model',
      '--base-url',
      'https://api.example.com/v1',
      '--model',
      'remote-model',
    ]);
    expect(code).toBe(1);
    expect(readRealmConfig(replicaLayout(root).realmToml).llm).toBeUndefined();
  });

  it('clears the local model config', async () => {
    await cmdConfig([
      'set',
      'local-model',
      '--base-url',
      'http://127.0.0.1:11434/v1',
      '--model',
      'gemma4:latest',
    ]);
    expect(await cmdConfig(['unset', 'local-model'])).toBe(0);
    expect(readRealmConfig(replicaLayout(root).realmToml).llm).toBeUndefined();
  });

  it('validates config metadata without leaking forbidden secret values', async () => {
    fs.appendFileSync(
      replicaLayout(root).realmToml,
      [
        '',
        '[llm]',
        'base_url = "http://127.0.0.1:11434/v1"',
        'model = "gemma4:latest"',
        'api_key = "SECRET_SENTINEL_SHOULD_NOT_PRINT"',
        '',
      ].join('\n'),
    );

    expect(await cmdConfig(['validate'])).toBe(1);
    const output = [...logs, ...errors].join('\n');
    expect(output).toContain('forbidden secret-like key llm.api_key');
    expect(output).not.toContain('SECRET_SENTINEL_SHOULD_NOT_PRINT');
  });

  it('validates connector config files without printing secret values', async () => {
    const connectorFile = path.join(replicaLayout(root).connectorsDir, 'sample.json');
    fs.writeFileSync(connectorFile, JSON.stringify({ token: 'CONNECTOR_SECRET_SENTINEL' }));

    expect(await cmdConfig(['validate'])).toBe(1);
    const output = [...logs, ...errors].join('\n');
    expect(output).toContain('connector config sample.json contains forbidden secret-like key token');
    expect(output).not.toContain('CONNECTOR_SECRET_SENTINEL');
  });

  it('shows loop and output model status without opening the encrypted DB', async () => {
    const config = readRealmConfig(replicaLayout(root).realmToml);
    config.llm = {
      base_url: 'https://api.example.com/v1',
      model: 'remote-model',
      egress: 'remote',
    };
    writeRealmConfig(replicaLayout(root).realmToml, config);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(await cmdModels(['status'])).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('loop/classifier');
    expect(output).toContain('ask/chat/output');
    expect(output).toContain('/models        : skipped (not a loopback endpoint)');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not list models through proxy mode even when the configured URL is loopback', async () => {
    const config = readRealmConfig(replicaLayout(root).realmToml);
    config.llm = {
      base_url: 'http://127.0.0.1:8787/v1',
      model: 'proxy-model',
      egress: 'local',
    };
    writeRealmConfig(replicaLayout(root).realmToml, config);
    process.env.MEMORING_LLM_PROXY = '1';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(await cmdModels(['status'])).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('local/remote   : remote (loopback)');
    expect(output).toContain('/models        : skipped (proxy mode is remote egress)');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
