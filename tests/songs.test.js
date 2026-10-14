import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkData } from '../scripts/check-data.mjs';
import { ENGLISH_SONG_SELECTION, qualifyingCharts, selectEnglishSongs, searchSongs, validateSongs } from '../src/songs.js';
import { validateAuthoredSongClues } from '../scripts/maimai-clues.mjs';
import { GameSession, entryCells, feedbackFor, normalizeAnswer, validateLevel } from '../src/game.js';
import { revisionContent } from '../src/analytics-protocol.js';

const { levels, songs, characters } = await checkData();
const level = levels.find((item) => item.id === 'maimai-1-en');
const registry = JSON.parse(await readFile(new URL('../data/maimai.json', import.meta.url)));
const snapshot = JSON.parse(await readFile(new URL('../data/sources/maimai-api.json', import.meta.url)));
const clueCatalog = JSON.parse(await readFile(new URL('../data/maimai-clues.json', import.meta.url)));
const authoredClues = validateAuthoredSongClues(clueCatalog, songs);
const solution = Object.fromEntries(level.entries.flatMap((entry) => entryCells(entry).map((key, i) => [key, entry.answer[i]])));

test('maimai snapshot joins API song IDs, preserves titles/artists/aliases and supports 13–15 charts', () => {
  assert.equal(snapshot.songs.length, snapshot.source.songCount);
  assert.equal(snapshot.source.version, 25500);
  assert.equal(songs.length, 22);
  assert.deepEqual(songs.map((song) => song.id), ENGLISH_SONG_SELECTION.map(([id]) => id));
  assert.deepEqual(selectEnglishSongs(snapshot), songs);
  for (const song of songs) {
    assert.ok(qualifyingCharts(song).length, song.title);
    assert.ok(song.aliases.includes(song.clueAlias));
    assert.equal(song.answer, normalizeAnswer(song.title, 'en'));
  }
  assert.ok(songs.some((song) => qualifyingCharts(song).some((chart) => chart.level === '15')));
});

test('only reviewed English titles enter the registry; API drift fails instead of silently changing answers', () => {
  assert.ok(!songs.some((song) => ['Garakuta Doll Play', 'Oshama Scramble!', 'INTERNET YAMERO'].includes(song.title)));
  for (const mutate of [
    (song) => { song.title = 'Garakuta Doll Play'; },
    (song) => { song.title += ' 2'; },
    (song) => { song.disabled = true; },
    (song) => { song.aliases = []; },
    (song) => { song.charts = [{ type: 'dx', difficulty: 3, level: '12', levelValue: 12.5 }]; },
    (song) => { song.answer += 'X'; },
  ]) {
    const bad = structuredClone(registry); mutate(bad.songs[0]);
    assert.throws(() => validateSongs(bad), /Invalid/);
  }
  const duplicate = structuredClone(registry); duplicate.songs.push(duplicate.songs[0]);
  assert.throws(() => validateSongs(duplicate), /duplicate/);
  const changed = structuredClone(snapshot); changed.songs.find((song) => song.id === 521).title = 'Renamed';
  assert.throws(() => selectEnglishSongs(changed), /changed/);
  const missingAlias = structuredClone(snapshot); missingAlias.songs.find((song) => song.id === 521).aliases = [];
  assert.throws(() => selectEnglishSongs(missingAlias), /changed/);
});

test('maimai has one connected English board, 11 across/11 down, with independently authored trilingual clues', () => {
  assert.equal(levels.filter((item) => item.difficulty === 'maimai').length, 1);
  assert.equal(level.answerLanguage, 'en');
  assert.equal(level.entries.length, 22);
  for (const direction of ['across', 'down']) assert.equal(level.entries.filter((entry) => entry.direction === direction).length, 11);
  validateLevel(level, characters, songs);
  for (const entry of level.entries) {
    assert.equal(entry.characterId, undefined);
    assert.deepEqual(entry.clues, authoredClues.get(entry.songId));
  }
  const unknown = structuredClone(level); unknown.entries[0].songId = 999999;
  assert.throws(() => validateLevel(unknown, characters, songs), /song mismatch/);
  const both = structuredClone(level); both.entries[0].characterId = characters[0].id;
  assert.throws(() => validateLevel(both, characters, songs), /song mismatch/);
  const kana = structuredClone(level); kana.answerLanguage = 'ja';
  assert.throws(() => validateLevel(kana, characters, songs), /English/);
  const crossing = structuredClone(level); crossing.entries[0].row++;
  assert.throws(() => validateLevel(crossing, characters, songs));
});

