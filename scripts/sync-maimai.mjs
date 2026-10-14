import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectEnglishSongs, validateSongs } from '../src/songs.js';
import { loadAuthoredSongClues } from './maimai-clues.mjs';
import { validateLevel } from '../src/game.js';

const root = new URL('../data/', import.meta.url);
const songUrl = 'https://maimai.lxns.net/api/v0/maimai/song/list?version=25500';
const aliasUrl = 'https://maimai.lxns.net/api/v0/maimai/alias/list';
async function request(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`API returned ${response.status}: ${url}`);
  return response.text();
}
const args = process.argv.slice(2);
let snapshot;
if (!args.length || args[0] === '--from') {
  if (args.length && args.length !== 3) throw new Error('Usage: npm run sync:maimai -- --from songs.json aliases.json');
  const [songText, aliasText] = args.length
    ? await Promise.all([readFile(args[1], 'utf8'), readFile(args[2], 'utf8')])
    : await Promise.all([request(songUrl), request(aliasUrl)]);
  const catalog = JSON.parse(songText), aliasCatalog = JSON.parse(aliasText);
  if (!Array.isArray(catalog.songs) || !Array.isArray(aliasCatalog.aliases)) throw new Error('Invalid API response');
  const aliases = new Map();
  for (const item of aliasCatalog.aliases) {
    if (!Number.isInteger(item.song_id) || !Array.isArray(item.aliases) || item.aliases.some((alias) => typeof alias !== 'string') || aliases.has(item.song_id)) throw new Error('Invalid API aliases');
    aliases.set(item.song_id, [...new Set(item.aliases.map((alias) => alias.trim()).filter(Boolean))]);
  }
  const seen = new Set();
  snapshot = { schemaVersion: 1, source: {
    provider: '落雪咖啡屋 maimai DX 查分器', documentation: 'https://maimai.lxns.net/docs/api/maimai',
    songUrl, aliasUrl, version: 25500, region: '舞萌 DX（中国大陆）', fetchedAt: new Date().toISOString(),
    songCount: catalog.songs.length, aliasRecordCount: aliasCatalog.aliases.length,
    sha256: { songs: createHash('sha256').update(songText).digest('hex'), aliases: createHash('sha256').update(aliasText).digest('hex') },
  }, versions: catalog.versions, songs: catalog.songs.map(({ id, title, artist, genre, bpm, version, disabled, difficulties }) => {
    if (!Number.isInteger(id) || seen.has(id) || typeof title !== 'string' || typeof artist !== 'string') throw new Error('Invalid API song');
    seen.add(id);
    const charts = ['standard', 'dx'].flatMap((type) => (difficulties?.[type] || []).map((chart) =>
      ({ type, difficulty: chart.difficulty, level: chart.level, levelValue: chart.level_value })));
    return { id, title, artist, genre, bpm, version, disabled: disabled === true, aliases: aliases.get(id) || [], charts };
  }).sort((a, b) => a.id - b.id) };
} else if (args.length === 1 && args[0] === '--snapshot') {
  snapshot = JSON.parse(await readFile(new URL('sources/maimai-api.json', root), 'utf8'));
} else throw new Error('Use --snapshot to regenerate offline, --from <songs> <aliases>, or no arguments to fetch the API.');

const registry = validateSongs({ schemaVersion: 1, source: snapshot.source, songs: selectEnglishSongs(snapshot) });
const authoredClues = await loadAuthoredSongClues(registry.songs);
// Positions are reviewed separately. Refreshing metadata never silently repacks a board.
const levelUrl = new URL('levels/maimai-1-en.json', root);
const level = JSON.parse(await readFile(levelUrl, 'utf8'));
const byId = new Map(registry.songs.map((song) => [song.id, song]));
for (const entry of level.entries) {
  const song = byId.get(entry.songId);
  if (!song) throw new Error(`Unknown board song: ${entry.songId}`);
  entry.answer = song.answer; entry.clues = authoredClues.get(song.id);
}
validateLevel(level, [], registry.songs);
await mkdir(new URL('sources/', root), { recursive: true });
const write = (url, value) => writeFile(url, JSON.stringify(value, null, 2) + '\n');
// One song per line keeps the complete metadata snapshot practical to review.
const { songs: snapshotSongs, ...snapshotHeader } = snapshot;
const snapshotText = JSON.stringify(snapshotHeader, null, 2).slice(0, -2)
  + ',\n  "songs": [\n' + snapshotSongs.map((song) => '    ' + JSON.stringify(song)).join(',\n') + '\n  ]\n}\n';
await writeFile(new URL('sources/maimai-api.json', root), snapshotText);
await write(new URL('maimai.json', root), registry);
await write(levelUrl, level);
console.log(`Saved ${snapshot.songs.length} API songs and ${registry.songs.length} reviewed English answers.`);
