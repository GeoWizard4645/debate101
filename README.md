# Debate 101

Debate 101 is an unincorporated non-profit collective bridging the gap between
novice learners and elite competition through tools, community, and strategy.

**[debate101.org](https://debate101.org)** · [Discord](https://discord.debate101.org)
· [Instagram](https://instagram.debate101.org) · [YouTube](https://youtube.debate101.org)

Vivaan Shahani · Arjun Gupta · Max McBride · Max Feinstein

## What's in this repo

| Path | What it is |
|---|---|
| [`index.html`](index.html) | The main site — a single-page app served straight from GitHub Pages |
| [`flow/`](flow/) | **Cascade**, our keyboard-first flowing app for web and desktop |
| [`desktop/`](desktop/) | The Electron shell that packages Cascade as a native app |
| [`tools/card-cutter/`](tools/card-cutter/) | Cut, highlight and cite debate evidence in the browser |
| [`tools/speed-trainer/`](tools/speed-trainer/) | Spreading practice with a live WPM meter and a clarity score |
| [`tools/round-tracker/`](tools/round-tracker/) | Competition record, judge book, and scouting book |
| [`data/content.json`](data/content.json) | Team bios, resources and lecture data the site loads at runtime |

Everything is static and client-side. No build step, no server, no accounts.

## Cascade

[Cascade](flow/) is a flowing app for Lincoln–Douglas, Policy, Public Forum and
Parliamentary debate. It runs at
**[debate101.org/flow](https://debate101.org/flow/)** and as a desktop app, works
fully offline, and reads and writes `.ebb` files that are byte-compatible with
[ebb](https://github.com/shreerammodi/ebb) — so a flow moves between the two
apps without conversion.

Beyond the grid: speech/prep/cross-ex timers on official times, dropped-argument
detection, answer links, voice-assisted capture, a block library with trigger
expansion, round analytics, and an evidence tracker.

See [`flow/README.md`](flow/README.md) and
[`flow/ARCHITECTURE.md`](flow/ARCHITECTURE.md).

## Running the site locally

The main site is a **Vite + React** app and needs a build. Cascade and the
standalone tools are not — they are plain static apps that get copied into the
output untouched.

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. `/flow` and `/tools` resolve in dev too,
because Vite serves the project root statically.

```bash
npm run build     # -> dist/
npm run preview   # serve dist/ exactly as it will deploy
```

### Where to edit what

| You want to change | Edit |
|---|---|
| Site copy, layout, design | `src/` (`pages/`, `components/`, `styles/`) |
| Resources, lectures, team bios, FAQ | `data/content.json` — no rebuild needed to change data, only to change how it renders |
| Cascade | `flow/` — plain ES modules, no build step |
| Card Cutter / Speed Trainer / Round Tracker | `tools/<name>/index.html` — self-contained, no build step |

`index.html` at the repo root is now the Vite entry point, not the site itself.
The previous single-file site is preserved verbatim at
[`legacy/index.html`](legacy/index.html).

The AI features run **on-device** (see `src/lib/ai.js`), so no API key is
required; `config.example.js` explains what is left of the old key plumbing.

### Images

Team headshots in `assets/` are full-resolution originals (46 MB in total). The
site serves 640px derivatives from `assets/opt/`, and the build deliberately
leaves the originals out of `dist/`. Regenerate the derivatives after adding a
photo:

```bash
sips -s format jpeg -s formatOptions 78 -Z 640 assets/NAME.png --out assets/opt/NAME.jpg
```

## Building the desktop app

```bash
cd desktop && npm install && npm start
```

See [`desktop/README.md`](desktop/README.md) for packaging installers.

## License

This project is open source under the **Debate 101 Non-Commercial Open Source
License v1.0** ([`LICENSE`](LICENSE), SPDX: `D101-NC-OS-1.0`).

You may use, copy, modify, and redistribute the code freely for **non-commercial**
purposes — school debate prep, teaching, research, team workflows, and community
hosting at no charge. Commercial use (selling the software, paid access, or
using it as part of a for-profit product or service) is not permitted without
separate written permission from the Debate 101 Collective.

## Credit

Cascade implements the `.ebb` file format from the
[ebb](https://github.com/shreerammodi/ebb) project by Shreeram Modi. Cascade is
an independent Debate 101 project and is not affiliated with or endorsed by ebb.
