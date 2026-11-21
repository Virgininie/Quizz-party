const AVATARS=[['🦙','🕶️','Lama à lunettes'],['🐱','🎩','Chat en smoking'],['🐸','👑','Grenouille couronnée'],['🐙','🎧','Poulpe DJ'],['🦊','🎸','Renard rockeur'],['🐧','🧣','Pingouin frileux'],['🐼','🎤','Panda chanteur'],['🦖','🥳','Dino fêtard'],['🐵','🍌','Singe gourmand'],['🐰','🥕','Lapin croqueur'],['🦉','🎓','Hibou savant'],['🦄','🌈','Licorne arc-en-ciel']];
const CAT_EMOJI={'Culture générale':'🧠','Cinéma & séries':'🎬','Musique':'🎵','Sciences & nature':'🧪','Fun':'🤪','Mixte':'🎲'};
const catEmoji=n=>CAT_EMOJI[n]||'🎯';
function avatarHtml(p){
  const a=AVATARS[p.avatar];
  if(a)return`<span class="av av-pic" title="${a[2]}"><i>${a[0]}</i><b>${a[1]}</b></span>`;
  const t=String(p.name||'?').slice(0,2).toUpperCase().replace(/[&<>"]/g,'');
  return`<span class="av">${t}</span>`;
}
