const express=require('express'),http=require('http'),{Server}=require('socket.io'),QR=require('qrcode');
const { categories, series, importSeries } = require('./questions');
const deezer = require('./deezer');
const N = 25, DUR = 10000, MAXP = 10;
const LISTEN_TIME = 15000, SPEAK_TIME = 3000;

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function availablePacks(room) {
  const packs = new Map([['mixte', { label: 'Mixte', rows: [...categories.values()].flat() }]]);
  for (const [label, rows] of categories) packs.set('category:' + label, { label, rows });
  for (const [label, rows] of new Map([...series, ...(room.importedSeries || [])])) {
    packs.set('series:' + label, { label, rows, custom: true });
  }
  return packs;
}

function mixedQuestions() {
  const pools = [...categories.values()].map(shuffle);
  const chosen = new Map();
  while (chosen.size < N && pools.some(pool => pool.length)) {
    for (const pool of pools) {
      const row = pool.pop();
      if (row) chosen.set(row.question, row);
      if (chosen.size === N) break;
    }
  }
  return shuffle([...chosen.values()]);
}

function makeQuestions(id, pack) {
  const rows = id === 'mixte' ? mixedQuestions()
    : pack.custom ? pack.rows : shuffle(pack.rows).slice(0, N);
  return rows.map(({ question, options }) => {
    const o = shuffle(options);
    return { q: question, o, c: o.indexOf(options[0]) };
  });
}

const app = express();
app.set('trust proxy', true);

