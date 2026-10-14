import { loadCatalog } from './catalog.js';
import { GameSession, cellKey, entryCells, normalizeAnswer, feedbackFor, formatTime, LANGUAGES } from './game.js';
import { translate } from './i18n.js';
import { AnalyticsClient } from './analytics.js';
import { analyticsConfig } from './analytics-config.js';

const $ = (id) => document.getElementById(id);
let language = 'zh-CN';
try { const saved = localStorage.getItem('tracen-ui-language'); if (LANGUAGES.includes(saved)) language = saved; } catch { /* Private storage may be unavailable. */ }
const t = (key, params) => translate(language, key, params);
let levels = [], characters = [], characterMap = new Map(), session = null, previewLevel = null, loadFailed = false;
let active = null, activeKey = '', activeDirection = 'across', forceRestart = false, noteKey = '';
let inputs = new Map(), containers = new Map(), members = new Map();
let draft = { difficulty:'beginner', answerLanguage:'en', levelId:'', mode:'easy' };
let searchState = { status:'initial', results:[], query:'' };
let revealedEntryId = null;
let runHandle = null;
let statsStorage = null;
try { statsStorage = localStorage; } catch { /* Anonymous statistics remain optional. */ }
const localApi = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(analyticsConfig.apiBaseUrl);
const analytics = new AnalyticsClient({ ...analyticsConfig, storage: statsStorage,
  enabled: location.origin === analyticsConfig.productionOrigin || (localApi && ['localhost','127.0.0.1'].includes(location.hostname)),
  onChange: () => refreshStatistics(),
});
const statistics = new Map();
let statisticsRequest = 0;
const setup = $('start-dialog'), finish = $('finish-dialog'), searchDialog = $('search-dialog');
const currentLevel = () => session?.level || previewLevel;
const entries = () => currentLevel()?.entries || [];
const currentMode = () => session?.mode || draft.mode;
const solutionView = () => session?.finishReason === 'revealed';
const feedback = () => solutionView() ? { solved:new Set(), greenCells:new Set() } : feedbackFor(entries(), session?.values || {}, currentMode());
const answerVisible = (entry, solved) => solutionView() || (currentMode()==='easy' && (solved.has(entry.id) || session?.revealedEntries.has(entry.id)));
const announce = (text) => { $('announcement').textContent = text; };

function nameCard(character, className = 'answer-names') {
  const card = document.createElement('div'); card.className = className;
  for (const [lang, label] of [['zh-CN','chineseName'],['ja','japaneseName'],['en','englishName']]) {
    const row = document.createElement('span'); row.className = 'name-row';
    const heading = document.createElement('small'); heading.textContent = t(label);
    const value = document.createElement('strong'); value.textContent = character.names[lang]; value.lang = lang;
    row.append(heading, value); card.append(row);
  }
  return card;
}

