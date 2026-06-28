// A live slash-command menu for the interactive REPL — the Claude Code / Codex
// affordance: typing `/` pops a filtered, description-annotated command list under
// the prompt; ↑/↓ move the selection, Tab/→ completes it, Enter runs the highlighted
// command (while still typing the command word) or submits the buffer, Esc dismisses.
//
// readline can't do this (its ↑/↓ are bound to history), so the interactive input is
// a small raw-mode line reader. It is used ONLY for a TTY; the non-interactive path
// (pipes / tests) keeps using readline. The reader is append-oriented (edits happen at
// the end of the line) which keeps the cursor math trivial.
//
// Rendering uses only RELATIVE cursor moves: draw the input line, draw N menu rows with
// '\n', then move back up with `ESC[N A`. This is scroll-safe — the N line-feeds move
// the cursor down by (N − scrolled) while the input line scrolls up by `scrolled`, so
// `ESC[N A` lands back on it regardless of how near the screen bottom we started (the
// failure mode of absolute DECSC/DECRC, whose saved position goes stale after a scroll).
// The one thing that breaks the row count is a menu row WIDER than the terminal, which
// wraps to two physical lines — so every row is truncated to one column-width.
import readline from 'node:readline';
import type { ChatCommandSpec } from './commands/chat';

const ESC = '\x1b';
const CLEAR_DOWN = `${ESC}[0J`; // clear from cursor to end of screen
const INVERSE = `${ESC}[7m`;
const RESET = `${ESC}[0m`;
const MAX_VISIBLE = 8; // cap rows so the menu never overruns a short terminal

/** Approximate display width (CJK / fullwidth count as 2 columns) so the cursor lands
 *  after the buffer even when the prompt contains a wide-character scope name. */
function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    const wide =
      (c >= 0x1100 && c <= 0x115f) || // Hangul Jamo
      (c >= 0x2e80 && c <= 0xa4cf) || // CJK radicals … Yi
      (c >= 0xac00 && c <= 0xd7a3) || // Hangul syllables
      (c >= 0xf900 && c <= 0xfaff) || // CJK compat
      (c >= 0xfe30 && c <= 0xfe4f) || // CJK compat forms
      (c >= 0xff00 && c <= 0xff60) || // fullwidth forms
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff); // emoji / symbols
    w += wide ? 2 : 1;
  }
  return w;
}

/** The commands that match the current input — only while the user is still typing the
 *  command word (a leading '/' and no space yet). Pure + exported for unit tests. */
export function filterCommands(buffer: string, commands: ChatCommandSpec[]): ChatCommandSpec[] {
  if (!buffer.startsWith('/') || buffer.includes(' ')) return [];
  const q = buffer.slice(1).toLowerCase();
  return commands.filter((c) => c.name.startsWith(q));
}

/** Cut `text` to at most `max` display columns so a menu row never wraps to a second
 *  physical line (which would desync the relative cursor math). Wide chars count as 2. */
function truncateToWidth(text: string, max: number): string {
  let w = 0;
  let out = '';
  for (const ch of text) {
    const cw = displayWidth(ch);
    if (w + cw > max) break;
    out += ch;
    w += cw;
  }
  return out;
}

/** What Enter submits: the highlighted command while the menu is open (the user is still
 *  typing the command word — Claude Code behavior), else the buffer verbatim (prose or a
 *  fully-typed `/cmd args`). Pure + exported so the Enter decision is unit-testable. */
export function resolveEnter(buffer: string, menu: ChatCommandSpec[], sel: number): string {
  const picked = menu[sel];
  return menu.length > 0 && picked ? `/${picked.name}` : buffer;
}

export interface MenuPromptOptions {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  prompt: string;
  commands: ChatCommandSpec[];
  summary: (name: string) => string;
  history: string[];
}

/** Read one line with the live slash menu. Resolves the entered text, or null on
 *  Ctrl-C / Ctrl-D (so the caller can end the session and release the realm lock).
 *  Assumes `input` is already a raw-mode, keypress-emitting TTY (set up once by the
 *  caller); this call only adds/removes its own keypress listener. */
