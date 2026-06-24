import type { ActiveRealmSilence } from '@core/runtime';

export function printActiveRealmSilence(result: ActiveRealmSilence, exitCode = 0): number {
  console.error(`  ${result.silence}.`);
  console.error('  Specify --realm <id|name> or run inside a registered project.');
  return exitCode;
}
