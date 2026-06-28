import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { filterCommands, promptWithMenu, resolveEnter } from '../apps/cli/slash-menu';
import { CHAT_COMMANDS } from '../apps/cli/commands/chat';

describe('slash menu command filtering', () => {
  it('shows all commands for a bare slash', () => {
    expect(filterCommands('/', CHAT_COMMANDS).map((c) => c.name)).toEqual(CHAT_COMMANDS.map((c) => c.name));
  });

  it('filters by prefix as the user types', () => {
    expect(filterCommands('/re', CHAT_COMMANDS).map((c) => c.name)).toEqual(['recent']);
    expect(filterCommands('/s', CHAT_COMMANDS).map((c) => c.name)).toEqual(['status', 'scopes', 'scope', 'sync']);
  });

  it('closes the menu once the command word is finished (a space) or for prose', () => {
    expect(filterCommands('/recent ', CHAT_COMMANDS)).toEqual([]); // past the command word
    expect(filterCommands('hello there', CHAT_COMMANDS)).toEqual([]); // natural-language prose
    expect(filterCommands('', CHAT_COMMANDS)).toEqual([]);
  });

  it('returns nothing for an unmatched prefix', () => {
    expect(filterCommands('/zzz', CHAT_COMMANDS)).toEqual([]);
  });
});

describe('Enter resolution (run highlighted vs submit buffer)', () => {
  it('runs the highlighted command while the menu is open', () => {
    expect(resolveEnter('/', CHAT_COMMANDS, 0)).toBe('/status'); // bare slash → first item
    expect(resolveEnter('/re', filterCommands('/re', CHAT_COMMANDS), 0)).toBe('/recent');
    const sMenu = filterCommands('/s', CHAT_COMMANDS); // status, scopes, scope, sync
    expect(resolveEnter('/s', sMenu, 1)).toBe('/scopes'); // ↓ once then Enter
  });

  it('submits the buffer verbatim once past the command word or for prose', () => {
    expect(resolveEnter('/scope spesan', [], 0)).toBe('/scope spesan');
    expect(resolveEnter('hello there', [], 0)).toBe('hello there');
    expect(resolveEnter('/zzz', filterCommands('/zzz', CHAT_COMMANDS), 0)).toBe('/zzz'); // no match → literal
  });
});

// Drive the raw-mode reader with a fake keypress-emitting TTY (no real terminal). Each
// key is { str, key } as readline.emitKeypressEvents would deliver it.
function ch(c: string): [string, { name: string }] {
  return [c, { name: c }];
}
const ENTER: [undefined, { name: string }] = [undefined, { name: 'return' }];
const TAB: [undefined, { name: string }] = [undefined, { name: 'tab' }];
const UP: [undefined, { name: string }] = [undefined, { name: 'up' }];
const DOWN: [undefined, { name: string }] = [undefined, { name: 'down' }];
const CTRL_C: [undefined, { name: string; ctrl: boolean }] = [undefined, { name: 'c', ctrl: true }];

function drive(keys: Array<[string | undefined, object]>, history: string[] = []): Promise<string | null> {
  const input = new EventEmitter() as EventEmitter & { isTTY?: boolean };
  const output = { columns: 80, write: () => true } as unknown as NodeJS.WriteStream;
  const result = promptWithMenu({
    input: input as unknown as NodeJS.ReadStream,
    output,
    prompt: 'memoring › ',
    commands: CHAT_COMMANDS,
    summary: (n) => `desc-${n}`,
    history,
  });
  for (const [str, key] of keys) input.emit('keypress', str, key);
  return result;
}

describe('interactive reader end-to-end', () => {
  it('bare slash + Enter runs the highlighted command (not the literal /)', async () => {
    expect(await drive([ch('/'), ENTER])).toBe('/status');
  });

  it('filters as you type, then Enter runs the match', async () => {
    expect(await drive([ch('/'), ch('r'), ch('e'), ENTER])).toBe('/recent');
  });

  it('↓ moves the highlight before Enter', async () => {
    expect(await drive([ch('/'), ch('s'), DOWN, ENTER])).toBe('/scopes');
  });

  it('Tab completes to the highlighted command with a trailing space for args', async () => {
    // '/sc' → [scopes, scope]; ↓ highlights `scope`; Tab completes to '/scope ' so args follow.
    expect(await drive([ch('/'), ch('s'), ch('c'), DOWN, TAB, ch('x'), ENTER])).toBe('/scope x');
  });

  it('plain prose submits verbatim', async () => {
    expect(await drive([ch('h'), ch('i'), ENTER])).toBe('hi');
  });

  it('Ctrl-C resolves null so the caller can release the realm lock', async () => {
    expect(await drive([ch('/'), CTRL_C])).toBeNull();
  });

  it('history recall keeps the menu closed so ↓ keeps walking history (not hijacked)', async () => {
    // ↑↑ recalls the command-shaped '/status'; the menu must stay closed so ↓ steps
    // forward to 'prose line' instead of moving a (wrongly reopened) menu selection.
    const out = await drive([UP, UP, DOWN, ENTER], ['/status', 'prose line']);
    expect(out).toBe('prose line');
  });
});

// The render must keep every menu row on ONE physical line — a wrapped row would desync
// the `ESC[N A` move back up and cause the stacking the user saw. Capture the bytes and
// assert no drawn line overflows a narrow terminal.
describe('renderer keeps rows within the terminal width', () => {
  it('truncates long rows so none wrap in a narrow terminal', async () => {
    const input = new EventEmitter();
    const lines: string[] = [];
    const output = {
      columns: 24,
      write: (s: string) => {
        lines.push(s);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const result = promptWithMenu({
      input: input as unknown as NodeJS.ReadStream,
      output,
      prompt: 'memoring › ',
      commands: CHAT_COMMANDS,
      summary: () => 'x'.repeat(80), // long ASCII description that would overflow 24 cols
      history: [],
    });
    input.emit('keypress', '/', { name: 'slash' }); // open the full menu (one render)
    input.emit('keypress', undefined, { name: 'c', ctrl: true }); // close without an extra input-line redraw
    await result;

    // Each '\n'-introduced physical line is one menu row; strip ANSI and assert it fits.
    const physical = lines
      .join('')
      .split('\n')
      .slice(1) // drop the input line (prompt + buffer)
      .map((l) => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, ''));
    for (const row of physical) {
      if (row.includes('x')) expect(row.length).toBeLessThanOrEqual(23); // cols - 1
    }
  });
});
