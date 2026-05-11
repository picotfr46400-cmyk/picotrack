// ══ BUILDER ══
function openBuilder(id){
  curForm=id?FORMS_DATA.find(f=>f.id===id)||null:null;
  formColor=curForm?curForm.couleur:'#3b82f6';
  formModules=curForm?[...(curForm.type||['general'])]:['general'];
  builderFields=curForm&&curForm.fields?[...curForm.fields]:[
    {type:'text',id:'f1',nom:'Nom complet',obligatoire:true,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:true,placeholder:'Prénom NOM',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:[],conditions:[]},
    {type:'number',id:'f2',nom:'Quantité',obligatoire:false,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:false,placeholder:'',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:[],conditions:[],precision:0,pas:1,activer_min:false,activer_max:false,min:0,max:100},
    {type:'select',id:'f3',nom:'Statut',obligatoire:false,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:false,placeholder:'',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:['En cours','Terminé','Annulé'],conditions:[]},
  ];
  layoutRows=[];declItems=[];
  document.getElementById('builder-name').value=curForm?curForm.nom:'';
  document.getElementById('b-nom').value=curForm?curForm.nom:'';
  document.getElementById('b-desc').value=curForm?curForm.desc:'';
  document.getElementById('builder-status').textContent=curForm?'Enregistré ✓':'Nouveau';
  document.getElementById('btab-decl').style.display=curForm?'':'none';
  initColors();initModules(formModules);show('v-builder');
  document.getElementById('tb-t').textContent=curForm?'Modifier : '+curForm.nom:'Nouveau formulaire';
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goList()">Formulaires</span><span class="bc-sep"> › </span><span class="bc-cur">${curForm?h(curForm.nom):'Nouveau formulaire'}</span>`;
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-forms').classList.add('on');
  setBTab('gen');renderFields();
}
function saveForm(quit){
  const nom=document.getElementById('b-nom').value||document.getElementById('builder-name').value;
  if(!nom.trim()){toast('e','⚠️ Le nom du formulaire est obligatoire');return;}
  const data={id:curForm?curForm.id:Date.now(),nom:nom.trim(),desc:document.getElementById('b-desc').value||'',
    type:[...document.querySelectorAll('#mod-grid .mod-c.on')].map(el=>{const m=MODULES_DEF.find(x=>el.innerHTML.includes(x.value));return m?m.value:'general'}),
    actif:true,resp:curForm?curForm.resp:0,couleur:formColor,fields:[...builderFields]};
  if(curForm){const i=FORMS_DATA.findIndex(f=>f.id===curForm.id);if(i>-1)FORMS_DATA[i]=data;else FORMS_DATA.push(data);}
  else FORMS_DATA.push(data);
  document.getElementById('builder-status').textContent='Enregistré ✓';
  document.getElementById('btab-decl').style.display='';
  filtered=[...FORMS_DATA];
  document.getElementById('prod-forms-count').textContent=FORMS_DATA.filter(f=>f.actif!==false).length;
  toast('s','💾 Formulaire enregistré');if(quit)setTimeout(()=>goList(),400);
}

// ══ BUILDER TABS ══
function setBTab(t){
  bTab=t;
  ['gen','fields','layout','apercu','decl'].forEach(x=>{
    const tab=document.getElementById('btab-'+x);if(tab)tab.classList.toggle('on',x===t);
    const a=document.getElementById('barea-'+x);if(!a)return;
    if(x===t){
      if(t==='fields')a.style.cssText='display:block;flex:1;overflow:hidden;padding:0';
      else if(t==='layout')a.style.cssText='display:block;flex:1;overflow:hidden;padding:0';
      else if(t==='apercu')a.style.cssText='display:flex;flex-direction:column;flex:1;overflow:hidden';
      else a.style.cssText='display:block;flex:1;overflow-y:auto;padding:22px';
    }else a.style.display='none';
  });
  if(t==='apercu')renderApercu();if(t==='decl')renderDecl();if(t==='layout')renderLayout();
}

