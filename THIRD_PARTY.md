# Third-party components

Filecairn bundles the following so it runs fully offline, with no requests to other servers.

## PDF.js (`vendor/pdfjs/`)
- Version 6.4.299 (`pdfjs-dist`), from https://github.com/mozilla/pdf.js. Apache License 2.0, © Mozilla. See `vendor/pdfjs/LICENSE`.
- Includes the standard fonts (Foxit and Liberation fonts, see `standard_fonts/LICENSE_*`), CMaps (Adobe, BSD-3-Clause) and WebAssembly decoders for JPEG 2000 (OpenJPEG, BSD-2-Clause), JBIG2 (PDFium, BSD-3-Clause) and color management (qcms, MIT); see `wasm/LICENSE_*`.

## pdf-lib (`vendor/pdf-lib/`)
- Version 1.17.1, from https://github.com/Hopding/pdf-lib. MIT License. See `vendor/pdf-lib/LICENSE.md`.

## Phosphor Icons (`js/icons.js`)
- Regular weight, from https://phosphoricons.com (`@phosphor-icons/core` 2.1.1). MIT License, © Phosphor Icons.
