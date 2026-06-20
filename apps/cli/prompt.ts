// Minimal interactive prompts. Passphrase comes from MEMORING_PASSPHRASE when
// set (headless / tests); otherwise it is read from the TTY with echo muted.
import readline from 'node:readline';

export async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

export async function askHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const rlAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  const original = rlAny._writeToOutput.bind(rl);
  rlAny._writeToOutput = (str: string) => {
    if (muted) {
      // Show the prompt itself, hide the typed characters.
      if (str.includes(question)) original(str);
      return;
    }
    original(str);
  };
  return await new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

export async function getPassphrase(prompt = 'Passphrase: '): Promise<string> {
  const env = process.env.MEMORING_PASSPHRASE;
  if (env) return env;
  return askHidden(prompt);
}
