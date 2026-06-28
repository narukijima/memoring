# Memoring Web Panel Design QA

final result: passed

Reference used: `/Users/spesan/Downloads/チャットUIダッシュボード設計/チャットUI 案B.dc.html`

Prototype checked: `http://127.0.0.1:4320/#t=...`

Viewport checks:

- Desktop 1440x900: passed. Dark chat dashboard layout matches the selected reference direction: compact top bar, left collection rail, centered empty-state prompt, suggestion actions, and rounded composer.
- Desktop revised 1440x900: passed. Sidebar now owns the brand, chat/memory tabs, close control, and content stack; the top header belongs to the main region and uses icon-only search/status/appearance/language controls.
- Desktop two-column 1440x900: passed. The top header is removed; icon-only search/status/appearance/language controls now sit at the bottom of the left sidebar, ordered so the rightmost control is language. The left sidebar is the separate rounded panel; the right chat surface sits on the backmost grid background.
- Desktop chat-independent 1440x900: passed. The chat surface is also an independent rounded panel while the page grid remains visible behind both main surfaces.
- Desktop tabs 1440x900: passed. Sidebar tabs are functional: Chat shows chat log rows, Memory shows connected memory collections and management summary.
- Desktop chat surface 1440x900: passed. The chat panel no longer uses the background grid pattern internally.
- Desktop collapsed 1440x900: passed. Sidebar collapses to icon-only navigation without text overflow.
- Mobile 390x844: passed. Header, drawer control, prompt, suggestions, chips, and composer remain readable without overlap.
- Interaction: passed. Suggestion click submits into the chat flow and renders a conversation response.
- Interaction revised: passed. Search focuses the composer, status runs `/status`, appearance toggles light/dark, and language toggles `ja/en` state.
- Composer revised: passed. Manual textarea resizing is disabled and the input grows automatically with multi-line text.
- Composer balanced: passed. Composer height and tool chips were reduced for a tighter chat layout.

Notes:

- Product copy and safety semantics remain Memoring-specific rather than copying the placeholder Mnemo brand.
- External web search and deep research controls stay disabled because v0 Web UI does not execute those features.
