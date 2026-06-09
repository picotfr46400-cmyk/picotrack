function initColors(){
  const grid=document.getElementById('color-row');if(!grid)return;
  grid.innerHTML=COLORS.map(c=>`<div class="c-swatch${formColor===c?' on':''}" style="background:${c}" onclick="selectColor('${c}',this)"></div>`).join('');
}
function selectColor(c,el){formColor=c;document.querySelectorAll('.c-swatch').forEach(e=>e.classList.remove('on'));el.classList.add('on');}
function initModules(sel=[]){
  const grid=document.getElementById('mod-grid');if(!grid)return;
  grid.innerHTML=MODULES_DEF.map(m=>`<div class="mod-c${sel.includes(m.value)?' on':''}" onclick="this.classList.toggle('on')" data-val="${m.value}"><div class="mc-dot"></div>${m.label}</div>`).join('');
}

// ══ APERÇU (builder) ══
function setApercu(mode,btn){document.querySelectorAll('.ap-tog').forEach(b=>b.classList.remove('on'));btn.classList.add('on');previewMode=mode;renderApercu();}
function apChange(fid,val){previewValues[fid]=val;builderFields.forEach(f=>{const w=document.getElementById('apw-'+f.id);if(!w)return;w.style.display=evalCond(f)?'block':'none';});}
function apChangeMulti(fid,val,checked){if(!Array.isArray(previewValues[fid]))previewValues[fid]=[];if(checked)previewValues[fid].push(val);else previewValues[fid]=previewValues[fid].filter(v=>v!==val);apChange(fid,previewValues[fid]);}
function evalCond(f){const conds=f.conditions||[];if(!conds.length)return true;const op=f.condOp||'all';const results=conds.map(c=>{const src=builderFields.find(x=>x.nom===c.field);if(!src)return true;const v=previewValues[src.id],cv=Array.isArray(v)?v.join(','):(v||'');if(c.op==='=')return cv===c.val;if(c.op==='!=')return cv!==c.val;if(c.op==='contains')return cv.includes(c.val);if(c.op==='empty')return !cv;return true;});return op==='all'?results.every(Boolean):results.some(Boolean);}
function resetPreview(){previewValues={};renderApercu();toast('i','↺ Aperçu réinitialisé');}
function renderApercu(){
  const container=document.getElementById('apercu-content');if(!container)return;
  if(!builderFields.length){container.innerHTML='<div style="text-align:center;padding:40px;color:var(--tl)">Aucun champ à prévisualiser</div>';return;}
  const color=formColor||'#3b82f6';
  const nomForm=document.getElementById('b-nom')?document.getElementById('b-nom').value||'Formulaire sans nom':'Formulaire';
  const fields=builderFields.filter(f=>previewMode==='sup'?f.vis_sup!==false:f.vis_nom!==false);
  let html=`<div class="apercu-form"><div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:14px;border-bottom:1.5px solid var(--bd)"><div style="width:6px;height:36px;border-radius:3px;background:${color};flex-shrink:0"></div><div style="flex:1"><div style="font-size:15px;font-weight:800">${h(nomForm)}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${previewMode==='sup'?'🖥 Supervision':'📱 App nomade'} — <span style="color:var(--w);font-weight:700">Mode test</span></div></div><button onclick="resetPreview()" class="btn btn-sm" style="font-size:11px">↺ Réinitialiser</button></div>`;
  fields.forEach(f=>{
    const fd=FD[f.type]||{l:f.nom};const cv=previewValues[f.id];const show=evalCond(f);const isLayout=['separator','image','titre'].includes(f.type);
    html+=`<div class="ap-field" id="apw-${f.id}" style="display:${show?'block':'none'}">`;
    if(!isLayout)html+=`<div class="ap-label">${h(f.nom||fd.l)}${f.obligatoire?'<span style="color:var(--d)"> *</span>':''}</div>`;
    if(f.afficher_legende&&f.legendeText)html+=`<div class="ap-hint" style="margin-bottom:6px">${h(f.legendeText)}</div>`;
    switch(f.type){
      case 'text':html+=`<input class="ap-input" style="background:#fff;height:auto;padding:10px 12px;outline:none;width:100%" placeholder="${h(f.afficher_placeholder&&f.placeholder?f.placeholder:'Saisir un texte...')}" value="${h(cv||'')}" oninput="apChange('${f.id}',this.value)">`;break;
      case 'textarea':html+=`<textarea class="ap-input" style="background:#fff;height:72px;resize:none;padding:10px 12px;outline:none;width:100%;font-family:inherit" placeholder="Saisir un texte..." oninput="apChange('${f.id}',this.value)">${h(cv||'')}</textarea>`;break;
      case 'number':html+=`<div style="display:flex;align-items:center;gap:8px"><button onclick="var n=document.getElementById('ni_${f.id}');n.value=+n.value-${f.pas||1};apChange('${f.id}',+n.value)" style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer">−</button><input id="ni_${f.id}" type="number" class="ap-input" style="width:90px;text-align:center;background:#fff;padding:8px;outline:none" value="${cv||0}" step="${f.pas||1}" oninput="apChange('${f.id}',+this.value)"><button onclick="var n=document.getElementById('ni_${f.id}');n.value=+n.value+${f.pas||1};apChange('${f.id}',+n.value)" style="width:34px;height:34px;border:1.5px solid var(--bd);border-radius:8px;background:#fff;font-size:18px;cursor:pointer;color:var(--p)">+</button></div>`;break;
      case 'checkbox':html+=`<label style="display:flex;align-items:center;gap:9px;cursor:pointer;padding:4px 0"><input type="checkbox" ${cv?'checked':''} onchange="apChange('${f.id}',this.checked)" style="width:18px;height:18px;accent-color:var(--p)"><span style="color:var(--tm)">Cocher si applicable</span></label>`;break;
      case 'select':html+=`<select class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" onchange="apChange('${f.id}',this.value)"><option value="">Sélectionner...</option>${(f.valeurs||[]).map(v=>`<option${cv===v?' selected':''}>${h(v)}</option>`).join('')}</select>`;break;
      case 'multiselect':const ms=Array.isArray(cv)?cv:[];html+=`<div style="display:flex;flex-wrap:wrap;gap:7px;padding:4px 0">${(f.valeurs||[]).map(v=>`<label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:1.5px solid ${ms.includes(v)?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${ms.includes(v)?'var(--pl)':'#fff'};color:${ms.includes(v)?'var(--p)':'var(--tm)'}"><input type="checkbox" ${ms.includes(v)?'checked':''} onchange="apChangeMulti('${f.id}','${v.replace(/'/g,"\\'")}',this.checked)" style="display:none">${ms.includes(v)?'✓ ':''}${h(v)}</label>`).join('')}</div>`;break;
      case 'date':html+=`<input type="date" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'heure':html+=`<input type="time" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'datetime':html+=`<input type="datetime-local" class="ap-input" style="background:#fff;cursor:pointer;outline:none;width:100%" value="${cv||''}" onchange="apChange('${f.id}',this.value)">`;break;
      case 'photo':case 'signature':case 'file':html+=`<div style="border:2px dashed var(--bd);border-radius:8px;padding:14px;text-align:center;color:var(--tl);font-size:13px">Simulation — non disponible en mode test</div>`;break;
      case 'location':html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--tl)">📍 Carte (simulation)</div>`;break;
      case 'image':html+=f.imageData?`<img src="${f.imageData}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;display:block">`:
        `<div style="background:#f8fafc;border:1.5px dashed var(--bd);border-radius:8px;height:70px;display:flex;align-items:center;justify-content:center;color:var(--tl);font-size:13px">🖼 Aucune image</div>`;break;
      case 'titre':html+=`<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:7px">${h(f.nom)}</div>`;break;
      case 'separator':html+=`<hr style="border:none;border-top:1.5px solid var(--bd)">`;break;
      case 'calcul':{const cr=computeCalcul(f,previewValues);html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px"><span style="font-size:17px;font-weight:800;font-family:'DM Mono',monospace;color:var(--tx)">${cr!==''?cr:'—'}</span><span style="font-size:11px;color:var(--tl)">calculé</span></div>`;break;}
      default:html+=`<div class="ap-input" style="color:var(--tl)">${fd.l||'—'}</div>`;
    }
    html+=`</div>`;
  });
  html+=`<div style="display:flex;justify-content:flex-end;gap:8px;padding-top:16px;border-top:1.5px solid var(--bd);margin-top:8px"><button class="btn btn-sm" onclick="resetPreview()">Annuler</button><button onclick="validatePreview()" style="padding:7px 16px;border-radius:8px;border:none;background:${color};color:#fff;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer">Valider</button></div></div>`;
  container.innerHTML=html;
}
function validatePreview(){
  const errs=builderFields.filter(f=>{if(!evalCond(f))return false;if(!f.obligatoire)return false;const v=previewValues[f.id];return !v||v===''||(Array.isArray(v)&&!v.length);});
  if(errs.length){toast('e','⚠️ '+errs.length+' champ(s) obligatoire(s) manquant(s)');errs.forEach(f=>{const w=document.getElementById('apw-'+f.id);if(w){w.style.outline='2px solid var(--d)';w.style.borderRadius='8px';setTimeout(()=>w.style.outline='',2000);}});}
  else toast('s','✅ Formulaire valide (aperçu) !');
}

