import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateCharacters, validateLevel } from '../src/game.js';
const root = new URL('../data/', import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
export async function checkData() {
  const registry = validateCharacters(await read('characters.json'));
  const manifest = await read('levels/index.json');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.levels) || !manifest.levels.length) throw new Error('Invalid level manifest');
  const seen = new Set(), levels = [];
  for (const item of manifest.levels) {
    if (!/^[a-z0-9-]+\.json$/.test(item.file) || seen.has(item.id)) throw new Error('Invalid or duplicate manifest entry');
    seen.add(item.id);
    const level = validateLevel(await read(`levels/${item.file}`), registry.characters);
    if (level.id !== item.id) throw new Error('Manifest id mismatch');
    levels.push(level);
  }
  return { characters:registry.characters,levels,manifest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {characters,levels} = await checkData();
  console.log(`Validated ${levels.length} trilingual levels and ${characters.length} character records.`);
}