test('editorial clues require complete unique wording and review when cited API facts change', () => {
  const missing = structuredClone(clueCatalog); missing.entries.pop();
  assert.throws(() => validateAuthoredSongClues(missing, songs), /Invalid/);
  const duplicated = structuredClone(clueCatalog); duplicated.entries[1].clues.en = duplicated.entries[0].clues.en;
  assert.throws(() => validateAuthoredSongClues(duplicated, songs), /duplicate/);
  const untranslated = structuredClone(clueCatalog); delete untranslated.entries[0].clues.ja;
  assert.throws(() => validateAuthoredSongClues(untranslated, songs), /Invalid/);
  for (const mutate of [
    (song) => { song.artist += ' changed'; },
    (song) => { song.aliases = []; },
    (song) => { song.bpm++; },
  ]) {
    const changed = structuredClone(songs); mutate(changed.find((song) => song.id === 456));
    assert.throws(() => validateAuthoredSongClues(clueCatalog, changed), /source review/);
  }
  const newCharts = structuredClone(songs);
  newCharts.find((song) => song.id === 834).charts.find((chart) => chart.difficulty === 4).level = '14+';
  assert.throws(() => validateAuthoredSongClues(clueCatalog, newCharts), /source review/);
});

test('song lookup supports title fragments, artists, Chinese aliases and exact-match ranking', () => {
  for (const query of ['ECHO', 'ｅｃｈｏ', '回声', 'CIRCRUSH']) assert.equal(searchSongs(songs, query)[0].id, 521);
  assert.equal(searchSongs(songs, '皇冠')[0].id, 456);
  assert.equal(searchSongs(songs, 'Brain')[0].id, 738);
  assert.equal(searchSongs(songs, 'xi')[0].id, 456);
  assert.equal(searchSongs(songs, 'Masayoshi').some((song) => song.id === 200), true);
  assert.deepEqual(searchSongs(songs, '小栗帽'), []);
  assert.deepEqual(searchSongs(songs, ' !!! '), []);
});

test('song sessions preserve Challenge quotas, assistance, reveals and solve/early-ending semantics', () => {
  let time = 1000;
  const session = new GameSession(level, 'hard', () => time);
  assert.equal(session.query(songs, '  ', searchSongs).status, 'empty');
  for (const query of ['回声', 'missing song', 'xi']) assert.equal(session.query(songs, query, searchSongs).status, 'ok');
  assert.equal(session.query(songs, 'ECHO', searchSongs).status, 'limit');
  session.setMode('easy');
  assert.equal(session.reveal(level.entries[0].id).status, 'ok');
  assert.deepEqual(session.values, {});
  assert.equal(session.query(songs, 'ECHO', searchSongs).results[0].id, 521);
  session.setMode('hard');
  assert.equal(session.query(songs, 'ECHO', searchSongs).status, 'limit');
  const entry = level.entries[0];
  session.update(Object.fromEntries(entryCells(entry).map((key, i) => [key, entry.answer[i]])));
  assert.equal(feedbackFor(level.entries, session.values, 'hard').solved.size, 0);
  assert.ok(feedbackFor(level.entries, session.values, 'easy').solved.has(entry.id));
  time = 5000; session.update(solution);
  assert.equal(session.finishReason, 'solved');
  assert.equal(session.elapsed, 4000);
  time = 9000; assert.equal(session.elapsed, 4000);
  const ended = new GameSession(level, 'hard', () => time);
  assert.equal(ended.endAndReveal(), true);
  assert.equal(ended.finishReason, 'revealed');
  assert.deepEqual(ended.values, solution);
});

test('statistics revision includes song references without changing legacy character revisions', () => {
  const content = JSON.parse(revisionContent(level));
  assert.equal(content.entries[0].songId, level.entries[0].songId);
  const changed = structuredClone(level); changed.entries[0].songId++;
  assert.notEqual(revisionContent(changed), revisionContent(level));
  const oldLevel = levels.find((item) => item.id === 'beginner-1-en');
  assert.ok(!Object.hasOwn(JSON.parse(revisionContent(oldLevel)).entries[0], 'songId'));
});

test('song answer reveals follow current upstream rules: three locked Challenge words and unlimited Assisted views', () => {
  const session = new GameSession(level, 'hard');
  for (const entry of level.entries.slice(0, 3)) {
    const revealed = session.reveal(entry.id);
    assert.equal(revealed.status, 'ok');
    const cells = entryCells(entry);
    assert.ok(cells.every((key, i) => session.values[key] === entry.answer[i]));
    assert.ok(cells.every((key) => session.revealedCells.has(key)));
    session.update({ [cells[0]]: '!' });
    assert.equal(session.values[cells[0]], entry.answer[0]);
    assert.ok(feedbackFor(level.entries, session.values, 'hard', session.hardRevealedEntries).solved.has(entry.id));
  }
  assert.equal(session.reveal(level.entries[3].id).status, 'limit');
  assert.equal(session.reveal(level.entries[0].id).reused, true);
  assert.equal(session.hardRevealedEntries.size, 3);
  session.setMode('easy');
  for (const entry of level.entries.slice(3, 8)) assert.equal(session.reveal(entry.id).status, 'ok');
  assert.equal(session.hardRevealedEntries.size, 3);
  assert.equal(session.revealedEntries.size, 8);
  assert.equal(session.everAssisted, true);
  session.setMode('hard');
  assert.equal(session.reveal(level.entries[3].id).status, 'limit');
});
