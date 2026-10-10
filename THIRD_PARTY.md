# Third-party components

Filecairn bundles the following so it runs fully offline, with no requests to other servers.

## PDF.js (`vendor/pdfjs/`)
- Version 6.4.299 (`pdfjs-dist`), from https://github.com/mozilla/pdf.js. Apache License 2.0, © Mozilla. See `vendor/pdfjs/LICENSE`.
- Includes the standard fonts (Foxit and Liberation fonts, see `standard_fonts/LICENSE_*`), CMaps (Adobe, BSD-3-Clause) and WebAssembly decoders for JPEG 2000 (OpenJPEG, BSD-2-Clause), JBIG2 (PDFium, BSD-3-Clause) and color management (qcms, MIT); see `wasm/LICENSE_*`.

## pdf-lib (`vendor/pdf-lib/`)
- Version 1.17.1, from https://github.com/Hopding/pdf-lib. MIT License. See `vendor/pdf-lib/LICENSE.md`.

## fontkit (`vendor/fontkit/`)
- `@pdf-lib/fontkit` 1.1.1, https://github.com/Hopding/fontkit. MIT License. Loaded only when a text box contains characters outside Western European (WinAnsi) encoding, to embed Liberation Sans (bundled with PDF.js).

## Font library (`vendor/fonts/library/`)
- 50 free font families from the Google Fonts collection (https://github.com/google/fonts), all under the SIL Open Font License 1.1; each folder has its `LICENSE.txt`. Hosted on this site and loaded only when used: Arimo (stand-in for Arial, Helvetica), Tinos (stand-in for Times New Roman), Cousine (stand-in for Courier New), Carlito (stand-in for Calibri), Caladea (stand-in for Cambria), Gelasio (stand-in for Georgia), EB Garamond (stand-in for Garamond), Archivo Narrow (stand-in for Arial Narrow), Roboto, Open Sans, Source Sans 3, Lato, Inter, Noto Sans, Montserrat, Poppins, Nunito Sans, Work Sans, IBM Plex Sans, PT Sans, Fira Sans, Barlow, DM Sans, Manrope, Public Sans, Raleway, Mulish, Rubik, Merriweather, Lora, Libre Baskerville, Crimson Pro, PT Serif, Source Serif 4, Noto Serif, Playfair Display, Libre Caslon Text, Cormorant Garamond, Spectral, IBM Plex Serif, Source Code Pro, Roboto Mono, IBM Plex Mono, JetBrains Mono, Oswald, Bebas Neue, Dancing Script, Caveat, Great Vibes, Pacifico.

## Phosphor Icons (`js/icons.js`)
- Regular weight, from https://phosphoricons.com (`@phosphor-icons/core` 2.1.1). MIT License, © Phosphor Icons.
