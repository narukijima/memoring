import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveActiveProjects, type RealmConfig } from '@core/realm';

const tmpDirs: string[] = [];
function tmpGitRepo(remoteUrl: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoring-gitrepo-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(
    path.join(dir, '.git', 'config'),
    `[remote "origin"]\n\turl = ${remoteUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
  );
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function configWith(projects: RealmConfig['projects']): RealmConfig {
  return { schema: 'realm.v1', realm_id: 'realm_x', name: 't', created_at: '', projects, connectors: [] };
}

describe('active scope resolution (Detailed Design §3.4 step 2)', () => {
  it('matches a project by git_remote when the CWD is not under any root_path', () => {
    const remote = 'https://github.com/acme/widgets.git';
    const repo = tmpGitRepo(remote);
    const config = configWith([
      { project_id: 'proj_a', name: 'widgets', root_paths: ['/nonexistent/elsewhere'], git_remotes: [remote] },
    ]);
    const res = resolveActiveProjects(config, { cwd: repo });
    expect(res.kind).toBe('resolved');
    if (res.kind !== 'resolved') return;
    expect(res.projectIds).toEqual(['proj_a']);
  });

  it('Silences when neither root_path nor git_remote matches', () => {
    const repo = tmpGitRepo('https://github.com/acme/other.git');
    const config = configWith([
      { project_id: 'proj_a', name: 'widgets', root_paths: ['/nonexistent/elsewhere'], git_remotes: ['https://github.com/acme/widgets.git'] },
    ]);
    expect(resolveActiveProjects(config, { cwd: repo }).kind).toBe('silence');
  });
});
