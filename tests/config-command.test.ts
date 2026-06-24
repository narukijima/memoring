import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cmdConfig } from '../apps/cli/commands/config';
import { createReplicaAtRoot } from '../apps/cli/commands/init';
import { replicaLayout } from '@core/paths';
import { readRealmConfig } from '@core/realm';

describe('memoring config local-model', () => {
  const savedHome = process.env.MEMORING_HOME;
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-config-'));
    process.env.MEMORING_HOME = root;
    createReplicaAtRoot({ root, name: 'default', usePassphrase: false });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedHome === undefined) delete process.env.MEMORING_HOME;
    else process.env.MEMORING_HOME = savedHome;
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
});
