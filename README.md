<p align="center"><img src="icons/icon.svg" width="72" alt="Filecairn"></p>
<h1 align="center">Filecairn</h1>
<p align="center">Free, private PDF editor that runs in your browser. No ads, no account, nothing uploaded.</p>
<p align="center"><a href="https://filecairn.silicairn.com/"><b>Open Filecairn →</b></a></p>

Part of the Silicairn suite, alongside [Photocairn](https://photocairn.silicairn.com/) (photo editor).

## Features (v0.1)
- **Open** PDFs, JPG, PNG and WebP (images become pages). Drop, pick or paste files; open several to **merge** them.
- **Organise pages**: drag to reorder (several at once), rotate, duplicate, delete, insert blank pages. Undo/redo for everything.
- **Extract** selected pages to a new PDF, or **split** into parts (every N pages, or ranges like `1-3, 4-8, 9-`), downloaded as one ZIP.
- **Save** without carrying over the source's metadata (author, software, dates).
- Works **offline** once loaded, installable as an app.
- **Agent-friendly**: drive it with `window.filecairn` (see [`llms.txt`](llms.txt)).

Coming next: redaction (real removal, not black boxes), highlights and annotations, fill & sign, adding text.

## Privacy
Everything happens on your device. The page's Content Security Policy only allows it to load its own files, so documents can't be sent anywhere. Scripts embedded in PDFs are never run.

## Keyboard
Click to select, Ctrl/Cmd+click to add, Shift+click for a range. `Ctrl+A` all, `Esc` none, `Delete` remove, `R` / `Shift+R` rotate, `Ctrl+D` duplicate, `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo, `Ctrl+S` save, `Ctrl+O` add files.

## Development
Plain ES modules, no build step.
```sh
npm install            # dev only: pdf-lib for test fixtures, puppeteer-core for browser tests
npm start              # http://localhost:8080
npm test               # unit tests (page model, ranges, zip)
CHROME=/path/to/chrome URL=http://localhost:8080/ node tests/e2e/smoke.mjs
```
- `js/pages.js`: the page list model (pure, unit-tested). `js/engine.js`: loading, rendering (PDF.js) and building PDFs (pdf-lib). `js/main.js`: the UI. `js/api.js`: `window.filecairn`. `js/zip.js`: tiny ZIP writer.
- Deployed on Cloudflare Pages: build command `sh build.sh`, output `dist`.

## License
MIT. Third-party components are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
