// ══ PicoTrack — Supabase Client ══
const SUPA_URL = 'https://jcanufkmcslxwmheqccp.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjYW51ZmttY3NseHdtaGVxY2NwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NjAyNDksImV4cCI6MjA5NDIzNjI0OX0.Vt9ZhmEZ0HaBiByRTOHYm65doZn5z09Cjg4AvzntgMU';

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer !== undefined ? options.prefer : 'return=representation',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) {
    _ptSupabaseOnline = false;
    updateSupabaseStatusUI('offline', `Supabase ${res.status}`);
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  _ptSupabaseOnline = true;
  _ptLastSyncLabel = new Date().toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  updateSupabaseStatusUI('online', 'Supabase connecté');
  return text ? JSON.parse(text) : [];
}


function _ptIsResetArtifactServiceSupabase(s){
  const nom = String((s && (s.nom || s.name)) || '').trim().toLowerCase();
  const desc = String((s && (s.description || s.desc)) || '').toLowerCase();
  return nom === 'nouvelle mission' || desc.includes('mission builder') || desc.includes('process builder');
}
function _ptFilterResetServices(rows){ return (rows || []).filter(r => !_ptIsResetArtifactServiceSupabase(r)); }

const DB = {
  async getForms() { return sbFetch('forms?select=*&order=created_at.asc'); },
  async createForm(data) { return sbFetch('forms', { method:'POST', body:JSON.stringify(data) }); },
  async updateForm(id, data) { return sbFetch(`forms?id=eq.${id}`, { method:'PATCH', body:JSON.stringify(data) }); },
  async deleteForm(id) { return sbFetch(`forms?id=eq.${id}`, { method:'DELETE', prefer:'' }); },

  async getSubmissions(formId) { return sbFetch(`submissions?form_id=eq.${formId}&select=*&order=created_at.desc`); },
  async getAllSubmissions(since) {
    const q = since ? `submissions?select=*&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}` : `submissions?select=*&order=created_at.desc&limit=500`;
    return sbFetch(q);
  },
  async createSubmission(formId, values, device='desktop') {
    const rows = await sbFetch('submissions', { method:'POST', body:JSON.stringify({ form_id: formId, values, device }) });
    return Array.isArray(rows) ? rows[0] : rows;
  },

  async getServices() { return sbFetch('services?select=*&order=created_at.asc'); },
  async createService(data) { return sbFetch('services', { method:'POST', body:JSON.stringify(data) }); },
  async updateService(id, data) { return sbFetch(`services?id=eq.${id}`, { method:'PATCH', body:JSON.stringify(data) }); },

  async getAllInstances(since) {
    const q = since ? `service_instances?select=*&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}` : `service_instances?select=*&order=created_at.desc&limit=500`;
    return sbFetch(q);
  },
  async getInstances(serviceId) { return sbFetch(`service_instances?service_id=eq.${serviceId}&select=*&order=created_at.desc`); },
  async createInstance(data) { return sbFetch('service_instances', { method:'POST', body:JSON.stringify(data) }); },
  async updateInstance(id, data) { return sbFetch(`service_instances?id=eq.${id}`, { method:'PATCH', body:JSON.stringify({ ...data, updated_at:new Date().toISOString() }) }); },
};

