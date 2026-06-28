// The panel's HTML shell. Served by GET / (token-exempt, Host-checked) under a
// strict CSP whose script-src admits ONLY this request's nonce, so the bootstrap
// can read the capability token from the URL fragment, strip it from the address
// bar, and present it as an explicit header on every /api/* call. The token lives
// only in this in-memory closure (never localStorage / cookies).
export function renderShell(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Memoring</title>
  <style>
    :root {
      --bg: #0b0c0d;
      --top: #111213;
      --panel: #0f1011;
      --panel-2: #17181a;
      --panel-3: #202224;
      --card: #191b1d;
      --card-hi: #222527;
      --line: rgba(255, 255, 255, 0.075);
      --line-soft: rgba(255, 255, 255, 0.055);
      --line-strong: rgba(94, 227, 176, 0.34);
      --ink: #f4f5f6;
      --ink-dim: #c9cacc;
      --ink-faint: #83858a;
      --green: #35d6a0;
      --green-strong: #5ee3b0;
      --gold: #d9bd72;
      --danger: #df7b69;
      --blue: #8db6ff;
      --shadow: 0 22px 70px rgba(0, 0, 0, 0.42);
      --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif;
      --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      /* One control unit, derived from the sidebar icon button — every icon
         button, text button, input, and tab is sized off these for a unified
         scale. Change here to rescale the whole chrome. */
      --ctrl: 34px;
      --ctrl-radius: 10px;
      --icon: 18px;
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      position: relative;
      margin: 0;
      color: var(--ink);
      background: var(--bg);
      font-family: var(--sans);
      font-size: 13.5px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background:
        linear-gradient(rgba(255,255,255,0.032) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.032) 1px, transparent 1px),
        radial-gradient(120% 75% at 50% -8%, rgba(255,255,255,0.026), transparent 58%);
      background-size: 36px 36px, 36px 36px, auto;
    }
    button, input, textarea, select { font: inherit; }
    button { cursor: pointer; }
    [hidden] { display: none !important; }
    h1, h2, h3, p { margin: 0; }
    ::selection { background: rgba(125,216,189,0.28); }
    body.appearance-light {
      --bg: #f7f8f7;
      --top: #ffffff;
      --panel: #ffffff;
      --panel-2: #ffffff;
      --panel-3: #f1f3f2;
      --card: #ffffff;
      --card-hi: #eff8f4;
      --line: rgba(20, 31, 27, 0.11);
      --line-soft: rgba(20, 31, 27, 0.08);
      --line-strong: rgba(22, 160, 107, 0.35);
      --ink: #16201b;
      --ink-dim: #3a403c;
      --ink-faint: #6b736e;
      --green: #16a06b;
      --green-strong: #0e8054;
      --gold: #9a7616;
      --danger: #c2402a;
      --blue: #2f6bd8;
      --shadow: 0 12px 32px -12px rgba(16,24,20,0.18);
    }

    .app {
      position: relative;
      z-index: 1;
      height: 100vh;
      display: block;
      background: transparent;
      overflow: hidden;
    }
    .logo-img {
      width: 30px;
      height: 30px;
      flex: none;
    }
    /* The collapse toggle is the first item of .side-nav — to the LEFT of the
       chat/memory switch when expanded, and on TOP of it (still first) when
       collapsed. Either way it stays at the side-body's top-left (x12), so it
       never moves between states. */
    .side-nav {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: start;
      gap: 8px;
    }
    .side-collapse {
      width: var(--ctrl);
      height: var(--ctrl);
      flex: none;
      display: grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: var(--ctrl-radius);
      color: var(--ink-dim);
      background: transparent;
    }
    .side-collapse:hover { color: var(--ink); border-color: var(--line-strong); background: rgba(255,255,255,0.05); }
    .side-collapse svg { width: var(--icon); height: var(--icon); display: block; }
    .side-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3px;
      height: var(--ctrl);
      padding: 3px;
      border: 1px solid var(--line-soft);
      border-radius: calc(var(--ctrl-radius) + 1px);
      background: rgba(255,255,255,0.04);
    }
    .side-tab {
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      border: 1px solid transparent;
      border-radius: var(--ctrl-radius);
      color: var(--ink-faint);
      background: transparent;
      padding: 0 8px;
      font-weight: 700;
    }
    .side-tab[aria-current="page"] {
      color: var(--ink);
      background: rgba(255,255,255,0.1);
      border-color: rgba(255,255,255,0.04);
    }
    .nav-ico { width: var(--icon); height: var(--icon); display: none; flex: none; }
    .runtime {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      align-items: center;
      justify-content: stretch;
      gap: 8px;
      min-width: 0;
      padding: 12px;
      border-top: 1px solid var(--line);
      background: rgba(255,255,255,0.018);
    }
    .top-icon {
      width: 100%;
      height: var(--ctrl);
      display: inline-grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: var(--ctrl-radius);
      color: var(--ink-dim);
      background: rgba(255,255,255,0.035);
    }
    .top-icon:hover, .top-icon[aria-pressed="true"] {
      color: var(--green-strong);
      border-color: var(--line-strong);
      background: rgba(53,214,160,0.11);
    }
    .top-icon svg {
      width: var(--icon);
      height: var(--icon);
      display: block;
    }

    .workspace {
      min-height: 0;
      height: 100%;
      display: grid;
      grid-template-columns: 288px minmax(0, 1fr);
      gap: 14px;
      padding: 14px;
      overflow: hidden;
      transition: grid-template-columns .26s cubic-bezier(.4, 0, .2, 1);
    }
    body.sidebar-collapsed .workspace { grid-template-columns: 64px minmax(0, 1fr); }
    .sidebar, .chat-shell {
      min-height: 0;
      border: 0;
      background: var(--panel);
      box-shadow: none;
      overflow: hidden;
    }
    .sidebar {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(15,16,17,0.94);
      box-shadow: var(--shadow);
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
    }
    .chat-shell {
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(15,16,17,0.88);
      box-shadow: var(--shadow);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
    }
    body.appearance-light .sidebar,
    body.appearance-light .chat-shell { background: rgba(255,255,255,0.94); }
    /* The chat-head keeps a faint tint for depth; light mode needs its own value
       (the dark one reads as a gray band). The messages + composer share the
       chat-shell surface (no separate fill), so they need no light override. */
    body.appearance-light .chat-head { background: rgba(16,32,24,0.018); }

    /* Owner-operations panel: a slide-over drawer that overlays the workspace
       from the right without stealing the chat column's width. Toggled by the
       single body.functions-open class (header button, scrim, ✕, and Esc all
       flip it). It sits OUTSIDE the .workspace grid via position:fixed. */
    .functions {
      position: fixed;
      z-index: 7;
      top: 14px;
      right: 14px;
      bottom: 14px;
      width: min(440px, calc(100vw - 28px));
      min-height: 0;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(15,16,17,0.98);
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform: translateX(calc(100% + 28px));
      transition: transform .26s cubic-bezier(.4, 0, .2, 1);
      visibility: hidden;
    }
    body.functions-open .functions {
      transform: none;
      visibility: visible;
    }
    body.appearance-light .functions { background: rgba(255,255,255,0.98); }
    .functions-scrim {
      position: fixed;
      inset: 0;
      z-index: 6;
      background: rgba(0,0,0,0.42);
      opacity: 0;
      pointer-events: none;
      transition: opacity .26s ease;
    }
    body.functions-open .functions-scrim {
      opacity: 1;
      pointer-events: auto;
    }

    .tool-head, .chat-head {
      border-bottom: 1px solid var(--line);
      padding: 12px;
    }
    .tool-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .tool-title h2 {
      font-size: 19px;
      font-weight: 750;
      letter-spacing: 0;
      text-transform: none;
      color: var(--ink);
    }

    .side-mid { min-height: 0; overflow: hidden; display: grid; }
    .side-body {
      min-height: 0;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto auto auto auto minmax(0, 1fr);
      gap: 12px;
      padding: 14px 12px 12px;
      align-content: start;
    }

    .icon-button {
      width: var(--ctrl);
      height: var(--ctrl);
      display: inline-grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: var(--ctrl-radius);
      color: var(--ink-dim);
      background: transparent;
    }
    .icon-button:hover { color: var(--ink); border-color: var(--line-strong); }
    .icon-button svg { width: var(--icon); height: var(--icon); display: block; }
    .rail-icon-svg { width: var(--icon); height: var(--icon); display: block; }

    /* Collapsed: the side-nav stacks (toggle stays first/top, chat+memory below
       it as icons) and the action/search/list rows drop their labels or hide.
       Every control left-aligns at x12, the toggle keeps its 34px size, so the
       toggle holds the exact same spot it had in the expanded row. */
    body.sidebar-collapsed .side-nav { grid-template-columns: 1fr; gap: 7px; }
    body.sidebar-collapsed .side-tabs {
      grid-template-columns: 1fr;
      border: 0;
      background: transparent;
      padding: 0;
      gap: 7px;
    }
    body.sidebar-collapsed .side-tab {
      width: var(--ctrl);
      height: var(--ctrl);
      padding: 0;
      justify-self: start;
      border: 1px solid transparent;
    }
    body.sidebar-collapsed .side-tab[aria-current="page"] {
      border-color: rgba(125,216,189,0.35);
      background: rgba(125,216,189,0.085);
    }
    body.sidebar-collapsed .nav-ico { display: block; }
    body.sidebar-collapsed .nav-label { display: none; }
    body.sidebar-collapsed .quick-action {
      width: var(--ctrl);
      height: var(--ctrl);
      padding: 0;
      justify-content: center;
      justify-self: start;
      box-shadow: none;
    }
    body.sidebar-collapsed .side-search,
    body.sidebar-collapsed .capability-strip,
    body.sidebar-collapsed .collection-scroll { display: none; }
    body.sidebar-collapsed .runtime {
      grid-template-columns: 1fr;
      justify-items: start;
      padding: 10px 12px;
    }
    body.sidebar-collapsed .top-icon {
      width: var(--ctrl);
      justify-self: start;
    }
    .quick-action {
      width: 100%;
      height: var(--ctrl);
      display: flex;
      align-items: center;
      gap: 9px;
      border: 0;
      border-radius: var(--ctrl-radius);
      color: #06140e;
      background: linear-gradient(150deg, #2ad698, #13a673);
      box-shadow: 0 0 18px -3px rgba(42,214,152,0.5);
      padding: 0 11px;
      font-weight: 750;
    }
    .side-search {
      width: 100%;
      height: var(--ctrl);
      color: var(--ink);
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--ctrl-radius);
      padding: 0 11px;
      outline: none;
    }
    .side-search:focus, input:focus, textarea:focus, select:focus {
      border-color: var(--line-strong);
      box-shadow: 0 0 0 3px rgba(125,216,189,0.08);
    }
    .capability-strip {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .cap {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255,255,255,0.03);
    }
    .cap strong { display: block; font-size: 12.5px; font-weight: 750; color: var(--ink); }
    .cap span { display: block; color: var(--ink-faint); font-size: 11px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .collection-scroll {
      min-height: 0;
      overflow: auto;
      padding: 0;
    }
    .collection-list { display: grid; gap: 8px; }
    .collection {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      color: var(--ink-dim);
      background: rgba(255,255,255,0.02);
      padding: 11px;
      text-align: left;
      display: grid;
      gap: 7px;
    }
    .collection:hover, .collection[aria-current="true"] {
      color: var(--ink);
      background: rgba(255,255,255,0.055);
      border-color: var(--line-strong);
    }
    .collection-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .collection-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .collection-meta {
      color: var(--ink-faint);
      font-family: var(--mono);
      font-size: 10.5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .count {
      min-width: 28px;
      text-align: center;
      border-radius: 999px;
      border: 1px solid var(--line);
      padding: 2px 6px;
      font-family: var(--mono);
      font-size: 10.5px;
    }

    .chat-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      background: rgba(11,12,13,0.54);
    }
    .context-title {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .chat-brand-logo { width: 26px; height: 26px; flex: none; display: block; }
    .chat-brand-name {
      font-size: 17px;
      font-weight: 750;
      letter-spacing: 0;
      white-space: nowrap;
      flex: none;
      color: var(--ink);
    }
    .context-path {
      display: flex;
      align-items: baseline;
      gap: 7px;
      min-width: 0;
      padding-left: 6px;
    }
    .path-seg {
      font-size: 15.5px;
      font-weight: 650;
      color: var(--ink-dim);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 30vw;
    }
    .path-dim { color: var(--ink-faint); font-weight: 600; flex: none; max-width: 22vw; }
    .path-sep { color: var(--ink-faint); font-weight: 400; flex: none; }
    .path-message { color: var(--ink-faint); font-weight: 600; max-width: 60vw; }
    .avatar {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      padding: 0;
      border-radius: 50%;
      border: 0;
      background: transparent;
      flex: none;
    }
    .chat-head-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: none;
    }
    .chat-status {
      color: var(--ink-faint);
      font-family: var(--mono);
      font-size: 11px;
      white-space: nowrap;
    }
    .head-action {
      width: var(--ctrl);
      height: var(--ctrl);
      flex: none;
      border-radius: var(--ctrl-radius);
    }
    .head-action svg { width: var(--icon); height: var(--icon); display: block; }
    .head-action[aria-expanded="true"] {
      color: var(--green-strong);
      border-color: var(--line-strong);
      background: rgba(53,214,160,0.11);
    }
    .messages {
      min-height: 0;
      overflow: auto;
      padding: 24px;
      background: transparent;
    }
    .welcome {
      min-height: 100%;
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 0;
      text-align: center;
      padding: 24px;
    }
    .welcome-badge {
      color: var(--green);
      border: 1px solid rgba(125,216,189,0.32);
      background: rgba(255,255,255,0.05);
      border-radius: 999px;
      padding: 7px 13px;
      font-size: 12.5px;
      font-weight: 650;
      margin-bottom: 22px;
    }
    .welcome h2 {
      font-size: 36px;
      line-height: 1.22;
      letter-spacing: 0;
      font-weight: 750;
      max-width: 760px;
    }
    .welcome p {
      color: var(--ink-dim);
      max-width: 620px;
      font-size: 15.5px;
      line-height: 1.7;
      margin-top: 13px;
    }
    .suggestions {
      width: min(600px, 100%);
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 32px;
    }
    .suggestion {
      border: 1px solid var(--line);
      border-radius: 14px;
      color: var(--ink-dim);
      background: rgba(255,255,255,0.025);
      padding: 15px;
      text-align: left;
    }
    .suggestion:hover {
      color: var(--ink);
      border-color: var(--line-strong);
      background: rgba(125,216,189,0.055);
    }
    .thread {
      width: min(840px, 100%);
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }
    .message {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
    }
    .message.user {
      grid-template-columns: minmax(0, 1fr) 34px;
    }
    .message.user .bubble { grid-column: 1; justify-self: end; }
    .message.user .avatar { grid-column: 2; grid-row: 1; padding: 0; color: var(--blue); border-color: rgba(141,182,255,0.28); background: rgba(141,182,255,0.08); border-radius: 9px; font-family: var(--mono); }
    .bubble {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--card);
      padding: 12px 13px;
      min-width: 0;
      max-width: 100%;
    }
    .message.user .bubble {
      background: rgba(141,182,255,0.08);
      border-color: rgba(141,182,255,0.24);
    }
    .bubble-text { white-space: pre-wrap; word-break: break-word; }
    .result-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .result-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(0,0,0,0.18);
      padding: 10px;
      text-align: left;
    }
    .result-card:hover { border-color: var(--line-strong); }
    .result-card[aria-selected="true"] { border-color: var(--green); background: rgba(125,216,189,0.055); }
    .result-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 7px;
    }
    .pill, .label-chip {
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink-dim);
      padding: 2px 6px;
      font-family: var(--mono);
      font-size: 10px;
      white-space: nowrap;
    }
    .pill.kind { color: var(--green); border-color: rgba(125,216,189,0.35); }
    .pill.public { color: var(--green); border-color: rgba(125,216,189,0.35); }
    .pill.internal { color: var(--gold); border-color: rgba(217,189,114,0.4); }
    .pill.confidential, .pill.secret, .pill.unknown { color: var(--danger); border-color: rgba(223,123,105,0.42); }
    .statement { color: var(--ink); font-size: 13.5px; }
    .labels { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }

    /* Composer area floats on the same surface as the messages — no divider line,
       no separate fill. The chips and the input box are two independent rounded
       elements, centered with breathing room so neither touches an outer frame. */
    .composer-wrap {
      background: transparent;
      padding: 4px 24px 18px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .tool-chips {
      width: min(720px, 100%);
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
    }
    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--ink-dim);
      background: rgba(255,255,255,0.03);
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 650;
    }
    .chip.active { color: var(--green); border-color: rgba(125,216,189,0.38); }
    .chip[disabled] { cursor: not-allowed; opacity: 0.52; }
    .composer {
      width: min(720px, 100%);
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      gap: 6px;
      align-items: end;
      border: 1px solid var(--line);
      border-radius: 22px;
      background: var(--panel-2);
      padding: 7px 7px 7px 8px;
      box-shadow: 0 14px 36px -18px rgba(0,0,0,0.65);
    }
    .composer:focus-within { border-color: var(--line-strong); }
    .attach {
      width: var(--ctrl);
      height: var(--ctrl);
      align-self: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--ink-faint);
      font-size: 22px;
      line-height: 1;
      display: grid;
      place-items: center;
    }
    .attach:hover { color: var(--ink); }
    #intentInput {
      width: 100%;
      min-height: var(--ctrl);
      max-height: 180px;
      resize: none;
      overflow: hidden;
      color: var(--ink);
      background: transparent;
      border: 0;
      padding: 8px 4px;
      outline: none;
      font-size: 15px;
      align-self: center;
    }
    #intentInput:focus { box-shadow: none; }
    .send {
      height: var(--ctrl);
      width: var(--ctrl);
      align-self: center;
      border: 0;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: linear-gradient(150deg,#2ad698,#13a673);
      color: #06140e;
      font-weight: 750;
      font-size: 18px;
      box-shadow: 0 4px 14px -5px rgba(42,214,152,0.6);
    }
    .send:hover { filter: brightness(1.08); }
    .send:active { filter: brightness(0.96); }

    /* Model picker: a compact pill on the right of the composer (Codex-style),
       just left of send. Reflects the active Realm's configured model and writes
       the choice back to realm.toml — the SAME config the CLI uses. */
    .model-picker {
      align-self: center;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: var(--ctrl);
      padding: 0 7px 0 9px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255,255,255,0.03);
      color: var(--ink-dim);
      max-width: 168px;
      min-width: 0;
    }
    .model-picker:hover { border-color: var(--line-strong); color: var(--ink); }
    .model-picker.disabled { opacity: 0.6; }
    .model-ico { width: 13px; height: 13px; flex: none; color: var(--green); display: block; }
    .model-caret { width: 13px; height: 13px; flex: none; color: var(--ink-faint); display: block; }
    #modelSelect {
      appearance: none;
      -webkit-appearance: none;
      min-width: 0;
      max-width: 116px;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: inherit;
      padding: 0;
      margin: 0;
      font-family: var(--mono);
      font-size: 12px;
      text-overflow: ellipsis;
      outline: none;
      cursor: pointer;
    }
    #modelSelect:focus { box-shadow: none; }
    #modelSelect option { color: var(--ink); background: var(--panel-2); }

    .tool-head p { color: var(--ink-faint); margin-top: 5px; font-size: 12px; }
    .tool-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 12px;
      display: grid;
      align-content: start;
      gap: 10px;
    }
    .tool-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255,255,255,0.024);
      padding: 12px;
      display: grid;
      gap: 9px;
    }
    .tool-card h3 {
      color: var(--ink-dim);
      font-size: 11.5px;
      font-weight: 650;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    label {
      display: grid;
      gap: 4px;
      color: var(--ink-faint);
      font-size: 10.5px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    input, select, textarea {
      min-width: 0;
      color: var(--ink);
      background: #090c0c;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 9px;
      outline: none;
    }
    textarea { min-height: 86px; resize: vertical; font-family: var(--mono); font-size: 12px; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .act {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: transparent;
      color: var(--ink-dim);
      padding: 8px 10px;
      font-family: var(--mono);
      font-size: 11px;
    }
    .act:hover, .act[aria-pressed="true"] {
      color: var(--ink);
      border-color: var(--line-strong);
      background: rgba(125,216,189,0.06);
    }
    .act.danger { color: var(--danger); border-color: rgba(223,123,105,0.42); }
    .muted, .empty { color: var(--ink-faint); font-size: 12px; }
    .console-out { min-height: 20px; color: var(--ink-dim); white-space: pre-wrap; word-break: break-word; font-family: var(--mono); font-size: 11px; }
    .candidate { display: grid; gap: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-3); padding: 10px; }
    .candidate .stmt { color: var(--ink); font-size: 12.5px; }

    .mobile-drawer {
      display: none;
      position: fixed;
      z-index: 5;
      right: 12px;
      top: 12px;
      width: var(--ctrl);
      height: var(--ctrl);
      border: 1px solid var(--line-strong);
      border-radius: var(--ctrl-radius);
      color: var(--ink);
      background: var(--panel);
    }
    body.functions-open .mobile-drawer { display: none; }

    @media (max-width: 1180px) {
      .workspace { grid-template-columns: 260px minmax(0, 1fr); }
      body.sidebar-collapsed .workspace { grid-template-columns: 64px minmax(0, 1fr); }
      .path-seg { max-width: 24vw; }
    }
    @media (max-width: 820px) {
      .workspace { grid-template-columns: 1fr; padding: 10px; }
      .sidebar {
        display: none;
        position: fixed;
        z-index: 4;
        inset: 10px 10px auto 10px;
        height: min(70vh, 560px);
        border-radius: 10px;
      }
      .sidebar.open { display: grid; }
      .chat-shell { border-radius: 10px; min-height: 0; }
      .chat-shell { margin: 0; }
      .mobile-drawer { display: grid; place-items: center; }
      .chat-head { align-items: flex-start; padding-right: 54px; }
      .chat-status { display: none; }
      .head-action {
        position: fixed;
        top: 12px;
        right: 54px;
        z-index: 5;
        width: var(--ctrl);
        height: var(--ctrl);
        border-color: var(--line-strong);
        background: var(--panel);
      }
      body.functions-open .head-action { display: none; }
      .path-seg { max-width: 40vw; }
      .messages { padding: 16px 12px; }
      .welcome { padding: 10px; align-content: start; padding-top: 56px; }
      .welcome h2 { font-size: 32px; }
      .suggestions { grid-template-columns: 1fr; }
      .message, .message.user { grid-template-columns: 1fr; }
      .message .avatar { display: none; }
      .message.user .bubble { grid-column: 1; justify-self: stretch; }
      .composer-wrap { padding: 6px 10px 12px; }
      #intentInput { font-size: 15px; }
      body.sidebar-collapsed .sidebar { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; scroll-behavior: auto !important; }
    }
  </style>
</head>
<body>
  <button id="mobileDrawer" class="mobile-drawer" type="button" aria-label="Open memory collections" data-i18n-aria="openCollections">☰</button>
  <main class="app">
    <div class="workspace">
      <aside id="sidebar" class="sidebar" aria-label="Memory collections" data-i18n-aria="memoryCollections">
        <div class="side-mid">
          <div class="side-body">
            <nav class="side-nav" aria-label="Switch view" data-i18n-aria="switchView">
              <button id="collapseSide" class="side-collapse" type="button" title="Toggle sidebar" aria-label="Toggle sidebar" data-i18n-title="toggleSidebar" data-i18n-aria="toggleSidebar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/></svg>
              </button>
              <div class="side-tabs">
                <button class="side-tab" type="button" data-side-mode="chat" aria-current="page">
                  <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1.2-4.3A8 8 0 1 1 21 12z"/></svg>
                  <span class="nav-label" data-i18n="navChat">Chat</span>
                </button>
                <button class="side-tab" type="button" data-side-mode="memory">
                  <svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M19 18H6a2 2 0 0 0-2 2"/></svg>
                  <span class="nav-label" data-i18n="navMemory">Memory</span>
                </button>
              </div>
            </nav>
            <button id="quickAction" class="quick-action" type="button">
              <svg class="rail-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              <span id="quickActionText" class="nav-label">New chat</span>
            </button>
            <input id="collectionSearch" class="side-search" type="search" placeholder="Search chats">
            <section class="capability-strip" aria-label="What you can do" data-i18n-aria="capStripAria">
              <div class="cap"><div><strong data-i18n="capGated">Gated</strong><span id="sidebarGateCount">Loading</span></div></div>
              <div class="cap"><div><strong data-i18n="capLocal">Local</strong><span data-i18n="capOwnerView">Owner view</span></div></div>
            </section>
            <section class="collection-scroll">
              <div id="collectionList" class="collection-list"></div>
            </section>
          </div>
        </div>
        <div class="runtime" aria-label="Runtime safeguards" data-i18n-aria="runtimeSafeguards">
          <button id="searchToggle" class="top-icon" type="button" title="Search" aria-label="Search" data-i18n-title="search" data-i18n-aria="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          </button>
          <button id="statusToggle" class="top-icon" type="button" title="Status" aria-label="Status" data-i18n-title="status" data-i18n-aria="status">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-3"/></svg>
          </button>
          <button id="appearanceToggle" class="top-icon" type="button" title="Toggle appearance" aria-label="Toggle appearance" data-i18n-aria="toggleAppearance" aria-pressed="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
          </button>
          <button id="languageToggle" class="top-icon" type="button" title="Switch language" aria-label="Switch language" data-i18n-aria="switchLanguage" aria-pressed="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>
          </button>
        </div>
      </aside>

      <section class="chat-shell" aria-label="Memoring chat">
        <header class="chat-head">
          <div class="context-title">
            <img class="chat-brand-logo" src="/assets/memoring-ring.svg" alt="" aria-hidden="true">
            <span class="chat-brand-name">Memoring</span>
            <div class="context-path">
              <span id="screenRealm" class="path-seg path-dim">default</span>
              <span id="screenPathSep" class="path-sep" aria-hidden="true">/</span>
              <h2 id="screenTitle" class="path-seg">Loading</h2>
            </div>
          </div>
          <div class="chat-head-actions">
            <div id="status" class="chat-status"></div>
            <button id="openFunctions" class="icon-button head-action" type="button" title="Functions (owner operations)" aria-label="Open functions" data-i18n-title="functionsOwner" data-i18n-aria="openFunctions" aria-expanded="false" aria-controls="functionsPanel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2.1"/><circle cx="15" cy="12" r="2.1"/><circle cx="9" cy="18" r="2.1"/></svg>
            </button>
          </div>
        </header>
        <section id="messages" class="messages" aria-live="polite"></section>
        <div class="composer-wrap">
          <div class="tool-chips" aria-label="Chat tools">
            <button class="chip active" type="button" data-command="/help">/help</button>
            <button class="chip active" type="button" data-command="/status">/status</button>
            <button class="chip active" type="button" data-command="/memories">/memories</button>
            <button class="chip" type="button" disabled title="The v0 web UI does not run external search" data-i18n="chipWebSearch" data-i18n-title="chipWebSearchOff">Web search</button>
            <button class="chip" type="button" disabled title="The v0 web UI does not run Deep Research" data-i18n="chipDeepResearch" data-i18n-title="chipDeepResearchOff">Deep research</button>
          </div>
          <form id="chatForm" class="composer" aria-label="Natural-language command" data-i18n-aria="composerAria">
            <button class="attach" type="button" aria-label="Add" data-i18n-aria="add">+</button>
            <textarea id="intentInput" rows="1" placeholder="@ to reference a memory, type your question…" data-i18n-ph="composerPlaceholder"></textarea>
            <div id="modelPicker" class="model-picker" title="Model" data-i18n-title="modelLabel" hidden>
              <svg class="model-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-2 8 9-12h-7z"/></svg>
              <select id="modelSelect" aria-label="Model" data-i18n-aria="modelLabel"></select>
              <svg class="model-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <button id="intentButton" class="send" type="submit" aria-label="Send" data-i18n-aria="send">→</button>
          </form>
        </div>
      </section>
    </div>
  </main>

  <aside id="functionsPanel" class="functions" aria-label="Functions" role="dialog" aria-modal="true">
        <header class="tool-head">
          <div class="tool-title">
            <h2>Functions</h2>
            <button id="collapseFunctions" class="icon-button" type="button" title="Close" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </div>
          <p>Chat is read-first. Owner operations run explicitly here.</p>
        </header>
        <div class="tool-scroll">
          <section class="tool-card">
            <h3>View</h3>
            <label>Realm<select id="realmSelect" aria-label="Realm selector"></select></label>
            <label>Scope<select id="scopeSelect" disabled><option>Loading scopes...</option></select></label>
            <label>Search<input id="searchInput" type="search" placeholder="Filter visible memories"></label>
            <label>Sensitivity
              <select id="sensitivitySelect" aria-label="Sensitivity filter">
                <option value="all">All</option>
                <option value="public">Public</option>
                <option value="internal">Internal</option>
              </select>
            </label>
            <div id="kindTabs" class="row" aria-label="Kind filter"></div>
          </section>

          <section class="tool-card">
            <h3>Passphrase</h3>
            <input id="ownerPassphrase" type="password" placeholder="Only for passphrase Realms">
            <div class="muted">Used only for this action. Not stored.</div>
          </section>

          <section class="tool-card">
            <h3>Import from AI</h3>
            <textarea id="importText" placeholder="Paste an exported memory blob"></textarea>
            <input id="importProvider" type="text" placeholder="provider hint">
            <div class="row">
              <button id="importBtn" class="act" type="button">Ingest</button>
              <button id="candidatesBtn" class="act" type="button">Candidates</button>
            </div>
            <div id="candidateList"></div>
          </section>

          <section class="tool-card">
            <h3>Realm lifecycle</h3>
            <input id="newRealmName" type="text" placeholder="new Realm name">
            <div class="row">
              <button id="newRealmBtn" class="act" type="button">Create</button>
              <button id="setActiveBtn" class="act" type="button">Set active</button>
              <button id="deleteRealmBtn" class="act danger" type="button">Delete</button>
            </div>
          </section>

          <section class="tool-card">
            <h3>Forget / redact</h3>
            <input id="forgetId" type="text" placeholder="clm_... / evt_... / und_...">
            <div class="row">
              <button id="forgetBtn" class="act danger" type="button">Forget</button>
              <button id="redactBtn" class="act danger" type="button">Redact</button>
            </div>
          </section>

          <section class="tool-card">
            <h3>Console</h3>
            <div id="consoleOut" class="console-out"></div>
          </section>
        </div>
      </aside>
  <div id="functionsScrim" class="functions-scrim" aria-hidden="true"></div>
  <script nonce="${nonce}">
    const TOKEN = (function () {
      const m = /[#&]t=([^&]+)/.exec(location.hash || '');
      const t = m ? decodeURIComponent(m[1]) : '';
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      return t;
    })();

    // Surface language. Default English; the toggle flips to Japanese and the choice
    // persists. One dictionary holds both branches side by side so they cannot drift
    // (mirrors apps/cli/i18n.ts). The chat surface localizes; the owner-operations
    // drawer stays English in both languages by design (ops parity with the CLI).
    let lang = (function () {
      try { var s = localStorage.getItem('memoring.lang'); if (s === 'ja' || s === 'en') return s; } catch (e) {}
      return 'en';
    })();
    const STR = {
      memoryCollections: { en: 'Memory collections', ja: 'メモリコレクション' },
      switchView: { en: 'Switch view', ja: '表示切り替え' },
      toggleSidebar: { en: 'Toggle sidebar', ja: 'サイドバーの開閉' },
      navChat: { en: 'Chat', ja: 'チャット' },
      navMemory: { en: 'Memory', ja: 'メモリ' },
      capStripAria: { en: 'What you can do', ja: 'できること' },
      capGated: { en: 'Gated', ja: 'Gate済み' },
      capLocal: { en: 'Local', ja: 'ローカル' },
      capOwnerView: { en: 'Owner view', ja: '所有者ビュー' },
      runtimeSafeguards: { en: 'Runtime safeguards', ja: 'ランタイム保護' },
      search: { en: 'Search', ja: '検索' },
      status: { en: 'Status', ja: 'ステータス' },
      toggleAppearance: { en: 'Toggle appearance', ja: '外観切り替え' },
      switchLanguage: { en: 'Switch language', ja: '言語切り替え' },
      functionsOwner: { en: 'Functions (owner operations)', ja: '機能（所有者操作）' },
      openFunctions: { en: 'Open functions', ja: '機能を開く' },
      chipWebSearch: { en: 'Web search', ja: 'ウェブ検索' },
      chipWebSearchOff: { en: 'The v0 web UI does not run external search', ja: 'v0のWeb UIでは外部検索を行いません' },
      chipDeepResearch: { en: 'Deep research', ja: 'ディープリサーチ' },
      chipDeepResearchOff: { en: 'The v0 web UI does not run Deep Research', ja: 'v0のWeb UIではDeep Researchを実行しません' },
      composerAria: { en: 'Natural-language command', ja: '自然言語コマンド' },
      add: { en: 'Add', ja: '追加' },
      composerPlaceholder: { en: '@ to reference a memory, type your question…', ja: '@ でメモリを指定、質問を入力…' },
      send: { en: 'Send', ja: '送信' },
      openCollections: { en: 'Open memory collections', ja: 'メモリコレクションを開く' },
      modelLabel: { en: 'Model', ja: 'モデル' },
      modelOnDevice: { en: 'On-device (rule-based)', ja: 'オンデバイス（ルールベース）' },
      modelSwitchFailed: { en: function (s) { return 'Could not switch model (' + s + ').'; }, ja: function (s) { return 'モデルを切り替えできませんでした (' + s + ')。'; } },
      appearanceToLight: { en: 'Switch to light', ja: 'ライトに切り替え' },
      appearanceToDark: { en: 'Switch to dark', ja: 'ダークに切り替え' },
      languageToJa: { en: 'Switch to 日本語', ja: '日本語に切り替え' },
      languageToEn: { en: 'Switch to English', ja: '英語に切り替え' },
      quickNewChat: { en: 'New chat', ja: '新規チャット' },
      quickAddMemory: { en: 'Add memory', ja: 'メモリを追加' },
      searchChats: { en: 'Search chats', ja: 'チャットを検索' },
      searchMemories: { en: 'Search memories', ja: 'メモリを検索' },
      currentChat: { en: 'Current chat', ja: '現在のチャット' },
      noConversationYet: { en: 'No conversation yet', ja: 'まだ会話はありません' },
      waiting: { en: 'waiting', ja: '待機中' },
      count: { en: function (n) { return String(n); }, ja: function (n) { return n + ' 件'; } },
      noCollections: { en: 'No collections.', ja: 'コレクションがありません。' },
      welcomeBadge: { en: function (n) { return 'Browsing ' + n + ' gated memories'; }, ja: function (n) { return n + '件のゲート済みメモリを参照中'; } },
      welcomeTitle: { en: 'Ask me anything.', ja: '何でも聞いてください。' },
      welcomeScoped: { en: function (name) { return 'Answers cite their sources across your saved ' + name + ' memories — in plain language or with slash commands.'; }, ja: function (name) { return name + ' の保存済みメモリを横断して、出典つきで回答します。自然な言葉でもスラッシュコマンドでも使えます。'; } },
      welcomeUnscoped: { en: 'Pick a memory collection on the left to set what the conversation can see.', ja: '左のメモリコレクションを選ぶと、会話の参照範囲が切り替わります。' },
      suggestions: {
        en: ['Summarize the key points so far', 'Catch me up on recent project status', 'Show the important decisions', 'Suggest the next actions to take'],
        ja: ['これまでの議論の要点をまとめて', '直近のプロジェクト状況を教えて', '重要な決定事項を見せて', '次に取るべきアクションを提案して']
      },
      noMatching: { en: 'No matching memories.', ja: '該当するメモリはありません。' },
      foundSummary: { en: function (n, g) { return n + ' found. ' + g; }, ja: function (n, g) { return n + '件見つかりました。' + g; } },
      moreResults: { en: function (n) { return n + ' more — narrow your search.'; }, ja: function (n) { return 'さらに ' + n + '件あります。検索を絞ってください。'; } },
      stScope: { en: 'Scope', ja: 'スコープ' },
      stProject: { en: 'Project', ja: 'プロジェクト' },
      stVisible: { en: 'Visible', ja: '表示' },
      stGated: { en: 'Gated', ja: 'Gate' },
      stFilters: { en: 'Filters', ja: 'フィルタ' },
      stNone: { en: 'None', ja: 'なし' },
      stNoneFilters: { en: 'none', ja: 'なし' },
      filterSearch: { en: 'search', ja: '検索' },
      shown: { en: 'shown', ja: '表示' },
      gated: { en: 'gated', ja: 'Gate' },
      selectCollection: { en: 'Select a collection.', ja: 'コレクションを選択してください。' },
      memory: { en: 'Memory', ja: 'メモリ' },
      loading: { en: 'Loading…', ja: '読み込み中…' },
      realmLocked: { en: 'This Realm is passphrase-locked.', ja: 'このRealmはパスフレーズでロックされています。' },
      failedScopes: { en: function (s) { return 'Failed to load scopes (' + s + ').'; }, ja: function (s) { return 'スコープの読み込みに失敗しました (' + s + ')。'; } },
      noScopesOpt: { en: 'No scopes', ja: 'スコープなし' },
      noConfigured: { en: 'No configured collections.', ja: '設定済みのコレクションがありません。' },
      realmBase: { en: 'Active Realm (CLI default)', ja: 'アクティブRealm（CLI既定）' },
      switchSpecify: { en: 'Specify a target, e.g. /switch project-id', ja: '切り替え先を指定してください。例: /switch project-id' },
      switchNoMatch: { en: 'No matching collection. Check /scopes.', ja: '一致するコレクションがありません。/scopes で確認してください。' },
      switchDone: { en: function (name, n) { return 'Switched to ' + name + '. Browsing ' + n + ' gated memories.'; }, ja: function (name, n) { return name + ' に切り替えました。' + n + '件のゲート済みメモリを参照します。'; } },
      scopesIntro: { en: 'Here are your collections.', ja: 'コレクション一覧です。' },
      detailNone: { en: 'No memory selected.', ja: '選択中のメモリはありません。' },
      dSelected: { en: 'Selected memory', ja: '選択中のメモリ' },
      dClaim: { en: 'Claim', ja: 'Claim' },
      dKind: { en: 'Kind', ja: '種別' },
      dSensitivity: { en: 'Sensitivity', ja: '機密度' },
      dEvidence: { en: 'Evidence', ja: '根拠数' },
      dFrom: { en: 'From', ja: 'From' },
      dUntil: { en: 'Until', ja: 'Until' },
      help: {
        en: ['Available commands:', '/status — current scope and counts', '/scopes — list memory collections', '/switch <scope or project_id> — change what you are browsing', '/memories — show the current memories', '/constraints /decisions /procedures /internal /public — filter the view', '/detail — metadata for the selected memory', '/clear — clear the conversation and filters'].join('\\n'),
        ja: ['使える操作:', '/status - 現在の参照範囲と件数', '/scopes - メモリコレクション一覧', '/switch <scope名 or project_id> - 参照先を切り替え', '/memories - 現在のメモリを表示', '/constraints /decisions /procedures /internal /public - 表示を絞り込み', '/detail - 選択中メモリのメタ情報', '/clear - 会話とフィルタをクリア'].join('\\n')
      }
    };
    function t(key) {
      const entry = STR[key];
      if (!entry) return key;
      var v = entry[lang];
      if (v === undefined) v = entry.en;
      if (typeof v === 'function') return v.apply(null, Array.prototype.slice.call(arguments, 1));
      return v;
    }
    function applyLang(next) {
      if (next) lang = next;
      try { localStorage.setItem('memoring.lang', lang); } catch (e) {}
      document.documentElement.lang = lang;
      var nodes = document.querySelectorAll('[data-i18n]');
      for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
      nodes = document.querySelectorAll('[data-i18n-ph]');
      for (var j = 0; j < nodes.length; j++) nodes[j].setAttribute('placeholder', t(nodes[j].getAttribute('data-i18n-ph')));
      nodes = document.querySelectorAll('[data-i18n-title]');
      for (var k = 0; k < nodes.length; k++) nodes[k].setAttribute('title', t(nodes[k].getAttribute('data-i18n-title')));
      nodes = document.querySelectorAll('[data-i18n-aria]');
      for (var m = 0; m < nodes.length; m++) nodes[m].setAttribute('aria-label', t(nodes[m].getAttribute('data-i18n-aria')));
    }
    function refreshToggleTitles() {
      var light = document.body.classList.contains('appearance-light');
      appearanceToggle.title = light ? t('appearanceToDark') : t('appearanceToLight');
      languageToggle.title = lang === 'ja' ? t('languageToEn') : t('languageToJa');
      languageToggle.setAttribute('aria-pressed', String(lang === 'ja'));
    }
    function setLang(next) {
      applyLang(next);
      refreshToggleTitles();
      render();
    }

    function api(path, opts) {
      opts = opts || {};
      const headers = Object.assign({ 'x-memoring-token': TOKEN }, opts.headers || {});
      let body = opts.body;
      if (body !== undefined && typeof body !== 'string') {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(body);
      }
      return fetch(path, Object.assign({}, opts, { headers: headers, body: body }));
    }
    function realmParam() { return activeRealm ? '?realm=' + encodeURIComponent(activeRealm) : ''; }
    function addText(parent, tag, text, className) {
      const el = document.createElement(tag);
      if (className) el.className = className;
      el.textContent = text;
      parent.appendChild(el);
      return el;
    }

    const sidebarEl = document.querySelector('#sidebar');
    const openFunctionsBtn = document.querySelector('#openFunctions');
    const closeFunctionsBtn = document.querySelector('#collapseFunctions');
    const functionsScrim = document.querySelector('#functionsScrim');
    const select = document.querySelector('#scopeSelect');
    const realmSelect = document.querySelector('#realmSelect');
    const collectionListEl = document.querySelector('#collectionList');
    const collectionSearch = document.querySelector('#collectionSearch');
    const sidebarGateCount = document.querySelector('#sidebarGateCount');
    const capabilityStrip = document.querySelector('.capability-strip');
    const quickActionText = document.querySelector('#quickActionText');
    const quickAction = document.querySelector('#quickAction');
    const messagesEl = document.querySelector('#messages');
    const screenTitleEl = document.querySelector('#screenTitle');
    const screenRealmEl = document.querySelector('#screenRealm');
    const pathSepEl = document.querySelector('#screenPathSep');
    const statusEl = document.querySelector('#status');
    const searchInput = document.querySelector('#searchInput');
    const sensitivitySelect = document.querySelector('#sensitivitySelect');
    const kindTabsEl = document.querySelector('#kindTabs');
    const chatForm = document.querySelector('#chatForm');
    const intentInput = document.querySelector('#intentInput');
    const sideTabs = Array.from(document.querySelectorAll('[data-side-mode]'));
    const searchToggle = document.querySelector('#searchToggle');
    const statusToggle = document.querySelector('#statusToggle');
    const appearanceToggle = document.querySelector('#appearanceToggle');
    const languageToggle = document.querySelector('#languageToggle');
    const modelPicker = document.querySelector('#modelPicker');
    const modelSelect = document.querySelector('#modelSelect');

    let scopes = [];
    let realms = [];
    let activeRealm = '';
    let currentRows = [];
    let activeKind = 'all';
    let selectedClaimId = null;
    let chatMessages = [];
    let sideMode = 'chat';

    const kindOrder = ['constraint', 'preference', 'decision', 'fact', 'project_context', 'procedure'];
    const kindLabels = {
      constraint: 'Constraints',
      preference: 'Preferences',
      decision: 'Decisions',
      fact: 'Facts',
      project_context: 'Project context',
      procedure: 'Procedures'
    };
    function kindLabel(kind) { return kindLabels[kind] || String(kind).replace(/_/g, ' '); }
    function activeScope() { return scopes.find((scope) => scope.project_id === select.value) || null; }
    function activeRealmName() {
      if (activeRealm) {
        const r = realms.find(function (x) { return x.realm_id === activeRealm; });
        return r ? r.name : activeRealm;
      }
      const current = realms.find(function (x) { return x.active; });
      return current ? current.name : 'default';
    }
    // The chat-head context reads as a path — realm / scope — instead of a raw
    // project id. Error / no-scope states collapse to a single clean line rather
    // than rendering a half-empty path.
    function setHeaderPath(realmName, scopeName) {
      screenRealmEl.hidden = false;
      pathSepEl.hidden = false;
      screenRealmEl.textContent = realmName;
      screenTitleEl.textContent = scopeName;
      screenTitleEl.classList.remove('path-message');
    }
    function setHeaderMessage(message) {
      screenRealmEl.hidden = true;
      pathSepEl.hidden = true;
      screenTitleEl.textContent = message;
      screenTitleEl.classList.add('path-message');
    }
    function sortedGroups(rows) {
      const grouped = new Map();
      for (const row of rows) grouped.set(row.kind, [...(grouped.get(row.kind) || []), row]);
      return Array.from(grouped.entries()).sort(function (a, b) {
        const ai = kindOrder.indexOf(a[0]);
        const bi = kindOrder.indexOf(b[0]);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a[0].localeCompare(b[0]);
      });
    }
    function matchesQuery(row, query) {
      if (!query) return true;
      const haystack = [row.statement, row.kind, row.sensitivity, row.status, ...(row.labelIds || [])].join(' ').toLowerCase();
      return haystack.includes(query.toLowerCase());
    }
    function filterRows(rows, queryOverride) {
      const query = queryOverride === undefined ? searchInput.value.trim() : queryOverride.trim();
      const sensitivity = sensitivitySelect.value;
      return rows.filter(function (row) {
        if (activeKind !== 'all' && row.kind !== activeKind) return false;
        if (sensitivity !== 'all' && row.sensitivity !== sensitivity) return false;
        return matchesQuery(row, query);
      });
    }
    function formatDate(value) {
      if (!value) return 'None';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
    }

    function rowSummary(rows) {
      if (rows.length === 0) return t('noMatching');
      const groups = sortedGroups(rows).map(function (entry) { return kindLabel(entry[0]) + ':' + entry[1].length; });
      return t('foundSummary', rows.length, groups.join(' / '));
    }
    function buildStatusText() {
      const selected = activeScope();
      const visible = filterRows(currentRows);
      const filters = [];
      if (activeKind !== 'all') filters.push(kindLabel(activeKind));
      if (sensitivitySelect.value !== 'all') filters.push(sensitivitySelect.value);
      if (searchInput.value.trim()) filters.push(t('filterSearch'));
      return [
        t('stScope') + ': ' + (selected ? selected.name : t('stNone')),
        t('stProject') + ': ' + (selected ? selected.project_id : t('stNone')),
        t('stVisible') + ': ' + visible.length + ' / ' + t('stGated') + ': ' + currentRows.length,
        t('stFilters') + ': ' + (filters.length ? filters.join(', ') : t('stNoneFilters'))
      ].join('\\n');
    }

    function sideModeLabel() {
      return sideMode === 'memory' ? t('navMemory') : t('navChat');
    }
    function renderSideTabs() {
      for (const tab of sideTabs) {
        tab.setAttribute('aria-current', tab.getAttribute('data-side-mode') === sideMode ? 'page' : 'false');
      }
    }
    function renderChatLogs() {
      collectionListEl.replaceChildren();
      sidebarGateCount.textContent = chatMessages.length ? t('count', chatMessages.length) : t('waiting');
      const q = collectionSearch.value.trim().toLowerCase();
      const logs = [];
      logs.push({
        title: t('currentChat'),
        meta: chatMessages.length ? chatMessages[chatMessages.length - 1].text.slice(0, 42) : t('noConversationYet'),
        count: String(chatMessages.length),
        current: true,
      });
      const visibleLogs = logs.filter(function (log) {
        return !q || log.title.toLowerCase().includes(q) || log.meta.toLowerCase().includes(q);
      });
      for (const log of visibleLogs) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'collection';
        button.setAttribute('aria-current', String(log.current));
        const row = document.createElement('div');
        row.className = 'collection-row';
        addText(row, 'span', log.title, 'collection-name');
        addText(row, 'span', log.count, 'count');
        button.appendChild(row);
        addText(button, 'div', log.meta, 'collection-meta');
        button.addEventListener('click', function () {
          sidebarEl.classList.remove('open');
          intentInput.focus();
        });
        collectionListEl.appendChild(button);
      }
    }
    function renderCollections() {
      collectionListEl.replaceChildren();
      sidebarGateCount.textContent = t('count', currentRows.length);
      const q = collectionSearch.value.trim().toLowerCase();
      const visibleScopes = scopes.filter(function (scope) {
        return !q || scope.name.toLowerCase().includes(q) || scope.project_id.toLowerCase().includes(q);
      });
      if (visibleScopes.length === 0) {
        addText(collectionListEl, 'div', t('noCollections'), 'muted');
        return;
      }
      for (const scope of visibleScopes) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'collection';
        button.setAttribute('aria-current', String(select.value === scope.project_id));
        const row = document.createElement('div');
        row.className = 'collection-row';
        addText(row, 'span', scope.name, 'collection-name');
        addText(row, 'span', select.value === scope.project_id ? String(currentRows.length) : '', 'count');
        button.appendChild(row);
        addText(button, 'div', scope.project_id, 'collection-meta');
        button.addEventListener('click', async function () {
          select.value = scope.project_id;
          await loadMemories({ preserveChat: false });
          sidebarEl.classList.remove('open');
        });
        collectionListEl.appendChild(button);
      }
    }
    function renderSidebarPanel() {
      renderSideTabs();
      if (sideMode === 'chat') {
        capabilityStrip.hidden = true;
        quickActionText.textContent = t('quickNewChat');
        collectionSearch.placeholder = t('searchChats');
        renderChatLogs();
        return;
      }
      capabilityStrip.hidden = false;
      quickActionText.textContent = t('quickAddMemory');
      collectionSearch.placeholder = t('searchMemories');
      renderCollections();
    }

    function renderKindTabs(rows) {
      const groups = sortedGroups(rows);
      if (activeKind !== 'all' && !groups.some(function (entry) { return entry[0] === activeKind; })) activeKind = 'all';
      kindTabsEl.replaceChildren();
      const all = document.createElement('button');
      all.type = 'button'; all.className = 'act'; all.textContent = 'All';
      all.setAttribute('aria-pressed', String(activeKind === 'all'));
      all.addEventListener('click', function () { activeKind = 'all'; render(); });
      kindTabsEl.appendChild(all);
      for (const entry of groups) {
        const kind = entry[0];
        const tab = document.createElement('button');
        tab.type = 'button'; tab.className = 'act'; tab.textContent = kindLabel(kind);
        tab.setAttribute('aria-pressed', String(activeKind === kind));
        tab.addEventListener('click', function () { activeKind = kind; render(); });
        kindTabsEl.appendChild(tab);
      }
    }

    function resultCard(row) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'result-card';
      card.setAttribute('aria-selected', String(row.claim_id === selectedClaimId));
      const top = document.createElement('div');
      top.className = 'result-top';
      addText(top, 'span', kindLabel(row.kind), 'pill kind');
      addText(top, 'span', row.sensitivity, 'pill ' + row.sensitivity);
      card.appendChild(top);
      addText(card, 'div', row.statement, 'statement');
      const labels = document.createElement('div');
      labels.className = 'labels';
      for (const labelId of (row.labelIds || []).slice(0, 5)) addText(labels, 'span', labelId, 'label-chip');
      if ((row.labelIds || []).length > 5) addText(labels, 'span', '+' + ((row.labelIds || []).length - 5), 'label-chip');
      card.appendChild(labels);
      card.addEventListener('click', function () {
        selectedClaimId = row.claim_id;
        pushAssistant(detailText(row), [row]);
      });
      return card;
    }

    function renderWelcome() {
      const selected = activeScope();
      const welcome = document.createElement('div');
      welcome.className = 'welcome';
      addText(welcome, 'div', t('welcomeBadge', currentRows.length), 'welcome-badge');
      addText(welcome, 'h2', t('welcomeTitle'));
      addText(welcome, 'p', selected ? t('welcomeScoped', selected.name) : t('welcomeUnscoped'));
      const suggestions = document.createElement('div');
      suggestions.className = 'suggestions';
      const items = t('suggestions');
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'suggestion';
        button.textContent = item;
        button.addEventListener('click', function () {
          intentInput.value = item;
          runIntent(item);
        });
        suggestions.appendChild(button);
      }
      welcome.appendChild(suggestions);
      messagesEl.appendChild(welcome);
    }
    function appendMemoringAvatar(parent) {
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.setAttribute('aria-hidden', 'true');
      const image = document.createElement('img');
      image.className = 'logo-img';
      image.src = '/assets/memoring-ring.svg';
      image.alt = '';
      avatar.appendChild(image);
      parent.appendChild(avatar);
    }

    function renderMessages() {
      messagesEl.replaceChildren();
      if (chatMessages.length === 0) {
        renderWelcome();
        return;
      }
      const thread = document.createElement('div');
      thread.className = 'thread';
      for (const message of chatMessages) {
        const wrap = document.createElement('article');
        wrap.className = 'message ' + message.role;
        if (message.role !== 'user') appendMemoringAvatar(wrap);
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        addText(bubble, 'div', message.text, 'bubble-text');
        if (message.rows && message.rows.length) {
          const list = document.createElement('div');
          list.className = 'result-list';
          for (const row of message.rows.slice(0, 8)) list.appendChild(resultCard(row));
          if (message.rows.length > 8) addText(list, 'div', t('moreResults', message.rows.length - 8), 'muted');
          bubble.appendChild(list);
        }
        wrap.appendChild(bubble);
        if (message.role === 'user') addText(wrap, 'div', 'You', 'avatar');
        thread.appendChild(wrap);
      }
      messagesEl.appendChild(thread);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function render() {
      const selected = activeScope();
      const filteredRows = filterRows(currentRows);
      if (!filteredRows.some(function (row) { return row.claim_id === selectedClaimId; })) selectedClaimId = filteredRows[0]?.claim_id || null;
      renderKindTabs(currentRows);
      renderMessages();
      renderSidebarPanel();
      if (selected) setHeaderPath(activeRealmName(), selected.name);
      else setHeaderMessage(t('memory'));
      const filters = [];
      if (activeKind !== 'all') filters.push(kindLabel(activeKind));
      if (sensitivitySelect.value !== 'all') filters.push(sensitivitySelect.value);
      if (searchInput.value.trim()) filters.push(t('filterSearch'));
      statusEl.textContent = filteredRows.length + ' ' + t('shown') + ' / ' + currentRows.length + ' ' + t('gated') + (filters.length ? ' / ' + filters.join(' / ') : '');
    }

    function clearSurface(message) {
      currentRows = [];
      chatMessages = [{ role: 'assistant', text: message || t('selectCollection') }];
      collectionListEl.replaceChildren();
      statusEl.textContent = message || '';
      setHeaderMessage(message || t('selectCollection'));
      renderMessages();
    }

    function pushUser(text) {
      chatMessages.push({ role: 'user', text: text });
    }
    function pushAssistant(text, rows) {
      chatMessages.push({ role: 'assistant', text: text, rows: rows || [] });
      render();
    }
    function autoResizeIntent() {
      intentInput.style.height = 'auto';
      intentInput.style.height = Math.min(intentInput.scrollHeight, 180) + 'px';
      intentInput.style.overflowY = intentInput.scrollHeight > 180 ? 'auto' : 'hidden';
    }
    function detailText(row) {
      if (!row) return t('detailNone');
      return [
        t('dSelected'),
        t('dClaim') + ': ' + row.claim_id,
        t('dKind') + ': ' + kindLabel(row.kind),
        t('dSensitivity') + ': ' + row.sensitivity,
        t('dEvidence') + ': ' + String(row.evidenceCount ?? 0),
        t('dFrom') + ': ' + formatDate(row.validFrom),
        t('dUntil') + ': ' + formatDate(row.validUntil),
        '',
        row.statement
      ].join('\\n');
    }
    function naturalQuery(input) {
      return input.replace(/^(show|find|search|filter|list|見せて|探して|検索して|絞って|一覧|表示して)\\s*/i, '').trim() || input;
    }
    async function switchScopeByText(text) {
      const target = text.trim().toLowerCase();
      if (!target) {
        pushAssistant(t('switchSpecify'));
        return;
      }
      const found = scopes.find(function (scope) {
        return scope.project_id.toLowerCase() === target || scope.name.toLowerCase() === target || scope.project_id.toLowerCase().includes(target) || scope.name.toLowerCase().includes(target);
      });
      if (!found) {
        pushAssistant(t('switchNoMatch'));
        return;
      }
      select.value = found.project_id;
      await loadMemories({ preserveChat: true });
      pushAssistant(t('switchDone', found.name, currentRows.length));
    }
    async function runIntent(raw) {
      const input = raw.trim();
      if (!input) { intentInput.focus(); return; }
      intentInput.value = '';
      autoResizeIntent();
      pushUser(input);
      const lower = input.toLowerCase();
      const command = lower.startsWith('/') ? lower.split(/\\s+/)[0] : '';

      if (command === '/clear' || lower === 'clear' || lower.includes('クリア') || lower.includes('解除')) {
        chatMessages = [];
        activeKind = 'all';
        sensitivitySelect.value = 'all';
        searchInput.value = '';
        selectedClaimId = null;
        render();
        intentInput.focus();
        return;
      }
      if (command === '/help') pushAssistant(t('help'));
      else if (command === '/status') pushAssistant(buildStatusText());
      else if (command === '/scopes') pushAssistant(t('scopesIntro'), scopes.map(function (scope) {
        return { claim_id: scope.project_id, kind: 'project_context', sensitivity: 'internal', statement: scope.name + ' / ' + scope.project_id, labelIds: [], evidenceCount: 0 };
      }));
      else if (command === '/switch') await switchScopeByText(input.replace(/^\\/switch\\s*/i, ''));
      else if (command === '/memories') {
        const rows = filterRows(currentRows);
        if (rows[0]) selectedClaimId = rows[0].claim_id;
        pushAssistant(rowSummary(rows), rows);
      }
      else if (command === '/constraints' || lower.includes('constraint') || lower.includes('制約')) {
        activeKind = 'constraint'; const rows = filterRows(currentRows); if (rows[0]) selectedClaimId = rows[0].claim_id; pushAssistant(rowSummary(rows), rows);
      }
      else if (command === '/decisions' || lower.includes('decision') || lower.includes('決定')) {
        activeKind = 'decision'; const rows = filterRows(currentRows); if (rows[0]) selectedClaimId = rows[0].claim_id; pushAssistant(rowSummary(rows), rows);
      }
      else if (command === '/procedures' || lower.includes('procedure') || lower.includes('手順')) {
        activeKind = 'procedure'; const rows = filterRows(currentRows); if (rows[0]) selectedClaimId = rows[0].claim_id; pushAssistant(rowSummary(rows), rows);
      }
      else if (command === '/internal' || lower.includes('internal') || lower.includes('内部')) {
        sensitivitySelect.value = 'internal'; const rows = filterRows(currentRows); if (rows[0]) selectedClaimId = rows[0].claim_id; pushAssistant(rowSummary(rows), rows);
      }
      else if (command === '/public' || lower.includes('public') || lower.includes('公開')) {
        sensitivitySelect.value = 'public'; const rows = filterRows(currentRows); if (rows[0]) selectedClaimId = rows[0].claim_id; pushAssistant(rowSummary(rows), rows);
      }
      else if (command === '/detail') {
        const rows = filterRows(currentRows);
        const row = rows.find(function (candidate) { return candidate.claim_id === selectedClaimId; }) || rows[0] || null;
        pushAssistant(detailText(row), row ? [row] : []);
      }
      else {
        const query = naturalQuery(input);
        searchInput.value = query;
        const rows = filterRows(currentRows, query);
        if (rows[0]) selectedClaimId = rows[0].claim_id;
        pushAssistant(rowSummary(rows), rows);
      }
      intentInput.focus();
    }

    async function loadMemories(opts) {
      opts = opts || {};
      const selected = activeScope();
      if (!selected) { clearSurface(); return; }
      statusEl.textContent = t('loading');
      const params = new URLSearchParams({ scope: selected.name, project: selected.project_id });
      if (activeRealm) params.set('realm', activeRealm);
      const response = await api('/api/memories?' + params.toString());
      if (!response.ok) throw new Error('Failed to load memories (' + response.status + ')');
      currentRows = await response.json();
      activeKind = 'all';
      selectedClaimId = currentRows[0]?.claim_id || null;
      searchInput.value = '';
      sensitivitySelect.value = 'all';
      if (!opts.preserveChat) chatMessages = [];
      render();
    }

    async function loadScopes() {
      const response = await api('/api/scopes' + realmParam());
      if (!response.ok) {
        select.replaceChildren();
        select.disabled = true;
        clearSurface(response.status === 423 ? t('realmLocked') : t('failedScopes', response.status));
        return;
      }
      scopes = await response.json();
      select.replaceChildren();
      if (scopes.length === 0) {
        const option = document.createElement('option');
        option.textContent = t('noScopesOpt');
        select.appendChild(option);
        select.disabled = true;
        clearSurface(t('noConfigured'));
        return;
      }
      for (const scope of scopes) {
        const option = document.createElement('option');
        option.value = scope.project_id;
        option.textContent = scope.name;
        select.appendChild(option);
      }
      select.disabled = false;
      await loadMemories({ preserveChat: false });
    }

    async function loadRealms() {
      const response = await api('/api/realms');
      if (!response.ok) throw new Error('Failed to load Realms (' + response.status + ')');
      realms = await response.json();
      realmSelect.replaceChildren();
      const base = document.createElement('option');
      base.value = '';
      base.textContent = t('realmBase');
      realmSelect.appendChild(base);
      for (const realm of realms) {
        const option = document.createElement('option');
        option.value = realm.realm_id;
        option.textContent = (realm.active ? '* ' : '') + realm.name + ' [' + realm.key_mode + ']' + (realm.locked ? ' (locked)' : '');
        realmSelect.appendChild(option);
      }
    }

    async function loadLlm() {
      try {
        const r = await api('/api/llm');
        renderModelPicker(r.ok ? await r.json() : null);
      } catch (e) {
        renderModelPicker(null);
      }
    }
    function renderModelPicker(data) {
      modelSelect.replaceChildren();
      if (!data || !data.configured) {
        // No LLM endpoint configured → the on-device rule-based provider. Shown as
        // a single, non-actionable label (configuring an endpoint is a CLI op).
        addText(modelSelect, 'option', t('modelOnDevice'));
        modelSelect.disabled = true;
        modelPicker.classList.add('disabled');
        modelPicker.hidden = false;
        return;
      }
      const models = (data.models && data.models.length) ? data.models : [data.model];
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        modelSelect.appendChild(opt);
      }
      modelSelect.value = data.model;
      modelSelect.disabled = false;
      modelPicker.classList.remove('disabled');
      modelPicker.hidden = false;
    }

    function consoleOut(msg) { document.querySelector('#consoleOut').textContent = msg; }
    function ownerPassphrase() {
      const v = document.querySelector('#ownerPassphrase').value;
      return v ? { passphrase: v } : {};
    }
    async function postJson(path, payload) {
      const response = await api(path, { method: 'POST', body: payload });
      let data = {};
      try { data = await response.json(); } catch (e) {}
      return { ok: response.ok, status: response.status, data: data };
    }

    function bindOwnerConsole() {
      document.querySelector('#importBtn').addEventListener('click', async function () {
        const text = document.querySelector('#importText').value;
        if (!text.trim()) { consoleOut('Paste an export first.'); return; }
        const payload = Object.assign({ text: text, provider: document.querySelector('#importProvider').value || undefined }, ownerPassphrase());
        const r = await postJson('/api/import' + realmParam(), payload);
        consoleOut(r.ok ? 'Imported: candidates=' + r.data.candidates + ' events=' + r.data.events + ' secret_skipped=' + r.data.secret_skipped : 'Import failed: ' + (r.data.error || r.status));
      });
      document.querySelector('#candidatesBtn').addEventListener('click', loadCandidates);
      document.querySelector('#newRealmBtn').addEventListener('click', async function () {
        const name = document.querySelector('#newRealmName').value.trim();
        if (!name) { consoleOut('Enter a Realm name.'); return; }
        const r = await postJson('/api/realms', { name: name });
        if (r.ok) { consoleOut('Created Realm ' + r.data.name + '.'); await loadRealms(); }
        else consoleOut('Create failed: ' + (r.data.error || r.status));
      });
      document.querySelector('#setActiveBtn').addEventListener('click', async function () {
        if (!activeRealm) { consoleOut('Select a specific Realm first.'); return; }
        const r = await postJson('/api/realms/active', { realm: activeRealm });
        if (r.ok) { consoleOut('Set active: ' + r.data.name); await loadRealms(); }
        else consoleOut('Set-active failed: ' + (r.data.error || r.status));
      });
      document.querySelector('#deleteRealmBtn').addEventListener('click', async function () {
        if (!activeRealm) { consoleOut('Select a specific Realm to delete.'); return; }
        if (!confirm('Delete this Realm and its directory? This is irreversible.')) return;
        const del = await api('/api/realms', { method: 'DELETE', body: { realm: activeRealm, confirm: true } });
        let data = {}; try { data = await del.json(); } catch (e) {}
        if (del.ok) { consoleOut('Removed Realm.'); activeRealm = ''; realmSelect.value = ''; await loadRealms(); await loadScopes(); }
        else consoleOut('Delete failed: ' + (data.error || del.status));
      });
      document.querySelector('#forgetBtn').addEventListener('click', async function () {
        const id = document.querySelector('#forgetId').value.trim();
        if (!id) { consoleOut('Enter an id to forget.'); return; }
        if (!confirm('Forget ' + id + '? This is irreversible.')) return;
        const r = await postJson('/api/forget' + realmParam(), Object.assign({ id: id, confirm: true }, ownerPassphrase()));
        consoleOut(r.ok ? 'Forgot ' + (r.data.forgotten || 0) + ' record(s).' : 'Forget failed: ' + (r.data.error || r.status));
      });
      document.querySelector('#redactBtn').addEventListener('click', async function () {
        const id = document.querySelector('#forgetId').value.trim();
        if (!id) { consoleOut('Enter an id to redact.'); return; }
        if (!confirm('Redact ' + id + '?')) return;
        const r = await postJson('/api/redact' + realmParam(), Object.assign({ id: id, confirm: true }, ownerPassphrase()));
        consoleOut(r.ok ? 'Redacted ' + id + '.' : 'Redact failed: ' + (r.data.error || r.status));
      });
    }

    async function loadCandidates() {
      const listEl = document.querySelector('#candidateList');
      listEl.replaceChildren();
      const response = await api('/api/import/candidates' + realmParam());
      if (!response.ok) { consoleOut('Candidates failed: ' + response.status); return; }
      const items = await response.json();
      if (items.length === 0) { addText(listEl, 'div', 'No imported candidates.', 'muted'); return; }
      for (const item of items) {
        const card = document.createElement('div');
        card.className = 'candidate';
        addText(card, 'div', '[' + item.kind + '] from ' + item.provider, 'muted');
        addText(card, 'div', item.statement, 'stmt');
        const scopeInput = document.createElement('input');
        scopeInput.type = 'text'; scopeInput.placeholder = 'scope label';
        const sensSelect = document.createElement('select');
        for (const s of ['', 'public', 'internal', 'confidential']) {
          const o = document.createElement('option');
          o.value = s; o.textContent = s || '(declared)';
          sensSelect.appendChild(o);
        }
        const row = document.createElement('div');
        row.className = 'row';
        const promote = document.createElement('button');
        promote.type = 'button'; promote.className = 'act'; promote.textContent = 'Promote';
        promote.addEventListener('click', async function () {
          if (!scopeInput.value.trim()) { consoleOut('Enter a scope to promote.'); return; }
          const payload = Object.assign({ claim_id: item.claim_id, scope: scopeInput.value.trim(), sensitivity: sensSelect.value || undefined }, ownerPassphrase());
          const r = await postJson('/api/import/promote' + realmParam(), payload);
          if (r.ok) { consoleOut('Promoted ' + item.claim_id + '.'); await loadCandidates(); await loadScopes(); }
          else consoleOut('Promote failed: ' + (r.data.error || r.status));
        });
        const reject = document.createElement('button');
        reject.type = 'button'; reject.className = 'act danger'; reject.textContent = 'Reject';
        reject.addEventListener('click', async function () {
          const r = await postJson('/api/import/reject' + realmParam(), Object.assign({ claim_id: item.claim_id }, ownerPassphrase()));
          if (r.ok) { consoleOut('Rejected ' + item.claim_id + '.'); await loadCandidates(); }
          else consoleOut('Reject failed: ' + (r.data.error || r.status));
        });
        card.appendChild(scopeInput);
        card.appendChild(sensSelect);
        row.appendChild(promote);
        row.appendChild(reject);
        card.appendChild(row);
        listEl.appendChild(card);
      }
    }

    realmSelect.addEventListener('change', function () {
      activeRealm = realmSelect.value;
      loadScopes().catch(function (error) { clearSurface(error.message); });
    });
    select.addEventListener('change', function () { loadMemories({ preserveChat: false }).catch(function (error) { clearSurface(error.message); }); });
    collectionSearch.addEventListener('input', renderSidebarPanel);
    searchInput.addEventListener('input', render);
    sensitivitySelect.addEventListener('change', render);
    chatForm.addEventListener('submit', function (event) {
      event.preventDefault();
      runIntent(intentInput.value);
    });
    intentInput.addEventListener('input', autoResizeIntent);
    intentInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        runIntent(intentInput.value);
      }
    });
    for (const chip of document.querySelectorAll('[data-command]')) {
      chip.addEventListener('click', function () {
        intentInput.value = chip.getAttribute('data-command') || '';
        autoResizeIntent();
        runIntent(intentInput.value);
      });
    }
    document.querySelector('#mobileDrawer').addEventListener('click', function () {
      sidebarEl.classList.toggle('open');
      document.body.classList.remove('sidebar-collapsed');
    });
    document.querySelector('#collapseSide').addEventListener('click', function () {
      sidebarEl.classList.remove('open');
      document.body.classList.toggle('sidebar-collapsed');
    });
    for (const tab of sideTabs) {
      tab.addEventListener('click', function () {
        sideMode = tab.getAttribute('data-side-mode') || 'chat';
        collectionSearch.value = '';
        renderSidebarPanel();
      });
    }
    quickAction.addEventListener('click', function () {
      if (sideMode === 'chat') {
        runIntent('/clear');
        return;
      }
      collectionSearch.focus();
    });
    function setFunctionsOpen(open) {
      document.body.classList.toggle('functions-open', open);
      openFunctionsBtn.setAttribute('aria-expanded', String(open));
      if (open) closeFunctionsBtn.focus();
      else openFunctionsBtn.focus();
    }
    openFunctionsBtn.addEventListener('click', function () {
      setFunctionsOpen(!document.body.classList.contains('functions-open'));
    });
    closeFunctionsBtn.addEventListener('click', function () { setFunctionsOpen(false); });
    functionsScrim.addEventListener('click', function () { setFunctionsOpen(false); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && document.body.classList.contains('functions-open')) setFunctionsOpen(false);
    });
    document.querySelector('.attach').addEventListener('click', function () {
      intentInput.focus();
    });
    searchToggle.addEventListener('click', function () {
      document.body.classList.remove('sidebar-collapsed');
      intentInput.focus();
    });
    statusToggle.addEventListener('click', function () {
      runIntent('/status');
    });
    appearanceToggle.addEventListener('click', function () {
      document.body.classList.toggle('appearance-light');
      appearanceToggle.setAttribute('aria-pressed', String(document.body.classList.contains('appearance-light')));
      refreshToggleTitles();
    });
    languageToggle.addEventListener('click', function () {
      setLang(lang === 'ja' ? 'en' : 'ja');
    });
    modelSelect.addEventListener('change', async function () {
      const r = await postJson('/api/llm/model', { model: modelSelect.value });
      if (!r.ok) {
        consoleOut(t('modelSwitchFailed', r.data.error || r.status));
        await loadLlm();
      }
    });

    bindOwnerConsole();
    autoResizeIntent();
    applyLang();
    refreshToggleTitles();
    loadLlm();
    loadRealms()
      .then(loadScopes)
      .catch(function (error) {
        select.replaceChildren();
        select.disabled = true;
        clearSurface(error.message);
      });
  </script>
</body>
</html>
`;
}
