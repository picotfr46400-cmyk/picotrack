// ══ NAVIGATION ══
function goList(){
  show('v-list');
  document.getElementById('tb-t').textContent='Formulaires';
  document.getElementById('breadcrumb').innerHTML='<span class="bc-link" onclick="goList()">▶ Formulaires</span>';
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-forms').classList.add('on');
  closeCfg();renderTable();
}
function goProduction(){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-prod-forms').classList.add('on');
  show('v-prod-forms');
  document.getElementById('tb-t').textContent='Formulaires';
  document.getElementById('breadcrumb').innerHTML='<span style="color:var(--tl)">▶ Production / Formulaires</span>';
  renderProdForms(FORMS_DATA);
  document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(f=>f.actif!==false).length;
}

// ══ TABLE ADMIN ══
function renderTable(){
  const body=document.getElementById('table-body');
  const start=(curPage-1)*pageSize;
  const page=filtered.slice(start,start+pageSize);
  body.innerHTML=page.map(f=>`
    <div class="dtr">
      <div class="dt-td"><span class="f-name-link" onclick="openBuilder(${f.id})">${h(f.nom)}</span></div>
      <div class="dt-td" style="color:var(--tl);font-size:12px">${h(f.desc||'—')}</div>
      <div class="dt-td">${(f.type||[]).map(t=>`<span class="mod-tag">${MODULES_DEF.find(m=>m.value===t)?.label||t}</span>`).join(' ')}</div>
      <div class="dt-td"><span class="status-dot ${f.actif?'on':'off'}"></span>${f.actif?'Oui':'Non'}</div>
      <div class="dt-td">${(f.resp||0).toLocaleString()}</div>
      <div class="dt-td dt-actions">
        <button class="ic-btn" onclick="openBuilder(${f.id})" title="Modifier">✏️</button>
        <button class="ic-btn" onclick="toggleActive(${f.id})">${f.actif?'🔴':'🟢'}</button>
        <button class="ic-btn" onclick="deleteForm(${f.id})">🗑</button>
      </div>
    </div>`).join('');
  renderPagination();
}
function renderPagination(){
  const total=filtered.length;const pages=Math.ceil(total/pageSize)||1;
  curPage=Math.min(curPage,pages);
  document.getElementById('pg-info').textContent=`${(curPage-1)*pageSize+1}–${Math.min(curPage*pageSize,total)} / ${total}`;
  const btns=document.getElementById('pg-btns');let html='';
  for(let i=1;i<=pages;i++){
    if(i===1||i===pages||Math.abs(i-curPage)<=1)html+=`<button class="pg-btn${i===curPage?' on':''}" onclick="goPage(${i})">${i}</button>`;
    else if(Math.abs(i-curPage)===2)html+=`<span style="color:var(--tl);padding:0 2px">…</span>`;
  }
  btns.innerHTML=html;
}
function goPage(p){curPage=p;renderTable();}
function setPageSize(n){pageSize=n;curPage=1;renderTable();}
function sortBy(col){
  if(sortCol===col)sortDir*=-1;else{sortCol=col;sortDir=1;}
  filtered.sort((a,b)=>{const av=a[col]??'',bv=b[col]??'';return(av<bv?-1:av>bv?1:0)*sortDir;});
  renderTable();
}
async function toggleActive(id){
  const f=FORMS_DATA.find(x=>String(x.id)===String(id));
  if(!f)return;
  f.actif=!f.actif;
  applyFilters();
  if(document.getElementById('prod-forms-count')) document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(f=>f.actif!==false).length;
  if(document.getElementById('v-prod-forms')?.classList.contains('on') && typeof renderProdForms==='function') renderProdForms(FORMS_DATA);
  toast('i',`${f.actif?'✅ Activé':'⚫ Désactivé'} : ${f.nom}`);
  if(typeof DB!=='undefined'){
    try{ await DB.updateForm(f.id,{actif:f.actif}); }
    catch(e){ console.warn('[DB] toggle formulaire:',e); toast('e','Erreur sauvegarde Supabase'); }
  }
}
async function deleteForm(id){
  if(!confirm('Supprimer ce formulaire ?'))return;
  const i=FORMS_DATA.findIndex(f=>String(f.id)===String(id));if(i>-1)FORMS_DATA.splice(i,1);
  filtered=filtered.filter(f=>String(f.id)!==String(id));renderTable();toast('s','🗑 Formulaire supprimé');
  if(typeof DB!=='undefined'){
    try{ await DB.deleteForm(id); }
    catch(e){ console.warn('[DB] delete formulaire:',e); toast('e','Erreur suppression Supabase'); }
  }
}

// ══ FILTRES ══
function toggleFilters(){document.getElementById('fbox-grid').classList.toggle('show');}
function applyFilters(){
  const nom=(document.getElementById('f-nom')?.value||'').toLowerCase();
  const desc=(document.getElementById('f-desc')?.value||'').toLowerCase();
  const mod=(document.getElementById('f-mod')?.value||'');
  filtered=FORMS_DATA.filter(f=>{
    if(nom&&!f.nom.toLowerCase().includes(nom))return false;
    if(desc&&!((f.desc||'').toLowerCase().includes(desc)))return false;
    if(mod&&!(f.type||[]).includes(mod))return false;
    return true;
  });
  curPage=1;renderTable();
  const cnt=[nom,desc,mod].filter(Boolean).length;
  const bdg=document.getElementById('filter-bdg');
  if(bdg){bdg.textContent=cnt;bdg.style.display=cnt?'':'none';}
}
function clearFilters(){
  ['f-nom','f-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const mod=document.getElementById('f-mod');if(mod)mod.value='';
  filtered=[...FORMS_DATA];curPage=1;renderTable();
  const bdg=document.getElementById('filter-bdg');if(bdg)bdg.style.display='none';
}
function searchForms(q){
  filtered=FORMS_DATA.filter(f=>f.nom.toLowerCase().includes(q.toLowerCase())||(f.desc||'').toLowerCase().includes(q.toLowerCase()));
  curPage=1;renderTable();
}

// ══ EXPORT ══
function exportCSV(){
  const rows=[['Nom','Description','Modules','Actif','Réponses'],...filtered.map(f=>[f.nom,f.desc||'',(f.type||[]).join(', '),f.actif?'Oui':'Non',f.resp])];
  dl('\ufeff'+rows.map(r=>r.map(c=>`"${c}"`).join(',')).join('\n'),'formulaires.csv','text/csv;charset=utf-8');
  toast('s','📄 CSV téléchargé');document.getElementById('exp-menu').classList.remove('on');
}
function exportExcel(){
  if(typeof XLSX==='undefined'){toast('e','XLSX non disponible');return;}
  const ws=XLSX.utils.json_to_sheet(filtered.map(f=>({Nom:f.nom,Description:f.desc,Modules:(f.type||[]).join(', '),Actif:f.actif?'Oui':'Non',Réponses:f.resp})));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Formulaires');
  XLSX.writeFile(wb,'formulaires.xlsx');toast('s','📊 Excel téléchargé');document.getElementById('exp-menu').classList.remove('on');
}
