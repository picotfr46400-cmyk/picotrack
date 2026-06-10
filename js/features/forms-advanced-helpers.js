// ══ HELPERS FORMULAIRES AVANCÉS ══
function _uploadFieldImage(input) {
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    if(curFieldIdx===null)return;
    builderFields[curFieldIdx].imageData=e.target.result;
    renderFields();setCfgTab('G');
    toast('i','🖼 Image chargée');
  };
  reader.readAsDataURL(file);
}
function computeCalcul(fld, values) {
  const steps=fld.calculSteps||[];if(!steps.length)return'';
  const getV=s=>s.type==='fixed'?(+s.value||0):(+values[s.fieldId]||0);
  let r=getV(steps[0]);
  for(let i=1;i<steps.length;i++){const v=getV(steps[i]);switch(steps[i].op){case'+':r+=v;break;case'-':r-=v;break;case'*':r*=v;break;case'/':r=v!==0?r/v:0;break;}}
  const p=fld.calculPrecision!==undefined?fld.calculPrecision:2;
  return +r.toFixed(p);
}
function _calcAddStep(){
  if(curFieldIdx===null)return;const f=builderFields[curFieldIdx];
  if(!f.calculSteps)f.calculSteps=[];
  const isFirst=f.calculSteps.length===0;
  f.calculSteps.push({type:'fixed',value:'0',...(isFirst?{}:{op:'+'})});
  setCfgTab('T');
}
function _calcRemoveStep(si){if(curFieldIdx===null)return;builderFields[curFieldIdx].calculSteps.splice(si,1);setCfgTab('T');}
function _calcSetOp(si,op){if(curFieldIdx===null)return;builderFields[curFieldIdx].calculSteps[si].op=op;}
function _calcSetType(si,type){if(curFieldIdx===null)return;builderFields[curFieldIdx].calculSteps[si].type=type;builderFields[curFieldIdx].calculSteps[si].fieldId='';builderFields[curFieldIdx].calculSteps[si].value='0';setCfgTab('T');}
function _calcSetField(si,fid){if(curFieldIdx===null)return;builderFields[curFieldIdx].calculSteps[si].fieldId=fid;}
function _calcSetValue(si,val){if(curFieldIdx===null)return;builderFields[curFieldIdx].calculSteps[si].value=val;}
function applyTransformers(fid, val) {
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return val;
  const fld=(f.fields||[]).find(x=>x.id===fid);if(!fld||(fld.transformateurs||[]).length===0)return val;
  let v=String(val||'');
  for(const trf of fld.transformateurs){
    try{
      switch(trf.nom){
        case 'Mettre le 1er caractère en majuscule':v=v.charAt(0).toUpperCase()+v.slice(1);break;
        case 'Tout en majuscule':v=v.toUpperCase();break;
        case 'Tout en minuscule':v=v.toLowerCase();break;
        case 'Ajouter un préfixe':v=(trf.param||'')+v;break;
        case 'Ajouter un suffixe':v=v+(trf.param||'');break;
        case 'Extraire une sous-chaîne':{const p=(trf.param||'').split(',');v=v.substring(+p[0]||0,p[1]!==undefined?+p[1]:undefined);break;}
        case 'Ne conserver que les x premiers caractères':v=v.slice(0,+trf.param||0);break;
        case 'Ne conserver que les x derniers caractères':v=(+trf.param||1)?v.slice(-(+trf.param)):v;break;
        case 'Retirer les espaces en début/fin':v=v.trim();break;
        case 'Transformateur avancé':if(trf.code){const fn=new Function('value',trf.code);v=String(fn(v)??v);}break;
      }
    }catch(e){}
  }
  return v;
}
function renderDupField(fld, color) {
  const vals=Array.isArray(saisieValues[fld.id])?saisieValues[fld.id]:[''];
  const max=fld.duplicable_max||10;const min=fld.duplicable_min||1;
  let out='';
  vals.forEach((v,idx)=>{
    let inp='';
    switch(fld.type){
      case 'text':inp=`<input class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit;font-size:13px;box-sizing:border-box" placeholder="${h(fld.afficher_placeholder&&fld.placeholder?fld.placeholder:'Saisir...')}" value="${h(v)}" oninput="saisieChangeDup('${fld.id}',${idx},this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'textarea':inp=`<textarea class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;height:72px;resize:vertical;padding:10px 13px;outline:none;font-family:inherit;font-size:13px;box-sizing:border-box" oninput="saisieChangeDup('${fld.id}',${idx},this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">${h(v)}</textarea>`;break;
      case 'number':inp=`<input type="number" class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit;font-size:13px" value="${+v||0}" step="${fld.pas||1}" oninput="saisieChangeDup('${fld.id}',${idx},+this.value)" onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'">`;break;
      case 'select':inp=`<select class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit;font-size:13px;cursor:pointer" onchange="saisieChangeDup('${fld.id}',${idx},this.value)"><option value="">— Sélectionner —</option>${(fld.valeurs||[]).map(opt=>`<option ${v===opt?'selected':''}>${h(opt)}</option>`).join('')}</select>`;break;
      case 'date':inp=`<input type="date" class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit" value="${h(v)}" onchange="saisieChangeDup('${fld.id}',${idx},this.value)">`;break;
      case 'heure':inp=`<input type="time" class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit" value="${h(v)}" onchange="saisieChangeDup('${fld.id}',${idx},this.value)">`;break;
      case 'datetime':inp=`<input type="datetime-local" class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit" value="${h(v)}" onchange="saisieChangeDup('${fld.id}',${idx},this.value)">`;break;
      default:inp=`<input class="ap-input" style="flex:1;background:#f8fafc;border:1.5px solid var(--bd);border-radius:8px;padding:10px 13px;outline:none;font-family:inherit;font-size:13px" value="${h(v)}" oninput="saisieChangeDup('${fld.id}',${idx},this.value)">`;
    }
    out+=`<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px">${inp}${vals.length>min?`<button onclick="saisieRemoveDup('${fld.id}',${idx})" style="width:32px;height:32px;border:1.5px solid #ef4444;border-radius:8px;background:#fff;color:#ef4444;cursor:pointer;font-size:16px;flex-shrink:0">✕</button>`:''}</div>`;
  });
  if(vals.length<max)out+=`<button onclick="saisieAddDup('${fld.id}')" style="width:100%;padding:8px;border:1.5px dashed var(--bd);border-radius:8px;background:transparent;color:${color};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">＋ Ajouter</button>`;
  return `<div id="dup-${fld.id}">${out}</div>`;
}
function saisieChangeDup(fid, idx, val) {
  if(!Array.isArray(saisieValues[fid]))saisieValues[fid]=[''];
  saisieValues[fid][idx]=val;
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  (f.fields||[]).forEach(fld=>{const w=document.getElementById('sw-'+fld.id);if(!w)return;w.style.display=saisieEvalCond(fld,f.fields)?'block':'none';});
}
function saisieAddDup(fid) {
  if(!Array.isArray(saisieValues[fid]))saisieValues[fid]=[''];
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  const fld=f.fields.find(x=>x.id===fid);if(!fld)return;
  if(saisieValues[fid].length>=(fld.duplicable_max||10))return;
  saisieValues[fid].push('');
  const wrap=document.getElementById('dup-'+fid);
  if(wrap)wrap.outerHTML=renderDupField(fld,f.couleur||'#3b82f6');
}
function saisieRemoveDup(fid, idx) {
  if(!Array.isArray(saisieValues[fid]))return;
  const f=FORMS_DATA.find(x=>x.id===curSaisieFormId);if(!f)return;
  const fld=f.fields.find(x=>x.id===fid);if(!fld)return;
  if(saisieValues[fid].length<=(fld.duplicable_min||1))return;
  saisieValues[fid].splice(idx,1);
  const wrap=document.getElementById('dup-'+fid);
  if(wrap)wrap.outerHTML=renderDupField(fld,f.couleur||'#3b82f6');
}
function _setDeclDB(i, val) {
  if (!declItems[i].config) declItems[i].config = {};
  if (val.startsWith('sdb_')) { declItems[i].config.dbId = parseInt(val.replace('sdb_','')); }
  else { delete declItems[i].config.dbId; }
  declItems[i].config.mappings = [];
  renderDecl();
}
function _setDeclMapping(i, colId, fieldId) {
  if (!declItems[i].config) declItems[i].config = {};
  if (!declItems[i].config.mappings) declItems[i].config.mappings = [];
  const m = declItems[i].config.mappings;
  const idx = m.findIndex(x=>x.colId===colId);
  if (fieldId) { if(idx>=0) m[idx].fieldId=fieldId; else m.push({colId,fieldId}); }
  else { if(idx>=0) m.splice(idx,1); }
}
function toggleHistoSub(tog){tog.classList.toggle('on');tog.classList.toggle('off');document.getElementById('sub-histo').classList.toggle('show',tog.classList.contains('on'));}
// ════════════════════════════════════════════════════════
// PATCH app.js — Coller CE BLOC ENTIER à la fin du fichier
// ════════════════════════════════════════════════════════

