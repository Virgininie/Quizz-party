const express=require('express'),http=require('http'),{Server}=require('socket.io'),QR=require('qrcode');
const Q=require('./questions'),N=Q.length,DUR=10000,MAXP=10;
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
function view(r){
  const players=Object.entries(r.players).map(([id,p])=>({id,name:p.name,score:p.score,ready:p.ready,online:p.online,inGame:p.inGame}));
  const v={code:r.code,phase:r.phase,players,rank:rank(players.filter(p=>r.phase==='lobby'||p.inGame)),qi:r.qi,n:N,left:r.endsAt?Math.max(0,r.endsAt-Date.now()):0};
  const q=Q[r.qi];
  if(q&&(r.phase==='question'||r.phase==='correction')){v.q=q.q;v.o=q.o;v.got=Object.keys(r.ans);v.total=players.filter(p=>p.inGame).length}
  if(q&&r.phase==='correction'){v.c=q.c;v.res=r.res}
  return v;
}
const push=r=>io.to(r.code).emit('state',view(r));
function go(r,phase,ms,next){clearTimeout(r.t);r.phase=phase;r.endsAt=ms?Date.now()+ms:0;push(r);if(ms)r.t=setTimeout(next,ms)}
function nextQ(r){r.qi++;r.ans={};r.res={};r.qStart=Date.now();go(r,'question',DUR,()=>correct(r))}
function correct(r){
  const q=Q[r.qi];let first=null;
  Object.entries(r.ans).forEach(([id,a])=>{if(a.i===q.c&&(!first||a.t<r.ans[first].t))first=id});
  Object.entries(r.players).filter(([,p])=>p.inGame).forEach(([id,p])=>{
    const a=r.ans[id],ok=!!a&&a.i===q.c,pts=ok?(id===first?2:1):0;
    p.score+=pts;r.res[id]={a:a?a.i:-1,ok,dt:a?a.dt:null,pts};
  });
  go(r,'correction',7000,()=>after(r));
}
function after(r){
  const n=r.qi+1;
  if(n>=N)return go(r,'final',0);
  const nx=()=>go(r,'next',3000,()=>nextQ(r));
  n%5===0?go(r,'ranking',7000,nx):nx();
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
    if(!p||!p.inGame||r.phase!=='question'||r.ans[s.data.pid]||!(i>=0&&i<4))return;
    r.ans[s.data.pid]={i,t:Date.now(),dt:Date.now()-r.qStart};
    const total=Object.values(r.players).filter(x=>x.inGame).length;
    Object.keys(r.ans).length>=total?correct(r):push(r);
  });
  s.on('host:rules',()=>{
    const r=R();if(!s.data.host||!r||r.phase!=='lobby')return;
    const on=Object.values(r.players).filter(p=>p.online);
    if(on.length&&on.every(p=>p.ready))go(r,'rules',0);
  });
  s.on('host:launch',()=>{
    const r=R();if(!s.data.host||!r||r.phase!=='rules')return;
    Object.values(r.players).forEach(p=>{p.inGame=p.ready;p.score=0});
    r.qi=-1;go(r,'countdown',5000,()=>nextQ(r));
  });
  s.on('host:again',()=>{
    const r=R();if(!s.data.host||!r||r.phase!=='final')return;
    Object.keys(r.players).forEach(id=>{const p=r.players[id];if(!p.online)delete r.players[id];else{p.ready=false;p.score=0;p.inGame=false}});
    r.qi=-1;go(r,'lobby',0);
  });
  s.on('disconnect',()=>{const r=R(),p=r&&r.players[s.data.pid];if(p){p.online=false;push(r)}});
});
server.listen(process.env.PORT||3000,()=>console.log('Quiz Party prêt'));