function mapFormFromDb(r){
  const modules = r.modules || [];
  return {
    id:r.id,
    nom:r.nom,
    desc:r.description||'',
    couleur:r.couleur||'#3b82f6',
    actif:r.actif!==false,
    type:modules,
    modules:modules,
    fields:r.fields||[],
    resp:0,
    visibleRoles:r.visible_roles||[],
    triggers:r.triggers||{}
  };
}
function formToDb(f){
  return {
    nom:f.nom,
    description:f.desc||'',
    couleur:f.couleur||'#3b82f6',
    actif:f.actif!==false,
    modules:f.type||f.modules||[],
    fields:f.fields||[],
    visible_roles:f.visibleRoles||f.visible_roles||[],
    triggers:f.triggers||{}
  };
}
function mapServiceFromDb(r){
  return { id:r.id, nom:r.nom, desc:r.description||'', couleur:r.couleur||'#3b82f6', actif:r.actif!==false, formId:r.form_id||r.formId||null, idPattern:r.id_pattern||'SVC-{YYYY}-{0000}', statuses:r.statuses||[], actions:r.actions||[], flux:r.flux||[], cardConfig:r.card_config||{}, kanbanGroups:r.kanban_groups||[] };
}
function mapSubmissionFromDb(r){
  return { id:r.id, formId:r.form_id, formNom:'', date:r.created_at, dateLabel:new Date(r.created_at).toLocaleString('fr-FR'), utilisateur:r.device==='pad'?'📱 PAD Terrain':'Picot Clément', values:r.values||{} };
}
function mapInstanceFromDb(r){
  const fd = r.form_data || {};
  return { id:r.id, serviceId:r.service_id, reference:r.ref, submissionId:fd.submissionId||fd.submission_id||null, currentStatusId:r.status_id, assignedTo:fd.assignedTo||null, priority:r.priority||'normal', createdBy:fd.createdBy||fd.created_by||(r.device==='pad'?'PAD Terrain':'Picot Clément'), createdAt:fd.createdAt||new Date(r.created_at).toLocaleString('fr-FR'), events:r.events||[] };
}
function serviceToDb(s){
  return { nom:s.nom, description:s.desc||'', couleur:s.couleur||'#3b82f6', actif:s.actif!==false, form_id:s.formId||null, id_pattern:s.idPattern||'SVC-{YYYY}-{0000}', statuses:s.statuses||[], actions:s.actions||[], flux:s.flux||[], card_config:s.cardConfig||{}, kanban_groups:s.kanbanGroups||[] };
}
function instanceToDb(inst, device='desktop'){
  return { service_id:inst.serviceId, ref:inst.reference, form_data:{ submissionId:inst.submissionId, createdBy:inst.createdBy, createdAt:inst.createdAt, assignedTo:inst.assignedTo }, status_id:inst.currentStatusId, priority:inst.priority||'normal', events:inst.events||[], device };
}



// ══ Gestion licences / quotas ══
function getCurrentEnvironmentCodeForLicenses(){
  try {
    const pc = JSON.parse(localStorage.getItem('pt_pc_session') || 'null');
    if (pc && pc.scope === 'all_environments') {
      return localStorage.getItem('pt_admin_env') || 'DEMO';
    }
    if (pc && pc.environment_code && pc.environment_code !== '*') return pc.environment_code;
  } catch(e) {}
  try {
    const pad = JSON.parse(localStorage.getItem('pt_pad') || 'null');
    if (pad && pad.code) return pad.code;
  } catch(e) {}
  return 'DEMO';
}

function setAdminEnvironmentCode(code){
  localStorage.setItem('pt_admin_env', (code || 'DEMO').toUpperCase().trim());
}

function getCurrentPcUser(){
  try { return JSON.parse(localStorage.getItem('pt_pc_session') || 'null'); } catch(e) { return null; }
}

function isSuperAdmin(){
  const u = getCurrentPcUser();
  return !!(u && u.role === 'super_admin' && u.scope === 'all_environments');
}

