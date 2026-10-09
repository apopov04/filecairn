#!/bin/sh
# Cloudflare Pages build: copy only the app into dist/ (no tests or dev files).
set -e
rm -rf dist && mkdir dist
cp -r index.html sw.js manifest.webmanifest _headers LICENSE THIRD_PARTY.md llms.txt robots.txt sitemap.xml css js icons vendor dist/
echo "Built dist/ ($(du -sh dist | cut -f1))"
