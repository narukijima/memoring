// Tiny flag parser (no dependency). Supports --key value, --key=value, --flag,
// and collects positionals under `_`.
export interface Flags {
  _: string[];
  [key: string]: string | boolean | string[];
}

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
    } else {
      (flags._ as string[]).push(token);
    }
  }
  return flags;
}
