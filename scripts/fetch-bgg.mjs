// Baked-at-build-time BGG enrichment for public/data/games.json.
// Resolves each game's BGG numeric id and up to 8 gallery images via
// api.geekdo.com (BGG's official xmlapi2 now returns Unauthorized).
// Run manually: `npm run fetch:bgg` (optionally `-- --force`). Never in CI/deploy.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_PATH = join(__dirname, '..', 'public', 'data', 'games.json');
const MAX_IMAGES = 8;
const UA = 'golgari-game-day build script (contact: repo owner)';
const force = process.argv.includes('--force');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function resolveId(title) {
  const url =
    'https://api.geekdo.com/api/geekitems?nosession=1&objecttype=thing' +
    '&subtype=boardgame&showcount=10&search=' +
    encodeURIComponent(title);
  const data = await getJson(url);
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) return { id: null, review: 'no results' };
  const exact = items.find(
    (i) => i.objecttype === 'thing' && String(i.name).toLowerCase() === title.toLowerCase()
  );
  if (exact) return { id: Number(exact.objectid), review: null };
  const first = items[0];
  return { id: Number(first.objectid), review: `no exact match; used "${first.name}" (${first.objectid})` };
}

async function fetchImages(id) {
  const url =
    'https://api.geekdo.com/api/images?ajax=1&gallery=game&nosession=1' +
    '&objecttype=thing&pageid=1&size=crop100&sort=hot' +
    `&showcount=${MAX_IMAGES}&objectid=${id}`;
  const data = await getJson(url);
  const images = Array.isArray(data.images) ? data.images : [];
  return images.slice(0, MAX_IMAGES).map((img) => {
    const image = { thumb: img['imageurl@2x'] || img.imageurl, large: img.imageurl_lg || img.imageurl };
    if (img.caption) image.caption = String(img.caption).trim();
    return image;
  });
}

async function main() {
  const games = JSON.parse(await readFile(GAMES_PATH, 'utf8'));
  const review = [];
  let resolved = 0;
  let imaged = 0;

  for (const game of games) {
    try {
      if (game.bggId == null) {
        const { id, review: note } = await resolveId(game.title);
        await sleep(250);
        if (id == null) {
          review.push(`${game.title}: ${note}`);
          continue;
        }
        game.bggId = id;
        resolved++;
        if (note) review.push(`${game.title}: ${note}`);
      }

      if (game.bggId != null && (force || !Array.isArray(game.bggImages) || game.bggImages.length === 0)) {
        const imgs = await fetchImages(game.bggId);
        await sleep(250);
        if (imgs.length) {
          game.bggImages = imgs;
          imaged++;
        } else {
          review.push(`${game.title}: no images returned for id ${game.bggId}`);
        }
      }
    } catch (err) {
      review.push(`${game.title}: ERROR ${err.message}`);
    }
  }

  await writeFile(GAMES_PATH, JSON.stringify(games, null, 2) + '\n', 'utf8');

  console.log(`\nDone. ids resolved: ${resolved}, games imaged: ${imaged}, total games: ${games.length}`);
  if (review.length) {
    console.log('\n=== NEEDS REVIEW ===');
    for (const line of review) console.log(' - ' + line);
    console.log('Hand-fix bggId in public/data/games.json for any wrong match, then re-run with --force.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
