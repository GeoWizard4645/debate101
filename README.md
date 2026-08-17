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

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The AI tools on the main site read a Gemini
key from `config.js`; copy `config.example.js` to `config.js` and paste a key in
if you want to exercise them locally. In production the key is injected at deploy
time by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) from a
repository secret.

## Building the desktop app

```bash
cd desktop && npm install && npm start
```

See [`desktop/README.md`](desktop/README.md) for packaging installers.

## Credit

Cascade implements the `.ebb` file format from the
[ebb](https://github.com/shreerammodi/ebb) project by Shreeram Modi. Cascade is
an independent Debate 101 project and is not affiliated with or endorsed by ebb.
