import { normalizeAnswer, normalizeSearch } from './game.js';

// An ASCII title alone does not establish that it is English. These titles and
// the clue aliases were reviewed; Japanese romanizations are deliberately absent.
export const ENGLISH_SONG_SELECTION = [
  [58, 'Endless World', '无尽世界'],
  [82, 'Reach For The Stars', '追星'], [100, 'Tell Your World', '告诉你的世界'],
  [133, 'We Gonna Party', '我们去派对'],
  [143, 'Fragrance', '香水'], [145, 'Starlight Disco', '星光迪斯科'],
  [200, 'Bad Apple!! feat.nomico', '坏苹果'], [231, 'Heartbeats', '心跳'],
  [238, 'Get Happy', '变得开心'], [261, 'Death Scythe', '死镰'],
  [456, 'Glorious Crown', '皇冠'], [494, 'CITRUS MONSTER', '橘子怪兽'],
  [521, 'ECHO', '回声'], [593, 'conflict', '公交车'],
  [641, 'Calamity Fortune', '东风谷早苗'], [689, 'Credits', '学分'],
  [734, 'ENERGY SYNERGY MATRIX', '一只猫拖着另一只猫跑'], [736, 'World Vanquisher', '世界征服者'],
  [738, 'Brain Power', '脑力'], [773, 'SILENT BLUE', '静蓝'],
  [834, 'PANDORA PARADOXXX', '潘多拉'], [1568, 'INTERNET OVERDOSE', '超天酱'],
];

export const qualifyingCharts = (song) => song.charts.filter((chart) =>
  ['standard', 'dx'].includes(chart.type) && chart.levelValue >= 13 && chart.levelValue < 16);

export function selectEnglishSongs(snapshot) {
  const byId = new Map(snapshot.songs.map((song) => [song.id, song]));
  return ENGLISH_SONG_SELECTION.map(([id, title, clueAlias]) => {
    const song = byId.get(id);
    if (!song || song.title !== title || song.disabled || !song.aliases.includes(clueAlias) || !qualifyingCharts(song).length) {
      throw new Error(`Reviewed song/alias changed in API snapshot: ${id}`);
    }
    return { ...song, clueAlias, answer: normalizeAnswer(song.title, 'en') };
  });
}

export function validateSongs(registry) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.songs) || !registry.songs.length
    || !registry.source?.fetchedAt || registry.source.version !== 25500
    || registry.source.songUrl !== 'https://maimai.lxns.net/api/v0/maimai/song/list?version=25500'
    || registry.source.aliasUrl !== 'https://maimai.lxns.net/api/v0/maimai/alias/list'
    || !Number.isFinite(Date.parse(registry.source.fetchedAt))) throw new Error('Invalid song registry/source');
  const ids = new Set(), answers = new Set();
  for (const song of registry.songs) {
    const approved = ENGLISH_SONG_SELECTION.find(([id, title, alias]) => id === song.id && title === song.title && alias === song.clueAlias);
    if (!approved || ids.has(song.id) || song.disabled || !/^[A-Za-z][A-Za-z\s'’!.,?&()\-]*$/.test(song.title)
      || !song.artist?.trim() || !Number.isFinite(song.bpm) || song.bpm <= 0 || !Number.isInteger(song.version)
      || !Array.isArray(song.charts) || !song.charts.length || song.charts.some((chart) =>
        !['standard', 'dx'].includes(chart.type) || !Number.isInteger(chart.difficulty) || chart.difficulty < 0 || chart.difficulty > 4
        || !/^\d{1,2}\+?$/.test(chart.level) || !Number.isFinite(chart.levelValue)
        || parseInt(chart.level) !== Math.floor(chart.levelValue)) || !qualifyingCharts(song).length
      || !Array.isArray(song.aliases) || song.aliases.some((alias) => typeof alias !== 'string' || !alias.trim())
      || !song.aliases.includes(song.clueAlias) || normalizeSearch(song.clueAlias) === normalizeSearch(song.title)
      || song.answer !== normalizeAnswer(song.title, 'en') || song.answer.length < 2 || answers.has(song.answer)) {
      throw new Error(`Invalid or duplicate reviewed English song: ${song.id}`);
    }
    ids.add(song.id); answers.add(song.answer);
  }
  return registry;
}

export function searchSongs(songs, query) {
  const key = normalizeSearch(query);
  if (!key) return [];
  return songs.map((song) => {
    const terms = [song.title, song.artist, ...song.aliases].map(normalizeSearch);
    return { song, rank: terms.includes(key) ? 0 : terms.some((term) => term.startsWith(key)) ? 1 : 2,
      matches: terms.some((term) => term.includes(key)) };
  }).filter((item) => item.matches).sort((a, b) => a.rank - b.rank || a.song.title.localeCompare(b.song.title)).map((item) => item.song);
}
