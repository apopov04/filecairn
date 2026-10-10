<p align="center"><img src="icons/icon.svg" width="72" alt="Filecairn"></p>
<h1 align="center">Filecairn</h1>
<p align="center">Free, private PDF editor that runs in your browser. No ads, no account, nothing uploaded.</p>
<p align="center"><a href="https://filecairn.silicairn.com/"><b>Open Filecairn →</b></a></p>

Part of the Silicairn suite, alongside [Photocairn](https://photocairn.silicairn.com/) (photo editor).

## Features (v1.0)
- **Open** PDFs, JPG, PNG and WebP (images become pages). Drop, pick or paste files; open several to **merge** them.
- **Organise pages**: drag to reorder (several at once), rotate, duplicate, delete, insert blank pages. Undo/redo for everything.
- **Extract** selected pages to a new PDF, or **split** into parts (every N pages, or ranges like `1-3, 4-8, 9-`), downloaded as one ZIP.
- **Annotate**: highlight, underline or strike through text (drag over it), draw with a pen, add rectangles, ellipses, lines and arrows, text boxes and sticky notes. Pick colours from the colour well at the bottom of the tool rail (presets or a custom picker), set line width and text size with a slider or by typing the exact value, and choose a font: the built-in Helvetica, Times and Courier, a library of 50 free fonts hosted on this site (including look-alikes for Arial, Times New Roman, Calibri, Cambria, Georgia, Garamond and Courier New), fonts installed on your computer (Chrome/Edge), or your own .ttf/.otf files; plus bold and italic. Fonts download only when used and are embedded in the saved PDF. Select an annotation to move, resize (white handles: corners of shapes and drawings, ends of lines and arrows, the corner of text boxes to scale the text), restyle or delete it; click a text box with the Text tool to edit it. Tools sit in a rail on the left; on the right are the tool settings and a History panel (click a step to jump back or forward) with a draggable divider between them. Zoom with the buttons, Ctrl+scroll/pinch or + / − / 0. Highlights on text are placed under the text so it keeps its colour. Everything is undoable. On save, markups are drawn into the page so they look the same in every viewer (text boxes stay real, searchable text, with a Unicode font when needed), and sticky notes become real PDF comments.
- **Fill & sign**: fill in PDF forms (text, checkboxes, radio buttons, dropdowns) right on the page; answers are written into the saved file. Create a signature or initials by drawing, typing (handwriting font) or uploading a photo of a paper signature (the paper is removed), place and resize it, and add today's date. Signatures can be remembered in your browser; it's a visual signature, not a certificate-based one.
- **Redact for real**: drag boxes over areas, or search for text and patterns (email addresses, phone numbers, long numbers, IBANs) to mark every match. On save, marked pages are flattened to images with the boxes burned in, so the text, images, links and form fields underneath are gone, not just covered. Unmarked pages stay as they are.
- **Save** without carrying over the source's metadata (author, software, dates).
- Works **offline** once loaded, installable as an app.
- **Agent-friendly**: drive it with `window.filecairn` (see [`llms.txt`](llms.txt)).



## Privacy
Everything happens on your device. The page's Content Security Policy only allows it to load its own files, so documents can't be sent anywhere. Scripts embedded in PDFs are never run.

## Keyboard
Click to select, Ctrl/Cmd+click to add, Shift+click for a range. `Ctrl+A` all, `Esc` none, `Delete` remove, `R` / `Shift+R` rotate, `Ctrl+D` duplicate, `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo, `Ctrl+S` save, `Ctrl+O` add files, `Ctrl+F` find text in the document (`Enter` / `Shift+Enter` next/previous match).

## Development
Plain ES modules, no build step.
```sh
npm install            # dev only: pdf-lib for test fixtures, puppeteer-core for browser tests
npm start              # http://localhost:8080
npm test               # unit tests (page model, ranges, zip)
CHROME=/path/to/chrome URL=http://localhost:8080/ node tests/e2e/smoke.mjs   # also redact.mjs, annotate.mjs and sign.mjs
```
- `js/pages.js`: the page list model (pure, unit-tested). `js/engine.js`: loading, rendering (PDF.js) and building PDFs (pdf-lib). `js/main.js`: the UI. `js/api.js`: `window.filecairn`. `js/zip.js`: tiny ZIP writer. `js/redact.js`: text search to boxes (pure, unit-tested). `js/annots.js`: annotation model and drawing. `js/pageview.js`: the page editor (annotate + redact). `js/history.js`: History panel and the sidebar divider. `js/forms.js`: form fields and filling. `js/sign.js`: the signature dialog.
- Deployed on Cloudflare Pages: build command `sh build.sh`, output `dist`.

## License
MIT. Third-party components are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
