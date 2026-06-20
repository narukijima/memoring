// `memoring context build` — the main exit. Generates a ContextPack through the
// Gate (Audience × Aperture) and writes .memoring/context.md with a Safety
// Header and signed Ouroboros marker (gates 3–7, 13). Silence when the Active
// Realm or active scope cannot be uniquely resolved (FR-055).
import path from 'node:path';
import { replicaLayout } from '@core/paths';
import { openActiveRealm } from '@core/runtime';
import { resolveActiveRealm } from '@core/realm';
import { buildContext } from '@retrieval/context-pack';
import type { Aperture } from '@core/schema/enums';
import { getPassphrase } from '../prompt';
import { parseFlags } from '../args';

const VALID_APERTURES = new Set<Aperture>(['strict', 'standard', 'permissive']);

export async function cmdContextBuild(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  // `context build` — drop the leading "build" subcommand if present.
  const aperture = (flags.aperture as Aperture) ?? 'standard';
  if (!VALID_APERTURES.has(aperture)) {
    console.error(`Invalid --aperture ${aperture}. Use strict | standard | permissive.`);
    return 1;
  }

  const ctx = await openActiveRealm(replicaLayout().root, getPassphrase);
  try {
    const realm = resolveActiveRealm(ctx.config, flags.realm as string | undefined);
    if (realm === 'silence') {
      console.error('  Silence: could not resolve the Active Realm. Specify --realm <id>.');
      return 2;
    }

    const cwd = process.cwd();
    const outPath = (flags.out as string) ?? path.join('.memoring', 'context.md');
    const result = buildContext(ctx, {
      audience: 'ai_tool',
      aperture,
      purpose: 'coding_agent_session_start',
      scope: flags.scope as string | undefined,
      project: flags.project as string | undefined,
      cwd,
      outPath,
      confidentialConfirmed: flags['confirm-confidential'] === true,
    });

    if (result.kind === 'silence') {
      console.error(`  Silence: ${result.reason}. No context.md emitted.`);
      console.error('  Hint: pass --scope <label> or --project <id>, or run inside a registered project.');
      return 2;
    }
    console.log(`  Wrote ${result.outPath}`);
    console.log(`  Emitted ${result.emitted} claim(s); dropped ${result.dropped} by the Gate.`);
    return 0;
  } finally {
    ctx.close(true);
  }
}
