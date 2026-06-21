// Tiny flag parser (no dependency). Supports --key value, --key=value, --flag,
// a `--` end-of-flags terminator (everything after is positional, verbatim), and
// collects positionals under `_`. Free-text commands (claim correct, search,
// forget --pattern) can use `--` so a value that itself starts with `--` is not
// eaten as a flag.
export interface Flags {
  _: string[];
  [key: string]: string | boolean | string[];
}

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--') {
      // End of flags: push the remainder as positionals, untouched.
      for (let j = i + 1; j < argv.length; j++) (flags._ as string[]).push(argv[j]!);
      break;
    }
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