// ══ FIELDS ══
function renderFields(){
  const canvas=document.getElementById('f-canvas');const dz=document.getElementById('drop-zone');
  canvas.querySelectorAll('.field-item,.drop-indicator').forEach(e=>e.remove());
  if(!builderFields.length){dz.style.display='block';return;}dz.style.display='none';
  builderFields.forEach((f,i)=>{
    const fd=FD[f.type]||{l:f.nom,ic:'?',bg:'#6b7280'};
    const el=document.createElement('div');el.className='field-item'+(curFieldIdx===i?' selected':'');
    el.draggable=true;el.dataset.i=i;
    el.innerHTML=`<span class="f-drag">⠿</span><div class="f-type-ic" style="background:${fd.bg}">${fd.ic}</div>
      <span class="f-name">${h(f.nom||fd.l)}</span>
      <div style="display:flex;gap:4px;margin-left:auto">${f.obligatoire?'<span class="f-badge obl">Obligatoire</span>':'<span class="f-badge opt">Facultatif</span>'}${f.duplicable?'<span class="f-badge dup">Dup.</span>':''}</div>
      <div style="display:flex;gap:3px;margin-left:8px">
        <button class="ic-btn" onclick="event.stopPropagation();editField(${i})">✏️</button>
        <button class="ic-btn" onclick="event.stopPropagation();dupField(${i})">📋</button>
        <button class="ic-btn" onclick="event.stopPropagation();delField(${i})">🗑</button>
      </div>`;
    el.onclick=()=>editField(i);
    el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',i);el.classList.add('dragging');});
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
    el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drag-over');});
    el.addEventListener('dragleave',()=>el.classList.remove('drag-over'));
    el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drag-over');const from=+e.dataTransfer.getData('text/plain');if(from===i)return;const tmp=builderFields.splice(from,1)[0];builderFields.splice(i,0,tmp);renderFields();});
    canvas.appendChild(el);
  });
  const cnt=document.getElementById('fields-cnt');if(cnt){cnt.textContent=builderFields.length;cnt.style.display=builderFields.length?'':'none';}
}

// ✅ CORRECTION : nom de fonction aligné avec l'HTML (addField, pas addFieldFromPanel)
function addField(type){
  const fd=FD[type]||{l:type};const id='f'+Date.now();
  builderFields.push({type,id,nom:fd.l,obligatoire:false,duplicable:false,duplicable_selection_min_max:false,duplicable_min:1,duplicable_max:10,duplicable_ajout_auto:false,afficher_legende:false,legendeText:'',afficher_placeholder:false,placeholder:'',afficher_transformation:false,processOnEdit:false,vis_sup:true,vis_nom:true,validateurs:[],transformateurs:[],valeurs:[],conditions:[],...(type==='number'?{precision:0,pas:1,activer_min:false,activer_max:false,min:0,max:100}:{})});
  curFieldIdx=builderFields.length-1;renderFields();openCfg(curFieldIdx);
  toast('i','✅ Champ "'+fd.l+'" ajouté');
}
function editField(i){curFieldIdx=i;openCfg(i);}
function dupField(i){const copy=JSON.parse(JSON.stringify(builderFields[i]));copy.id='f'+Date.now();copy.nom+=' (copie)';builderFields.splice(i+1,0,copy);renderFields();toast('i','📋 Champ dupliqué');}
function delField(i){builderFields.splice(i,1);if(curFieldIdx===i){curFieldIdx=null;closeCfg();}else if(curFieldIdx>i)curFieldIdx--;renderFields();}