// ══ MISE EN PAGE ══
let poolDragId=null,cellDragSrc=null;
function renderLayout(){
  const canvas=document.getElementById('layout-canvas');const pool=document.getElementById('layout-pool');if(!canvas||!pool)return;
  const saisieFields=builderFields.filter(f=>!['separator','son','video'].includes(f.type));
  if(!layoutRows.length&&saisieFields.length)layoutRows=saisieFields.map(f=>({id:'r'+f.id,cols:[{field:f.id,size:12}]}));
  const placedIds=new Set();layoutRows.forEach(r=>r.cols.forEach(c=>{if(c.field)placedIds.add(c.field)}));
  pool.innerHTML=saisieFields.length?saisieFields.map(f=>{const fd=FD[f.type]||{ic:'?',bg:'#6b7280'};return`<div class="lp-item${placedIds.has(f.id)?' placed':''}" draggable="${!placedIds.has(f.id)}" ondragstart="poolDragStart('${f.id}')"><div class="f-type-ic" style="background:${fd.bg};width:22px;height:22px;font-size:11px">${fd.ic}</div>${h(f.nom)}</div>`;}).join(''):'<div style="color:var(--tl);font-size:12px;text-align:center;padding:12px">Aucun champ disponible</div>';
  canvas.innerHTML='';
  layoutRows.forEach(row=>{
    const div=document.createElement('div');div.className='layout-row';
    const totalSize=row.cols.reduce((s,c)=>s+c.size,0);
    let cols=`<div class="row-cols">`;
    row.cols.forEach((col,ci)=>{
      const fld=builderFields.find(f=>f.id===col.field);const fd=fld?FD[fld.type]||{ic:'?',bg:'#6b7280'}:null;
      cols+=`<div class="layout-col" id="lc-${row.id}-${ci}" style="flex:${col.size}" draggable="${!!col.field}" ondragstart="${col.field?`cellDragStart(event,'${row.id}',${ci},'${col.field}')`:''}" ondragover="cellDragOver(event,'${row.id}',${ci})" ondragleave="document.getElementById('lc-${row.id}-${ci}').classList.remove('drag-over')" ondrop="cellDrop(event,'${row.id}',${ci})"><div class="col-size">${col.size}/12</div><div class="col-resize"><span onclick="resizeCol('${row.id}',${ci},-1)">◀</span><span onclick="resizeCol('${row.id}',${ci},1)">▶</span></div><div class="col-content">${fld?`<div style="display:flex;align-items:center;gap:6px;font-size:12px"><div class="f-type-ic" style="background:${fd.bg};width:20px;height:20px;font-size:10px">${fd.ic}</div><span>${h(fld.nom)}</span><span class="cell-rm" onclick="event.stopPropagation();clearCell('${row.id}',${ci})">✕</span></div>`:`<span>＋ Déposer</span>`}</div></div>`;
    });
    cols+=`<div class="layout-add-col" onclick="addCol('${row.id}')" ${totalSize>=12?'style="pointer-events:none;opacity:.3"':''}>＋</div></div>`;
    div.innerHTML=`<div class="row-handle"><span>⠿</span></div>${cols}<div class="row-actions"><button class="ic-btn" onclick="removeRow('${row.id}')">🗑</button></div>`;
    canvas.appendChild(div);
  });
  const addRow=document.createElement('div');addRow.className='layout-add-row';addRow.innerHTML='＋ Ajouter une ligne';addRow.onclick=()=>{layoutRows.push({id:'r'+Date.now(),cols:[{field:null,size:12}]});renderLayout();};canvas.appendChild(addRow);
}
function poolDragStart(fid){poolDragId=fid;cellDragSrc=null;}
function cellDragStart(e,rid,ci,fid){cellDragSrc={rid,ci,fid};poolDragId=null;}
function cellDragOver(e,rid,ci){e.preventDefault();document.getElementById('lc-'+rid+'-'+ci).classList.add('drag-over');}
function cellDrop(e,rid,ci){
  e.preventDefault();const cell=document.getElementById('lc-'+rid+'-'+ci);cell.classList.remove('drag-over');
  const row=layoutRows.find(r=>r.id===rid);if(!row)return;const col=row.cols[ci];
  if(poolDragId){if(!col.field){col.field=poolDragId;renderLayout();toast('i','✅ Champ placé');}else toast('w','⚠️ Cellule occupée');poolDragId=null;}
  else if(cellDragSrc){const srcRow=layoutRows.find(r=>r.id===cellDragSrc.rid);if(srcRow){const srcCol=srcRow.cols[cellDragSrc.ci];const tmp=col.field;col.field=srcCol.field;srcCol.field=tmp;renderLayout();toast('i','↕ Champs échangés');}cellDragSrc=null;}
}
function clearCell(rid,ci){const row=layoutRows.find(r=>r.id===rid);if(!row)return;row.cols[ci].field=null;renderLayout();}
function addCol(rid){const row=layoutRows.find(r=>r.id===rid);if(!row)return;const total=row.cols.reduce((s,c)=>s+c.size,0);if(total>=12){toast('w','⚠️ Ligne complète');return;}row.cols.push({field:null,size:Math.min(3,12-total)});renderLayout();}
function removeCol(rid,ci){const row=layoutRows.find(r=>r.id===rid);if(!row||row.cols.length<=1)return;row.cols.splice(ci,1);renderLayout();}
function removeRow(rid){layoutRows=layoutRows.filter(r=>r.id!==rid);renderLayout();}
function resizeCol(rid,ci,delta){const row=layoutRows.find(r=>r.id===rid);if(!row)return;const col=row.cols[ci];const total=row.cols.reduce((s,c)=>s+c.size,0);if(col.size+delta<1||total+delta>12)return;col.size+=delta;renderLayout();}

