import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/game.js';

// Editorial clues are independent of the API dictionary. Sync may copy them
// into a board, but must never compose or overwrite their wording.
export function validateAuthoredSongClues(catalog, songs) {
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries) || catalog.entries.length !== songs.length) throw new Error('Invalid authored song clues');
  const byId = new Map(songs.map((song) => [song.id, song])), clues = new Map();
  const seenTexts = new Map(LANGUAGES.map((language) => [language, new Set()]));
  for (const entry of catalog.entries) {
    const song = byId.get(entry.songId), facts = entry.sourceFacts;
    if (!song || clues.has(entry.songId)) throw new Error(`Unknown or duplicate authored song clue: ${entry.songId}`);
    if (!facts || facts.title !== song.title || facts.artist !== song.artist || !Array.isArray(facts.aliases) || !facts.aliases.length
      || facts.aliases.some((alias) => !song.aliases.includes(alias))
      || (facts.bpm !== undefined && facts.bpm !== song.bpm)
      || (facts.charts !== undefined && (!Array.isArray(facts.charts) || facts.charts.some((hint) =>
        !song.charts.some((chart) => chart.type === hint.type && chart.difficulty === hint.difficulty && chart.level === hint.level))))) {
      throw new Error(`Authored song clue needs source review: ${entry.songId}`);
    }
    for (const language of LANGUAGES) {
      const text = entry.clues?.[language];
      if (typeof text !== 'string' || !text.trim() || /\$\{|\{\{/.test(text) || seenTexts.get(language).has(text)) throw new Error(`Invalid or duplicate ${language} authored clue: ${entry.songId}`);
      seenTexts.get(language).add(text);
    }
    clues.set(entry.songId, entry.clues);
  }
  return clues;
}

export async function loadAuthoredSongClues(songs) {
  const catalog = JSON.parse(await readFile(new URL('../data/maimai-clues.json', import.meta.url), 'utf8'));
  return validateAuthoredSongClues(catalog, songs);
}