for (const file of ['tv.html', 'play.html', 'style.css']) {
  app.get('/' + file, (req, res) => res.sendFile(file, { root: __dirname }));
}
app.get('/',(q,r)=>r.redirect('/tv.html'));
const server=http.createServer(app),io=new Server(server);
const rooms={};
const newCode=()=>{let c;do c=Array.from({length:4},()=>'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.random()*23|0]).join('');while(rooms[c]);return c};
app.get('/qr/:c',async(req,res)=>{
  const base=process.env.BASE_URL||`${req.protocol}://${req.get('host')}`;
  res.type('image/svg+xml').send(await QR.toString(`${base}/play.html?r=${encodeURIComponent(req.params.c)}`,{type:'svg',margin:1}));
});
const rank=l=>{const s=[...l].sort((a,b)=>b.score-a.score);let p=0,last=null;return s.map((x,i)=>{if(x.score!==last){p=i+1;last=x.score}return{...x,place:p}})};
function view(r, socket){
  const players=Object.entries(r.players).map(([id,p])=>({id,name:p.name,score:p.score,ready:p.ready,online:p.online,inGame:p.inGame}));
  const v={code:r.code,phase:r.phase,players,rank:rank(players.filter(p=>r.phase==='lobby'||p.inGame)),qi:r.qi,n:r.tracks?.length ?? r.questions?.length ?? N,left:r.endsAt?Math.max(0,r.endsAt-Date.now()):0};
  v.mode = r.mode;
  if (r.mode === 'blind') {
    const b = r.blind;
    if (socket.data.host && r.phase === 'musicSetup') {
      v.themes = Object.keys(deezer.themes);
      v.trackCount = r.tracks?.length ?? 0;
    }
    if (b) {
      const track = r.tracks[r.qi];
      v.buzzed = b.seen.has(socket.data.pid);
      v.active = b.active;
      v.bip = b.bip;
      if (socket.data.host) {
        v.queue = b.queue;
        if (['musicLoad', 'musicPlay'].includes(r.phase)) {
          v.preview = track.preview;
          v.offset = b.elapsed + (r.phase === 'musicPlay' ? Date.now() - b.started : 0);
        }
        if (r.phase === 'musicJudge') v.judge = { title: track.title, artist: track.artist, found: b.found };
        if (r.phase === 'musicReveal') v.results = b.results;
      }
      if (r.phase === 'musicReveal') {
        v.reveal = { title: track.title, artist: track.artist, id: track.id };
        v.result = b.results[socket.data.pid];
      }
    }
  }
  const q=r.questions?.[r.qi];
  if (socket.data.host && r.phase === 'categories') {
    v.packs = [...availablePacks(r)].map(([id, pack]) => ({
      id, label: pack.label, count: pack.custom ? pack.rows.length : Math.min(N,
        new Set(pack.rows.map(row => row.question)).size),
      custom: !!pack.custom,
    }));
  }
  if (q && (r.phase === 'question' || r.phase === 'correction')) {
    v.q = q.q;
    v.o = q.o;
    v.received = Object.keys(r.ans).length;
    v.total = players.filter(p => p.inGame).length;
    v.choice = r.ans[socket.data.pid]?.i ?? null;
  }
  if (q && r.phase === 'correction') {
    v.c = q.c;
    if (socket.data.host) v.res = r.res;
    else v.result = r.res[socket.data.pid];
  }
  return v;
}
function push(room) {
  for (const id of io.sockets.adapter.rooms.get(room.code) || []) {
    const socket = io.sockets.sockets.get(id);
    if (socket) socket.emit('state', view(room, socket));
  }
}
function go(r,phase,ms,next){clearTimeout(r.t);r.phase=phase;r.endsAt=ms?Date.now()+ms:0;push(r);if(ms)r.t=setTimeout(next,ms)}
function nextQ(r){r.qi++;r.ans={};r.res={};r.qStart=Date.now();go(r,'question',DUR,()=>correct(r))}
function correct(r){
  const q=r.questions?.[r.qi];let first=null;
  Object.entries(r.ans).forEach(([id,a])=>{if(a.i===q.c&&(!first||a.t<r.ans[first].t))first=id});
  Object.entries(r.players).filter(([,p])=>p.inGame).forEach(([id,p])=>{
    const a=r.ans[id],ok=!!a&&a.i===q.c,pts=ok?(id===first?2:1):0;
    p.score+=pts;r.res[id]={a:a?a.i:-1,ok,dt:a?a.dt:null,pts};
  });
  go(r,'correction',7000,()=>after(r));
}
function after(r){
  const n=r.qi+1;
  if(n>=r.questions.length)return go(r,'final',0);
  const nx=()=>go(r,'next',3000,()=>nextQ(r));
  n%5===0?go(r,'ranking',7000,nx):nx();
}
function revealTrack(r) {
  r.blind.active = null;
  go(r, 'musicReveal', 7000, () => {
    if (r.qi + 1 === r.tracks.length) return go(r, 'final', 0);
    const next = () => go(r, 'next', 3000, () => nextTrack(r));
    if ((r.qi + 1) % 5 === 0) go(r, 'ranking', 7000, next);
    else next();
  });
}

function loadTrack(r) {
  go(r, 'musicLoad', 0);
}

function nextTrack(r) {
  r.qi++;
  r.blind = {
    seen: new Set(), queue: [], active: null, elapsed: 0, started: 0,
    found: { title: false, artist: false }, results: Object.create(null), bip: 0,
  };
  loadTrack(r);
}

function advanceBuzz(r, automatic = false) {
  const b = r.blind;
  if (b.found.title && b.found.artist) return revealTrack(r);
  if (b.queue.length) {
    if (automatic) giveTurn(r);
    else go(r, 'musicQueue', 0);
  } else if (b.elapsed < LISTEN_TIME &&
      Object.entries(r.players).some(([id, p]) => p.inGame && !b.seen.has(id))) {
    loadTrack(r);
  } else revealTrack(r);
}

function scoreBuzz(r, points) {
  const b = r.blind;
  r.players[b.active].score += points;
  b.results[b.active] = { pts: points };
  b.active = null;
}

function giveTurn(r) {
  r.blind.active = r.blind.queue.shift();
  go(r, 'musicSpeak', SPEAK_TIME, () => {
    r.blind.bip++;
    scoreBuzz(r, -1);
    advanceBuzz(r, true);
  });
}

io.on('connection',s=>{
  s.data={};
  const R=()=>rooms[s.data.code];
  s.on('host:create',(old,cb)=>{
    let r=old&&rooms[old.code];
    if(!r||r.key!==old.key){const code=newCode();r=rooms[code]={code,key:Math.random().toString(36).slice(2),players:{},phase:'lobby',qi:-1,ans:{},res:{}}}
    s.data={code:r.code,host:true};s.join(r.code);cb&&cb({code:r.code,key:r.key});push(r);
  });
  s.on('join',({code,pid,name}={},cb)=>{
    code=String(code||'').toUpperCase();const r=rooms[code];
    if(!r||!pid)return cb({err:'Salon introuvable'});
    let p=r.players[pid];
    if(p)p.online=true;
    else{
      if(r.phase!=='lobby')return cb({late:true});
      if(Object.keys(r.players).length>=MAXP)return cb({err:'Salon complet (10 joueurs maximum)'});
      name=String(name||'').trim().slice(0,14);if(!name)return cb({err:'Choisis un pseudo'});
      r.players[pid]={name,score:0,ready:false,online:true,inGame:false};
    }
    s.data={code,pid};s.join(code);cb({ok:true});push(r);
  });
  s.on('ready',()=>{const r=R(),p=r&&r.players[s.data.pid];if(p&&r.phase==='lobby'){p.ready=!p.ready;push(r)}});
  s.on('answer',i=>{
    const r=R(),p=r&&r.players[s.data.pid];i=+i;
    if(!p||!p.inGame||r.phase!=='question'||Date.now()>=r.endsAt||r.ans[s.data.pid]||!Number.isInteger(i)||!(i>=0&&i<4))return;
    r.ans[s.data.pid]={i,t:Date.now(),dt:Date.now()-r.qStart};
    const total=Object.values(r.players).filter(x=>x.inGame).length;
    Object.keys(r.ans).length>=total?correct(r):push(r);
  });
  s.on('host:rules',(mode)=>{
    const r=R();if(!s.data.host||!r||r.phase!=='lobby')return;
    const on=Object.values(r.players).filter(p=>p.online);
    if(on.length&&on.every(p=>p.ready)) {
      r.mode = mode === 'blind' ? 'blind' : 'quiz';
      go(r,'rules',0);
    }
  });
  s.on('host:categories', () => {
    const r = R();
    if (s.data.host && r?.phase === 'rules') go(r, r.mode === 'blind' ? 'musicSetup' : 'categories', 0);
  });
  s.on('host:import', (csv, ack) => {
    const r = R();
    if (typeof ack !== 'function' || !s.data.host || r?.phase !== 'categories') return;
    if (typeof csv !== 'string' || Buffer.byteLength(csv, 'utf8') > 250000) {
      return ack({ error: 'Le fichier CSV doit faire moins de 250 Ko.' });
    }
    try {
      r.importedSeries = importSeries(csv);
      ack({ count: r.importedSeries.size });
      push(r);
    } catch (error) {
      ack({ error: error.message });
    }
  });
  s.on('host:launch',(id)=>{
    const r=R();
    if (!s.data.host || r?.phase !== 'categories') return;
    const pack = availablePacks(r).get(id);
    if (!pack?.rows.length) return;
    r.questions = makeQuestions(id, pack);
    Object.values(r.players).forEach(p=>{p.inGame=p.ready;p.score=0});
    r.qi=-1;go(r,'countdown',5000,()=>nextQ(r));
  });
  s.on('host:tracks', async (theme, ack) => {
    const r = R();
    if (typeof ack !== 'function' || !s.data.host || r?.phase !== 'musicSetup') return;
    if (r.loadingTracks) return ack({ error: 'Une recherche Deezer est déjà en cours.' });
    r.loadingTracks = true;
    delete r.tracks;
    push(r);
    try {
      r.tracks = shuffle(await deezer.search(theme)).slice(0, N);
      ack({ count: r.tracks.length });
      push(r);
    } catch (error) {
      ack({ error: error.message });
    } finally { r.loadingTracks = false; }
  });
  s.on('host:back', () => {
    const r = R();
    if (!s.data.host || !['rules', 'categories', 'musicSetup'].includes(r?.phase) || r.loadingTracks) return;
    delete r.tracks;
    go(r, 'lobby', 0);
  });
  s.on('host:music', () => {
    const r = R();
    if (!s.data.host || r?.phase !== 'musicSetup' || !r.tracks?.length || r.loadingTracks) return;
    Object.values(r.players).forEach(p => { p.inGame = p.ready; p.score = 0; });
    r.qi = -1;
    go(r, 'countdown', 5000, () => nextTrack(r));
  });
  s.on('host:playing', (round) => {
    const r = R();
    if (!s.data.host || r?.phase !== 'musicLoad' || round !== r.qi) return;
    r.blind.started = Date.now();
    go(r, 'musicPlay', LISTEN_TIME - r.blind.elapsed, () => {
      r.blind.elapsed = LISTEN_TIME;
      advanceBuzz(r);
    });
  });
  s.on('host:musicEnded', (round) => {
    const r = R();
    if (!s.data.host || !['musicLoad', 'musicPlay'].includes(r?.phase) || round !== r.qi) return;
    r.blind.elapsed = LISTEN_TIME;
    advanceBuzz(r);
  });
  s.on('buzz', (round) => {
    const r = R(), id = s.data.pid, b = r?.blind;
    if (!r?.players[id]?.inGame || r.qi !== round || !b ||
        !['musicPlay', 'musicQueue', 'musicSpeak', 'musicJudge'].includes(r.phase) || b.seen.has(id)) return;
    if (r.phase === 'musicPlay' && Date.now() >= r.endsAt) return;
    b.seen.add(id);
    b.queue.push(id);
    if (r.phase === 'musicPlay') {
      b.elapsed = Math.min(LISTEN_TIME, b.elapsed + Date.now() - b.started);
      go(r, 'musicQueue', 0);
    } else push(r);
  });
  s.on('host:giveTurn', (round, id) => {
    const r = R();
    if (s.data.host && r?.phase === 'musicQueue' && r.qi === round && r.blind.queue[0] === id) giveTurn(r);
  });
  s.on('host:heard', (round, id) => {
    const r = R();
    if (s.data.host && r?.phase === 'musicSpeak' && r.qi === round &&
        r.blind.active === id && Date.now() < r.endsAt) go(r, 'musicJudge', 0);
  });
  s.on('host:judge', (round, id, verdict) => {
    const r = R();
    if (!s.data.host || r?.phase !== 'musicJudge' || r.qi !== round || r.blind.active !== id) return;
    const found = r.blind.found;
    let points = 0;
    for (const key of ['title', 'artist']) {
      if (!found[key] && verdict?.[key] === true) {
        found[key] = true;
        points++;
      }
    }
    scoreBuzz(r, points || -1);
    advanceBuzz(r);
  });
  s.on('host:again',()=>{
    const r=R();if(!s.data.host||!r||r.phase!=='final')return;
    Object.keys(r.players).forEach(id=>{const p=r.players[id];if(!p.online)delete r.players[id];else{p.ready=false;p.score=0;p.inGame=false}});
    r.qi=-1;delete r.questions;delete r.tracks;delete r.blind;go(r,'lobby',0);
  });
  s.on('disconnect',()=>{const r=R(),p=r&&r.players[s.data.pid];if(p){p.online=false;push(r)}});
});
server.listen(process.env.PORT||3000,()=>console.log('Quiz Party prêt'));
