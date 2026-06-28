import fs from 'node:fs';
import path from 'node:path';
import { buildAtlas } from '@retrieval/atlas';
import { isActiveRealmSilence, openResolvedRealm } from '@core/runtime';
import { parseFlags } from '../args';
import { getPassphrase } from '../prompt';
import { printActiveRealmSilence } from './resolve';

function assertSafeAtlasOut(outDir: string): void {
  const resolved = path.resolve(outDir);
  const atlasRoot = path.resolve('.memoring', 'atlas');
  if (resolved !== atlasRoot && !resolved.startsWith(`${atlasRoot}${path.sep}`)) {
    throw new Error('atlas output must stay under .memoring/atlas');
  }
  const memoringDir = path.resolve('.memoring');
  if (fs.existsSync(memoringDir) && fs.lstatSync(memoringDir).isSymbolicLink()) {
    throw new Error('.memoring is a symlink; refusing to write Atlas projection');
  }
}

export async function cmdAtlas(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'build') {
    console.error('Usage: memoring atlas build [--out .memoring/atlas]');
    return 1;
  }
  const flags = parseFlags(rest);
  const out = typeof flags.out === 'string' ? flags.out : '.memoring/atlas';
  try {
    assertSafeAtlasOut(out);
  } catch (err) {
    console.error(`  ${(err as Error).message}`);
    return 1;
  }
  const opened = await openResolvedRealm(flags, getPassphrase);
  if (isActiveRealmSilence(opened)) return printActiveRealmSilence(opened);
  const ctx = opened;
  try {
    const result = buildAtlas(ctx, { outDir: out });
    console.log(`  Atlas built: ${result.files.length} files, ${result.claims} gated claims`);
    console.log(`  Output: ${result.outDir}`);
    console.log('  Derived projection only; can_be_evidence=false.');
    return 0;
  } finally {
    ctx.close(false);
  }
}
