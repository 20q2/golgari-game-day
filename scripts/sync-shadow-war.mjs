// Copy the Shadow War artifacts into public/shadow-war/ as standalone pages.
//
// The source files are Artifact *body fragments* — they open with <title> and
// <style> and have no doctype, <head> or charset. Published on claude.ai the
// runtime wraps them; served from GitHub Pages nothing does, so the em dashes
// mojibake and mobile ignores the viewport. This adds the missing shell.
//
// Source lives outside the repo, so a missing source is a warning, not an
// error — a clean checkout still builds. Run manually after editing the kit:
//   npm run sync:shadow-war

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = 'a:/Coding/duxfurry/shadow-war';
const OUT_DIR = join(root, 'public', 'shadow-war');

const PAGES = [
  { src: 'player-handout.html', out: 'players.html', fallback: 'The Shadow War — Standing Orders' },
  { src: 'shadow-war-dm-kit.html', out: 'dm-kit.html', fallback: 'The Shadow War — DM Kit' },
];

// Mirrors the reset the Artifact runtime injects, minus its forced light
// color-scheme: these documents theme themselves off prefers-color-scheme.
const RESET = `:root{color-scheme:light dark}
    body{margin:0;padding:0}
    img{max-width:100%}
    [hidden]{display:none!important}`;

function wrap(fragment, fallbackTitle) {
  let body = fragment;
  let title = fallbackTitle;

  // Hoist the fragment's own <title> into the head where it belongs.
  const m = body.match(/^\s*<title>([\s\S]*?)<\/title>\s*/);
  if (m) {
    title = m[1].trim();
    body = body.slice(m[0].length);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
    ${RESET}
</style>
</head>
<body>
${body.replace(/\s*$/, '')}
</body>
</html>
`;
}

if (!existsSync(SRC_DIR)) {
  console.warn(`[sync-shadow-war] source not found at ${SRC_DIR} — leaving public/shadow-war as-is.`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const page of PAGES) {
  const from = join(SRC_DIR, page.src);
  if (!existsSync(from)) {
    console.warn(`[sync-shadow-war] missing ${from} — skipped.`);
    continue;
  }
  const html = wrap(readFileSync(from, 'utf8'), page.fallback);
  writeFileSync(join(OUT_DIR, page.out), html, 'utf8');
  console.log(`[sync-shadow-war] ${page.src} -> public/shadow-war/${page.out} (${html.length.toLocaleString()} chars)`);
}
