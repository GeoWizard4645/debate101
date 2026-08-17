# Cascade

**A keyboard-first flowing app for competitive debate.** Built by
[Debate 101](https://debate101.org).

Cascade runs in the browser at **[debate101.org/flow](https://debate101.org/flow/)**
and as a native desktop app (macOS, Windows, Linux) from [`../desktop`](../desktop).
Same codebase, same keybindings, same files.

It reads and writes **`.ebb`** files that are byte-compatible with
[ebb](https://github.com/shreerammodi/ebb) file version 3, so a flow moves
between the two apps without conversion.

---

## What it does

A flow is a grid: **rows are arguments, columns are speeches**. Columns are
derived from the round's event, so a neg off-case sheet introduced in the 1NC
starts at 1NC and the aff's answers land exactly one column to the right.

Supported events: **Policy, Lincoln–Douglas, Public Forum, Parliamentary.**

### The gestures that matter

| Key | What it does |
|---|---|
| `Tab` | Answer this argument — same row, next speech column |
| `⌘/Ctrl + Enter` | Start a new argument in the next column, aligned under this one |
| `Enter` | Commit and drop to the next row |
| `Alt + Enter` | Newline *inside* a cell |
| `⌘/Ctrl + K` | Kill a kicked argument (struck through, dimmed, excluded from drop detection) |
| `⌘/Ctrl + L` | Link an answer to the argument it answers |
| `⌘/Ctrl + ⇧ + D` | Jump to the next dropped argument |
| `⌘/Ctrl + ⇧ + B` | Block picker |
| `⌘/Ctrl + ⇧ + Space` | Start / stop the speech clock |
| `⌘/Ctrl + ⇧ + P` | Command palette |
| `?` | Every binding, generated from the live keymap |

Every binding is rebindable from the keymap editor.

## The six features beyond a plain grid

1. **Round Clock** — speech, prep and cross-ex clocks on official event times.
   Counts down, then counts *over*, so the flow records how far a speech ran
   long. Ending a speech arms the next one and walks the grid to its column.
2. **Answer links & dropped-argument radar** — link a response to what it
   answers; Cascade watches every row across every column and lists exactly what
   went unanswered, ranked by how much the drop matters.
3. **Voice Flow** — assisted capture that listens for the words that start a new
   argument ("next off", "turn", "extend", "cross-apply") and lays them down as
   rows while you keep typing tags. Runs through the browser's own speech
   service; Cascade uploads nothing.
4. **Block library** — type `;perm` and press `Tab`. Shells, frontlines and
   frameworks expand in place. Export the library as one JSON file and a whole
   team shares it.
5. **Round analytics** — coverage by side, time against the limit, flow density
   per speech, and a printable post-round report.
6. **Evidence tracker** — every cell you mark as a card becomes a cite entry with
   author, year and URL, exportable as a clean cite sheet.

## Files in, files out

**Import** (drag-and-drop anywhere, or the upload zone on the start screen — on
the web version too, not just desktop): `.ebb`, legacy ebb JSON backups
(`{kind: "backup"}`), `.csv`, `.tsv`, `.md`, `.txt`, Verbatim cases (`.docx`),
and Excel flow templates (`.xlsx`).

**Export**: `.ebb` native, `.ebb` strict (Cascade's extensions stripped for
maximum interop), `.json`, `.csv`, Markdown, plain text, a cite sheet, a
whole-library backup, and a landscape print layout for PDF.

## Privacy

No account, no server, no telemetry, no network calls. Flows live in a file on
your machine and in your browser's own storage. Autosave keeps a copy locally so
a dead laptop does not cost you a round.

## Running it

The web app has **no build step** — native ES modules, plain CSS. Serve the
repo root over any static server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/flow/>.

For the desktop app, see [`../desktop/README.md`](../desktop/README.md).

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module contracts, the full `.ebb`
format specification, and the Cascade extension namespaces.

## Credit

The `.ebb` file format is the work of the
[ebb](https://github.com/shreerammodi/ebb) project by Shreeram Modi. Cascade
implements it so the two apps interoperate. Cascade is an independent Debate 101
project and is not affiliated with or endorsed by ebb.

## License

Cascade and the rest of Debate 101 are released under the
[Debate 101 Non-Commercial Open Source License v1.0](../LICENSE) (D101-NC-OS-1.0):
free to use, modify, and redistribute for non-commercial purposes.
