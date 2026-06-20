// Daemon entry point — a thin wrapper over the resident watch loop so it can be
// launched as its own process (npm run daemon). The loop itself lives in the
// retrieval/intake/claim packages; the daemon just drives it diff-driven.
import { cmdWatch } from '../cli/commands/watch';

cmdWatch(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`Daemon error: ${(err as Error).message}`);
    process.exit(1);
  });
