// Scans public/undercity/player_sprites/ and writes a manifest the dev-only
// color-test sandbox (src/app/undercity/color-test) reads to populate its
// sprite dropdown — so newly-dropped art shows up without editing any list.
//
// A "sprite" is any top-level <name>.png that isn't a companion file
// (<name>.mask.png / <name>.hat.png). For each we record whether an authored
// region mask and/or a hat guide sits beside it, so the sandbox can apply the
// exact board mask + place hats without probing for 404s. Subfolders
// (original/, source/) are ignored.
//
// Run: npm run gen:player-sprites   (also runs automatically on prebuild)

import { readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spriteDir = join(root, 'public', 'undercity', 'player_sprites');
const outFile = join(root, 'public', 'data', 'undercity-player-sprites.json');

const entries = readdirSync(spriteDir, { withFileTypes: true });
const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));

const base = [...files]
  .filter((f) => f.endsWith('.png') && !f.endsWith('.mask.png') && !f.endsWith('.hat.png'))
  .map((f) => f.slice(0, -'.png'.length))
  .sort();

const sprites = base.map((name) => ({
  name,
  hasMask: files.has(`${name}.mask.png`),
  hasHat: files.has(`${name}.hat.png`),
}));

writeFileSync(outFile, JSON.stringify({ sprites }, null, 2) + '\n');
console.log(`Wrote ${sprites.length} player sprites → ${outFile}`);