function renderStrings() {
  document.documentElement.lang = language;
  document.title = t('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  for (const id of ['ui-language','setup-language']) { $(id).value = language; $(id).setAttribute('aria-label', t('uiLanguage')); }
  $('mode-switch').setAttribute('aria-label', t('modeLabel'));
  $('change-direction').setAttribute('aria-label', t('switchDirection'));
  $('search-input').placeholder = t('searchPlaceholder');
  for (const [key, input] of inputs) {
    const [row,column] = key.split(',').map(Number);
    input.setAttribute('aria-label', t('cellLabel', {row:row+1,column:column+1}));
  }
  if (levels.length) { renderSetup(); renderGame(); renderSearch(); renderAnswerDialog(); refreshStatistics(); }
  else $('load-status').textContent = t(loadFailed ? 'loadError' : 'loading');
}

function setLanguage(value) {
  if (!LANGUAGES.includes(value)) return;
  language = value;
  try { localStorage.setItem('tracen-ui-language', value); } catch { /* Preference only. */ }
  renderStrings();
}

function syncDraft(source = 'level') {
  let available = levels.filter((level) => level.difficulty === draft.difficulty && level.answerLanguage === draft.answerLanguage);
  noteKey = '';
  if (!available.length) {
    const alternative = source === 'answer'
      ? levels.find((level) => level.answerLanguage === draft.answerLanguage)
      : levels.find((level) => level.difficulty === draft.difficulty);
    if (alternative) {
      noteKey = source === 'answer' ? 'adjustedCategory' : 'adjustedAnswer';
      draft.difficulty = alternative.difficulty; draft.answerLanguage = alternative.answerLanguage;
      available = levels.filter((level) => level.difficulty === draft.difficulty && level.answerLanguage === draft.answerLanguage);
    }
  }
  if (!available.some((level) => level.id === draft.levelId)) draft.levelId = available[0]?.id || '';
  renderSetup();
}

function renderSetup() {
  if (!levels.length) return;
  $('difficulty-select').value = draft.difficulty; $('answer-select').value = draft.answerLanguage;
  const available = levels.filter((level) => level.difficulty === draft.difficulty && level.answerLanguage === draft.answerLanguage);
  const select = $('level-select'); select.replaceChildren();
  for (const level of available) {
    const option = document.createElement('option'); option.value = level.id; option.textContent = level.title[language]; select.append(option);
  }
  if (!available.length) { const option = document.createElement('option'); option.textContent = t('emptyLevels'); option.value=''; select.append(option); }
  select.value = draft.levelId;
  const level = levels.find((level) => level.id === draft.levelId);
  $('level-description').textContent = level?.description[language] || '';
  $('level-summary').textContent = level ? t('selectionSummary', { rows:level.grid.rows,columns:level.grid.columns,
    across:level.entries.filter((e)=>e.direction==='across').length,down:level.entries.filter((e)=>e.direction==='down').length }) : '';
  $('selection-note').hidden = !noteKey; $('selection-note').textContent = noteKey ? t(noteKey) : '';
  $('start-button').disabled = !level;
  $('start-button-label').textContent = t(!session ? 'start' : forceRestart || level?.id !== session.level.id ? 'startNew' : 'apply');
  $('cancel-setup').hidden = !session;
  if (level) void loadStatistics(level, 'setup-statistics');
}

function paintStatistics(element, result = { status: 'loading' }) {
  element.replaceChildren();
  const heading = document.createElement('strong'); heading.className = 'statistics-title'; heading.textContent = t('statsTitle'); element.append(heading);
  if (result.status !== 'ok') {
    const note = document.createElement('p'); note.textContent = t({ loading:'statsLoading', disabled:'statsDisabled', error:'statsError' }[result.status]); element.append(note);
  } else {
    const metrics = document.createElement('dl'); metrics.className = 'statistics-metrics';
    for (const [label, value] of [['statsStarts', result.starts.toLocaleString(language)], ['statsSolved', result.solved.toLocaleString(language)],
      ['statsAverage', result.averageMs === null ? t('statsNoCompletions') : formatTime(result.averageMs)]]) {
      const item = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = t(label); dd.textContent = value; item.append(dt,dd); metrics.append(item);
    }
    element.append(metrics);
    const challenge = document.createElement('p'); challenge.textContent = t('statsChallenge', { n:result.challengeSolved.toLocaleString(language),
      time:result.challengeAverageMs === null ? t('statsNoCompletions') : formatTime(result.challengeAverageMs) }); element.append(challenge);
  }
  if (analytics.enabled) {
    const note = document.createElement('small'); note.textContent = t('statsPrivacy'); element.append(note);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button statistics-refresh'; button.textContent = t('statsRefresh');
    button.addEventListener('click', () => { const level = levels.find((level) => level.id === element.dataset.level); if (level) void loadStatistics(level,element.id,true); }); element.append(button);
  }
}
async function loadStatistics(level, elementId, force = false) {
  const element = $(elementId); if (!element) return;
  const request = String(++statisticsRequest); element.dataset.request = request;
  element.dataset.level = level.id; paintStatistics(element, force ? undefined : statistics.get(level.id));
  const result = await analytics.stats(level, force); statistics.set(level.id, result);
  if (element.dataset.level === level.id && element.dataset.request === request) paintStatistics(element, result);
}
function refreshStatistics() {
  if (currentLevel()) void loadStatistics(currentLevel(), 'level-statistics');
  const selected = levels.find((level) => level.id === draft.levelId);
  if (selected) void loadStatistics(selected, 'setup-statistics');
}
window.addEventListener('online', () => { void analytics.flush(); refreshStatistics(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void analytics.flush(); refreshStatistics(); } });
void analytics.flush();

function openSetup(replay = false) {
  finish.close();
  forceRestart = replay;
  const level = currentLevel();
  if (level) draft = { difficulty:level.difficulty, answerLanguage:level.answerLanguage,levelId:level.id,mode:currentMode() };
  document.querySelector(`input[name="mode"][value="${draft.mode}"]`).checked = true;
  noteKey = ''; renderSetup(); setup.showModal();
}

function updateTimer() { $('timer').textContent = formatTime(session?.elapsed || 0); }
setInterval(updateTimer, 250);

function renderGame() {
  const level = currentLevel(); if (!level || !active) return;
  const { solved, greenCells } = feedback();
  $('level-title').textContent = level.title[language];
  $('level-category').textContent = `${t(level.difficulty)} / ${t(level.answerLanguage === 'en' ? 'answerEn':'answerJa')}`;
  $('board-label').textContent = level.title[language];
  $('game-status').textContent = t(!session ? 'ready' : solutionView() ? 'ended' : session.completed ? 'finished' : 'playing');
  $('easy-mode').setAttribute('aria-pressed', String(currentMode()==='easy'));
  $('hard-mode').setAttribute('aria-pressed', String(currentMode()==='hard'));
  $('mode-description').textContent = t(currentMode()==='easy'?'easyShort':'hardShort');
  $('progress').textContent = solutionView() ? t('solutionProgress',{total:entries().length}) : currentMode()==='easy'
    ? t('progressCorrect',{n:solved.size,total:entries().length})
    : t('progressFilled',{n:Object.values(session?.values || {}).filter(Boolean).length,total:inputs.size});
  const selected = new Set(entryCells(active));
  for (const [key, cell] of containers) {
    cell.classList.toggle('active-word', selected.has(key)); cell.classList.toggle('selected',key===activeKey);
    cell.classList.toggle('correct',greenCells.has(key));
    cell.classList.toggle('solution',solutionView());
    inputs.get(key).tabIndex = key===activeKey ? 0 : -1;
  }
  $('active-clue-number').textContent = t('currentEntry',{number:active.number,direction:t(active.direction)});
  $('active-clue-text').textContent = `${active.clues[language]} (${[...active.answer].length})`;
  const answer = $('active-answer'); answer.replaceChildren(); answer.hidden = !answerVisible(active,solved);
  if (!answer.hidden) answer.append(nameCard(characterMap.get(active.characterId)));
  $('change-direction').disabled = (members.get(activeKey)?.length || 0) < 2 || !session || session.completed;
  $('input-rule').textContent = t(level.answerLanguage==='ja'?'jaRule':'enRule');
  for (const direction of ['across','down']) {
    $(`${direction}-tab`).classList.toggle('selected', activeDirection===direction);
    $(`${direction}-tab`).setAttribute('aria-pressed',String(activeDirection===direction));
    $(`${direction}-count`).textContent = entries().filter((e)=>e.direction===direction).length;
  }
  $('finish-time').textContent = formatTime(session?.elapsed || 0);
  $('finish-mode').textContent = t((session?.finishedMode || currentMode())==='easy'?'easy':'hard');
  $('finish-title').textContent=t(solutionView()?'endedTitle':'finishTitle');
  $('finish-dialog').querySelector('.dialog-copy').textContent=t(solutionView()?'endedCopy':'finishCopy');
  renderAnswerActions(solved); renderClues(solved); updateTimer();
}

function renderAnswerActions(solved = feedback().solved) {
  const easy=currentMode()==='easy', remaining=Math.max(0,3-(session?.revealedEntries.size||0));
  const alreadyViewed=session?.revealedEntries.has(active.id);
  $('reveal-answer').hidden=!easy||Boolean(session?.completed);
  $('reveal-answer').textContent=t(alreadyViewed?'revealAgain':'revealAnswer');
  $('reveal-answer').disabled=!session||session.completed||(remaining===0&&!alreadyViewed);
  $('reveal-allowance').hidden=!easy||Boolean(session?.completed);
  $('reveal-allowance').textContent=t('revealRemaining',{n:remaining});
  $('end-game').hidden=easy||!session||session.completed;
  $('answer-action-note').textContent=session?.completed?'':t(easy?'revealNote':'endActionNote');
}

function renderAnswerDialog() {
  const entry=entries().find((e)=>e.id===revealedEntryId); if(!entry)return;
  $('revealed-clue').textContent=`${t('currentEntry',{number:entry.number,direction:t(entry.direction)})} · ${entry.clues[language]}`;
  $('revealed-literal').textContent=entry.answer;
  $('revealed-names').replaceChildren(nameCard(characterMap.get(entry.characterId)));
  $('answer-dialog-note').textContent=`${t('revealRemaining',{n:Math.max(0,3-session.revealedEntries.size)})} · ${t('revealNote')}`;
}

function renderClues(solved = feedback().solved) {
  const list = $('clue-list'); list.replaceChildren();
  for (const entry of entries().filter((e)=>e.direction===activeDirection)) {
    const button = document.createElement('button'); button.type='button'; button.className='clue-item'; button.dataset.entry=entry.id;
    button.classList.toggle('active',entry.id===active.id); button.classList.toggle('solved',solved.has(entry.id));
    button.setAttribute('aria-pressed',String(entry.id===active.id));
    const number = document.createElement('span'); number.className='clue-index'; number.textContent=String(entry.number).padStart(2,'0');
    const content = document.createElement('span'); content.className='clue-copy';
    const text = document.createElement('span'); text.textContent=entry.clues[language];
    const length = document.createElement('span'); length.className='clue-length'; length.textContent=` (${[...entry.answer].length})`;
    content.append(text,length);
    if (answerVisible(entry,solved)) {
      content.append(nameCard(characterMap.get(entry.characterId)));
      if(solved.has(entry.id)) {
        const check = document.createElement('span'); check.className='solved-mark'; check.textContent='✓'; check.setAttribute('aria-label',t('correct')); button.append(check);
      } else {
        const label=document.createElement('small');label.className='revealed-label';label.textContent=t('revealMarked');content.append(label);
      }
    }
    button.prepend(number,content);
    button.addEventListener('click',()=>{
      const keys = entryCells(entry); activate(entry,keys.find((key)=>!session?.values[key])||keys[0]);
    });
    list.append(button);
  }
}

function activate(entry,key,focus = true) {
  if (!entry) return;
  active=entry; activeKey=key; activeDirection=entry.direction; renderGame();
  const list=$('clue-list'), button=list.querySelector('.clue-item.active');
  if (button) {
    const top=button.offsetTop, bottom=top+button.offsetHeight;
    if (top<list.scrollTop) list.scrollTop=top;
    else if (bottom>list.scrollTop+list.clientHeight) list.scrollTop=bottom-list.clientHeight;
  }
  if (focus&&session&&!session.completed) inputs.get(key)?.focus({preventScroll:true});
}
function chooseCell(key,toggle = false) {
  const options=members.get(key); if (!options) return;
  let entry=options.find((e)=>e.direction===active.direction)||options[0];
  if (toggle&&options.length===2) entry=options.find((e)=>e.id!==active.id)||entry;
  activate(entry,key,false);
}
function stepInWord(amount) {
  const keys=entryCells(active), next=keys[keys.indexOf(activeKey)+amount]; if (next) activate(active,next);
}
function nextEntry(amount) {
  const all=entries(), next=all[(all.findIndex((e)=>e.id===active.id)+amount+all.length)%all.length];
  const keys=entryCells(next); activate(next,keys.find((key)=>!session.values[key])||keys[0]);
}
function toggleDirection() {
  const options=members.get(activeKey); if (options?.length===2) activate(options.find((e)=>e.id!==active.id),activeKey);
}
function commit(changes) {
  if (!session||session.completed) return;
  const completed=session.update(changes);
  for (const key of Object.keys(changes)) inputs.get(key).value=session.values[key]||'';
  renderGame();
  if (completed) {
    void analytics.end(runHandle, session);
    for (const input of inputs.values()) input.readOnly=true;
    announce(t('finishAnnouncement',{time:formatTime(session.elapsed)})); finish.showModal();
  }
}
function insertText(text) {
  if (!session||session.completed) return;
  const letters=[...normalizeAnswer(text,session.level.answerLanguage)]; if (!letters.length) return;
  const keys=entryCells(active), offset=keys.indexOf(activeKey), count=Math.min(letters.length,keys.length-offset), changes={};
  for (let i=0;i<count;i++) changes[keys[offset+i]]=letters[i];
  commit(changes);
  if (!session.completed) activate(active,keys[Math.min(offset+count,keys.length-1)]);
}
function handleKey(event) {
  if (!session||session.completed||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey) return;
  if (session.level.answerLanguage==='en'&&/^[a-zA-Z]$/.test(event.key)) { event.preventDefault(); insertText(event.key); }
  else if (session.level.answerLanguage==='ja'&&/^[\u3041-\u3096\u30A1-\u30FAー]$/.test(event.key)) { event.preventDefault(); insertText(event.key); }
  else if (event.key==='Backspace') { event.preventDefault(); if (!session.values[activeKey]) stepInWord(-1); commit({[activeKey]:''}); }
  else if (event.key==='Delete') { event.preventDefault(); commit({[activeKey]:''}); }
  else if (event.key==='Tab') { event.preventDefault(); nextEntry(event.shiftKey?-1:1); }
  else if (event.key===' '||event.key==='Enter') { event.preventDefault(); toggleDirection(); }
  else if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
    event.preventDefault(); const [r,c]=activeKey.split(',').map(Number);
    const [dr,dc]={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[event.key];
    const key=cellKey(r+dr,c+dc);
    if (inputs.has(key)) activate(members.get(key).find((e)=>e.direction===(dr?'down':'across'))||members.get(key)[0],key);
  }
}

function buildBoard(level,enabled = false) {
  inputs=new Map(); containers=new Map(); members=new Map();
  for (const entry of level.entries) for (const key of entryCells(entry)) {
    if (!members.has(key)) members.set(key,[]); members.get(key).push(entry);
  }
  const starts=new Map(level.entries.map((e)=>[cellKey(e.row,e.column),e.number]));
  const board=$('board'); board.replaceChildren(); board.style.gridTemplateColumns=`repeat(${level.grid.columns},minmax(0,1fr))`;
  board.style.aspectRatio=`${level.grid.columns} / ${level.grid.rows}`;
  board.classList.toggle('kana-board',level.answerLanguage==='ja');
  level.grid.layout.forEach((row,r)=>[...row].forEach((char,c)=>{
    const cell=document.createElement('div'); cell.className='cell'; board.append(cell);
    if (char==='#') {cell.setAttribute('aria-hidden','true');return;}
    const key=cellKey(r,c);cell.classList.add('white');cell.dataset.cell=key;
    if (starts.has(key)) {const number=document.createElement('span');number.className='cell-number';number.textContent=starts.get(key);cell.append(number);}
    const input=document.createElement('input');input.type='text';input.autocomplete='off';input.spellcheck=false;
    input.autocapitalize=level.answerLanguage==='en'?'characters':'off';input.inputMode='text';input.lang=level.answerLanguage==='ja'?'ja':'en';
    input.setAttribute('aria-label',t('cellLabel',{row:r+1,column:c+1}));input.setAttribute('enterkeyhint','next');input.disabled=!enabled;input.tabIndex=-1;
    let composing=false, compositionAnchor=null, suppressCompositionEcho=false;
    input.addEventListener('focus',()=>{if(activeKey!==key)chooseCell(key);});
    input.addEventListener('pointerdown',()=>chooseCell(key,activeKey===key));input.addEventListener('keydown',handleKey);
    input.addEventListener('paste',(event)=>{event.preventDefault();insertText(event.clipboardData.getData('text'));});
    input.addEventListener('beforeinput',(event)=>{
      if(composing||event.isComposing||event.inputType.includes('Composition'))return;
      suppressCompositionEcho=false;
      if(event.inputType==='insertText'&&event.data!=null){event.preventDefault();insertText(event.data);}
      else if(event.inputType==='deleteContentBackward'){event.preventDefault();if(!session?.values[key])stepInWord(-1);commit({[activeKey]:''});}
    });
    input.addEventListener('input',(event)=>{
      if(composing||event.isComposing)return;
      if(suppressCompositionEcho){input.value=session?.values[key]||'';return;}
      const value=input.value;input.value=session?.values[key]||'';
      if(value)insertText(value);else commit({[key]:''});
    });
    input.addEventListener('compositionstart',()=>{composing=true;compositionAnchor={entry:active,key};suppressCompositionEcho=false;input.value='';});
    input.addEventListener('compositionend',(event)=>{
      composing=false;const value=event.data||input.value;input.value=session?.values[key]||'';
      suppressCompositionEcho=true;
      if(compositionAnchor)activate(compositionAnchor.entry,compositionAnchor.key,false);
      insertText(value);compositionAnchor=null;
      setTimeout(()=>{suppressCompositionEcho=false;},0);
    });
    cell.append(input);inputs.set(key,input);containers.set(key,cell);
  }));
  active=level.entries[0];activeKey=entryCells(active)[0];activeDirection=active.direction;
}

function launch(level,mode) {
  revealedEntryId=null;
  session=new GameSession(level,mode);previewLevel=level;searchState={status:'initial',results:[],query:''};$('search-input').value='';
  runHandle=analytics.begin(session); refreshStatistics();
  buildBoard(level,true);renderGame();renderSearch();
  for(const id of ['lookup','choose-level','restart'])$(id).disabled=false;
  activate(active,activeKey);$('clue-list').scrollTop=0;announce(t('startedAnnouncement'));
}
function applyMode(mode) {
  $('answer-dialog').close();
  if(session)session.setMode(mode);draft.mode=mode;renderGame();
  // A result obtained in Assisted mode must not bypass the Challenge allowance.
  searchState={status:'initial',results:[],query:''};renderSearch();
  announce(t('modeChanged',{mode:t(mode==='easy'?'easy':'hard')}));
}
function renderSearch() {
  const hard=currentMode()==='hard', remaining=Math.max(0,3-(session?.hardSearches||0));
  $('search-allowance').textContent=hard?t('searchRemaining',{n:remaining}):t('searchUnlimited');
  $('dictionary-count').textContent=t('dictionaryCount',{n:characters.length});
  $('search-submit').disabled=!session||(hard&&remaining===0);
  $('search-query').hidden=!searchState.query;$('search-query').textContent=t('searchQuery',{query:searchState.query});
  const message=searchState.status==='ok'?(searchState.results.length?t('resultCount',{n:searchState.results.length}):t('noResults')):
    t({initial:'searchInitial',empty:'searchEmpty',limit:'searchLimit'}[searchState.status]);
  $('search-message').textContent=message;
  const results=$('search-results');results.replaceChildren();
  if(searchState.status==='ok')for(const character of searchState.results){
    const card=document.createElement('article');card.className='character-result';card.dataset.character=character.id;card.append(nameCard(character));results.append(card);
  }
}

for(const id of ['ui-language','setup-language'])$(id).addEventListener('change',(event)=>setLanguage(event.target.value));
$('difficulty-select').addEventListener('change',(event)=>{draft.difficulty=event.target.value;syncDraft('difficulty');});
$('answer-select').addEventListener('change',(event)=>{draft.answerLanguage=event.target.value;syncDraft('answer');});
$('level-select').addEventListener('change',(event)=>{draft.levelId=event.target.value;noteKey='';renderSetup();});
document.querySelectorAll('input[name="mode"]').forEach((radio)=>radio.addEventListener('change',()=>{draft.mode=radio.value;}));
$('start-form').addEventListener('submit',(event)=>{
  event.preventDefault();const level=levels.find((e)=>e.id===draft.levelId);if(!level)return;
  draft.mode=new FormData(event.currentTarget).get('mode');setup.close();
  if(!session||forceRestart||session.level.id!==level.id)launch(level,draft.mode);else applyMode(draft.mode);
  forceRestart=false;
});
setup.addEventListener('cancel',(event)=>{if(!session)event.preventDefault();});
$('cancel-setup').addEventListener('click',()=>setup.close());
$('choose-level').addEventListener('click',()=>openSetup());
$('easy-mode').addEventListener('click',()=>applyMode('easy'));
$('hard-mode').addEventListener('click',()=>applyMode('hard'));
for(const direction of ['across','down'])$(`${direction}-tab`).addEventListener('click',()=>{activeDirection=direction;renderGame();$('clue-list').scrollTop=0;});
$('change-direction').addEventListener('click',toggleDirection);
$('restart').addEventListener('click',()=>$('restart-dialog').showModal());
$('cancel-restart').addEventListener('click',()=>$('restart-dialog').close());
$('confirm-restart').addEventListener('click',()=>{$('restart-dialog').close();launch(session.level,session.mode);});
$('review-board').addEventListener('click',()=>finish.close());
$('play-again').addEventListener('click',()=>openSetup(true));
$('lookup').addEventListener('click',()=>{renderSearch();searchDialog.showModal();$('search-input').focus();});
$('close-search').addEventListener('click',()=>searchDialog.close());
$('search-form').addEventListener('submit',(event)=>{
  event.preventDefault();if(!session)return;
  const query=$('search-input').value;searchState={...session.query(characters,query),query};renderSearch();
});
$('reveal-answer').addEventListener('click',()=>{
  if(!session||session.completed)return;
  const result=session.reveal(active.id);
  if(result.status!=='ok'){if(result.status==='limit')announce(t('revealLimit'));return;}
  revealedEntryId=active.id;renderGame();renderAnswerDialog();$('answer-dialog').showModal();
});
$('close-answer').addEventListener('click',()=>$('answer-dialog').close());
$('end-game').addEventListener('click',()=>{if(session&&!session.completed&&session.mode==='hard')$('end-dialog').showModal();});
$('cancel-end').addEventListener('click',()=>$('end-dialog').close());
$('confirm-end').addEventListener('click',()=>{
  $('end-dialog').close();if(!session?.endAndReveal())return;
  void analytics.end(runHandle, session);
  for(const [key,input] of inputs){input.value=session.values[key]||'';input.readOnly=true;}
  renderGame();announce(t('endedAnnouncement',{time:formatTime(session.elapsed)}));finish.showModal();
});
renderStrings();setup.showModal();
try {
  const catalog=await loadCatalog();levels=catalog.levels;characters=catalog.characters;characterMap=new Map(characters.map((c)=>[c.id,c]));
  previewLevel=levels[0];draft.levelId=previewLevel.id;draft.difficulty=previewLevel.difficulty;draft.answerLanguage=previewLevel.answerLanguage;
  buildBoard(previewLevel);$('load-status').textContent='';$('load-status').hidden=true;renderStrings();
} catch(error) { loadFailed=true;$('load-status').textContent=t('loadError');console.error(error); }
