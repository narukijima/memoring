// Logging carries only ids / counts / state — never content payload, secrets,
// or personal data (NFR-004, AGENTS.md security). Keep this the only log path.
type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: string, msg: string, fields?: Fields): void {
  const parts = [`[${level}]`, msg];
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) parts.push(`${k}=${String(v)}`);
    }
  }
  const line = parts.join(' ');
  if (level === 'error' || level === 'warn') console.error(line);
  else console.error(line); // logs go to stderr; stdout is reserved for command output
}

export const log = {
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
  debug: (msg: string, fields?: Fields) => {
    if (process.env.MEMORING_DEBUG) emit('debug', msg, fields);
  },
};
