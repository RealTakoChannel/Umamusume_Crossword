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

export function songClues(song) {
  // One useful chart hint is easier to read than every qualifying chart.
  // Stable phrasing keeps offline regeneration reproducible.
  const chart = qualifyingCharts(song).sort((a, b) => b.levelValue - a.levelValue || b.difficulty - a.difficulty)[0];
  const difficulty = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'Re:MASTER'][chart.difficulty];
  const chartZh = `${chart.type === 'standard' ? '标准' : 'DX'}${['绿谱', '黄谱', '红谱', '紫谱', '白谱'][chart.difficulty]}`;
  const chartEn = `${chart.type === 'standard' ? 'standard' : 'DX'} ${difficulty} chart`;
  const chartJa = `${chart.type === 'standard' ? 'スタンダード' : 'DX'}の${difficulty}`;
  const { artist, clueAlias: alias, bpm } = song;
  const clues = [
    {
      'zh-CN': `玩家口中的“${alias}”，就是 ${artist} 的这首作品。再给你一个提示：${chartZh}为 ${chart.level} 级，BPM 是 ${bpm}。`,
      en: `Players know this ${artist} track by the nickname “${alias}”. One more hint: its ${chartEn} is level ${chart.level}, at ${bpm} BPM.`,
      ja: `プレイヤーに「${alias}」と呼ばれる、${artist}の楽曲です。もう一つのヒント：${chartJa}はレベル${chart.level}、BPMは${bpm}。`,
    },
    {
      'zh-CN': `${artist} 的这首歌有个玩家别名：“${alias}”。想不起曲名的话，可以参考它的${chartZh}：${chart.level} 级，BPM ${bpm}。`,
      en: `This track by ${artist} has a player nickname: “${alias}”. Need another clue? Its ${chartEn} is level ${chart.level}, with a BPM of ${bpm}.`,
      ja: `${artist}のこの曲には、「${alias}」という呼び名があります。曲名が浮かばなければ、レベル${chart.level}の${chartJa}、BPM ${bpm}を手がかりに。`,
    },
    {
      'zh-CN': `从“${alias}”这个别名找找灵感，这首歌的曲师是 ${artist}。${chartZh}为 ${chart.level} 级，BPM ${bpm}，你想起它了吗？`,
      en: `Start with the nickname “${alias}” and the artist ${artist}. Its ${chartEn} is level ${chart.level}, at ${bpm} BPM. Does the title ring a bell?`,
      ja: `「${alias}」という呼び名と、アーティストの${artist}が手がかりです。${chartJa}はレベル${chart.level}、BPMは${bpm}。曲名を思い出せますか？`,
    },
    {
      'zh-CN': `还记得玩家说的“${alias}”吗？曲师署名是 ${artist}，${chartZh}为 ${chart.level} 级，BPM ${bpm}。试着把它的英文曲名填进题盘。`,
      en: `Remember the track players call “${alias}”? The artist credit is ${artist}; its ${chartEn} is level ${chart.level}, at ${bpm} BPM. Try filling in its English title.`,
      ja: `「${alias}」と呼ばれるこの曲、覚えていますか？アーティスト表記は${artist}。${chartJa}はレベル${chart.level}、BPMは${bpm}です。英語の曲名をマスに入れてみましょう。`,
    },
  ];
  const index = ENGLISH_SONG_SELECTION.findIndex(([id]) => id === song.id);
  return clues[Math.max(0, index) % clues.length];
}

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