// ══ DÉCLENCHEURS ══
// ✅ CORRECTION : addDecl défini (évite l'erreur sur le bouton statique HTML)
function addDecl(){setBTab('decl');}
function renderDecl(){
  const cnt=document.getElementById('decl-cnt');if(cnt){cnt.textContent=declItems.length;cnt.style.display=declItems.length?'':'none';}
  const area=document.getElementById('barea-decl');if(!area)return;
  let html=`<div style="padding:16px">`;
  if(!declItems.length)html+=`<div style="text-align:center;padding:32px;color:var(--tl)"><div style="font-size:28px;margin-bottom:8px;opacity:.3">⚡</div><div style="font-size:13px">Aucun déclencheur configuré</div></div>`;
  else html+=declItems.map((d,i)=>{
    const def=DECL_ACTIONS.find(a=>a.type===d.type)||{ic:'?',label:d.type};
    let extra='';
    if(d.type==='db_row'){
      const dbOpts=DATABASES_DATA.map(db=>`<option value="sdb_${db.id}" ${d.config?.dbId===db.id?'selected':''}>${h(db.nom)}</option>`).join('');
      const selectedDb = d.config?.dbId ? DATABASES_DATA.find(x=>x.id===d.config.dbId) : null;
      const mappingHtml = selectedDb ? selectedDb.columns.map(col=>{
        const fOpts=builderFields.filter(f=>!['separator','image','titre'].includes(f.type)).map(f=>`<option value="${f.id}" ${d.config?.mappings?.find(m=>m.colId===col.id)?.fieldId===f.id?'selected':''}>${h(f.nom)}</option>`).join('');
        return `<div style="display:grid;grid-template-columns:1fr 20px 1fr;gap:6px;align-items:center;margin-bottom:5px">
          <div style="font-size:11.5px;font-weight:600;background:var(--bg);border-radius:6px;padding:5px 9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(col.nom)}</div>
          <div style="text-align:center;color:var(--tl);font-size:12px">←</div>
          <select class="ci" style="font-size:11.5px" onchange="_setDeclMapping(${i},'${col.id}',this.value)">
            <option value="">— Aucun —</option>${fOpts}
          </select>
        </div>`;
      }).join('') : '';
      extra=`<div style="margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:8px">
        <div class="fl2" style="margin-bottom:6px">Base cible</div>
        <select class="ci" style="width:100%;margin-bottom:${selectedDb?'10px':'0'}" onchange="_setDeclDB(${i},this.value)">
          <option value="">— Choisir une base autonome —</option>${dbOpts}
        </select>
        ${selectedDb?`<div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Mapping colonne ← champ formulaire</div>${mappingHtml}`:''}
      </div>`;
    }
    return`<div style="border:1.5px solid var(--bd);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px"><span style="font-size:18px">${def.ic}</span><div style="flex:1;font-size:13px;font-weight:700">${def.label}</div><button class="ic-btn" onclick="declItems.splice(${i},1);renderDecl()">🗑</button></div>
      ${extra}
    </div>`;
  }).join('');
  html+=`<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">${DECL_ACTIONS.map(a=>`<button class="btn btn-sm" onclick="declItems.push({type:'${a.type}',desc:''});renderDecl();toast('i','${a.label} ajouté')">${a.ic} ${a.label}</button>`).join('')}</div></div>`;
  area.innerHTML=html;
}
