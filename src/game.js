export const LANGUAGES = ['zh-CN', 'en', 'ja'];
export const cellKey = (row, column) => `${row},${column}`;
export const entryCells = (entry) => Array.from(entry.answer, (_, i) => cellKey(
  entry.row + (entry.direction === 'down' ? i : 0),
  entry.column + (entry.direction === 'across' ? i : 0),
));
export const toKatakana = (text) => text.replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
export function normalizeAnswer(text, language = 'en') {
  const value = String(text).normalize('NFKC').normalize('NFC');
  return language === 'ja' ? toKatakana(value).replace(/[^\u30A1-\u30FAー]/g, '')
    : value.toUpperCase().replace(/[^A-Z]/g, '');
}
export function normalizeSearch(text) {
  return toKatakana(String(text).normalize('NFKC').normalize('NFC')).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}
export function searchCharacters(characters, query) {
  const key = normalizeSearch(query);
  if (!key) return [];
  return characters.map((character) => {
    const names = [...Object.values(character.names), ...(character.aliases || [])].map(normalizeSearch);
    return { character, rank: names.includes(key) ? 0 : names.some((n) => n.startsWith(key)) ? 1 : 2,
      matches: names.some((name) => name.includes(key)) };
  }).filter((e) => e.matches).sort((a, b) => a.rank - b.rank || a.character.names.en.localeCompare(b.character.names.en))
    .map((e) => e.character);
}
export function evaluate(entries, values) {
  const solved = new Set();
  let filledWords = 0;
  for (const entry of entries) {
    const keys = entryCells(entry);
    if (keys.every((key) => Boolean(values[key]))) filledWords++;
    if (keys.every((key, i) => values[key] === [...entry.answer][i])) solved.add(entry.id);
  }
  return { solved, filledWords, complete: entries.length > 0 && solved.size === entries.length };
}
export function feedbackFor(entries, values, mode) {
  if (mode !== 'easy') return { solved: new Set(), greenCells: new Set() };
  const { solved } = evaluate(entries, values);
  return { solved, greenCells: new Set(entries.filter((e) => solved.has(e.id)).flatMap(entryCells)) };
}
export function formatTime(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000)), hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0'), rest = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}
export class GameSession {
  constructor(level, mode = 'easy', now = () => performance.now()) {
    this.now = now; this.mode = mode; this.restart(level);
  }
  restart(level) {
    this.level = level; this.values = {}; this.startedAt = this.now(); this.finishedAt = null; this.finishedMode = null; this.finishReason = null;
    this.hardSearches = 0; this.revealedEntries = new Set();
    this.everAssisted = this.mode === 'easy'; this.lookupCount = 0;
  }
  get completed() { return this.finishedAt !== null; }
  get elapsed() { return (this.finishedAt ?? this.now()) - this.startedAt; }
  setMode(mode) { if (!['easy', 'hard'].includes(mode)) throw new Error('Invalid play mode'); this.mode = mode; if (!this.completed && mode === 'easy') this.everAssisted = true; }
  update(changes) {
    if (this.completed) return false;
    Object.assign(this.values, changes);
    for (const key of Object.keys(this.values)) if (!this.values[key]) delete this.values[key];
    if (evaluate(this.level.entries, this.values).complete) { this.finishedAt = this.now(); this.finishedMode = this.mode; this.finishReason = 'solved'; }
    return this.completed;
  }
  query(characters, query) {
    if (!normalizeSearch(query)) return { status: 'empty', results: [] };
    if (this.mode === 'hard' && this.hardSearches >= 3) return { status: 'limit', results: [] };
    if (this.mode === 'hard') this.hardSearches++;
    if (!this.completed) this.lookupCount++;
    return { status: 'ok', results: searchCharacters(characters, query) };
  }
  reveal(entryId) {
    if (this.completed) return { status: 'finished' };
    if (this.mode !== 'easy') return { status: 'unavailable' };
    const entry = this.level.entries.find((entry) => entry.id === entryId);
    if (!entry) return { status: 'invalid' };
    if (this.revealedEntries.has(entryId)) return { status: 'ok', entry, reused: true };
    if (this.revealedEntries.size >= 3) return { status: 'limit' };
    this.revealedEntries.add(entryId);
    return { status: 'ok', entry, reused: false };
  }
  endAndReveal() {
    if (this.completed || this.mode !== 'hard') return false;
    this.finishedAt = this.now(); this.finishedMode = this.mode; this.finishReason = 'revealed';
    this.values = Object.fromEntries(this.level.entries.flatMap((entry) => entryCells(entry).map((key, i) => [key, [...entry.answer][i]])));
    return true;
  }
}
export function validateCharacters(registry) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.characters)) throw new Error('Invalid character registry');
  const seen = new Set();
  for (const c of registry.characters) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id) || seen.has(c.id)) throw new Error(`Invalid character id: ${c.id}`);
    seen.add(c.id);
    for (const lang of LANGUAGES) if (typeof c.names?.[lang] !== 'string' || !c.names[lang].trim()) throw new Error(`Missing ${lang} name: ${c.id}`);
    if (!Array.isArray(c.aliases) || c.aliases.some((x) => typeof x !== 'string')) throw new Error(`Invalid aliases: ${c.id}`);
  }
  return registry;
}
export function validateLevel(level, characters) {
  const fail = (message) => { throw new Error(`${level.id || 'level'}: ${message}`); };
  if (level.schemaVersion !== 1 || !/^[a-z0-9-]+$/.test(level.id)) fail('Invalid schemaVersion or id');
  if (!['beginner', 'advanced', 'epithets', 'cinderella'].includes(level.difficulty) || !['en', 'ja'].includes(level.answerLanguage)) fail('Invalid collection or answerLanguage');
  for (const lang of LANGUAGES) if (!level.title?.[lang]?.trim() || !level.description?.[lang]?.trim()) fail(`Missing metadata: ${lang}`);
  const { rows, columns, layout } = level.grid || {};
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows > 60 || columns > 60) fail('Invalid dimensions');
  if (!Array.isArray(layout) || layout.length !== rows || layout.some((row) => typeof row !== 'string' || row.length !== columns || !/^[.#]+$/.test(row))) fail('Invalid grid layout');
  if (!Array.isArray(level.entries) || !level.entries.length) fail('Empty entries');
  const characterMap = new Map(characters.map((c) => [c.id, c])), ids = new Set(), answers = new Set(), grid = new Map(), starts = new Map(), usedNumbers = new Map();
  for (const e of level.entries) {
    if (!e.id || ids.has(e.id) || answers.has(e.answer)) fail(`Duplicate entry: ${e.id}`);
    ids.add(e.id); answers.add(e.answer);
    if (!['across', 'down'].includes(e.direction) || !Number.isInteger(e.row) || !Number.isInteger(e.column) || !Number.isInteger(e.number) || e.number < 1) fail(`Invalid position: ${e.id}`);
    for (const lang of LANGUAGES) if (typeof e.clues?.[lang] !== 'string' || !e.clues[lang].trim()) fail(`Missing clue ${lang}: ${e.id}`);
    const character = characterMap.get(e.characterId);
    if (!character || e.answer !== normalizeAnswer(character.names[level.answerLanguage], level.answerLanguage)) fail(`Answer/name mismatch: ${e.id}`);
    const start = cellKey(e.row, e.column);
    if ((starts.has(start) && starts.get(start) !== e.number) || (usedNumbers.has(e.number) && usedNumbers.get(e.number) !== start)) fail(`Inconsistent number: ${e.id}`);
    starts.set(start, e.number); usedNumbers.set(e.number, start);
    const letters = [...e.answer];
    if (letters.length < 2) fail(`Answer too short: ${e.id}`);
    entryCells(e).forEach((key, i) => {
      const [r, col] = key.split(',').map(Number);
      if (layout[r]?.[col] !== '.') fail(`Answer outside white cells: ${e.id}`);
      if (grid.has(key) && grid.get(key) !== letters[i]) fail(`Crossing mismatch: ${e.id}`);
      grid.set(key, letters[i]);
    });
  }
  if (grid.size !== layout.join('').replaceAll('#', '').length) fail('Orphan white cells');
  const runs = [];
  for (const direction of ['across', 'down']) for (let r = 0; r < rows; r++) for (let col = 0; col < columns; col++) {
    if (layout[r][col] === '#') continue;
    if (grid.has(cellKey(r - (direction === 'down' ? 1 : 0), col - (direction === 'across' ? 1 : 0)))) continue;
    let rr = r, cc = col, word = '';
    while (grid.has(cellKey(rr, cc))) { word += grid.get(cellKey(rr, cc)); rr += direction === 'down' ? 1 : 0; cc += direction === 'across' ? 1 : 0; }
    if ([...word].length > 1) runs.push(`${r},${col},${direction}:${word}`);
  }
  const expected = level.entries.map((e) => `${e.row},${e.column},${e.direction}:${e.answer}`).sort();
  if (JSON.stringify(runs.sort()) !== JSON.stringify(expected)) fail('Unlisted or overlapping grid runs');
  const numbered = [...starts].sort((a, b) => { const aa = a[0].split(',').map(Number), bb = b[0].split(',').map(Number); return aa[0] - bb[0] || aa[1] - bb[1]; });
  if (numbered.some((e, i) => e[1] !== i + 1)) fail('Numbers must follow reading order');
  const connected = new Set([level.entries[0].id]);
  let changed = true;
  while (changed) {
    changed = false;
    const known = new Set(level.entries.filter((e) => connected.has(e.id)).flatMap(entryCells));
    for (const e of level.entries) if (!connected.has(e.id) && entryCells(e).some((k) => known.has(k))) { connected.add(e.id); changed = true; }
  }
  if (connected.size !== level.entries.length) fail('Disconnected grid');
  return level;
}
