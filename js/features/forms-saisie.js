// ══ PRODUCTION : SAISIE RÉELLE ══
function openFormSaisie(id){
  const f=FORMS_DATA.find(x=>x.id===id);if(!f)return;
  curSaisieFormId=id;saisieValues={};
  document.getElementById('breadcrumb').innerHTML=`
    <span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span>
    <span style="color:var(--tl);margin:0 4px">/</span>
    <span style="font-weight:600">${h(f.nom)}</span>`;
  document.getElementById('tb-t').textContent=f.nom;
  renderSaisieForm(f);
  show('v-saisie');
}
function renderSaisieForm(f){
  const wrap=document.getElementById('saisie-wrap');
  const color=f.couleur||'#3b82f6';
  const fields=f.fields||[];
  if(!fields.length){
    wrap.innerHTML=`<div style="text-align:center;padding:60px 20px;color:var(--tl)"><div style="font-size:36px;margin-bottom:12px">📋</div><div style="font-size:14px">Ce formulaire ne contient aucun champ.</div><button class="btn btn-sm" style="margin-top:16px" onclick="goProduction()">← Retour</button></div>`;
    return;
  }
  let html=`<div style="background:var(--card,#fff);border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.09);padding:26px;margin-bottom:24px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;padding-bottom:16px;border-bottom:2px solid var(--bd)">
      <div style="width:6px;height:44px;border-radius:3px;background:${color};flex-shrink:0"></div>
      <div style="flex:1"><div style="font-size:16px;font-weight:800;color:var(--tx)">${h(f.nom)}</div>
      ${f.desc?`<div style="font-size:12px;color:var(--tl);margin-top:2px">${h(f.desc)}</div>`:''}
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--tl)">🖥 Mode Saisie</div>
        <div style="font-size:11px;font-weight:700;color:${color};margin-top:2px">${(f.resp||0).toLocaleString()} réponse${(f.resp||0)>1?'s':''}</div>
      </div>
    </div>`;
  fields.forEach(fld=>{
    const fd=FD[fld.type]||{l:fld.nom};
    const isLayout=['separator','image','titre'].includes(fld.type);
    const visible=saisieEvalCond(fld,fields);
    html+=`<div class="ap-field" id="sw-${fld.id}" style="margin-bottom:16px;display:${visible?'block':'none'}">`;
    if(!isLayout)html+=`<div style="font-size:12.5px;font-weight:600;color:var(--tx);margin-bottom:6px">${h(fld.nom||fd.l)}${fld.obligatoire?'<span style="color:#ef4444"> *</span>':''}</div>`;
    if(fld.afficher_legende&&fld.legendeText)html+=`<div style="font-size:11px;color:var(--tl);margin-bottom:6px;font-style:italic">${h(fld.legendeText)}</div>`;
    switch(fld.type){
      case 'text':
        if(fld.duplicable){
          if(!Array.isArray(saisieValues[fld.id]))saisieValues[fld.id]=Array(Math.max(fld.duplicable_min||1,1)).fill('');
          html+=renderDupField(fld,color);
        }else{
          html+=`<input class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:auto;padding:10px 13px;outline:none;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" placeholder="${h(fld.afficher_placeholder&&fld.placeholder?fld.placeholder:'Saisir un texte...')}" value="${h(saisieValues[fld.id]||'')}" oninput="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;
        }
        break;
      case 'textarea':
        html+=`<textarea class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:82px;resize:vertical;padding:10px 13px;outline:none;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" placeholder="Saisir un texte..." oninput="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">${h(saisieValues[fld.id]||'')}</textarea>`;break;
      case 'number':{
        if(fld.duplicable){if(!Array.isArray(saisieValues[fld.id]))saisieValues[fld.id]=Array(Math.max(fld.duplicable_min||1,1)).fill(0);html+=renderDupField(fld,color);break;}
        const nv=saisieValues[fld.id]!==undefined?saisieValues[fld.id]:0;
        html+=`<div style="display:flex;align-items:center;gap:10px">
          <button onclick="var n=document.getElementById('sni_${fld.id}');n.value=Math.round((+n.value-${fld.pas||1})*1000)/1000;saisieChange('${fld.id}',+n.value)" style="width:38px;height:38px;border:1.5px solid var(--bd);border-radius:8px;background:#f8fafc;font-size:20px;cursor:pointer;transition:all .15s" onmouseover="this.style.background='${color}';this.style.color='#fff';this.style.borderColor='${color}'" onmouseout="this.style.background='#f8fafc';this.style.color='inherit';this.style.borderColor='var(--bd)'">−</button>
          <input id="sni_${fld.id}" type="number" class="ap-input" style="width:110px;text-align:center;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:9px;outline:none;font-family:inherit;font-size:15px;font-weight:700;transition:border-color .15s" value="${nv}" step="${fld.pas||1}" oninput="saisieChange('${fld.id}',+this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">
          <button onclick="var n=document.getElementById('sni_${fld.id}');n.value=Math.round((+n.value+${fld.pas||1})*1000)/1000;saisieChange('${fld.id}',+n.value)" style="width:38px;height:38px;border:1.5px solid ${color};border-radius:8px;background:${color};font-size:20px;cursor:pointer;color:#fff;font-weight:700;transition:opacity .15s" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">+</button>
        </div>`;break;}
      case 'checkbox':
        const cbv=saisieValues[fld.id]===true;
        html+=`<label id="cbl_${fld.id}" style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;padding:10px 16px;border:1.5px solid ${cbv?color:'var(--bd)'};border-radius:8px;background:${cbv?color+'18':'#f8fafc'};transition:all .15s;user-select:none"><input type="checkbox" ${cbv?'checked':''} onchange="saisieChange('${fld.id}',this.checked);updateCbLabel('${fld.id}','${color}')" style="width:17px;height:17px;accent-color:${color};cursor:pointer"><span style="font-size:13px;color:var(--tm)">Cocher si applicable</span></label>`;break;
      case 'select':
        html+=`<select class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:100%;font-family:inherit;font-size:13px;transition:border-color .15s" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'"><option value="">— Sélectionner —</option>${(fld.valeurs||[]).map(v=>`<option${saisieValues[fld.id]===v?' selected':''}>${h(v)}</option>`).join('')}</select>`;break;
      case 'multiselect':
        const msv=Array.isArray(saisieValues[fld.id])?saisieValues[fld.id]:[];
        html+=`<div id="ms_${fld.id}" style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">${(fld.valeurs||[]).map(v=>{const on=msv.includes(v);return`<label style="display:flex;align-items:center;gap:6px;padding:7px 15px;border:1.5px solid ${on?color:'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${on?color+'18':'#f8fafc'};color:${on?color:'var(--tm)'};transition:all .15s"><input type="checkbox" ${on?'checked':''} onchange="saisieChangeMulti('${fld.id}','${v.replace(/'/g,"\\'")}',this.checked)" style="display:none">${on?'✓ ':''}${h(v)}</label>`;}).join('')}</div>`;break;
      case 'date':
        if(fld.duplicable){if(!Array.isArray(saisieValues[fld.id]))saisieValues[fld.id]=Array(Math.max(fld.duplicable_min||1,1)).fill('');html+=renderDupField(fld,color);break;}
        html+=`<input type="date" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:200px;font-family:inherit;font-size:13px;transition:border-color .15s" value="${saisieValues[fld.id]||''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'heure':
        if(fld.duplicable){if(!Array.isArray(saisieValues[fld.id]))saisieValues[fld.id]=Array(Math.max(fld.duplicable_min||1,1)).fill('');html+=renderDupField(fld,color);break;}
        html+=`<input type="time" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:160px;font-family:inherit;font-size:13px;transition:border-color .15s" value="${saisieValues[fld.id]||''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'datetime':
        if(fld.duplicable){if(!Array.isArray(saisieValues[fld.id]))saisieValues[fld.id]=Array(Math.max(fld.duplicable_min||1,1)).fill('');html+=renderDupField(fld,color);break;}
        html+=`<input type="datetime-local" class="ap-input" style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;cursor:pointer;outline:none;padding:10px 13px;width:100%;font-family:inherit;font-size:13px;box-sizing:border-box;transition:border-color .15s" value="${saisieValues[fld.id]||''}" onchange="saisieChange('${fld.id}',this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'photo':html+=`<div style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc">📷 Capture photo — disponible sur l'app nomade</div>`;break;
      case 'signature':html+=`<div style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc">✍ Signature — disponible sur l'app nomade</div>`;break;
      case 'file':html+=`<div style="border:2px dashed var(--bd);border-radius:10px;padding:22px;text-align:center;color:var(--tl);font-size:13px;background:#f8fafc">📎 Fichier — disponible sur l'app nomade</div>`;break;
      case 'location':html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:10px;padding:16px;display:flex;align-items:center;justify-content:space-between"><span style="color:var(--tl);font-size:13px">📍 ${saisieValues[fld.id]||'Non capturé'}</span><button onclick="saisieChange('${fld.id}','GPS: 45.0473° N, 4.7277° E');this.textContent='✅ Capturé';this.style.background='#10b981';this.style.color='#fff'" style="padding:6px 14px;border-radius:20px;border:1.5px solid ${color};color:${color};background:transparent;cursor:pointer;font-size:12px;font-family:inherit">Capturer</button></div>`;break;
      case 'titre':html+=`<div style="font-size:15px;font-weight:800;border-bottom:2px solid var(--bd);padding-bottom:8px;color:var(--tx)">${h(fld.nom)}</div>`;break;
      case 'separator':html+=`<hr style="border:none;border-top:1.5px solid var(--bd);margin:4px 0">`;break;
      case 'image':html+=fld.imageData?`<img src="${fld.imageData}" style="max-width:100%;max-height:220px;border-radius:8px;object-fit:contain;display:block">`:
        `<div style="background:#f8fafc;border:1.5px dashed var(--bd);border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;color:var(--tl);font-size:13px">🖼 Aucune image configurée</div>`;break;
     case 'calcul':{const cr=computeCalcul(fld,saisieValues);saisieValues[fld.id]=cr;html+=`<div style="background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px"><span id="calcul-result-${fld.id}" style="font-size:17px;font-weight:800;font-family:'DM Mono',monospace;color:var(--tx)">${cr!==''?cr:'—'}</span><span style="font-size:11px;color:var(--tl)">calculé automatiquement</span></div>`;break;}
      default:html+=`<div class="ap-input" style="color:var(--tl);font-style:italic">${fd.l||'—'}</div>`;
    }
    html+=`</div>`;
  });
  html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding-top:20px;border-top:2px solid var(--bd);margin-top:8px;gap:12px">
    <button class="btn" onclick="goProduction()" style="padding:9px 20px;border-radius:8px;font-size:13px">← Annuler</button>
    <div style="display:flex;gap:10px">
      <button class="btn" onclick="resetSaisie()" style="padding:9px 18px;border-radius:8px;font-size:13px">↺ Réinitialiser</button>
      <button onclick="submitSaisie()" id="btn-submit-saisie" style="padding:10px 26px;border-radius:8px;border:none;background:${color};color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">✅ Valider la saisie</button>
    </div>
  </div></div>`;
  wrap.innerHTML=html;
}
function saisieChange(fid,val){
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);
  const fld=f?(f.fields||[]).find(x=>x.id===fid):null;
  if(fld&&typeof val==='string'&&(fld.transformateurs||[]).length){
    const tv=applyTransformers(fid,val);
    if(tv!==val){val=tv;const inp=document.querySelector(`#sw-${fid} input,#sw-${fid} textarea`);if(inp&&inp.value!==tv)inp.value=tv;}
  }
  saisieValues[fid]=val;
  if(!f)return;
  (f.fields||[]).forEach(fld=>{const w=document.getElementById('sw-'+fld.id);if(!w)return;w.style.display=saisieEvalCond(fld,f.fields)?'block':'none';});
  (f.fields||[]).filter(c=>c.type==='calcul').forEach(c=>{const r=computeCalcul(c,saisieValues);saisieValues[c.id]=r;const el=document.getElementById('calcul-result-'+c.id);if(el)el.textContent=r!==''?String(r):'—';});
}
function saisieChangeMulti(fid,val,checked){
  if(!Array.isArray(saisieValues[fid]))saisieValues[fid]=[];
  if(checked){if(!saisieValues[fid].includes(val))saisieValues[fid].push(val);}
  else saisieValues[fid]=saisieValues[fid].filter(v=>v!==val);
  saisieChange(fid,saisieValues[fid]);
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  const fld=f.fields.find(x=>x.id===fid);if(!fld)return;
  const color=f.couleur||'#3b82f6';
  const container=document.getElementById('ms_'+fid);if(!container)return;
  container.innerHTML=(fld.valeurs||[]).map(v=>{const on=saisieValues[fid]?.includes(v);return`<label style="display:flex;align-items:center;gap:6px;padding:7px 15px;border:1.5px solid ${on?color:'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12.5px;font-weight:600;background:${on?color+'18':'#f8fafc'};color:${on?color:'var(--tm)'};transition:all .15s"><input type="checkbox" ${on?'checked':''} onchange="saisieChangeMulti('${fid}','${v.replace(/'/g,"\\'")}',this.checked)" style="display:none">${on?'✓ ':''}${h(v)}</label>`;}).join('');
}
function updateCbLabel(fid,color){
  const lbl=document.getElementById('cbl_'+fid);if(!lbl)return;
  const checked=lbl.querySelector('input').checked;
  lbl.style.borderColor=checked?color:'var(--bd)';lbl.style.background=checked?color+'18':'#f8fafc';
}
function saisieEvalCond(fld,allFields){
  const conds=fld.conditions||[];if(!conds.length)return true;
  const op=fld.condOp||'all';
  const results=conds.map(c=>{
    const src=allFields.find(x=>x.nom===c.field);if(!src)return true;
    const v=saisieValues[src.id];const cv=Array.isArray(v)?v.join(','):(v||'');
    if(c.op==='=')return cv===c.val;if(c.op==='!=')return cv!==c.val;
    if(c.op==='contains')return cv.includes(c.val);if(c.op==='empty')return !cv;return true;
  });
  return op==='all'?results.every(Boolean):results.some(Boolean);
}
function resetSaisie(){saisieValues={};const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(f)renderSaisieForm(f);toast('i','↺ Formulaire réinitialisé');}
function submitSaisie(){
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  const errors=(f.fields||[]).filter(fld=>{
    if(!saisieEvalCond(fld,f.fields))return false;if(!fld.obligatoire)return false;
    const v=saisieValues[fld.id];return v===undefined||v===''||v===false||(Array.isArray(v)&&!v.length);
  });
  if(errors.length){
    toast('e','⚠️ '+errors.length+' champ(s) obligatoire(s) non rempli(s)');
    errors.forEach(fld=>{const w=document.getElementById('sw-'+fld.id);if(w){w.style.outline='2px solid #ef4444';w.style.borderRadius='8px';w.scrollIntoView({behavior:'smooth',block:'nearest'});setTimeout(()=>w.style.outline='',2800);}});
    return;
  }
  // Validateurs personnalisés
  const _vldErrors=[];
  (f.fields||[]).forEach(fld=>{
    if(!saisieEvalCond(fld,f.fields))return;
    const val=saisieValues[fld.id];const sv=Array.isArray(val)?val.join(','):String(val||'');
    (fld.validateurs||[]).forEach(vld=>{
      let ok=true;const msg=vld.message||'Valeur invalide';
      try{
        switch(vld.nom){
          case 'Nb de caractères minimum':ok=sv.length>=(+vld.value||0);break;
          case 'Nb de caractères maximum':ok=sv.length<=(+vld.value||999);break;
          case 'Lettres uniquement':ok=/^[a-zA-ZÀ-ÿ\s]*$/.test(sv);break;
          case 'Chiffres uniquement':ok=/^\d*$/.test(sv);break;
          case 'Adresse email':ok=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sv);break;
          case 'Expression régulière':try{ok=new RegExp(vld.value||'').test(sv);}catch(e){ok=true;}break;
          case 'Validateur avancé':if(vld.code){try{const fn=new Function('value',vld.code);ok=!!fn(sv);}catch(e){ok=true;}}break;
        }
      }catch(e){ok=true;}
      if(!ok)_vldErrors.push({fld,msg:`${fld.nom} : ${msg}`});
    });
  });
  if(_vldErrors.length){
    _vldErrors.forEach(({fld,msg})=>{const w=document.getElementById('sw-'+fld.id);if(w){w.style.outline='2px solid #ef4444';w.style.borderRadius='8px';w.scrollIntoView({behavior:'smooth',block:'nearest'});setTimeout(()=>w.style.outline='',2800);}toast('e','⚠️ '+msg);});
    return;
  }
  // Déclencheur base de données dynamique
  const _dbTrigger = declItems.find(d => d.type === 'db_row');
  if (_dbTrigger) {
    const cfg = _dbTrigger.config || {};
    if (cfg.dbId) {
      // Écriture dans une base autonome avec mapping
      const targetDB = DATABASES_DATA.find(x=>x.id===cfg.dbId);
      if (targetDB) {
        const mappedValues = {};
        (cfg.mappings||[]).forEach(m=>{ if(saisieValues[m.fieldId]!==undefined) mappedValues[m.colId]=saisieValues[m.fieldId]; });
        targetDB.rows.push({id:Date.now(),date:new Date().toISOString(),dateLabel:new Date().toLocaleString('fr-FR'),source:'form:'+f.nom,values:mappedValues});
      }
    } else {
      // Fallback : écriture dans DB_DATA liée au formulaire (ancien comportement)
      if (!DB_DATA[f.id]) DB_DATA[f.id] = [];
      DB_DATA[f.id].push({id:Date.now(),date:new Date().toISOString(),dateLabel:new Date().toLocaleString('fr-FR'),user:'Picot Clément',values:{...saisieValues}});
    }
  }
 const newSub = {id:Date.now(),formId:f.id,formNom:f.nom,date:new Date().toISOString(),dateLabel:new Date().toLocaleString('fr-FR'),utilisateur:'Picot Clément',values:{...saisieValues}};
  SUBMISSIONS_DATA.push(newSub);
  f.resp=(f.resp||0)+1;
  // Sauvegarder dans Supabase
  if (typeof DB !== 'undefined') {
    const device = (typeof isPadMode === 'function' && isPadMode()) ? 'pad' : 'desktop';
    DB.createSubmission(f.id, {...saisieValues}, device)
      .then(() => console.log('[DB] Saisie enregistrée'))
      .catch(e => console.warn('[DB] Erreur saisie:', e));
  }
  document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(x=>x.actif!==false).length;
  const btn=document.getElementById('btn-submit-saisie');
  if(btn){btn.textContent='✅ Enregistré !';btn.style.background='#10b981';btn.style.pointerEvents='none';}
  toast('s','✅ Saisie enregistrée ! ('+f.resp.toLocaleString()+' réponse'+(f.resp>1?'s':'')+')');
  setTimeout(()=>openSubmissions(curSaisieFormId),900);
}