export function promptWithMenu(opts: MenuPromptOptions): Promise<string | null> {
  const { input, output, prompt, commands, summary, history } = opts;
  return new Promise((resolve) => {
    let buffer = '';
    let sel = 0;
    let winStart = 0;
    let menu = filterCommands(buffer, commands);
    let histIdx = history.length;

    const recompute = (): void => {
      menu = filterCommands(buffer, commands);
      if (sel >= menu.length) sel = Math.max(0, menu.length - 1);
    };

    // Redraw the input line + menu IN PLACE. Uses only RELATIVE cursor moves (clear to
    // end of screen, then move up by the number of menu rows drawn) so it stays correct
    // even when drawing the menu scrolls a short terminal — the failure mode of absolute
    // save/restore. The menu is windowed to MAX_VISIBLE rows around the selection.
    const render = (): void => {
      if (menu.length <= MAX_VISIBLE) winStart = 0;
      else if (sel < winStart) winStart = sel;
      else if (sel >= winStart + MAX_VISIBLE) winStart = sel - MAX_VISIBLE + 1;
      const visible = menu.slice(winStart, winStart + MAX_VISIBLE);
      const cols = Math.max(20, output.columns ?? 80);

      output.write(`\r${CLEAR_DOWN}${prompt}${buffer}`);
      for (let i = 0; i < visible.length; i++) {
        const c = visible[i]!;
        const last = i === visible.length - 1 && winStart + visible.length < menu.length;
        const label = `/${c.name}${c.arg ? ` ${c.arg}` : ''}`;
        // Truncate to one physical line so the menu height equals visible.length exactly
        // — otherwise a wrapped row would throw off the `ESC[N A` move back up below.
        const row = truncateToWidth(`  ${label.padEnd(18)}  ${summary(c.name)}${last ? '  …' : ''} `, cols - 1);
        output.write(`\n${winStart + i === sel ? `${INVERSE}${row}${RESET}` : row}`);
      }
      if (visible.length > 0) output.write(`${ESC}[${visible.length}A`); // back up to the input line
      output.write(`\r${ESC}[${displayWidth(prompt) + displayWidth(buffer)}C`); // to just after the buffer
    };

    const finish = (line: string | null): void => {
      input.off('keypress', onKey);
      output.write(`${CLEAR_DOWN}\n`); // cursor is on the input line → clears the menu below it
      resolve(line);
    };

    const onKey = (str: string | undefined, key: readline.Key): void => {
      const name = key?.name;
      if (key?.ctrl && (name === 'c' || name === 'd')) return finish(null); // Ctrl-C / Ctrl-D end the session
      if (name === 'return' || name === 'enter') {
        // Enter RUNS the highlighted command when the menu is open (Claude Code behavior);
        // otherwise submit the buffer as-is. Reflect the resolved command on the input
        // line first so the user sees exactly what ran.
        const line = resolveEnter(buffer, menu, sel);
        if (line !== buffer) {
          buffer = line;
          menu = [];
          render();
        }
        return finish(line);
      }
      if (name === 'escape') {
        menu = [];
        return render();
      }
      // Tab or → completes the input to the highlighted command (with a trailing space so
      // the user can add args); the space closes the menu.
      if (name === 'tab' || name === 'right') {
        if (menu.length > 0) buffer = `/${menu[sel]!.name} `;
        recompute();
        return render();
      }
      // ↑/↓ move the menu selection while the menu is open, else walk input history.
      // History recall keeps the menu CLOSED even when the recalled line is command-
      // shaped (e.g. '/status'), so ↑/↓ keep stepping through history (the readline
      // mental model) instead of being hijacked into menu selection. Editing the line
      // with a printable key reopens the menu via recompute().
      if (name === 'up') {
        if (menu.length > 0) {
          sel = (sel - 1 + menu.length) % menu.length;
          return render();
        }
        if (histIdx > 0) {
          buffer = history[--histIdx] ?? '';
          menu = [];
          sel = 0;
          return render();
        }
        return;
      }
      if (name === 'down') {
        if (menu.length > 0) {
          sel = (sel + 1) % menu.length;
          return render();
        }
        if (histIdx < history.length) {
          histIdx += 1;
          buffer = histIdx === history.length ? '' : history[histIdx] ?? '';
          menu = [];
          sel = 0;
          return render();
        }
        return;
      }
      if (name === 'backspace') {
        buffer = buffer.slice(0, -1);
        recompute();
        return render();
      }
      // A printable character (ignore control/escape sequences).
      if (str && !key?.ctrl && !key?.meta && str.length === 1 && str >= ' ') {
        buffer += str;
        recompute();
        return render();
      }
    };

    input.on('keypress', onKey);
    render();
  });
}