// ══ CONFIG CHAMP ══
// ✅ CORRECTION : openCfg montre cfg-bd + met à jour le header
function openCfg(i){
  cfgOpen=true;curFieldIdx=i;
  const f=builderFields[i];const fd=FD[f.type]||{l:f.type,ic:'?',bg:'#6b7280'};
  const panel=document.getElementById('cfg-panel');if(panel)panel.style.display='flex';
  const bd=document.getElementById('cfg-bd');if(bd)bd.style.display='block';
  const ic=document.getElementById('cfg-ic');if(ic){ic.textContent=fd.ic;ic.style.background=fd.bg;}
  const title=document.getElementById('cfg-title');if(title)title.textContent=h(f.nom||fd.l);
  const tTab=document.getElementById('ctab-T');if(tTab){tTab.textContent=f.type==='calcul'?'∑':'T';tTab.title=f.type==='calcul'?'Calcul':'Transformateurs';}
  setCfgTab('G');
}
// ✅ CORRECTION : closeCfg cache aussi cfg-bd
function closeCfg(){
  cfgOpen=false;curFieldIdx=null;
  const panel=document.getElementById('cfg-panel');if(panel)panel.style.display='none';
  const bd=document.getElementById('cfg-bd');if(bd)bd.style.display='none';
  renderFields();
}
// ✅ CORRECTION : saveCfg sauvegarde les inputs avant de fermer
function saveCfg(){
  if(curFieldIdx===null){closeCfg();return;}
  const f=builderFields[curFieldIdx];
  const nom=document.getElementById('ci-nom');if(nom)f.nom=nom.value;
  const legende=document.getElementById('ci-legende');if(legende)f.legendeText=legende.value;
  const placeholder=document.getElementById('ci-placeholder');if(placeholder)f.placeholder=placeholder.value;
  const title=document.getElementById('cfg-title');if(title)title.textContent=h(f.nom);
  renderFields();closeCfg();toast('s','✅ Champ enregistré');
}
// ✅ CORRECTION : setCfgTab utilise les bons IDs (.ctab avec id="ctab-X")
function setCfgTab(t){
  cfgTab=t;
  document.querySelectorAll('.ctab').forEach(b=>b.classList.remove('on'));
  const activeTab=document.getElementById('ctab-'+t);if(activeTab)activeTab.classList.add('on');
  if(curFieldIdx===null)return;
  const f=builderFields[curFieldIdx];const fd=FD[f.type]||{l:f.type};let html='';
  if(t==='G'){
    html+=`<div class="cg"><div class="cl">Nom du champ</div><input class="ci" id="ci-nom" value="${h(f.nom||fd.l)}" oninput="builderFields[curFieldIdx].nom=this.value;renderFields()"></div>`;
    html+=`<div class="cg" style="margin-top:10px"><div class="cl">Légende</div><div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Afficher une légende</div><div class="tog ${f.afficher_legende?'on':'off'}" onclick="toggleProp('afficher_legende',this)"></div></div>${f.afficher_legende?`<textarea class="ci" id="ci-legende" rows="2" style="resize:none;height:52px;margin-top:5px">${h(f.legendeText||'')}</textarea>`:''}</div>`;
    if(['text','textarea','number'].includes(f.type))html+=`<div class="cg" style="margin-top:10px"><div class="cl">Placeholder</div><div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Afficher un texte de substitution</div><div class="tog ${f.afficher_placeholder?'on':'off'}" onclick="toggleProp('afficher_placeholder',this)"></div></div>${f.afficher_placeholder?`<input class="ci" id="ci-placeholder" value="${h(f.placeholder||'')}" placeholder="Ex : Saisir une valeur..." style="margin-top:5px">`:''}</div>`;
    if(['select','multiselect'].includes(f.type))html+=`<div class="cg" style="margin-top:10px"><div class="cl">Options</div>${(f.valeurs||[]).map((v,i)=>`<div style="display:flex;gap:6px;margin-bottom:5px"><input class="ci" value="${h(v)}" oninput="builderFields[curFieldIdx].valeurs[${i}]=this.value" style="flex:1"><button class="ic-btn" onclick="removeOpt(${i})">✕</button></div>`).join('')}<button class="add-opt" onclick="addOpt()">＋ Ajouter une option</button></div>`;
    if(f.type==='number')html+=`<div class="cg" style="margin-top:10px"><div class="cl">Incrément (pas)</div><input class="ci" type="number" value="${f.pas||1}" min="0.01" step="any" oninput="builderFields[curFieldIdx].pas=+this.value" style="width:100px"></div>`;
    if(f.type==='image'){
      html+=`<div class="cg" style="margin-top:10px"><div class="cl">Image</div>
        ${f.imageData
          ?`<img src="${f.imageData}" style="max-width:100%;max-height:120px;border-radius:8px;object-fit:contain;display:block;margin-bottom:8px">`
          :`<div style="background:#f8fafc;border:1.5px dashed var(--bd);border-radius:8px;height:72px;display:flex;align-items:center;justify-content:center;color:var(--tl);font-size:13px;margin-bottom:8px">🖼 Aucune image</div>`}
        <input type="file" id="img-upload-${curFieldIdx}" accept="image/*" style="display:none" onchange="_uploadFieldImage(this)">
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" onclick="document.getElementById('img-upload-${curFieldIdx}').click()">📁 ${f.imageData?'Changer':'Choisir'} une image</button>
          ${f.imageData?`<button class="btn btn-sm" onclick="builderFields[curFieldIdx].imageData=null;renderFields();setCfgTab('G')">🗑 Supprimer</button>`:''}
        </div>
      </div>`;
    }
    const isLayout=['image','titre','separator','son','video'].includes(f.type);
    if(!isLayout)html+=`<div class="cg" style="margin-top:10px"><div class="cl">Obligatoire</div><div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Champ requis</div><div class="tog ${f.obligatoire?'on':'off'}" onclick="toggleProp('obligatoire',this)"></div></div></div>`;
   if(!['image','titre','separator','son','video','calcul','requete'].includes(f.type)){
      html+=`<div class="cg" style="margin-top:10px"><div class="cl">Champ duplicable</div>
        <div class="tr" style="padding:6px 0"><div class="tr-lbl" style="font-size:12px">Permettre l'ajout multiple</div><div class="tog ${f.duplicable?'on':'off'}" onclick="toggleProp('duplicable',this)"></div></div>
        ${f.duplicable?`<div style="margin-top:8px;display:flex;gap:10px">
          <div><div style="font-size:11px;color:var(--tl);margin-bottom:3px">Min</div><input class="ci" type="number" value="${f.duplicable_min||1}" min="1" oninput="builderFields[curFieldIdx].duplicable_min=+this.value" style="width:70px"></div>
          <div><div style="font-size:11px;color:var(--tl);margin-bottom:3px">Max</div><input class="ci" type="number" value="${f.duplicable_max||10}" min="1" oninput="builderFields[curFieldIdx].duplicable_max=+this.value" style="width:70px"></div>
        </div>`:''}
      </div>`;
    }
    html+=`<div class="cg" style="margin-top:10px"><div class="cl">Visibilité</div><div class="tr" style="padding:5px 0"><div class="tr-lbl" style="font-size:12px">🖥 Supervision</div><div class="tog ${f.vis_sup!==false?'on':'off'}" onclick="toggleProp('vis_sup',this)"></div></div><div class="tr" style="padding:5px 0"><div class="tr-lbl" style="font-size:12px">📱 App nomade</div><div class="tog ${f.vis_nom!==false?'on':'off'}" onclick="toggleProp('vis_nom',this)"></div></div></div>`;
  }
  if(t==='V'){
    const avail=VALIDATORS_BY_TYPE[f.type]||[];
    if(!(f.validateurs||[]).length)html+=`<div style="text-align:center;padding:20px;color:var(--tl);font-size:12px;opacity:.6">Aucun validateur configuré</div>`;
    html+=(f.validateurs||[]).map((vld,vi)=>{
      const isAdv=vld.nom==='Validateur avancé';
      return `<div style="border:1.5px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${isAdv||vld.hasValue?'8':'4'}px">
          <span style="font-size:12px;font-weight:700">${vi+1}. ${vld.nom}</span>
          <button class="ic-btn" onclick="builderFields[curFieldIdx].validateurs.splice(${vi},1);setCfgTab('V')">🗑</button>
        </div>
        ${isAdv
          ?`<div style="margin-bottom:6px"><div style="font-size:11px;color:var(--tl);margin-bottom:3px">Message d'erreur</div><input class="ci" value="${h(vld.message||'')}" placeholder="Valeur invalide..." oninput="builderFields[curFieldIdx].validateurs[${vi}].message=this.value"></div>
           <div style="background:#1e293b;border-radius:6px;padding:8px"><div style="font-size:10px;color:#64748b;margin-bottom:4px;font-family:'DM Mono',monospace">// function validate(value) — return true si valide</div><textarea style="width:100%;background:transparent;border:none;outline:none;color:#e2e8f0;font-family:'DM Mono',monospace;font-size:12px;resize:vertical;min-height:72px;box-sizing:border-box" oninput="builderFields[curFieldIdx].validateurs[${vi}].code=this.value" placeholder="return value.length > 0;">${h(vld.code||'return value.length > 0;')}</textarea></div>`
          :vld.hasValue
          ?`<div style="display:flex;gap:6px"><input class="ci" type="${vld.typeInput||'text'}" value="${h(vld.value||'')}" placeholder="Valeur..." oninput="builderFields[curFieldIdx].validateurs[${vi}].value=this.value" style="width:90px"><input class="ci" style="flex:1" value="${h(vld.message||'')}" placeholder="Message d'erreur..." oninput="builderFields[curFieldIdx].validateurs[${vi}].message=this.value"></div>`
          :`<input class="ci" value="${h(vld.message||'')}" placeholder="Message d'erreur (optionnel)..." oninput="builderFields[curFieldIdx].validateurs[${vi}].message=this.value">`}
      </div>`;
    }).join('');
    if(avail.length)html+=`<div style="display:flex;gap:6px;margin-top:4px"><select class="ci" id="vld-sel" style="flex:1"><option value="">— Sélectionner —</option>${avail.map(v=>`<option>${h(v)}</option>`).join('')}</select><button class="btn btn-sm bp" onclick="addVld()">＋</button></div>`;
  }
 if(t==='T'){
    if(f.type==='calcul'){
      const steps=f.calculSteps||[];
      const numFields=builderFields.filter((bf,idx)=>idx!==curFieldIdx&&['number','calcul'].includes(bf.type));
      const fieldOptsFor=sel=>numFields.map(bf=>`<option value="${bf.id}" ${sel===bf.id?'selected':''}>${h(bf.nom)}</option>`).join('');
      let stepsHtml='';
      steps.forEach((step,si)=>{
        stepsHtml+=`<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
          ${si===0
            ?`<div style="width:50px;text-align:center;font-size:11px;color:var(--tl);flex-shrink:0">début</div>`
            :`<select class="ci" style="width:50px;text-align:center;font-size:16px;font-weight:800;padding:6px 2px" onchange="_calcSetOp(${si},this.value)">
              <option value="+" ${step.op==='+'?'selected':''}>+</option>
              <option value="-" ${step.op==='-'?'selected':''}>−</option>
              <option value="*" ${step.op==='*'?'selected':''}>×</option>
              <option value="/" ${step.op==='/'?'selected':''}>÷</option>
            </select>`}
          <select class="ci" style="width:95px;flex-shrink:0" onchange="_calcSetType(${si},this.value)">
            <option value="field" ${step.type==='field'?'selected':''}>Champ</option>
            <option value="fixed" ${step.type==='fixed'?'selected':''}>Valeur</option>
          </select>
          ${step.type==='field'
            ?`<select class="ci" style="flex:1" onchange="_calcSetField(${si},this.value)"><option value="">— Choisir —</option>${fieldOptsFor(step.fieldId)}</select>`
            :`<input class="ci" type="number" style="flex:1" value="${h(String(step.value||'0'))}" oninput="_calcSetValue(${si},this.value)">`}
          ${steps.length>1?`<button class="ic-btn" onclick="_calcRemoveStep(${si})">🗑</button>`:''}
        </div>`;
      });
      html+=`<div class="cg"><div class="cl" style="margin-bottom:6px">Formule de calcul</div>
        <div class="f-hint" style="margin-bottom:10px">Combinez champs numériques et valeurs fixes. Le résultat est en lecture seule dans le formulaire.</div>
        ${!steps.length?`<div style="text-align:center;padding:14px;color:var(--tl);font-size:12px;border:1.5px dashed var(--bd);border-radius:8px;margin-bottom:8px">Aucun terme configuré</div>`:''}
        ${stepsHtml}
        <button class="btn btn-sm" style="width:100%;margin-top:4px" onclick="_calcAddStep()">＋ Ajouter un terme</button>
        ${steps.length>=2?`<div style="margin-top:10px;padding:10px;background:var(--bg);border-radius:8px;display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--tl)">Décimales :</span><input class="ci" type="number" value="${f.calculPrecision!==undefined?f.calculPrecision:2}" min="0" max="10" style="width:55px" oninput="builderFields[curFieldIdx].calculPrecision=+this.value"></div>`:''}
      </div>`;
      const body=document.getElementById('cfg-body');if(body)body.innerHTML=html;return;
    }
    if(!['text','textarea'].includes(f.type)){html+=`<div style="text-align:center;padding:24px;background:var(--bg);border-radius:8px;color:var(--tl);font-size:12px">⚙️ Non applicable pour ce type de champ</div>`;const body=document.getElementById('cfg-body');if(body)body.innerHTML=html;return;}    
    if(!(f.transformateurs||[]).length)html+=`<div style="text-align:center;padding:20px;color:var(--tl);font-size:12px;opacity:.6">Aucun transformateur configuré</div>`;
    html+=(f.transformateurs||[]).map((trf,ti)=>{
      const isAdv=trf.nom==='Transformateur avancé';
      const needsParam=/(préfixe|suffixe|premiers|derniers|sous-chaîne)/i.test(trf.nom);
      return `<div style="border:1.5px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${isAdv||needsParam?'8':'0'}px">
          <span style="font-size:12px;font-weight:700">${ti+1}. ${trf.nom}</span>
          <button class="ic-btn" onclick="builderFields[curFieldIdx].transformateurs.splice(${ti},1);setCfgTab('T')">🗑</button>
        </div>
        ${isAdv
          ?`<div style="background:#1e293b;border-radius:6px;padding:8px"><div style="font-size:10px;color:#64748b;margin-bottom:4px;font-family:'DM Mono',monospace">// function transform(value) — retournez la valeur modifiée</div><textarea style="width:100%;background:transparent;border:none;outline:none;color:#e2e8f0;font-family:'DM Mono',monospace;font-size:12px;resize:vertical;min-height:72px;box-sizing:border-box" oninput="builderFields[curFieldIdx].transformateurs[${ti}].code=this.value" placeholder="return value.toUpperCase();">${h(trf.code||'return value.toUpperCase();')}</textarea></div>`
          :needsParam
          ?`<input class="ci" value="${h(trf.param||'')}" placeholder="Paramètre..." oninput="builderFields[curFieldIdx].transformateurs[${ti}].param=this.value">`
          :''}
      </div>`;
    }).join('');
    html+=`<div style="display:flex;gap:6px;margin-top:4px"><select class="ci" id="trf-sel" style="flex:1"><option value="">— Sélectionner —</option>${TRANSFORMERS.map(t=>`<option>${h(t)}</option>`).join('')}</select><button class="btn btn-sm bp" onclick="addTrf()">＋</button></div>`;
  }
  if(t==='A'){
    html+=`<div class="cg" style="margin-bottom:14px"><div class="cl" style="margin-bottom:8px">Visible par (rôles)</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${ROLES_DATA.map(r=>{const on=(f.visibleByRoles||[]).includes(r.id);return`<label style="display:flex;align-items:center;gap:5px;padding:5px 11px;border:1.5px solid ${on?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;background:${on?'var(--pl)':'#fff'};color:${on?'var(--p)':'var(--tm)'}"><input type="checkbox" ${on?'checked':''} style="display:none" onchange="_toggleFieldRole(${r.id},this.checked)">${on?'✓ ':''}${h(r.nom)}</label>`;}).join('')}</div>
      <div style="font-size:11px;color:var(--tl);margin-top:5px">Vide = visible par tous les rôles</div>
    </div>
    <div class="cl" style="margin-bottom:8px">Conditions d'affichage</div>`;
    if((f.conditions||[]).length)html+=`<div style="margin-bottom:8px"><label style="font-size:12px;margin-right:8px"><input type="radio" name="condOp" value="all" ${(f.condOp||'all')==='all'?'checked':''} onchange="builderFields[curFieldIdx].condOp='all'"> Toutes</label><label style="font-size:12px"><input type="radio" name="condOp" value="any" ${f.condOp==='any'?'checked':''} onchange="builderFields[curFieldIdx].condOp='any'"> Au moins une</label></div>`;
    html+=(f.conditions||[]).map((c,ci)=>`<div style="border:1.5px solid var(--bd);border-radius:8px;padding:8px;margin-bottom:6px"><div style="display:flex;gap:6px;align-items:center"><select class="ci" style="flex:1;padding:6px 8px;font-size:12px" onchange="builderFields[curFieldIdx].conditions[${ci}].field=this.value"><option value="">— Champ source —</option>${builderFields.filter((_,idx)=>idx!==curFieldIdx).map(bf=>`<option${c.field===bf.nom?' selected':''}>${h(bf.nom)}</option>`).join('')}</select><select class="ci" style="width:44px;padding:6px 4px;font-size:13px;text-align:center" onchange="builderFields[curFieldIdx].conditions[${ci}].op=this.value"><option${c.op==='='?' selected':''}>=</option><option${c.op==='!='?' selected':''}>≠</option><option${c.op==='contains'?' selected':''}>∋</option><option${c.op==='empty'?' selected':''}>∅</option></select><input class="ci" style="flex:1;padding:6px 8px;font-size:12px" value="${h(c.val||'')}" placeholder="Valeur..." oninput="builderFields[curFieldIdx].conditions[${ci}].val=this.value"><button class="ic-btn" onclick="builderFields[curFieldIdx].conditions.splice(${ci},1);setCfgTab('A')">✕</button></div></div>`).join('');
    html+=`<button class="add-opt" onclick="(builderFields[curFieldIdx].conditions=builderFields[curFieldIdx].conditions||[]).push({field:'',op:'=',val:''});setCfgTab('A')">＋ Ajouter une condition</button>`;
  }
  const body=document.getElementById('cfg-body');if(body)body.innerHTML=html;
}
function toggleProp(prop,el){
  if(curFieldIdx===null)return;const f=builderFields[curFieldIdx];
  el.classList.toggle('on');el.classList.toggle('off');f[prop]=el.classList.contains('on');
  if(prop==='afficher_legende'){const t=document.getElementById('ci-legende');if(t)f.legendeText=t.value;}
  if(prop==='afficher_placeholder'){const t=document.getElementById('ci-placeholder');if(t)f.placeholder=t.value;}
  renderFields();setCfgTab(cfgTab);
}
function addOpt(){if(curFieldIdx===null)return;(builderFields[curFieldIdx].valeurs=builderFields[curFieldIdx].valeurs||[]).push('Nouvelle option');setCfgTab('G');}
function removeOpt(i){if(curFieldIdx===null)return;builderFields[curFieldIdx].valeurs.splice(i,1);setCfgTab('G');}
function addVld(){const sel=document.getElementById('vld-sel');if(!sel||curFieldIdx===null||!sel.value)return;const nom=sel.value;const isAdv=nom==='Validateur avancé';const hasValue=!isAdv&&/(min|max|caractère|fichier|sélection|valeur)/i.test(nom);(builderFields[curFieldIdx].validateurs=builderFields[curFieldIdx].validateurs||[]).push({nom,hasValue,value:'',message:'',typeInput:'number',...(isAdv?{code:'return value.length > 0;'}:{})});setCfgTab('V');toast('i','✅ Validateur ajouté');}
function addTrf(){const sel=document.getElementById('trf-sel');if(!sel||curFieldIdx===null||!sel.value)return;const nom=sel.value;const isAdv=nom==='Transformateur avancé';const hasParam=!isAdv&&/(préfixe|suffixe|premiers|derniers|sous-chaîne)/i.test(nom);(builderFields[curFieldIdx].transformateurs=builderFields[curFieldIdx].transformateurs||[]).push({nom,...(isAdv?{code:'return value.toUpperCase();'}:{param:hasParam?'':undefined})});setCfgTab('T');toast('i','✅ Transformateur ajouté');}
document.addEventListener("click", function(e){
  const tab = e.target.closest(".flow-tab");
  if(!tab) return;

  document.querySelectorAll(".flow-tab").forEach(t => t.classList.remove("on"));
  tab.classList.add("on");
});
