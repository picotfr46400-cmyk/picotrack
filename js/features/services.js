// ══ DONNÉES SERVICES ══
let SERVICES_DATA = [
  {
    id: 1,
    nom: "Demande d'intervention",
    desc: 'Gestion des demandes terrain',
    couleur: '#3b82f6',
    formId: 1,
    idPattern: 'INT-{YYYY}-{0000}',
    actif: true,
    statuses: [
      {id:'s1', nom:'Nouveau',     couleur:'#64748b', position:0,   type:'initial'},
      {id:'s2', nom:'En cours',    couleur:'#f59e0b', position:50,  type:'normal'},
      {id:'s3', nom:'Clôturé',     couleur:'#10b981', position:100, type:'terminal'},
    ],
    actions: [
      {id:'a1', nom:'Prendre en charge', couleur:'#3b82f6', type:'change_status', config:{targetStatusId:'s2'}},
      {id:'a2', nom:'Clôturer',          couleur:'#10b981', type:'change_status', config:{targetStatusId:'s3'}},
      {id:'a3', nom:'Commenter',         couleur:'#8b5cf6', type:'comment',        config:{}},
    ],
    flux: [
      {statusId:'s1', actionId:'a1', enabled:true},
      {statusId:'s1', actionId:'a3', enabled:true},
      {statusId:'s2', actionId:'a2', enabled:true},
      {statusId:'s2', actionId:'a3', enabled:true},
    ],
  }
];
let SERVICE_INSTANCES_DATA = [];
const SVC_COUNTERS = {};

// builder state
let curService = null, svcTab = 'gen';
let svcBuilderStatuses = [], svcBuilderActions = [], svcBuilderFlux = [];
let svcBuilderColor = '#3b82f6', svcBuilderFormId = null;
let curInstanceId = null, curKanbanGroupId = null;
let svcBuilderCardConfig = {couleur:'#3b82f6', titleFieldId:null, subtitle1FieldId:null, subtitle2FieldId:null};
let svcBuilderKanbanGroups = [];

// ══ NAVIGATION ══
function goServices() {
  document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
  document.getElementById('sb-services').classList.add('on');
  show('v-services');
  document.getElementById('tb-t').textContent = 'Services';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Services</span>';
  renderServices();
}

// ══ LISTE SERVICES ══
function renderServices(list) {
  list = list || SERVICES_DATA;
  const grid = document.getElementById('services-grid');
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--tl)">
      <div style="font-size:32px;margin-bottom:12px;opacity:.3">⚡</div>Aucun service créé</div>`;
    return;
  }
  grid.innerHTML = list.map(svc => {
    const f = FORMS_DATA.find(x => x.id === svc.formId);
    const all = SERVICE_INSTANCES_DATA.filter(i => i.serviceId === svc.id);
    const pending = all.filter(i => !isTerminalStatus(svc, i.currentStatusId)).length;
    const color = svc.couleur || '#3b82f6';
    return `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;display:flex;flex-direction:column">
      <div style="height:5px;background:${color}"></div>
      <div style="padding:16px;flex:1">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="width:36px;height:36px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">⚡</div>
          <div style="flex:1">
            <div style="font-weight:800;font-size:14px">${h(svc.nom)}</div>
            ${svc.desc ? `<div style="font-size:11px;color:var(--tl);margin-top:1px">${h(svc.desc)}</div>` : ''}
          </div>
          <button class="ic-btn" onclick="event.stopPropagation();openServiceBuilder(${svc.id})" title="Configurer">✏️</button>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <span style="font-size:11px;padding:3px 9px;border-radius:20px;background:#f1f5f9;color:var(--tm)">${svc.statuses.length} statuts</span>
          <span style="font-size:11px;padding:3px 9px;border-radius:20px;background:#f1f5f9;color:var(--tm)">${svc.actions.length} actions</span>
          ${f
            ? `<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:${color}18;color:${color}">📋 ${h(f.nom)}</span>`
            : `<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:var(--dl);color:var(--d)">⚠ Formulaire manquant</span>`}
        </div>
        <div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <span style="font-size:13px;font-weight:800;color:var(--tx)">${pending}</span>
            <span style="font-size:11px;color:var(--tl)"> en cours</span>
            <span style="font-size:11px;color:var(--tl);margin-left:6px">/ ${all.length} total</span>
          </div>
          <button onclick="openServiceInstances(${svc.id})" style="padding:6px 16px;border-radius:20px;background:${color};color:#fff;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Voir →</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function isTerminalStatus(svc, statusId) {
  const s = svc.statuses.find(x => x.id === statusId);
  return s && s.type === 'terminal';
}

function searchServices(q) {
  renderServices(SERVICES_DATA.filter(s => s.nom.toLowerCase().includes(q.toLowerCase())));
}

// ══ SERVICE BUILDER ══
function openServiceBuilder(id) {
  curService = id ? SERVICES_DATA.find(s => s.id === id) : null;
  if (curService) {
    svcBuilderStatuses = JSON.parse(JSON.stringify(curService.statuses));
    svcBuilderActions  = JSON.parse(JSON.stringify(curService.actions));
    svcBuilderFlux     = JSON.parse(JSON.stringify(curService.flux));
    svcBuilderColor    = curService.couleur;
    svcBuilderFormId   = curService.formId;
    svcBuilderCardConfig   = curService.cardConfig   ? JSON.parse(JSON.stringify(curService.cardConfig))   : {couleur:'#3b82f6',titleFieldId:null,subtitle1FieldId:null,subtitle2FieldId:null};
    svcBuilderKanbanGroups = curService.kanbanGroups ? JSON.parse(JSON.stringify(curService.kanbanGroups)) : [];
    svcBuilderActions = JSON.parse(JSON.stringify(curService.actions)).map(a=>({...a, effects: a.effects||(a.type?[{type:a.type,config:a.config||{}}]:[{type:'change_status',config:{}}])}));
  } else {
    svcBuilderStatuses = []; svcBuilderActions = []; svcBuilderFlux = [];
    svcBuilderColor = '#3b82f6'; svcBuilderFormId = null;
    svcBuilderCardConfig = {couleur:'#3b82f6',titleFieldId:null,subtitle1FieldId:null,subtitle2FieldId:null};
    svcBuilderKanbanGroups = [];
  }
  document.getElementById('sb2-name').value = curService ? curService.nom : '';
  document.getElementById('tb-t').textContent = curService ? 'Modifier : ' + curService.nom : 'Nouveau service';
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goServices()">▶ Services</span><span class="bc-sep"> › </span><span class="bc-cur">${curService ? h(curService.nom) : 'Nouveau service'}</span>`;
  document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
  document.getElementById('sb-services').classList.add('on');
  show('v-service-builder');
  setSvcTab('gen');
}

function setSvcTab(t) {
  svcTab = t;
  ['gen','formulaires','statuses','actions','flux','kanban'].forEach(x => {
    const tab = document.getElementById('svctab-' + x);
    if (tab) tab.classList.toggle('on', x === t);
  });
  renderSvcTab();
}