async function hashPassword(text){
  const msg = new TextEncoder().encode(text || '');
  const buf = await crypto.subtle.digest('SHA-256', msg);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

DB.getLicenseLimits = async function(environmentCode){
  const rows = await sbFetch(`environment_license_limits?environment_code=eq.${encodeURIComponent(environmentCode)}&select=*&limit=1`);
  return rows && rows.length ? rows[0] : {environment_code:environmentCode, supervision_limit:0, pad_limit:0, lecture_limit:0};
};

DB.upsertLicenseLimits = async function(environmentCode, limits){
  const payload = {
    environment_code: environmentCode,
    supervision_limit: Number(limits.supervision_limit || 0),
    pad_limit: Number(limits.pad_limit || 0),
    lecture_limit: Number(limits.lecture_limit || 0),
    updated_at: new Date().toISOString()
  };
  return sbFetch('environment_license_limits?on_conflict=environment_code', {
    method:'POST',
    headers:{'Prefer':'resolution=merge-duplicates,return=representation'},
    body:JSON.stringify(payload)
  });
};

DB.getLicenses = async function(environmentCode){
  return sbFetch(`licenses?environment_code=eq.${encodeURIComponent(environmentCode)}&select=*&order=created_at.desc`);
};

DB.createLicense = async function(data){
  return sbFetch('licenses', { method:'POST', body:JSON.stringify(data) });
};

DB.updateLicense = async function(id, data){
  return sbFetch(`licenses?id=eq.${id}`, { method:'PATCH', body:JSON.stringify(data) });
};

let _lastSubSyncAt = new Date().toISOString();
let _lastInstSyncAt = new Date().toISOString();
const _syncListeners = {};
const _instanceHashes = new Map();
const _formHashes = new Map();
const _serviceHashes = new Map();
let _syncStarted = false;
let _ptSupabaseOnline = null;
let _ptLastSyncLabel = 'Non synchronisé';

function onSync(table, callback){ if(!_syncListeners[table]) _syncListeners[table]=[]; _syncListeners[table].push(callback); }
function _emitSync(table, event, row){ (_syncListeners[table]||[]).forEach(cb=>cb(event,row)); }
function _hash(obj){ try { return JSON.stringify(obj); } catch { return String(Date.now()); } }

async function _pollNewSubmissions(){
  try{
    const rows=await DB.getAllSubmissions(_lastSubSyncAt);
    if(rows.length){
      _lastSubSyncAt=new Date().toISOString();
      rows.forEach(r=>_emitSync('submissions','INSERT',r));
    }
  }catch(e){ console.warn('[Sync] submissions:', e.message); }
}

// Important : les changements de statut modifient une demande existante.
// On ne peut donc pas filtrer uniquement sur created_at. On repasse les 500 dernières
// demandes et on émet UPSERT seulement si leur contenu a changé.
async function _pollInstances(){
  try{
    const rows=await DB.getAllInstances();
    rows.forEach(r=>{
      const h=_hash(r);
      const old=_instanceHashes.get(String(r.id));
      if(old!==h){
        _instanceHashes.set(String(r.id), h);
        _emitSync('service_instances', old ? 'UPDATE' : 'INSERT', r);
      }
    });
  }catch(e){ console.warn('[Sync] service_instances:', e.message); }
}

async function _pollCatalog(){
  try{
    let changed=false;
    const [forms, services] = await Promise.all([DB.getForms(), DB.getServices()]);

    forms.forEach(r=>{
      const h=_hash(r), key=String(r.id), old=_formHashes.get(key);
      if(old!==h){
        _formHashes.set(key,h);
        const mapped=mapFormFromDb(r);
        const idx=FORMS_DATA.findIndex(x=>String(x.id)===key);
        if(idx>=0) FORMS_DATA[idx]={...FORMS_DATA[idx],...mapped, resp:FORMS_DATA[idx].resp||0};
        else FORMS_DATA.push(mapped);
        changed=true;
      }
    });

    _ptFilterResetServices(services).forEach(r=>{
      const h=_hash(r), key=String(r.id), old=_serviceHashes.get(key);
      if(old!==h){
        _serviceHashes.set(key,h);
        const mapped=mapServiceFromDb(r);
        const idx=SERVICES_DATA.findIndex(x=>String(x.id)===key);
        if(idx>=0) SERVICES_DATA[idx]={...SERVICES_DATA[idx],...mapped};
        else SERVICES_DATA.push(mapped);
        changed=true;
      }
    });

    if(changed) refreshCurrentViewAfterSync();
  }catch(e){ console.warn('[Sync] catalogue:', e.message); }
}

function startSync(){
  if (_syncStarted) return;
  _syncStarted = true;
  _lastSubSyncAt = new Date().toISOString();
  setInterval(_pollNewSubmissions, 5000);
  setInterval(_pollInstances, 5000);
  setInterval(_pollCatalog, 10000);
  console.log('[Sync] Polling démarré formulaires + services + statuts (5s)');
  updateSupabaseStatusUI(_ptSupabaseOnline ? 'online' : 'syncing', 'Synchronisation active');
}

async function syncAllFromSupabase(){
  updateSupabaseStatusUI('syncing','Synchronisation catalogue');
  try{
    const [forms, services, submissions, instances] = await Promise.all([DB.getForms(), DB.getServices(), DB.getAllSubmissions(), DB.getAllInstances()]);
    if(forms.length){
      FORMS_DATA.length = 0;
      forms.forEach(r=>FORMS_DATA.push(mapFormFromDb(r)));
    }
    if(services.length){
      SERVICES_DATA.length = 0;
      _ptFilterResetServices(services).forEach(r=>SERVICES_DATA.push(mapServiceFromDb(r)));
    }
    SUBMISSIONS_DATA.length = 0;
    submissions.forEach(r=>SUBMISSIONS_DATA.push(mapSubmissionFromDb(r)));
    SERVICE_INSTANCES_DATA.length = 0;
    instances.forEach(r=>SERVICE_INSTANCES_DATA.push(mapInstanceFromDb(r)));
    FORMS_DATA.forEach(f=>{ f.resp = SUBMISSIONS_DATA.filter(s=>s.formId==f.id).length; });

    // Références pour détecter ensuite les modifications pendant le polling
    _formHashes.clear(); forms.forEach(r=>_formHashes.set(String(r.id), _hash(r)));
    _serviceHashes.clear(); _ptFilterResetServices(services).forEach(r=>_serviceHashes.set(String(r.id), _hash(r)));
    _instanceHashes.clear(); instances.forEach(r=>_instanceHashes.set(String(r.id), _hash(r)));

    console.log('[DB] Données chargées depuis Supabase ✅', {forms:FORMS_DATA.length, services:SERVICES_DATA.length, submissions:SUBMISSIONS_DATA.length, instances:SERVICE_INSTANCES_DATA.length});
    updateSupabaseStatusUI('online','Synchronisation OK');
    refreshCurrentViewAfterSync();
  }catch(e){ console.warn('[DB] Chargement Supabase échoué:', e.message); }
}

function refreshCurrentViewAfterSync(){
  try{
    if(typeof filtered!=='undefined') filtered=[...FORMS_DATA];
    if(document.getElementById('v-list')?.classList.contains('on') && typeof renderTable==='function') renderTable();
    if(document.getElementById('v-prod-forms')?.classList.contains('on') && typeof renderProdForms==='function') renderProdForms(FORMS_DATA);
    if(document.getElementById('v-prod-services-list')?.classList.contains('on') && typeof renderProdServices==='function') renderProdServices();
    if(document.getElementById('v-services')?.classList.contains('on') && typeof renderServices==='function') renderServices();
    if(document.getElementById('v-submissions')?.classList.contains('on') && typeof curSubFormId!=='undefined' && curSubFormId && typeof openSubmissions==='function') openSubmissions(curSubFormId);
    if(document.getElementById('v-service-instances')?.classList.contains('on') && curService && typeof renderServiceInstances==='function') renderServiceInstances(curService);
  }catch(e){}
}


function updateSupabaseStatusUI(state, label){
  try{
    const colors = {online:'#10b981', syncing:'#f59e0b', offline:'#ef4444'};
    const text = state === 'online' ? 'Synchro active' : state === 'syncing' ? 'Synchronisation…' : 'Hors ligne';
    let el = document.getElementById('pt-sync-status');
    if(!el){
      const sb = document.getElementById('sb');
      if(!sb) return;
      el = document.createElement('div');
      el.id='pt-sync-status';
      el.style.cssText='margin:12px 14px;padding:10px 12px;border:1px solid rgba(148,163,184,.22);border-radius:14px;background:rgba(15,23,42,.32);color:#cbd5e1;font-size:11px;font-weight:700;display:flex;align-items:center;gap:8px;';
      const envBox = document.querySelector('.sb-env');
      if(envBox && envBox.parentNode) envBox.parentNode.insertBefore(el, envBox.nextSibling);
      else sb.appendChild(el);
    }
    el.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${colors[state]||colors.syncing};box-shadow:0 0 0 3px ${colors[state]||colors.syncing}22"></span><span>${text}</span><span style="margin-left:auto;color:#94a3b8;font-weight:600">${_ptLastSyncLabel||''}</span>`;
    const padDot = document.getElementById('pad-sync-dot');
    if(padDot) padDot.style.background = colors[state]||colors.syncing;
    const padTxt = document.getElementById('pad-sync-text');
    if(padTxt) padTxt.textContent = text;
  }catch(e){}
}

async function checkSupabaseConnection(){
  updateSupabaseStatusUI('syncing','Test connexion Supabase');
  try{
    await sbFetch('forms?select=id&limit=1');
    updateSupabaseStatusUI('online','Supabase connecté');
    return true;
  }catch(e){
    console.warn('[DB] Test connexion Supabase échoué:', e.message);
    updateSupabaseStatusUI('offline','Supabase inaccessible');
    return false;
  }
}

async function migrateDataToSupabase(){
  try{
    const existing = await DB.getForms();
    if(!existing.length){
      console.log('[DB] Migration des données demo...');
      for(const f of (typeof FORMS_DATA!=='undefined'?FORMS_DATA:[])){
        await DB.createForm({ nom:f.nom, description:f.desc||'', couleur:f.couleur||'#3b82f6', actif:f.actif!==false, modules:f.type||f.modules||[], fields:f.fields||[] });
      }
      for(const s of (typeof SERVICES_DATA!=='undefined'?SERVICES_DATA:[])){
        await DB.createService(serviceToDb(s));
      }
      console.log('[DB] Migration OK ✅');
    }
  }catch(e){ console.warn('[DB] Migration échouée:', e.message); }
  await syncAllFromSupabase();
  startSync();
}
