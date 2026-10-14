import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index.js';
import { supportedLevels } from '../worker/levels.generated.js';
import { AnalyticsClient } from '../src/analytics.js';
import { GameSession } from '../src/game.js';
import { levelRevision, solutionCells } from '../src/analytics-protocol.js';
import { onRequest } from '../functions/api/[[path]].js';

const schema = await readFile(new URL('../worker/migrations/0001_stats.sql', import.meta.url), 'utf8');
const puzzle = JSON.parse(await readFile(new URL('../data/levels/beginner-1-en.json', import.meta.url), 'utf8'));
const level = supportedLevels.find((level) => level.id === puzzle.id);
const origin = 'https://umamusume-crossword.pages.dev';
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(schema);
  const DB = { prepare(sql) {
    const statement = sqlite.prepare(sql); let params = [];
    const query = { bind(...values) { params = values; return query; },
      async first() { return statement.get(...params) || null; }, async run() { return { success: true, meta: statement.run(...params) }; } };
    return query;
  } };
  const env = { DB, ALLOWED_ORIGINS: origin };
  const send = (path, body, requestOrigin = origin) => worker.fetch(new Request(`https://stats.example${path}`, {
    method: body ? 'POST' : 'GET', headers: { ...(requestOrigin ? { Origin:requestOrigin } : {}), ...(body ? { 'Content-Type':'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  const start = (extra = {}) => ({ runId:crypto.randomUUID(), levelId:level.id, revision:level.revision, startMode:'hard', ...extra });
  const finish = (run, extra = {}) => ({ runId:run.runId, levelId:run.levelId, revision:run.revision,
    outcome:'solved', elapsedMs:60000, finishedMode:'hard', everAssisted:false, lookupCount:0, revealCount:0, values:level.solution, ...extra });
  const stats = async () => (await send(`/api/stats?levelId=${level.id}&revision=${level.revision}`)).json();
  return { sqlite, env, send, start, finish, stats };
}
function memoryStorage() {
  const data = new Map(); return { get length() { return data.size; }, key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.get(k) ?? null; }, setItem(k,v) { data.set(k,String(v)); }, removeItem(k) { data.delete(k); } };
}
const apiFetch = (f) => (url, options) => { const request = new Request(url, options); request.headers.set('Origin',origin); return worker.fetch(request,f.env); };
const flush = async (client, handle) => { if (handle) await handle.ready; await client.flush(); };

test('Worker puzzle revisions and server solutions match the actual catalog', async () => {
  assert.equal(level.revision, await levelRevision(puzzle)); assert.deepEqual(level.solution,solutionCells(puzzle));
  assert.equal(supportedLevels.length,8);
});
test('unplayed puzzles return zero games and null averages, never a zero-second result',async () => {
  const f=fixture(); const stats=await f.stats(); assert.equal(stats.starts,0); assert.equal(stats.solved,0); assert.equal(stats.averageMs,null); assert.equal(stats.challengeAverageMs,null);
});
test('retries count a start and successful completion exactly once and averages exclude abandoned games',async () => {
  const f=fixture(), run=f.start(), abandoned=f.start();
  assert.equal((await f.send('/api/runs/start',run)).status,200); await f.send('/api/runs/start',run); await f.send('/api/runs/start',abandoned);
  const finish=f.finish(run); await f.send('/api/runs/finish',finish); await f.send('/api/runs/finish',finish);
  const stats=await f.stats(); assert.equal(stats.starts,2); assert.equal(stats.solved,1); assert.equal(stats.averageMs,60000); assert.equal(stats.challengeSolved,1);
});
test('Assisted and mixed-mode games stay out of the all-Challenge average',async () => {
  const f=fixture();
  for(const [startMode,everAssisted,elapsedMs] of [['hard',false,60000],['easy',true,120000],['hard',true,180000]]) {
    const run=f.start({startMode}); await f.send('/api/runs/start',run);
    assert.equal((await f.send('/api/runs/finish',f.finish(run,{everAssisted,elapsedMs}))).status,200);
  }
  const stats=await f.stats(); assert.equal(stats.solved,3); assert.equal(stats.averageMs,120000); assert.equal(stats.challengeSolved,1); assert.equal(stats.challengeAverageMs,60000);
});
test('revealing the full solution records an early ending without a successful completion',async () => {
  const f=fixture(), run=f.start(); await f.send('/api/runs/start',run);
  const finish=f.finish(run,{outcome:'revealed'}); delete finish.values;
  assert.equal((await f.send('/api/runs/finish',finish)).status,200);
  assert.equal((await f.send('/api/runs/finish',f.finish(run))).status,409);
  assert.equal((await f.stats()).solved,0); assert.equal(f.sqlite.prepare('SELECT status FROM game_runs').get().status,'revealed');
});
test('incomplete boards, unknown puzzles and revisions, impossible times and erased help history are rejected',async () => {
  const f=fixture(),run=f.start({startMode:'easy'}); await f.send('/api/runs/start',run);
  for(const extra of [{values:{}},{elapsedMs:-1},{elapsedMs:8*86400000},{revealCount:4},{everAssisted:false},{revision:'stale'}]) {
    const response=await f.send('/api/runs/finish',f.finish(run,{everAssisted:true,...extra})); assert.ok(response.status>=400);
  }
  assert.equal((await f.stats()).solved,0);
  assert.equal((await f.send('/api/runs/start',f.start({levelId:'unknown'}))).status,422);
});
test('run IDs cannot be reused for a different puzzle or mode; finishing without a start is rejected',async () => {
  const f=fixture(),run=f.start(); await f.send('/api/runs/start',run);
  assert.equal((await f.send('/api/runs/start',{...run,startMode:'easy'})).status,409);
  assert.equal((await f.send('/api/runs/finish',f.finish(f.start()))).status,409); assert.equal((await f.stats()).starts,1);
});
test('origins are checked before writes; public reads disclose only aggregate data',async () => {
  const f=fixture(),run=f.start();
  assert.equal((await f.send('/api/runs/start',run,'https://other.example')).status,403);
  assert.equal((await f.send('/api/runs/start',run,null)).status,403);
  const preflight=await worker.fetch(new Request('https://stats.example/api/runs/start',{method:'OPTIONS',headers:{Origin:origin}}),f.env);
  assert.equal(preflight.status,204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  await f.send('/api/runs/start',run); const data=JSON.stringify(await f.stats()); assert.ok(!data.includes(run.runId)); assert.ok(!data.includes('started_at'));
});
test('oversized, malformed and non-JSON requests return controlled client errors',async () => {
  const f=fixture();
  for(const [body,type,status] of [['{','application/json',400],['{}','text/plain',415],['x'.repeat(33000),'application/json',413]]) {
    const response=await worker.fetch(new Request('https://stats.example/api/runs/start',{method:'POST',headers:{Origin:origin,'Content-Type':type},body}),f.env);
    assert.equal(response.status,status);
  }
});
test('a missing database produces a safe failure without exposing credentials or internal errors',async () => {
  const response=await worker.fetch(new Request('https://stats.example/api/health'),{});
  assert.equal(response.status,503); assert.equal((await response.json()).error,'Statistics temporarily unavailable');
});
test('session history survives mode changes and resets only for a new game',() => {
  const session=new GameSession(puzzle,'hard'); session.setMode('easy'); session.query([], 'unknown'); session.setMode('hard');
  assert.equal(session.everAssisted,true); assert.equal(session.lookupCount,1); assert.equal(session.hardSearches,0);
  session.query([],' '); assert.equal(session.lookupCount,1); session.restart(puzzle); assert.equal(session.everAssisted,false); assert.equal(session.lookupCount,0);
  session.update(level.solution); session.setMode('easy'); assert.equal(session.everAssisted,false);
});
test('client integration counts restarts, keeps a finished board snapshot, and records one win',async () => {
  const f=fixture(),storage=memoryStorage(),client=new AnalyticsClient({apiBaseUrl:'https://stats.example',fetcher:apiFetch(f),storage});
  let time=0; const session=new GameSession(puzzle,'hard',()=>time),handle=client.begin(session); await flush(client,handle);
  session.setMode('easy'); session.setMode('hard'); session.query([],'unknown'); time=90000; session.update(level.solution);
  await client.end(handle,session); await client.end(handle,session); await client.flush();
  const stats=await f.stats(); assert.equal(stats.starts,1); assert.equal(stats.solved,1); assert.equal(stats.averageMs,90000); assert.equal(stats.challengeSolved,0);
  assert.equal(storage.length,0); assert.equal(f.sqlite.prepare('SELECT lookup_count FROM game_runs').get().lookup_count,1);
  await flush(client,client.begin(new GameSession(puzzle))); assert.equal((await f.stats()).starts,2); client.dispose();
});
test('offline starts and completions survive reload and replay in order without duplicates',async () => {
  const f=fixture(),storage=memoryStorage();
  const client=new AnalyticsClient({apiBaseUrl:'https://stats.example',storage,fetcher:async()=>{throw new Error('offline');}});
  let time=0; const session=new GameSession(puzzle,'hard',()=>time),handle=client.begin(session); await flush(client,handle);
  time=50000;session.update(level.solution); await client.end(handle,session); client.dispose(); assert.equal(storage.length,1);
  const recovered=new AnalyticsClient({apiBaseUrl:'https://stats.example',storage,fetcher:apiFetch(f)}); await recovered.flush(); recovered.dispose();
  const stats=await f.stats(); assert.equal(stats.starts,1);assert.equal(stats.solved,1);assert.equal(stats.averageMs,50000);assert.equal(storage.length,0);
});
test('a lost successful HTTP response can be retried without incrementing starts or wins twice',async () => {
  const f=fixture(),storage=memoryStorage(); let loseStart=true,loseFinish=true;
  const fetcher=async(url,options)=>{const response=await apiFetch(f)(url,options);
    if(url.endsWith('/start')&&loseStart){loseStart=false;throw new Error('response lost');}
    if(url.endsWith('/finish')&&loseFinish){loseFinish=false;throw new Error('response lost');} return response;};
  const client=new AnalyticsClient({apiBaseUrl:'https://stats.example',storage,fetcher});
  const session=new GameSession(puzzle,'easy'),handle=client.begin(session);await flush(client,handle);session.update(level.solution);
  await client.end(handle,session);await client.flush();await client.flush();client.dispose();
  assert.equal((await f.stats()).starts,1);assert.equal((await f.stats()).solved,1);
});
test('separate tabs keep separate pending records and a disabled client never sends requests',async () => {
  const storage=memoryStorage(),offline=async()=>{throw new Error('offline');};
  const clients=[1,2].map(()=>new AnalyticsClient({apiBaseUrl:'https://stats.example',storage,fetcher:offline}));
  for(const client of clients)await flush(client,client.begin(new GameSession(puzzle))); assert.equal(storage.length,2);clients.forEach((c)=>c.dispose());
  const disabled=new AnalyticsClient({apiBaseUrl:'https://stats.example',enabled:false,fetcher:()=>assert.fail('must not send')});
  assert.equal(disabled.begin(new GameSession(puzzle)),null);assert.equal((await disabled.stats(puzzle)).status,'disabled');await disabled.flush();disabled.dispose();
});
test('initializing the schema again preserves existing records and counters',async()=>{
  const f=fixture(),run=f.start();await f.send('/api/runs/start',run);f.sqlite.exec(schema);assert.equal((await f.stats()).starts,1);
});
test('the same-origin Pages route forwards to the bound Worker and uses the real SQL API',async()=>{
  const f=fixture(),run=f.start();
  const request=new Request(`${origin}/api/runs/start`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(run)});
  const response=await onRequest({request,env:{STATS:{fetch:(request)=>worker.fetch(request,f.env)}}});
  assert.equal(response.status,200);assert.equal((await f.stats()).starts,1);
});
test('unbound previews and Worker connection failures fail safely without exposing details',async()=>{
  for(const env of [{},{STATS:{fetch:()=>{throw new Error('private infrastructure details');}}}]){
    const response=await onRequest({request:new Request(`${origin}/api/health`),env});
    assert.equal(response.status,503);assert.equal((await response.json()).error,'Statistics temporarily unavailable');
  }
});
test('completion during an in-flight start is delivered without losing or duplicating the result',async()=>{
  const f=fixture();let release;const gate=new Promise((resolve)=>{release=resolve;});
  const fetcher=async(url,options)=>{if(url.endsWith('/start'))await gate;return apiFetch(f)(url,options);};
  const client=new AnalyticsClient({apiBaseUrl:'https://stats.example',fetcher});
  const session=new GameSession(puzzle,'hard'),handle=client.begin(session);await handle.ready;
  session.update(level.solution);const ending=client.end(handle,session);release();await ending;await client.flush();
  assert.equal((await f.stats()).starts,1);assert.equal((await f.stats()).solved,1);client.dispose();
});
