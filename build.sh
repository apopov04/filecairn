#!/bin/sh
# Cloudflare Pages build: copy only the app into dist/ (no tests or dev files).
set -e
rm -rf dist && mkdir dist
cp -r index.html sw.js manifest.webmanifest _headers LICENSE THIRD_PARTY.md llms.txt robots.txt sitemap.xml css js icons vendor dist/
# Version every app file's URL with this deploy's commit, so a browser can never
# mix a new page with old cached code (Cloudflare tells browsers to keep JS/CSS
# for hours). Vendor files are immutable and keep their URLs.
V=$(printf %s "${CF_PAGES_COMMIT_SHA:-$(date +%s)}" | cut -c1-8)
sed -i -E "s#(from \"\./[a-z0-9-]+\.js)\"#\1?v=$V\"#g; s#(import\(\"\./[a-z0-9-]+\.js)\"#\1?v=$V\"#g; s#(new URL\(\"\./[a-z0-9-]+\.js)\"#\1?v=$V\"#g" dist/js/*.js
sed -i -E "s#(href|src)=\"(js/main\.js|css/app\.css)\"#\1=\"\2?v=$V\"#g" dist/index.html
echo "Built dist/ ($(du -sh dist | cut -f1))"
