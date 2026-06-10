// ══ DÉPLACER v-saisie hors de v-prod-forms ══
(function(){
  const main=document.getElementById('main');
  ['v-saisie','v-submissions'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&main&&el.parentElement!==main)main.appendChild(el);
  });
})();

// ══ UTILITAIRES ══
function h(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function toast(type,msg){
  const el=document.createElement('div');el.className='toast '+type;el.textContent=msg;
  document.getElementById('toasts').appendChild(el);setTimeout(()=>el.remove(),3200);
}
function show(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  const t=document.getElementById(id);if(t)t.classList.add('on');
}
function dl(c,n,t){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([c],{type:t}));a.download=n;a.click();}
function toggleDrop(id){
  const m=document.getElementById(id);m.classList.toggle('on');
  document.addEventListener('click',function hh(e){if(!m.contains(e.target)){m.classList.remove('on');document.removeEventListener('click',hh);}},{once:true});
}

