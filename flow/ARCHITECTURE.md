# Cascade — architecture & module contracts

Cascade is Debate 101's keyboard-first flowing app. It runs as a static web app
(`https://debate101.org/flow/`) and as a desktop app (Electron shell in
`/desktop`, loading the exact same files). One codebase, two shells.

It reads and writes **`.ebb`** files — byte-compatible with
[ebb](https://github.com/shreerammodi/ebb) file version 3 — so a flow moves
between the two apps without conversion.

## Hard rules

1. **No build step.** Native ES modules, plain CSS, no bundler, no TypeScript,
   no npm for the web app. GitHub Pages serves the repo root as-is.
2. **No CDN dependency for anything load-bearing.** Fonts may come from Google
   Fonts with a system fallback; everything else is local. The app must work
   fully offline (a debate round has no wifi).
3. **No network calls.** Every feature is client-side. Flows never leave the
   machine.
4. **Modules never import each other's feature modules.** They import from
   `model.js`, `ebbfile.js`, `store.js`, `ui.js`, `registry.js`, `bus.js`,
   `dom.js` only. Cross-feature messages go over the bus.
5. **Every file starts with a comment saying what it is and why.** Match the
   house style: explain the *why*, not the *what*.
6. Target evergreen Chrome/Edge/Safari/Firefox. Feature-detect anything else
   (File System Access API, Web Speech API) and degrade gracefully.

## Layout

```
flow/
  index.html          the app shell markup (shell agent)
  app.css             all styles, CSS custom properties (shell agent)
  js/
    bus.js            pub/sub                              [WRITTEN]
    dom.js            el(), $, fmtClock, download, ...     [WRITTEN]
    registry.js       commands + keybindings               [WRITTEN]
    events.js         debate event/speech/timing tables
    model.js          FlowRound model + helpers
    ebbfile.js        .ebb serialize / parse / validate
    store.js          state, undo/redo, autosave, files
    ui.js             shell services: panels, modals, toasts, toolbar, status
    sheets.js         sheet sidebar
    grid.js           the flow grid editor
    timers.js         FEATURE 1
    links.js          FEATURE 2
    voice.js          FEATURE 3
    blocks.js         FEATURE 4
    insights.js       FEATURE 5 + 6 (analytics + evidence tracker)
    exports.js        import / upload / export
    palette.js        command palette, keymap editor, cheatsheet
    main.js           wiring (integration)
```

---

## The `.ebb` file format (authoritative)

A `.ebb` file is pretty-printed JSON (2-space indent, trailing newline):

```jsonc
{
  "version": 3,
  "round": {
    "id": "round_...",
    "createdAt": 1700000000000,
    "updatedAt": 1700000000000,
    "event": "policy" | "pf" | "ld" | "parli",     // optional, default "policy"
    "firstSide": "aff" | "neg",                     // optional, default "aff"
    "scouting": {
      "affSchool": "", "negSchool": "",
      "aff": { "first": {"first":"","last":""}, "second": {"first":"","last":""} },
      "neg": { "first": {"first":"","last":""}, "second": {"first":"","last":""} },
      "tournament": "", "round": "", "flight": "", "date": "", "judge": "",
      "decision": { "vote": "aff"|"neg", "rfd": "", "peerNotes": {} }
    },
    "sheets": [
      {
        "id": "sheet_...",
        "title": "1.",
        "group": "aff" | "neg",
        "order": 0,                      // number; CX sheet is -1
        "kind": "flow" | "cx",           // optional, default "flow"
        "startSpeechId": "1nc",          // optional
        "data": [["cell", null], ["..."]],           // rows of (string|null)
        "meta": { "0,1": { "bold": true, "highlight": true,
                           "card": true, "group": true, "kicked": true,
                           "answers": {"sheetId":"","row":0,"col":0},
                           "source": {"app":"","token":"","key":"","title":""} } }
      }
    ]
  }
}
```

Validation is strict and fails with the **path to the bad value**
(`Invalid flow file: round.sheets[2].data[4][1] is not text or null`). Limits:
`MAX_FLOW_BYTES = 64 * 1024 * 1024`, `MAX_ROUND_CELLS = 2_000_000`
(counted per sheet as `rows * widest row`, summed).

### Cascade extensions

Everything Cascade adds beyond ebb lives under two namespaced keys. ebb's
parser preserves unknown keys (`normalizeFlow` spreads `...rest`), so a Cascade
file opens in ebb with the extras intact and inert, and a round-trip through
ebb does not lose them.

- `round.cascade` — see `ensureCascade()` in `model.js`.
- `meta["r,c"].cascade` — per-cell Cascade decoration.

`exports.js` offers **"Export .ebb (strict)"** which strips both namespaces for
maximum interop, and **"Export .ebb"** which keeps them. Native saves keep them.

---

## `events.js` — debate events, speeches, and official times

Ported from ebb's `src/lib/format/events.ts`, plus timing. Exports:

```js
export const EVENTS          // Record<EventId, EventDef>, ids: policy | pf | ld | parli
export function getEvent(id)              // unknown id => policy
export function sideLabels(id)            // { aff: {label, speakers}, neg: {...} }
export function speechOrder(event, firstSide) // SpeechDef[] — strict alternation
export function speechTerms(speech)       // searchable string
export function eventList()               // [{id, name}] for pickers
```

`SpeechDef = { id, name, short, side, aliases?, seconds }`. Speech definitions
must match ebb exactly (ids, names, shorts, aliases, side, order) — that is what
makes column layout agree between the apps. `seconds` and the prep table are new:

| event  | speeches (seconds)                                                     | prep per side |
|--------|------------------------------------------------------------------------|---------------|
| policy | 1AC 480, 1NC 480, 2AC 480, Block 480, 1AR 300, 2NR 300, 2AR 300         | 480           |
| ld     | 1AC 360, 1NC 420, 1AR 240, 2NR 360, 2AR 180                             | 240           |
| pf     | AC/NC 240, AR/NR 240, AS/NS 180, AF/NF 120                              | 180           |
| parli  | PM 420, LOC 480, MGC 480, Block 480, PMR 300                            | 0 (no prep)   |

Also export cross-ex period lengths: policy/ld CX 180s, PF first/second cross
180s, grand cross 180s.

```js
export const PREP_SECONDS    // Record<EventId, number>
export const CX_SECONDS      // Record<EventId, number>
export function speechSeconds(eventId, speechId)  // number, 0 when unknown
```

Add a `TIMER_PRESETS` export for common variants a debater actually meets
(e.g. `"policy-novice"` with 8-minute prep, `"ld-nsda"`, `"pf-nsda"`,
`"parli-npda"`); shape `{id, label, eventId, speeches: {speechId: seconds}, prep, cx}`.

---

## `model.js` — the round model

Ported from ebb's `src/lib/model/flow.ts`, same names and semantics:

```js
export function uid(prefix)                          // `${prefix}_${8 rand chars}`
export function emptyScouting()
export function makeFlowSheet({title, group, order})
export function makeCxFlowSheet(title = "CX")        // order -1, kind "cx"
export function makeFlowRound({event, firstSide} = {})
export function normalizeFlow(raw)                   // fills defaults, never mutates
export function compareSheets(a, b)
export function sortedSheets(round)
export function firstFlowSheetId(round)
export function sheetRangeIds(sheets, anchor, head)
export function moveSheetRange(orderedIds, selectedIds, delta)
export function dropSheetRange(orderedIds, selectedIds, grabbedId)
```

Plus Cascade-only helpers:

```js
export const CELL_KEY = /^\d+,\d+$/
export function cellKey(row, col)                    // `${row},${col}`
export function getCell(sheet, row, col)             // string ("" when absent)
export function setCell(sheet, row, col, text)       // grows data, mutates sheet
export function getMeta(sheet, row, col)             // CellMeta | undefined
export function setMeta(sheet, row, col, patch)      // merge; deletes empty entries
export function sheetById(round, id)
export function paddedCells(rows)                    // rows * widest row

/**
 * The speech columns a sheet shows: the round's full alternating speech order
 * sliced from the sheet's first speech. A neg off-case sheet introduced in the
 * 1NC therefore starts at 1NC and the aff's answers land one column right.
 * CX sheets return one column per cross-ex period instead.
 */
export function sheetColumns(round, sheet)           // SpeechDef[] (CX: {id, name, short, side})

export function ensureCascade(round)                 // mutates + returns round.cascade
```

`round.cascade` shape — create every key, empty:

```js
{
  v: 1,
  links: [],        // links.js:    {id, from:{sheetId,row,col}, to:{sheetId,row,col}, kind, note}
  blocks: [],       // blocks.js:   {id, trigger, title, body, tags:[], event, uses}
  evidence: [],     // insights.js: {id, sheetId, row, col, cite, author, year, url, tag, strength}
  timeline: [],     // timers.js:   {speechId, startedAt, endedAt, seconds, overBy}
  prep: {},         // timers.js:   {aff: secondsRemaining, neg: secondsRemaining}
  notes: "",        // scratchpad / RFD prep
  prefs: {}         // per-round view prefs (column widths, hidden columns)
}
```

Per-cell `meta["r,c"].cascade`:
```js
{ color: "amber"|"rose"|"sky"|"lime"|"violet", star: true, flagged: true,
  answered: true, voter: true, ts: 1700000000000 /* when typed, for analytics */ }
```

---

## `ebbfile.js` — the file format

```js
export const FLOW_FILE_VERSION = 3
export const MAX_FLOW_BYTES = 64 * 1024 * 1024
export const MAX_ROUND_CELLS = 2_000_000

export function serializeFlow(round, {strict = false} = {})  // -> string; strict strips cascade keys
export function parseFlowFile(text)      // -> FlowRound, preserves identity; throws Error with path
export function parseLegacyExport(text)  // -> FlowRound[], fresh ids (handles {kind:"backup"})
export function checkRound(value, path)  // throws; returns the round
export function isFlowFileText(text)     // cheap sniff, no throw
export function suggestFilename(round)   // "Harvard R3 — Aff vs Bronx BC.ebb", filesystem-safe
```

Error messages must read `Invalid flow file: <path> <expectation>`.

---

## `store.js` — state, history, persistence

Single mutable round plus derived view state. Everything that changes the round
goes through `commit()`.

```js
export const store = {
  // --- reading (never mutate the returned round outside commit) ---
  get round(),                    // FlowRound
  get activeSheetId(),
  get activeSheet(),              // FlowSheet | null
  get selection(),                // {row, col, anchorRow, anchorCol}
  get dirty(),                    // boolean
  get fileName(),                 // string | null
  get canUndo(), get canRedo(),
  get cascade(),                  // round.cascade (ensured)

  // --- writing ---
  /**
   * Apply a mutation to the round and push an undo entry.
   * @param {(round) => void} mutator  mutate the draft in place
   * @param {{label?: string, coalesce?: string, silent?: boolean}} [opts]
   *   coalesce: consecutive commits with the same key collapse into one undo
   *   entry (typing in a cell is one undo, not one per keystroke).
   */
  commit(mutator, opts),
  undo(), redo(),
  setRound(round, {fileName, markClean = true}),   // open / new / import
  setActiveSheet(id),
  setSelection({row, col, anchorRow, anchorCol}),
  markSaved(fileName),

  // --- persistence ---
  save(),            // Promise<boolean> — writes to the current handle, else saveAs
  saveAs(),          // Promise<boolean>
  open(),            // Promise<boolean> — picker; falls back to <input type=file>
  openFile(file),    // Promise<boolean> — a File/Blob (drag-drop, upload flow)
  newRound(opts),    // {event, firstSide}
  recents(),         // Promise<[{id, name, updatedAt, event, tournament}]>
  restoreRecent(id),
  subscribe(fn),     // fn(state) on any change; returns unsubscribe
}
```

- **Autosave** to IndexedDB (`cascade-flows`) every 2s of idle after a change,
  and on `visibilitychange`/`beforeunload`. On load, offer to restore the most
  recent autosave. This is the safety net when a laptop dies mid-round.
- **File System Access API** when available (`showSaveFilePicker`, `.ebb`
  extension, `types: [{description: "Debate flow", accept: {"application/json": [".ebb"]}}]`),
  so `Mod+S` after the first save writes silently to the same file. Otherwise
  fall back to a download and keep autosave as the source of truth.
- Emits on the bus: `round:change`, `sheet:change`, `selection:change`,
  `save:state` (`{dirty, fileName, savedAt}`), `file:opened`.
- `beforeunload` warns while `dirty`.
- Undo stack cap: 200 entries, structural-clone snapshots of `round` (a round is
  small; a diff engine is not worth the bug surface here).

---

## `ui.js` — shell services

Owned by the shell agent alongside `index.html` / `app.css`.

```js
export const ui = {
  /** Register a right-dock panel. Returns an unregister fn. */
  registerPanel({id, title, icon, order = 100, mount(el), onShow?, onHide?}),
  showPanel(id), hidePanel(), togglePanel(id), activePanel(),

  /** Toolbar buttons. slot: "left" | "center" | "right". */
  addToolbarButton({id, label, icon, title, slot = "right", onClick, active?}),
  setToolbarButtonState(id, {active, disabled, label}),

  /** Status bar segments, right-aligned in registration order. */
  setStatus(id, htmlOrNode),
  clearStatus(id),

  /** Modal dialog. Resolves to the id of the action clicked, or null on Esc. */
  modal({title, body /* Node|string */, actions: [{id, label, primary?, danger?}],
         width?, onMount?}),               // -> Promise<string|null>
  confirm(message, {title, confirmLabel, danger}),   // -> Promise<boolean>
  prompt(message, {title, value, placeholder}),      // -> Promise<string|null>

  toast(message, {type = "info"|"success"|"warn"|"error", ms = 3200} = {}),

  theme(),                 // "dark" | "light"
  setTheme(name),

  /** A floating heads-up overlay pinned above the grid (timers use this). */
  hud(),                   // HTMLElement
}
```

DOM contract (the shell guarantees these exist before `main.js` runs):

| id / class        | purpose                                          |
|-------------------|--------------------------------------------------|
| `#app`            | root                                             |
| `#topbar`         | with `.slot-left`, `.slot-center`, `.slot-right` |
| `#sidebar`        | sheets.js mounts here                            |
| `#grid-host`      | grid.js mounts here                              |
| `#dock`           | panel host (`#dock-tabs`, `#dock-body`)          |
| `#hud`            | floating overlay above the grid                  |
| `#statusbar`      | status segments                                  |
| `#modal-root`     | modals + toasts                                  |

### Design tokens (`app.css`)

```
--d1-navy:  #051C2C   --d1-accent: #0072b1   --d1-accent-2: #38bdf8
--aff: #10b981        --neg: #f43f5e         --card: #fbbf24
```
Dark theme is the default (rounds happen in dim rooms and a white grid at 2am
is a real complaint); `[data-theme="light"]` overrides. Every color goes through
a custom property — no hard-coded hex outside `:root`. Type: Inter (UI) and a
monospace stack for the grid. Density is the point: the grid should fit ~40 rows
on a 13" laptop at the default zoom.

---

## `grid.js` — the flow editor

The centerpiece. A sheet is a grid: **rows = arguments, columns = speeches**.

- Renders the active sheet as a real `<table>` inside a virtualized scroller
  (render only rows in view + 20 overscan; a sheet can hold thousands of rows).
- Cells are single-click-to-select, type-to-replace, Enter/double-click to edit
  (a `<textarea>` overlay sized to the cell, auto-growing).
- **Keyboard-first, and this is the whole product.** Arrows move; `Tab` /
  `Shift+Tab` move a column; `Enter` commits and moves down; `Alt+Enter` inserts
  a newline inside a cell; `Esc` cancels the edit; `Shift+arrows` extend a
  selection; `Mod+Backspace` deletes the row; `Mod+O` inserts a row above,
  `Mod+Shift+O` below; typing in the last row appends a new row automatically.
- **The flowing gesture that matters:** from a cell in column *n*, `Tab` puts
  you in the same row of column *n+1* — that is how a debater answers an
  argument. `Mod+Enter` starts a new row in the *next* column, aligned under the
  argument being answered.
- Formatting via `registry` commands, applied to the selection, stored in
  `meta`: `Mod+B` bold, `Mod+Shift+H` highlight, `Mod+T` card, `Mod+G` group,
  `Mod+K` kicked (renders struck through and dimmed — the argument is dead).
  Cascade adds `Mod+1..5` for the five `cascade.color` swatches and `Mod+Shift+S`
  star.
- Column headers show the speech `short` and are tinted by side (aff/neg).
  The column for the speech currently running (from the bus topic
  `timer:speech`) gets a live accent border.
- Clipboard: copy/paste a rectangular selection as TSV, so a flow moves in and
  out of Excel/Google Sheets. Paste grows the grid.
- Find within sheet (`Mod+F`) highlighting matches, `Enter` cycles.
- Emits `grid:cellChanged {sheetId,row,col,text}`, `grid:selection {sheetId,row,col}`,
  and listens for `grid:goto {sheetId,row,col}` (links, search, analytics jump here)
  and `grid:insertText {text, atNewRow}` (voice + blocks push text in).

Exports: `export function mountGrid(host)`, `export const grid = { focus(), goto(sheetId,row,col), insertText(text,{newRow}), getSelectionRect(), refresh() }`.

---

## Feature modules

Each exports `export function init()` (called by `main.js` after the shell and
store exist) and registers its own commands, panels, and toolbar buttons. Each
must work when the round has no data for it, and must persist everything into
`round.cascade` through `store.commit()`.

### FEATURE 1 — `timers.js`: Round Clock
Speech clock + per-side prep clock + cross-ex clock, wired to the event's
official times (`events.js`). Requirements:
- HUD readout above the grid (large, legible across a room), plus a dock panel
  with the full round timeline.
- Auto-advance: ending a speech arms the next speech in `speechOrder`, and moves
  the grid's active column to it (`bus.emit("grid:goto", ...)`) and emits
  `timer:speech {speechId, side, running}` so the grid can highlight the column.
- Prep clocks: press to run one side's prep, press again to stop; remaining prep
  persists in `round.cascade.prep`. Never let prep go negative — it stops at 0
  and turns red.
- Counts **down** by default with an over-time count-up past zero (debaters go
  over; the flow should record by how much). Audible + visual alert at 30s and
  at 0, honoring a mute toggle (`Web Audio` beep, no asset files).
- Every completed speech appends to `round.cascade.timeline`.
- Commands: `timer.startStop`, `timer.next`, `timer.reset`, `timer.prepAff`,
  `timer.prepNeg`, `timer.mute`. Chords: `Mod+Shift+Space` start/stop,
  `Mod+Shift+ArrowRight` next speech, `Mod+Shift+A`/`Mod+Shift+N` prep.
- Keeps time against `performance.now()` deltas, not a per-tick decrement, so a
  backgrounded tab does not lose seconds.

### FEATURE 2 — `links.js`: Answer Links & Dropped-Argument Radar
- Link a cell to the cell it answers (`Mod+L` starts a link from the selection,
  next cell click or `Mod+L` again completes it). Stored in
  `round.cascade.links` *and* mirrored into ebb's native `meta.answers` so ebb
  shows it too.
- Draw links as SVG curves over the grid between visible cells (redraw on scroll
  and resize; skip when either end is offscreen).
- **Dropped-argument radar**: for each non-empty cell in speech column *n*, if
  the row has nothing in column *n+1* (the opponent's next speech) and no link
  answering it, it is dropped. Panel lists every dropped argument grouped by
  sheet with a click-to-jump, a count badge on the dock tab, and a
  `Mod+Shift+D` "next dropped argument" command. Ignore cells marked `kicked`.
- An "extension chain" view: follow one argument's row across every column and
  show where it died.

### FEATURE 3 — `voice.js`: Voice Flow (assisted capture)
- `webkitSpeechRecognition` / `SpeechRecognition`, `continuous`, `interimResults`.
  Feature-detect: when absent, the panel explains that the browser does not
  support it and offers the desktop app / Chrome. **Never break the app.**
- Interim text streams into a live "listening" strip; final phrases are pushed
  into the grid at the current cell, one new row per detected sentence
  (`bus.emit("grid:insertText", {text, newRow: true})`), so a debater flows the
  tag while the transcript catches the warrant.
- A **keyword catcher**: user-configurable trigger words (defaults: "first",
  "second", "next off", "turn", "extend", "cross-apply", "impact") start a new
  row automatically — that is what makes it usable at speed.
- A full transcript log per speech in the panel with timestamps, searchable, and
  exportable to text. Store the transcript under
  `round.cascade.transcript = [{speechId, at, text}]` (add the key in `ensureCascade`).
- Mic permission is requested only when the user starts it, and the panel shows
  a clear recording indicator. Nothing is uploaded — say so in the panel.

### FEATURE 4 — `blocks.js`: Block Library & Autotext
- A searchable library of pre-written responses/blocks, stored in
  `localStorage` (`cascade.blocks`, shared across rounds) and optionally into
  the round.
- **Trigger expansion**: typing a trigger (`;perm`, `;framework`) in a cell and
  pressing `Tab` expands it to the block body. This is the killer feature — a
  debater types `;t-fw` and gets their whole T shell.
- `Mod+Shift+B` opens a fuzzy block picker over the grid; Enter inserts at the
  cursor, `Mod+Enter` inserts as a new row.
- Blocks are grouped by tag and by event, importable/exportable as JSON so a
  team shares one library. Include ~15 useful starter blocks (perm shells,
  theory shells, standard framework answers) seeded on first run, clearly marked
  as editable examples.
- Track `uses` so the picker sorts by what the debater actually reaches for.

### FEATURE 5 + 6 — `insights.js`: Round Analytics + Evidence Tracker
Two panels from one module.
- **Analytics**: after (or during) a round — time spent per speech vs. the
  official limit, words/lines flowed per speech, coverage (arguments answered ÷
  arguments made) per side, dropped-argument counts, per-column density
  sparkline, cards read per side. Rendered as inline SVG (no chart library).
  A "Post-round report" button produces a printable summary.
- **Evidence tracker**: any cell marked as a card (`meta.card`) is collected
  into a cite list; the panel lets a debater fill in author, year, publication,
  and URL per card, tag it (`aff`, `neg`, `impact`, `link`, `card of the round`),
  and export the whole list as a formatted cite sheet (Markdown + plain text) to
  paste into a post-round email or a doc. Stored in `round.cascade.evidence`,
  keyed by cell.
- Both panels update live off `round:change`, debounced.

---

## `exports.js` — import, upload, export

- **Upload / import flow (web *and* desktop)**: a drop zone on the start screen
  and a `Mod+Shift+I` command. Accepts:
  - `.ebb` (file version 3) — opens as a document, identity preserved
  - `.json` legacy ebb exports, including `{kind: "backup", rounds: [...]}` —
    imported with fresh ids, one sheet-set per round, user picks which
  - `.csv` / `.tsv` — one sheet, columns mapped to speeches in order
  - `.txt` / `.md` — one column, one line per row
  - `.docx` — via the `mammoth` global **only if already loaded**; otherwise
    offer a clear "paste the text instead" path. Do not add a CDN dependency.
  Drag-and-drop anywhere in the app window works, with a full-window drop
  overlay. Multiple files queue.
- **Exports**: `.ebb` (native, with extensions), `.ebb` strict (interop),
  `.json`, `.csv` (per sheet + a combined workbook-style multi-sheet CSV zip is
  *not* needed — a per-sheet picker is), `.md`, `.txt`, printable HTML → PDF via
  `window.print()` with a dedicated print stylesheet (landscape, one sheet per
  page, columns preserved), and a **cite sheet** export.
- An "Export everything" backup writes `{version:3, kind:"backup", rounds:[...]}`
  across every autosaved round, matching ebb's legacy backup shape so ebb can
  read it.
- All exports go through `dom.js`'s `download()`, or the File System Access API
  when present.
- Commands under the "File" category, and a toolbar Export menu.

## `palette.js` — command palette, keymap, help

- `Mod+Shift+P` (and `Mod+P` for a sheet quick-switcher) opens a fuzzy palette
  over every registered command, showing its chord. Arrow keys + Enter.
  Recently-run commands float to the top.
- `?` (when not editing a cell) opens the keyboard cheatsheet, generated from
  the registry so it can never drift from the real bindings.
- A keymap editor in a modal: click a chord, press a new one, it rebinds; stored
  in `localStorage` (`cascade.keymap`) and applied over the defaults at boot.
- Owns the single global `keydown` listener: resolve the chord through
  `registry.lookup()` and run it, **unless** the event target is a text input or
  the grid is in edit mode and the chord is a bare key. Call `preventDefault()`
  only when a command actually ran.

---

## `main.js` (integration — do not write this)

Boots in order: theme → shell → store (restore autosave) → grid → sheets →
features → palette → start screen. Agents must not create or edit `main.js`,
`index.html`, `app.css`, `bus.js`, `dom.js`, or `registry.js` unless they own it.

## Style

- 4-space indent, double quotes, semicolons, `const` by default.
- JSDoc on every exported function. Comments explain *why*.
- No `innerHTML` with user text — use `textContent` or `esc()`.
- Accessible: real buttons, `aria-label`s, visible focus rings, `role="grid"`
  on the flow table.