function renderSvcTab() {
  const area = document.getElementById('svc-area'); if (!area) return;
  if      (svcTab === 'gen')         renderSvcGen(area);
  else if (svcTab === 'formulaires') renderSvcFormulaires(area);
  else if (svcTab === 'statuses')    renderSvcStatuses(area);
  else if (svcTab === 'actions')     renderSvcActions(area);
  else if (svcTab === 'flux')        renderSvcFlux(area);
  else if (svcTab === 'kanban')      renderSvcKanbanConfig(area);
}

// ── Onglet Général ──
function renderSvcGen(area) {
  const formOptions = FORMS_DATA.filter(f => f.actif !== false).map(f =>
    `<option value="${f.id}" ${svcBuilderFormId === f.id ? 'selected' : ''}>${h(f.nom)}</option>`
  ).join('');
  area.innerHTML = `
    <div class="b-sec">
      <div class="b-sec-t">Informations générales</div>
      <div class="ig" style="margin-bottom:12px">
        <div class="fg"><div class="fl2">Nom du service <span class="req">*</span></div>
          <input class="fi" id="svc-nom" value="${h(curService ? curService.nom : '')}" placeholder="Ex : Demande d'intervention..."
            oninput="document.getElementById('sb2-name').value=this.value">
        </div>
        <div class="fg"><div class="fl2">Description</div>
          <textarea class="fi fi-ta" id="svc-desc" placeholder="Description optionnelle...">${h(curService ? curService.desc || '' : '')}</textarea>
        </div>
      </div>
      <div class="ig ig2">
        <div class="fg">
          <div class="fl2">Couleur</div>
          <div class="color-row" id="svc-color-row">
            ${COLORS.map(c => `<div class="c-swatch${svcBuilderColor===c?' on':''}" style="background:${c}"
              onclick="svcBuilderColor='${c}';document.querySelectorAll('#svc-color-row .c-swatch').forEach(e=>e.classList.remove('on'));this.classList.add('on')"></div>`).join('')}
          </div>
        </div>
        <div class="fg">
          <div class="fl2">Format identifiant</div>
          <input class="fi" id="svc-pattern" value="${h(curService ? curService.idPattern||'SVC-{YYYY}-{0000}' : 'SVC-{YYYY}-{0000}')}" placeholder="SVC-{YYYY}-{0000}">
          <div class="f-hint">Variables : {YYYY} = année, {0000} = numéro auto</div>
        </div>
      </div>
    </div>
    <div class="b-sec">
      <div class="b-sec-t">Formulaire déclencheur <span class="req">*</span></div>
      <div class="f-hint" style="margin-bottom:10px">Ce formulaire est utilisé pour créer une nouvelle demande.</div>
      <select class="fi" id="svc-form" style="appearance:none" onchange="svcBuilderFormId=+this.value||null">
        <option value="">— Sélectionner un formulaire —</option>${formOptions}
      </select>
    </div>`;
  // sync top bar name
  document.getElementById('sb2-name').addEventListener('input', e => {
    const el = document.getElementById('svc-nom'); if (el) el.value = e.target.value;
  });
}
// ── Onglet Formulaires + étiquette ──
function renderSvcFormulaires(area) {
  const formOptions = FORMS_DATA.filter(f=>f.actif!==false).map(f=>`<option value="${f.id}" ${svcBuilderFormId===f.id?'selected':''}>${h(f.nom)}</option>`).join('');
  const f = svcBuilderFormId ? FORMS_DATA.find(x=>x.id===svcBuilderFormId) : null;
  const fields = f ? (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)) : [];
  const cc = svcBuilderCardConfig;
  const fo = (sel) => `<option value="">— Aucun —</option>`+fields.map(fld=>`<option value="${fld.id}" ${sel===fld.id?'selected':''}>${h(fld.nom)}</option>`).join('');
  const tV = fields.find(x=>x.id===cc.titleFieldId)?.nom||'Titre';
  const s1V = fields.find(x=>x.id===cc.subtitle1FieldId)?.nom||null;
  const s2V = fields.find(x=>x.id===cc.subtitle2FieldId)?.nom||null;
  area.innerHTML = `
    <div class="b-sec">
      <div class="b-sec-t">Formulaire déclencheur <span class="req">*</span></div>
      <select class="fi" style="appearance:none" onchange="svcBuilderFormId=+this.value||null;renderSvcTab()">
        <option value="">— Sélectionner —</option>${formOptions}
      </select>
    </div>
    ${f ? `<div class="b-sec">
      <div class="b-sec-t">Étiquette de la carte kanban</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:12px">
          <div><div class="fl2">Couleur</div>
            <div class="color-row" id="cc-row">${COLORS.map(c=>`<div class="c-swatch${cc.couleur===c?' on':''}" style="background:${c}" onclick="svcBuilderCardConfig.couleur='${c}';document.querySelectorAll('#cc-row .c-swatch').forEach(e=>e.classList.remove('on'));this.classList.add('on');updateCardPreview()"></div>`).join('')}</div>
          </div>
          <div><div class="fl2">Titre <span class="req">*</span></div>
            <select class="fi" style="appearance:none" id="cc-title" onchange="svcBuilderCardConfig.titleFieldId=this.value||null;updateCardPreview()">${fo(cc.titleFieldId)}</select>
          </div>
          <div><div class="fl2">Sous-titre 1</div>
            <select class="fi" style="appearance:none" id="cc-sub1" onchange="svcBuilderCardConfig.subtitle1FieldId=this.value||null;updateCardPreview()">${fo(cc.subtitle1FieldId)}</select>
          </div>
          <div><div class="fl2">Sous-titre 2</div>
            <select class="fi" style="appearance:none" id="cc-sub2" onchange="svcBuilderCardConfig.subtitle2FieldId=this.value||null;updateCardPreview()">${fo(cc.subtitle2FieldId)}</select>
          </div>
        </div>
        <div style="width:250px;flex-shrink:0">
          <div class="fl2" style="margin-bottom:8px">Aperçu</div>
          <div id="card-preview-wrap">${buildCardPreviewHtml(cc,{tV,s1V,s2V})}</div>
        </div>
      </div>
    </div>` : '<div class="f-hint" style="padding:20px;text-align:center">Sélectionnez d\'abord un formulaire.</div>'}`;
}
function buildCardPreviewHtml(cc,{tV,s1V,s2V}){
  const c=cc.couleur||'#3b82f6';
  return `<div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)"><div style="height:4px;background:${c}"></div><div style="padding:12px 14px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><span style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--tl)"># REF-2026-0001</span><span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${c}20;color:${c};font-weight:800">Nouveau</span></div><div style="font-size:13px;font-weight:800;margin-bottom:4px">${h(tV)}</div>${s1V?`<div style="font-size:11.5px;color:var(--tl)">${h(s1V)}</div>`:''}${s2V?`<div style="font-size:11.5px;color:var(--tl)">${h(s2V)}</div>`:''}</div></div>`;
}
function updateCardPreview(){
  const wrap=document.getElementById('card-preview-wrap');if(!wrap)return;
  const f=svcBuilderFormId?FORMS_DATA.find(x=>x.id===svcBuilderFormId):null;if(!f)return;
  const fields=(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
  const cc=svcBuilderCardConfig;
  const tV=fields.find(x=>x.id===cc.titleFieldId)?.nom||'Titre...';
  const s1V=fields.find(x=>x.id===cc.subtitle1FieldId)?.nom||null;
  const s2V=fields.find(x=>x.id===cc.subtitle2FieldId)?.nom||null;
  wrap.innerHTML=buildCardPreviewHtml(cc,{tV,s1V,s2V});
}

// ── Onglet Vue Kanban ──
function renderSvcKanbanConfig(area) {
  area.innerHTML=`<div class="b-sec">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="b-sec-t" style="margin:0">Groupes de statuts (onglets kanban)</div>
      <button class="btn bp btn-sm pill" onclick="addKanbanGroup()">＋ Ajouter</button>
    </div>
    <div class="f-hint" style="margin-bottom:12px">Chaque groupe = un onglet dans le kanban. Les statuts cochés = les colonnes visibles. ↑↓ pour réordonner.</div>
    ${!svcBuilderKanbanGroups.length
      ?`<div style="text-align:center;padding:32px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px"><div style="font-size:24px;opacity:.3">⊞</div>Sans groupe, tous les statuts sont dans un seul onglet.</div>`
      :svcBuilderKanbanGroups.map((g,gi)=>`
        <div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
            <div class="tog ${g.visible?'on':'off'}" onclick="svcBuilderKanbanGroups[${gi}].visible=!svcBuilderKanbanGroups[${gi}].visible;renderSvcTab()" title="Visible"></div>
            <input class="ci" style="flex:1" value="${h(g.nom)}" oninput="svcBuilderKanbanGroups[${gi}].nom=this.value">
            <button class="ic-btn" onclick="moveKanbanGroup(${gi},-1)" ${gi===0?'disabled':''}>↑</button>
            <button class="ic-btn" onclick="moveKanbanGroup(${gi},1)" ${gi===svcBuilderKanbanGroups.length-1?'disabled':''}>↓</button>
            <button class="ic-btn" onclick="svcBuilderKanbanGroups.splice(${gi},1);renderSvcTab()">🗑</button>
          </div>
          <div class="fl2" style="margin-bottom:6px">Colonnes (statuts inclus)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${svcBuilderStatuses.map(s=>{const on=g.statusIds.includes(s.id);return`<label style="display:flex;align-items:center;gap:5px;padding:5px 11px;border:1.5px solid ${on?s.couleur:'var(--bd)'};border-radius:20px;cursor:pointer;font-size:12px;font-weight:700;background:${on?s.couleur+'18':'#fff'};color:${on?s.couleur:'var(--tm)'}"><input type="checkbox" ${on?'checked':''} style="display:none" onchange="toggleKanbanStatus(${gi},'${s.id}',this.checked)">${h(s.nom)}</label>`;}).join('')}
          </div>
        </div>`).join('')}
  </div>`;
}
function addKanbanGroup(){svcBuilderKanbanGroups.push({id:'kg'+Date.now(),nom:'Nouveau groupe',statusIds:[],visible:true,order:svcBuilderKanbanGroups.length});renderSvcTab();}
function moveKanbanGroup(gi,dir){const ni=gi+dir;if(ni<0||ni>=svcBuilderKanbanGroups.length)return;[svcBuilderKanbanGroups[gi],svcBuilderKanbanGroups[ni]]=[svcBuilderKanbanGroups[ni],svcBuilderKanbanGroups[gi]];renderSvcTab();}
function toggleKanbanStatus(gi,sid,checked){const g=svcBuilderKanbanGroups[gi];if(checked){if(!g.statusIds.includes(sid))g.statusIds.push(sid);}else g.statusIds=g.statusIds.filter(id=>id!==sid);renderSvcTab();}

// ── Onglet Statuts ──
function renderSvcStatuses(area) {
  const cnt = document.getElementById('svc-status-cnt');
  if (cnt) { cnt.textContent = svcBuilderStatuses.length; cnt.style.display = svcBuilderStatuses.length ? '' : 'none'; }
  area.innerHTML = `
    <div class="b-sec">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="b-sec-t" style="margin:0">Statuts</div>
        <button class="btn bp btn-sm pill" onclick="addSvcStatus()">＋ Ajouter</button>
      </div>
      ${!svcBuilderStatuses.length
        ? `<div style="text-align:center;padding:32px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px">
             <div style="font-size:24px;margin-bottom:8px;opacity:.3">◎</div>
             Ajoutez au moins 1 statut Initial et 1 statut Terminal.
           </div>`
        : svcBuilderStatuses.map((s, i) => `
          <div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;gap:10px;align-items:center">
            <div style="width:10px;height:10px;border-radius:50%;background:${s.couleur};flex-shrink:0"></div>
            <input class="ci" style="flex:1" value="${h(s.nom)}" placeholder="Nom du statut" oninput="svcBuilderStatuses[${i}].nom=this.value">
            <select class="ci" style="width:130px" onchange="svcBuilderStatuses[${i}].type=this.value">
              <option value="initial"  ${s.type==='initial' ?'selected':''}>Initial</option>
              <option value="normal"   ${s.type==='normal'  ?'selected':''}>Normal</option>
              <option value="terminal" ${s.type==='terminal'?'selected':''}>Terminal</option>
            </select>
            <input type="number" class="ci" style="width:65px;text-align:center" value="${s.position}" min="0" max="100" title="Position %" oninput="svcBuilderStatuses[${i}].position=+this.value">
            <div style="display:flex;gap:4px">
              ${COLORS.slice(0,6).map(c => `<div style="width:18px;height:18px;border-radius:4px;background:${c};cursor:pointer;
                border:2px solid ${s.couleur===c?'#fff':'transparent'};box-shadow:${s.couleur===c?'0 0 0 2px '+c:'none'};flex-shrink:0"
                onclick="svcBuilderStatuses[${i}].couleur='${c}';renderSvcTab()"></div>`).join('')}
            </div>
            <button class="ic-btn" onclick="svcBuilderStatuses.splice(${i},1);renderSvcTab()">🗑</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:4px 0 2px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:700;color:var(--tl);flex-shrink:0">Visible par :</span>
            ${renderVisibilitySelector(s.visibleBy||[], `_toggleStatusVis.bind(null,${i})`)}
          </div>
        </div>`).join('')}
    </div>
   <div class="f-hint">💡 "Initial" = statut à la création.</div>`;
}

function addSvcStatus() {
  svcBuilderStatuses.push({
    id: 's' + Date.now(), nom: 'Nouveau statut', couleur: '#64748b', position: 50,
    type: svcBuilderStatuses.find(s => s.type === 'initial') ? 'normal' : 'initial'
  });
  renderSvcTab();
}

// ── Onglet Actions ──
function renderSvcActions(area) {
  const cnt = document.getElementById('svc-action-cnt');
  if (cnt) { cnt.textContent = svcBuilderActions.length; cnt.style.display = svcBuilderActions.length ? '' : 'none'; }
  const ET = [{v:'change_status',l:'Changer le statut'},{v:'fill_form',l:'Remplir un formulaire'},{v:'assign',l:'Affecter'},{v:'send_email',l:'Envoyer un email'},{v:'comment',l:'Commenter'},{v:'edit_form',l:'Modifier le formulaire'},{v:'update_db_row', l:'Modifier une ligne (base de données)'}];
  const sOpts = svcBuilderStatuses.map(s=>`<option value="${s.id}">${h(s.nom)}</option>`).join('');
  const fOpts = FORMS_DATA.filter(f=>f.actif!==false).map(f=>`<option value="${f.id}">${h(f.nom)}</option>`).join('');
  area.innerHTML = `<div class="b-sec">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="b-sec-t" style="margin:0">Boutons d'action</div>
      <button class="btn bp btn-sm pill" onclick="addSvcAction()">＋ Ajouter</button>
    </div>
    ${!svcBuilderActions.length
      ?`<div style="text-align:center;padding:32px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px"><div style="font-size:24px;opacity:.3">◉</div>Aucun bouton.</div>`
      :svcBuilderActions.map((a,i)=>{
        const effects=a.effects||[{type:a.type||'change_status',config:a.config||{}}];
        return `<div style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:10px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
            <input class="ci" style="flex:1" value="${h(a.nom)}" oninput="svcBuilderActions[${i}].nom=this.value">
            <div style="display:flex;gap:4px">${COLORS.slice(0,6).map(c=>`<div style="width:18px;height:18px;border-radius:4px;background:${c};cursor:pointer;border:2px solid ${a.couleur===c?'#fff':'transparent'};box-shadow:${a.couleur===c?'0 0 0 2px '+c:'none'}" onclick="svcBuilderActions[${i}].couleur='${c}';renderSvcTab()"></div>`).join('')}</div>
            <button class="ic-btn" onclick="svcBuilderActions.splice(${i},1);renderSvcTab()">🗑</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;padding:4px 0 8px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:700;color:var(--tl);flex-shrink:0">Visible par :</span>
            ${renderVisibilitySelector(a.visibleBy||[], `_toggleActionVis.bind(null,${i})`)}
          </div>
          <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;margin-bottom:6px">Effets séquentiels</div>
          ${effects.map((ef,ei)=>`<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;background:var(--bg);border-radius:8px;padding:8px 10px">
            <span style="font-size:11px;font-weight:800;color:var(--tl);min-width:16px;margin-top:6px">${ei+1}</span>
            <div style="flex:1;display:flex;flex-direction:column;gap:6px">
              <select class="ci" onchange="updateEffect(${i},${ei},'type',this.value)">${ET.map(t=>`<option value="${t.v}" ${ef.type===t.v?'selected':''}>${t.l}</option>`).join('')}</select>
              ${ef.type==='change_status'?`<select class="ci" onchange="updateEffect(${i},${ei},'targetStatusId',this.value)"><option value="">— Statut cible —</option>${sOpts}</select>`:''}
              ${ef.type==='fill_form'?`<select class="ci" onchange="updateEffect(${i},${ei},'formId',+this.value)"><option value="">— Formulaire —</option>${fOpts}</select>`:''}
${ef.type==='update_db_row'? renderDbEffectHtml(i,ei,ef) :''}
            </div>
            <button class="ic-btn" onclick="removeEffect(${i},${ei})">✕</button>
          </div>`).join('')}
          <button style="width:100%;padding:6px;border-radius:7px;border:1.5px dashed var(--bd);background:transparent;color:var(--tm);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit" onclick="addEffect(${i})">＋ Ajouter un effet</button>
        </div>`;}).join('')}
  </div>`;
}
function updateEffect(ai,ei,key,val){if(!svcBuilderActions[ai].effects)svcBuilderActions[ai].effects=[];const ef=svcBuilderActions[ai].effects[ei];if(!ef)return;if(key==='type'){ef.type=val;ef.config={};renderSvcTab();}else if(key==='targetStatusId')ef.config={targetStatusId:val};else if(key==='formId'){
    const fid = String(val).startsWith('sdb_') ? val : +val;
    if(ef.type==='update_db_row'){ef.config={formId:fid,matchCriteria:[],updates:[]};renderSvcTab();}
    else ef.config={formId:fid};
  }
}
function addEffect(ai){(svcBuilderActions[ai].effects=svcBuilderActions[ai].effects||[{type:'change_status',config:{}}]).push({type:'change_status',config:{}});renderSvcTab();}
function removeEffect(ai,ei){svcBuilderActions[ai].effects.splice(ei,1);if(!svcBuilderActions[ai].effects.length)svcBuilderActions[ai].effects=[{type:'change_status',config:{}}];renderSvcTab();}

function addSvcAction() {
  svcBuilderActions.push({id:'a'+Date.now(), nom:'Nouvelle action', couleur:'#3b82f6', type:'change_status', config:{}});
  renderSvcTab();
}

// ── Onglet Flux (matrice) ──
function renderSvcFlux(area) {
  if (!svcBuilderStatuses.length || !svcBuilderActions.length) {
    area.innerHTML = `<div style="text-align:center;padding:60px;color:var(--tl)">
      <div style="font-size:32px;margin-bottom:12px;opacity:.3">⊞</div>
      Définissez d'abord des statuts et des actions.</div>`;
    return;
  }
  area.innerHTML = `
    <div class="b-sec">
      <div class="b-sec-t">Matrice Flux — Statuts × Actions</div>
      <div class="f-hint" style="margin-bottom:14px">✔ = bouton visible dans ce statut. Les statuts terminaux n'ont aucune action possible.</div>
      <div style="overflow-x:auto">
        <table style="border-collapse:collapse;font-size:12.5px;min-width:100%">
          <thead>
            <tr>
              <th style="padding:10px 14px;text-align:left;background:var(--bg);border:1px solid var(--bd);min-width:150px;
                font-size:10.5px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px">Statut ↓ / Action →</th>
              ${svcBuilderActions.map(a => `
                <th style="padding:8px 10px;text-align:center;background:var(--bg);border:1px solid var(--bd);min-width:110px">
                  <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
                    <div style="width:10px;height:10px;border-radius:50%;background:${a.couleur}"></div>
                    <span style="font-size:11px;font-weight:700;color:var(--tx)">${h(a.nom)}</span>
                  </div>
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${svcBuilderStatuses.map(s => {
              const isTerminal = s.type === 'terminal';
              return `<tr style="background:${isTerminal?'var(--bg)':'#fff'}">
                <td style="padding:10px 14px;border:1px solid var(--bd);font-weight:700">
                  <div style="display:flex;align-items:center;gap:7px">
                    <div style="width:9px;height:9px;border-radius:50%;background:${s.couleur};flex-shrink:0"></div>
                    ${h(s.nom)}
                    ${s.type==='initial'?'<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:var(--pl);color:var(--p);font-weight:800">Initial</span>':''}
                    ${isTerminal?'<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:var(--sl);color:var(--s);font-weight:800">Terminal</span>':''}
                  </div>
                </td>
                ${svcBuilderActions.map(a => {
                  const enabled = svcBuilderFlux.find(f => f.statusId===s.id && f.actionId===a.id)?.enabled;
                  return `<td style="padding:10px;text-align:center;border:1px solid var(--bd)">
                    ${isTerminal
                      ? `<span style="color:var(--tl)">—</span>`
                      : `<input type="checkbox" ${enabled?'checked':''} style="width:17px;height:17px;accent-color:${a.couleur};cursor:pointer"
                           onchange="toggleFlux('${s.id}','${a.id}',this.checked)">`}
                  </td>`;
                }).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function toggleFlux(statusId, actionId, enabled) {
  const existing = svcBuilderFlux.find(f => f.statusId===statusId && f.actionId===actionId);
  if (existing) existing.enabled = enabled;
  else svcBuilderFlux.push({statusId, actionId, enabled});
}

// ── Sauvegarde service ──
function saveService(quit) {
  const nom = document.getElementById('sb2-name')?.value || document.getElementById('svc-nom')?.value || '';
  if (!nom.trim())                                    { toast('e','⚠️ Nom obligatoire'); return; }
  if (!svcBuilderFormId)                              { toast('e','⚠️ Sélectionnez un formulaire'); setSvcTab('gen'); return; }
  if (!svcBuilderStatuses.find(s=>s.type==='initial')){ toast('e','⚠️ Ajoutez 1 statut Initial'); setSvcTab('statuses'); return; }
  if (!svcBuilderStatuses.find(s=>s.type==='terminal')){ toast('e','⚠️ Ajoutez 1 statut Terminal'); setSvcTab('statuses'); return; }
  const desc    = document.getElementById('svc-desc')?.value || '';
  const pattern = document.getElementById('svc-pattern')?.value || 'SVC-{YYYY}-{0000}';
  const data = {
    id:       curService ? curService.id : Date.now(),
    nom:      nom.trim(), desc, couleur: svcBuilderColor,
    formId:   svcBuilderFormId, idPattern: pattern, actif: true,
    statuses:      JSON.parse(JSON.stringify(svcBuilderStatuses)),
    actions:       JSON.parse(JSON.stringify(svcBuilderActions)),
    flux:          JSON.parse(JSON.stringify(svcBuilderFlux)),
    cardConfig:    JSON.parse(JSON.stringify(svcBuilderCardConfig)),
    kanbanGroups:  JSON.parse(JSON.stringify(svcBuilderKanbanGroups)),
  };
  if (curService) {
    const i = SERVICES_DATA.findIndex(s => s.id === curService.id);
    if (i > -1) SERVICES_DATA[i] = data; else SERVICES_DATA.push(data);
    curService = data;
  } else {
    SERVICES_DATA.push(data);
    curService = data;
  }
  // Sauvegarde Supabase du service
  if (typeof DB !== 'undefined' && typeof serviceToDb === 'function') {
    const payload = serviceToDb(data);
    const savePromise = curService && curService.id && String(curService.id).length < 12
      ? DB.updateService(curService.id, payload)
      : DB.createService(payload).then(rows => {
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (row && row.id) { data.id = row.id; curService.id = row.id; }
        });
    savePromise.catch(e => console.warn('[DB] Service non sauvegardé:', e.message));
  }
  toast('s','✅ Service enregistré');
  if (quit) setTimeout(() => goServices(), 400);
}

// ══ INSTANCES (DEMANDES) ══
function generateRef(svc) {
  if (!SVC_COUNTERS[svc.id]) SVC_COUNTERS[svc.id] = 0;
  SVC_COUNTERS[svc.id]++;
  const n = String(SVC_COUNTERS[svc.id]).padStart(4,'0');
  return (svc.idPattern || 'SVC-{YYYY}-{0000}')
    .replace('{YYYY}', new Date().getFullYear())
    .replace('{0000}', n);
}

function openServiceInstances(id) {
  const svc = SERVICES_DATA.find(s => s.id === id); if (!svc) return;
  curService = svc;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goServices()">▶ Services</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(svc.nom)}</span>`;
  document.getElementById('tb-t').textContent = svc.nom;
  renderServiceInstances(svc);
  show('v-service-instances');
}

function renderServiceInstances(svc) {
  const color = svc.couleur || '#3b82f6';
  const instances = SERVICE_INSTANCES_DATA.filter(i => i.serviceId === svc.id).reverse();
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <div style="font-size:17px;font-weight:800">${h(svc.nom)}</div>
      <div style="font-size:12px;color:var(--tl);margin-top:2px">${instances.length} demande${instances.length>1?'s':''}</div>
    </div>
    <button class="btn bp" onclick="openCreateInstance(${svc.id})" style="background:${color};border-color:${color}">＋ Nouvelle demande</button>
  </div>`;
  if (!instances.length) {
    html += `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">
      <div style="font-size:32px;margin-bottom:10px">📭</div>Aucune demande. Créez-en une.</div>`;
  } else {
    html += instances.map(inst => {
      const status = svc.statuses.find(s => s.id === inst.currentStatusId);
      const title  = getInstanceTitle(svc, inst);
      return `<div onclick="openInstanceDetail(${inst.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:14px 18px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:all .15s"
        onmouseover="this.style.borderColor='${color}';this.style.boxShadow='0 2px 10px rgba(0,0,0,.08)'"
        onmouseout="this.style.borderColor='var(--bd)';this.style.boxShadow='none'">
        <div style="font-size:11.5px;font-weight:800;font-family:'DM Mono',monospace;color:var(--tl);min-width:130px">${h(inst.reference)}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${h(title)}</div>
          <div style="font-size:11px;color:var(--tl);margin-top:2px">${inst.createdAt}</div>
        </div>
        ${status ? `<span style="padding:4px 12px;border-radius:20px;font-size:11px;font-weight:800;background:${status.couleur}22;color:${status.couleur}">${h(status.nom)}</span>` : ''}
        <div style="color:var(--tl);font-size:18px">›</div>
      </div>`;
    }).join('');
  }
  document.getElementById('svc-instances-wrap').innerHTML = html;
}

function getInstanceTitle(svc, inst) {
  const f = FORMS_DATA.find(x => x.id === svc.formId);
  const sub = SUBMISSIONS_DATA.find(s => s.id === inst.submissionId);
  if (!f || !sub) return inst.reference;
  const firstText = f.fields.find(fld => fld.type === 'text');
  return (firstText && sub.values[firstText.id]) ? sub.values[firstText.id] : inst.reference;
}

function openCreateInstance(svcId) {
  const svc = SERVICES_DATA.find(s => s.id === svcId); if (!svc) return;
  const f = FORMS_DATA.find(x => x.id === svc.formId);
  if (!f) { toast('e','⚠️ Formulaire introuvable — configurez le service'); return; }
  curService = svc; curSaisieFormId = f.id; saisieValues = {};
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="openServiceInstances(${svc.id})">▶ ${h(svc.nom)}</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">Nouvelle demande</span>`;
  document.getElementById('tb-t').textContent = svc.nom;
  renderSaisieForm(f);
  // patch le bouton submit
  const btn = document.getElementById('btn-submit-saisie');
  if (btn) btn.onclick = () => submitServiceInstance(f, svc);
  show('v-saisie');
}

async function submitServiceInstance(f, svc) {
  const errors = (f.fields||[]).filter(fld => {
    if (!saisieEvalCond(fld, f.fields)) return false;
    if (!fld.obligatoire) return false;
    const v = saisieValues[fld.id];
    return v===undefined||v===''||v===false||(Array.isArray(v)&&!v.length);
  });
  if (errors.length) { toast('e','⚠️ '+errors.length+' champ(s) obligatoire(s)'); return; }

  const initialStatus = svc.statuses.find(s => s.type === 'initial');
  const nowIso = new Date().toISOString();
  const now = new Date().toLocaleString('fr-FR');
  const device = (typeof isPadMode === 'function' && isPadMode()) ? 'pad' : 'desktop';
  const userLabel = device === 'pad' ? '📱 PAD Terrain' : 'Picot Clément';
  const ref = generateRef(svc);

  let subId = Date.now();
  let instId = subId + 1;

  try {
    if (typeof DB !== 'undefined') {
      const dbSub = await DB.createSubmission(f.id, {...saisieValues}, device);
      if (dbSub && dbSub.id) subId = dbSub.id;
    }
  } catch(e) {
    console.warn('[DB] Saisie service non sauvegardée:', e.message);
  }

  const newSub = {id:subId, formId:f.id, formNom:f.nom, date:nowIso, dateLabel:now, utilisateur:userLabel, values:{...saisieValues}};
  if (!SUBMISSIONS_DATA.some(x => x.id == newSub.id)) SUBMISSIONS_DATA.push(newSub);
  f.resp = (f.resp||0) + 1;

  const newInst = {
    id: instId, serviceId: svc.id, reference: ref, submissionId: subId,
    currentStatusId: initialStatus ? initialStatus.id : svc.statuses[0]?.id,
    assignedTo: null, priority: 'normal', createdBy: userLabel, createdAt: now,
    events: [{id: Date.now(), type:'created', actor:userLabel, at: now, payload:{}}]
  };

  try {
    if (typeof DB !== 'undefined' && typeof instanceToDb === 'function') {
      const rows = await DB.createInstance(instanceToDb(newInst, device));
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row && row.id) newInst.id = row.id;
    }
  } catch(e) {
    console.warn('[DB] Demande service non sauvegardée:', e.message);
  }

  if (!SERVICE_INSTANCES_DATA.some(x => x.id == newInst.id)) SERVICE_INSTANCES_DATA.push(newInst);
  toast('s', `✅ Demande ${ref} créée`);
  setTimeout(() => openInstanceDetail(newInst.id), 500);
}
// ── Détail d'une demande ──
function openInstanceDetail(id) {
  const inst = SERVICE_INSTANCES_DATA.find(x => x.id === id); if (!inst) return;
  const svc  = SERVICES_DATA.find(s => s.id === inst.serviceId); if (!svc) return;
  curService = svc; curInstanceId = id;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goServices()">▶ Services</span><span style="color:var(--tl);margin:0 4px">/</span><span class="bc-link" onclick="openServiceInstances(${svc.id})">${h(svc.nom)}</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(inst.reference)}</span>`;
  document.getElementById('tb-t').textContent = inst.reference;
  renderInstanceDetail(inst, svc);
  show('v-service-instance-detail');
}

function renderInstanceDetail(inst, svc) {
  const color = svc.couleur || '#3b82f6';
  const f   = FORMS_DATA.find(x => x.id === svc.formId);
  const sub = SUBMISSIONS_DATA.find(s => s.id === inst.submissionId);
  const currentStatus = svc.statuses.find(s => s.id === inst.currentStatusId);
  const availableActions = svc.actions.filter(a =>
    svc.flux.find(fl => fl.statusId===inst.currentStatusId && fl.actionId===a.id && fl.enabled)
  );

  // ── Panneau principal ──
  let main = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:22px;margin-bottom:16px">`;
  main += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:14px;border-bottom:2px solid var(--bd)">
    <div style="width:5px;height:42px;border-radius:3px;background:${color};flex-shrink:0"></div>
    <div style="flex:1">
      <div style="font-size:16px;font-weight:800">${h(inst.reference)}</div>
      <div style="font-size:11px;color:var(--tl);margin-top:2px">${h(svc.nom)} — ${inst.createdAt}</div>
    </div>
    ${currentStatus ? `<span style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:800;background:${currentStatus.couleur}22;color:${currentStatus.couleur}">${h(currentStatus.nom)}</span>` : ''}
  </div>`;

  // Données formulaire
  if (f && sub) {
    const fields = (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));
    main += `<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px">Données du formulaire</div>`;
    fields.forEach(fld => {
      const v = sub.values[fld.id];
      const val = Array.isArray(v) ? v.join(', ') : (v||'—');
      main += `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--bg)">
        <div style="font-size:11.5px;color:var(--tl);width:140px;flex-shrink:0">${h(fld.nom)}</div>
        <div style="font-size:12.5px;font-weight:600;color:${val==='—'?'var(--tl)':'var(--tx)'}">${h(val)}</div>
      </div>`;
    });
    main += `</div>`;
  }

  // Boutons d'action
  if (availableActions.length) {
    main += `<div style="margin-bottom:18px"><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px">Actions disponibles</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">`;
    availableActions.forEach(a => {
      main += `<button onclick="executeAction(${inst.id},'${a.id}')"
        style="padding:8px 20px;border-radius:8px;border:none;background:${a.couleur};color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s"
        onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">${h(a.nom)}</button>`;
    });
    main += `</div></div>`;
  } else if (currentStatus && currentStatus.type === 'terminal') {
    main += `<div style="padding:12px;background:var(--sl);border-radius:8px;color:var(--s);font-size:12.5px;font-weight:700;text-align:center;margin-bottom:18px">✅ Demande clôturée</div>`;
  }

  // Zone commentaire
  main += `<div><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px">Commentaire</div>
    <textarea id="comment-input-${inst.id}" style="width:100%;border:1.5px solid var(--bd);border-radius:8px;padding:10px;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;resize:none;height:72px;outline:none;box-sizing:border-box;transition:border-color .15s" placeholder="Votre commentaire..."
      onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='var(--bd)'"></textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:8px">
      <button onclick="addComment(${inst.id})" style="padding:7px 18px;border-radius:8px;border:none;background:${color};color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit">Envoyer</button>
    </div>
  </div></div>`;

  document.getElementById('sid-main').innerHTML = main;
  renderInstanceHistory(inst, svc);
}

function renderInstanceHistory(inst, svc) {
  const ICONS = {created:'✏️', status_changed:'🔄', commented:'💬', assigned:'👤', form_filled:'📋', email_sent:'📧', db_updated:'🗃'};
const LABELS = {created:'Demande créée', status_changed:'Statut modifié', commented:'Commentaire', assigned:'Affectation', form_filled:'Formulaire rempli', email_sent:'Email envoyé', db_updated:'Base de données mise à jour'};
  const events = [...(inst.events||[])].reverse();
  let html = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);padding:16px;position:sticky;top:0">
    <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">Historique</div>`;
  events.forEach((ev, i) => {
    html += `<div style="display:flex;gap:9px;${i<events.length-1?'margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--bg)':''}">
      <div style="width:28px;height:28px;border-radius:8px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">${ICONS[ev.type]||'•'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700">${LABELS[ev.type]||ev.type}</div>
        ${ev.payload?.comment    ? `<div style="font-size:11.5px;color:var(--tm);margin-top:2px;font-style:italic">"${h(ev.payload.comment)}"</div>` : ''}
        ${ev.payload?.fromStatus ? `<div style="font-size:11px;color:var(--tl);margin-top:2px">${h(ev.payload.fromStatus)} → ${h(ev.payload.toStatus)}</div>` : ''}
        ${ev.payload?.toUser     ? `<div style="font-size:11px;color:var(--tl);margin-top:2px">→ ${h(ev.payload.toUser)}</div>` : ''}
        <div style="font-size:11px;color:var(--tl);margin-top:1px">${ev.actor} · ${ev.at}</div>
      </div>
    </div>`;
  });
  html += `</div>`;
  document.getElementById('sid-history').innerHTML = html;
}

// ── Exécuter une action ──
function executeAction(instId, actionId) {
  const inst=SERVICE_INSTANCES_DATA.find(x=>x.id===instId);if(!inst)return;
  const svc=SERVICES_DATA.find(s=>s.id===inst.serviceId);if(!svc)return;
  const action=svc.actions.find(a=>a.id===actionId);if(!action)return;
  const effects=action.effects||(action.type?[{type:action.type,config:action.config||{}}]:[]);
  const now=new Date().toLocaleString('fr-FR');
  if(effects.some(ef=>ef.type==='comment')){const inp=document.getElementById('comment-input-'+instId);if(!inp||!inp.value.trim()){toast('e','⚠️ Ce bouton requiert un commentaire');inp&&inp.focus();return;}}
  effects.forEach(ef=>{
    if(ef.type==='change_status'){const from=svc.statuses.find(s=>s.id===inst.currentStatusId);const to=svc.statuses.find(s=>s.id===ef.config?.targetStatusId);if(!to){toast('e','⚠️ Statut cible manquant');return;}inst.currentStatusId=to.id;inst.events.push({id:Date.now(),type:'status_changed',actor:'Picot Clément',at:now,payload:{fromStatus:from?.nom,toStatus:to.nom}});toast('s',`🔄 → ${to.nom}`);}
    else if(ef.type==='comment'){const inp=document.getElementById('comment-input-'+instId);const txt=inp?inp.value.trim():'';if(!txt)return;inst.events.push({id:Date.now(),type:'commented',actor:'Picot Clément',at:now,payload:{comment:txt}});if(inp)inp.value='';toast('s','💬 Commentaire ajouté');}
    else if(ef.type==='assign'){const who=prompt('Affecter à :');if(!who)return;inst.assignedTo=who;inst.events.push({id:Date.now(),type:'assigned',actor:'Picot Clément',at:now,payload:{toUser:who}});toast('s',`👤 → ${who}`);}
    else if(ef.type==='fill_form'){const f=FORMS_DATA.find(x=>x.id===ef.config?.formId);if(!f){toast('e','⚠️ Formulaire introuvable');return;}openLinkedFormModal(inst,svc,action,f);}
    else if(ef.type==='send_email'){inst.events.push({id:Date.now(),type:'email_sent',actor:'Picot Clément',at:now,payload:{}});toast('s','📧 Email envoyé');}
    else if(ef.type==='edit_form'){toast('i','ℹ️ Disponible en V2');}
    else if(ef.type==='update_db_row'){
      const targetFid=ef.config?.formId;
      if(!targetFid){toast('e','⚠️ Base non configurée');return;}
      const svcSub=SUBMISSIONS_DATA.find(s=>s.id===inst.submissionId);
      const criteria=ef.config?.matchCriteria||[];
      const updates=ef.config?.updates||[];
      if(!updates.length){toast('w','⚠️ Aucune modification définie');return;}
      const isSdb=String(targetFid).startsWith('sdb_');
      let matched=[], dbName='';
      if(isSdb){
        const sdb=DATABASES_DATA.find(x=>x.id===parseInt(String(targetFid).replace('sdb_','')));
        if(!sdb){toast('e','⚠️ Base introuvable');return;}
        dbName=sdb.nom;
        matched=criteria.length?sdb.rows.filter(row=>criteria.every(c=>{
          if(!c.dbFieldId)return true;
          const dbVal=String(row.values[c.dbFieldId]||'');
          const srcVal=c.sourceType==='form_field'?String(svcSub?.values[c.sourceFieldId]||''):String(c.value||'');
          return dbVal===srcVal;
        })):sdb.rows;
        if(!matched.length){toast('w','⚠️ Aucune ligne correspondante');return;}
        matched.forEach(row=>{updates.forEach(u=>{if(!u.dbFieldId)return;row.values[u.dbFieldId]=u.sourceType==='form_field'?(svcSub?.values[u.sourceFieldId]||''):(u.value||'');});});
      } else {
        dbName=FORMS_DATA.find(x=>x.id===targetFid)?.nom||'';
        const targetRows=SUBMISSIONS_DATA.filter(s=>s.formId===targetFid);
        matched=criteria.length?targetRows.filter(row=>criteria.every(c=>{
          if(!c.dbFieldId)return true;
          const dbVal=String(row.values[c.dbFieldId]||'');
          const srcVal=c.sourceType==='form_field'?String(svcSub?.values[c.sourceFieldId]||''):String(c.value||'');
          return dbVal===srcVal;
        })):targetRows;
        if(!matched.length){toast('w','⚠️ Aucune ligne correspondante');return;}
        matched.forEach(row=>{updates.forEach(u=>{if(!u.dbFieldId)return;row.values[u.dbFieldId]=u.sourceType==='form_field'?(svcSub?.values[u.sourceFieldId]||''):(u.value||'');});});
      }
      inst.events.push({id:Date.now(),type:'db_updated',actor:'Picot Clément',at:now,payload:{db:dbName,lignes:matched.length}});
      toast('s',`🗃 ${matched.length} ligne${matched.length>1?'s':''} mise${matched.length>1?'s à jour':' à jour'}`);
    }
  });
  if (typeof DB !== 'undefined' && typeof instanceToDb === 'function') {
    DB.updateInstance(inst.id, instanceToDb(inst, (typeof isPadMode === 'function' && isPadMode()) ? 'pad' : 'desktop'))
      .catch(e => console.warn('[DB] Action service non sauvegardée:', e.message));
  }
  const isKanban=document.getElementById('v-service-kanban')?.classList.contains('on');
  if(isKanban)renderKanbanBoard(svc,curKanbanGroupId);else renderInstanceDetail(inst,svc);
}
// ── Navigation production services ──
function goProdServices(){
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-prod-services').classList.add('on');
  show('v-prod-services-list');
  document.getElementById('tb-t').textContent='Services';
  document.getElementById('breadcrumb').innerHTML='<span style="color:var(--tl)">▶ Production / Services</span>';
  renderProdServices();
}
function renderProdServices(list){
  list=(list||SERVICES_DATA).filter(s=>s.actif!==false);
  const grid=document.getElementById('prod-services-grid');
  if(!list.length){grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--tl)"><div style="font-size:32px;opacity:.3">⚡</div>Aucun service actif.</div>`;return;}
  grid.innerHTML=list.map(svc=>{const all=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id);const open=all.filter(i=>!isTerminalStatus(svc,i.currentStatusId)).length;const c=svc.couleur||'#3b82f6';return`<div onclick="openServiceKanban(${svc.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${c}';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--bd)';this.style.transform=''"><div style="height:5px;background:${c}"></div><div style="padding:16px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="width:36px;height:36px;border-radius:9px;background:${c}22;display:flex;align-items:center;justify-content:center;font-size:18px">⚡</div><div style="flex:1"><div style="font-weight:800;font-size:14px">${h(svc.nom)}</div>${svc.desc?`<div style="font-size:11px;color:var(--tl)">${h(svc.desc)}</div>`:''}</div></div><div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between"><div><span style="font-size:15px;font-weight:800">${open}</span><span style="font-size:11px;color:var(--tl)"> en cours / ${all.length} total</span></div><div style="padding:5px 14px;border-radius:20px;background:${c};color:#fff;font-size:12px;font-weight:700">Ouvrir →</div></div></div></div>`;}).join('');
}
function searchProdServices(q){renderProdServices(SERVICES_DATA.filter(s=>s.nom.toLowerCase().includes(q.toLowerCase())));}
function openServiceKanban(svcId){
  const svc=SERVICES_DATA.find(s=>s.id===svcId);if(!svc)return;curService=svc;
  const groups=(svc.kanbanGroups||[]).filter(g=>g.visible).sort((a,b)=>a.order-b.order);
  curKanbanGroupId=groups.length?groups[0].id:'__all__';
  document.getElementById('breadcrumb').innerHTML=`<span class="bc-link" onclick="goProdServices()">▶ Production / Services</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(svc.nom)}</span>`;
  document.getElementById('tb-t').textContent=svc.nom;
  renderKanbanTabs(svc);renderKanbanBoard(svc,curKanbanGroupId);show('v-service-kanban');
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-prod-services').classList.add('on');
}
function renderKanbanTabs(svc){
  const groups=(svc.kanbanGroups||[]).filter(g=>g.visible).sort((a,b)=>a.order-b.order);
  const el=document.getElementById('kanban-group-tabs');if(!groups.length){el.innerHTML='';return;}
  el.innerHTML=groups.map(g=>{const cnt=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id&&g.statusIds.includes(i.currentStatusId)).length;const on=g.id===curKanbanGroupId;return`<div onclick="curKanbanGroupId='${g.id}';renderKanbanTabs(curService);renderKanbanBoard(curService,'${g.id}')" style="padding:12px 20px;font-size:13px;font-weight:700;cursor:pointer;border-bottom:3px solid ${on?'var(--p)':'transparent'};color:${on?'var(--p)':'var(--tl)'};white-space:nowrap;display:flex;align-items:center;gap:7px">${h(g.nom)}<span style="font-size:11px;font-weight:800;padding:1px 7px;border-radius:20px;background:${on?'var(--pl)':'#f1f5f9'};color:${on?'var(--p)':'var(--tl)'}">${cnt}</span></div>`;}).join('');
}
function renderKanbanBoard(svc,groupId){
  const board=document.getElementById('kanban-board');if(!board)return;
  const groups=(svc.kanbanGroups||[]).filter(g=>g.visible).sort((a,b)=>a.order-b.order);
  const statusIds=groups.length?(groups.find(g=>g.id===groupId)?.statusIds||[]):svc.statuses.map(s=>s.id);
  const cols=svc.statuses.filter(s=>statusIds.includes(s.id));
  if(!cols.length){board.innerHTML=`<div style="color:var(--tl);padding:40px">Aucun statut dans ce groupe.</div>`;return;}
  board.innerHTML=cols.map(status=>{
    const instances=SERVICE_INSTANCES_DATA.filter(i=>i.serviceId===svc.id&&i.currentStatusId===status.id);
    return`<div style="min-width:280px;max-width:320px;flex-shrink:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:10px 14px;background:#fff;border-radius:10px;border:1.5px solid var(--bd);border-left:4px solid ${status.couleur}">
        <span style="font-size:13px;font-weight:800">${h(status.nom)}</span>
        <span style="font-size:11px;font-weight:800;padding:1px 8px;border-radius:20px;background:${status.couleur}20;color:${status.couleur};margin-left:auto">${instances.length}</span>
        <button onclick="openCreateInstance(${svc.id})" style="width:24px;height:24px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;cursor:pointer;font-size:14px;color:var(--tl)" title="Nouvelle demande">＋</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;min-height:60px">
        ${instances.length?instances.map(inst=>buildKanbanCardHtml(inst,svc,status)).join(''):`<div style="border:2px dashed var(--bd);border-radius:8px;padding:20px;text-align:center;color:var(--tl);font-size:12px">Aucune demande</div>`}
      </div>
    </div>`;
  }).join('');
}
function buildKanbanCardHtml(inst,svc,status){
  const cc=svc.cardConfig||{};const sub=SUBMISSIONS_DATA.find(s=>s.id===inst.submissionId);const c=cc.couleur||svc.couleur||'#3b82f6';
  const gv=fid=>{if(!fid||!sub)return null;const v=sub.values[fid];return Array.isArray(v)?v.join(', '):(v||null);};
  const tV=gv(cc.titleFieldId)||inst.reference;const s1=gv(cc.subtitle1FieldId);const s2=gv(cc.subtitle2FieldId);
  const acts=svc.actions.filter(a=>svc.flux.find(fl=>fl.statusId===status.id&&fl.actionId===a.id&&fl.enabled));
  return`<div onclick="openInstanceDetail(${inst.id})" style="background:#fff;border:1.5px solid var(--bd);border-radius:10px;overflow:hidden;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${c}'" onmouseout="this.style.borderColor='var(--bd)'">
    <div style="height:3px;background:${c}"></div>
    <div style="padding:11px 13px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--tl)">${h(inst.reference)}</span>
        ${inst.assignedTo?`<span style="font-size:10px;padding:1px 7px;border-radius:20px;background:var(--pl);color:var(--p)">👤 ${h(inst.assignedTo)}</span>`:''}
      </div>
      <div style="font-size:13px;font-weight:800;margin-bottom:3px">${h(tV)}</div>
      ${s1?`<div style="font-size:11.5px;color:var(--tl)">${h(s1)}</div>`:''}
      ${s2?`<div style="font-size:11.5px;color:var(--tl)">${h(s2)}</div>`:''}
      ${acts.length?`<div onclick="event.stopPropagation()" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;padding-top:8px;border-top:1px solid var(--bg)">${acts.map(a=>`<button onclick="event.stopPropagation();executeAction(${inst.id},'${a.id}')" style="padding:4px 10px;border-radius:6px;border:none;background:${a.couleur};color:#fff;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">${h(a.nom)}</button>`).join('')}</div>`:''}
    </div>
  </div>`;
}
