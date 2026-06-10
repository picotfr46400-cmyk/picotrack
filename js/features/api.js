// ══ API CONFIG ══
let API_CONFIG = {
  keys: [
    {id:'k1', name:'Clé de production', key:'pt_live_a8f2k9x3m1q7z4w6n5r0y2', created:'09/05/2026', lastUsed:'09/05/2026', active:true},
    {id:'k2', name:'Clé de test',       key:'pt_test_b3j7p2l8s4v1u6t9e0c5h', created:'09/05/2026', lastUsed:'Jamais',      active:false},
  ],
  webhooks: [],
  logs: [
    {id:1, method:'GET',  endpoint:'/api/v1/forms',            status:200, at:'09/05/2026 21:42:07', key:'pt_live_...'},
    {id:2, method:'POST', endpoint:'/api/v1/forms/1/submissions',status:201, at:'09/05/2026 21:45:05', key:'pt_live_...'},
    {id:3, method:'GET',  endpoint:'/api/v1/services/1/instances',status:200,at:'09/05/2026 21:46:12', key:'pt_live_...'},
  ]
};
let apiTab = 'keys';

function goApiConfig() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-api').classList.add('on');
  show('v-api-config');
  document.getElementById('tb-t').textContent = 'API & Intégrations';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / API</span>';
  setApiTab('keys');
}

function setApiTab(t) {
  apiTab = t;
  ['keys','endpoints','webhooks','logs'].forEach(x => {
    const tab = document.getElementById('apitab-' + x);
    if (tab) tab.classList.toggle('on', x === t);
  });
  renderApiTab();
}

function renderApiTab() {
  const area = document.getElementById('api-area'); if (!area) return;
  if      (apiTab === 'keys')      renderApiKeys(area);
  else if (apiTab === 'endpoints') renderApiEndpoints(area);
  else if (apiTab === 'webhooks')  renderApiWebhooks(area);
  else if (apiTab === 'logs')      renderApiLogs(area);
}

// ── Clés API ──
function renderApiKeys(area) {
  area.innerHTML = `
    <div style="max-width:800px;margin:0 auto">
      <div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:20px;margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div>
            <div style="font-size:14px;font-weight:800">Clés API</div>
            <div style="font-size:12px;color:var(--tl);margin-top:2px">Utilisez ces clés pour authentifier vos requêtes via le header <code style="background:var(--bg);padding:1px 6px;border-radius:4px;font-family:'DM Mono',monospace">Authorization: Bearer &lt;clé&gt;</code></div>
          </div>
          <button class="btn bp pill" onclick="generateApiKey()">＋ Générer une clé</button>
        </div>
        ${API_CONFIG.keys.map((k,i) => `
          <div style="border:1.5px solid var(--bd);border-radius:10px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px;background:${k.active?'#fff':'var(--bg)'}">
            <div style="width:10px;height:10px;border-radius:50%;background:${k.active?'var(--s)':'var(--tl)'};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;margin-bottom:4px">${h(k.name)}</div>
              <div style="display:flex;align-items:center;gap:8px">
                <code id="key-val-${k.id}" style="font-family:'DM Mono',monospace;font-size:11.5px;background:var(--bg);padding:4px 10px;border-radius:6px;color:var(--tm);letter-spacing:.5px">${k.active ? k.key.substring(0,12)+'••••••••••••' : '••••••••••••••••••••••••'}</code>
                ${k.active ? `<button onclick="copyKey('${k.key}')" style="padding:3px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit">📋 Copier</button>
                <button onclick="toggleKeyVisibility('${k.id}','${k.key}')" style="padding:3px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit" id="vis-btn-${k.id}">👁 Afficher</button>` : ''}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:11px;color:var(--tl)">Créée le ${k.created}</div>
              <div style="font-size:11px;color:var(--tl)">Dernière utilisation : ${k.lastUsed}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <div class="tog ${k.active?'on':'off'}" onclick="toggleApiKey(${i})" title="${k.active?'Désactiver':'Activer'}"></div>
              <button class="ic-btn" onclick="deleteApiKey(${i})" title="Supprimer">🗑</button>
            </div>
          </div>`).join('')}
      </div>
      <div style="background:var(--wl);border:1.5px solid #fde68a;border-radius:10px;padding:14px 16px">
        <div style="font-size:12.5px;font-weight:700;color:#92400e;margin-bottom:4px">⚠️ Sécurité</div>
        <div style="font-size:12px;color:#78350f;line-height:1.5">Ne partagez jamais vos clés API. En cas de compromission, révoquez immédiatement la clé concernée et générez-en une nouvelle.</div>
      </div>
    </div>`;
}

function generateApiKey() {
  const name = prompt('Nom de la clé (ex: Intégration ERP) :');
  if (!name) return;
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const key = 'pt_live_' + Array.from({length:24}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  API_CONFIG.keys.push({id:'k'+Date.now(), name, key, created:new Date().toLocaleDateString('fr-FR'), lastUsed:'Jamais', active:true});
  renderApiTab();
  toast('s', '🔑 Clé "'+name+'" générée');
}
function copyKey(key) {
  navigator.clipboard?.writeText(key).then(()=>toast('s','📋 Clé copiée')).catch(()=>toast('i','Clé : '+key));
}
function toggleKeyVisibility(kid, fullKey) {
  const el = document.getElementById('key-val-'+kid);
  const btn = document.getElementById('vis-btn-'+kid);
  if (!el || !btn) return;
  const isHidden = el.textContent.includes('••');
  el.textContent = isHidden ? fullKey : fullKey.substring(0,12)+'••••••••••••';
  btn.textContent = isHidden ? '🙈 Masquer' : '👁 Afficher';
}
function toggleApiKey(i) { API_CONFIG.keys[i].active = !API_CONFIG.keys[i].active; renderApiTab(); }
function deleteApiKey(i) { if (!confirm('Supprimer cette clé ?')) return; API_CONFIG.keys.splice(i,1); renderApiTab(); toast('s','🗑 Clé supprimée'); }

// ── Endpoints ──
function renderApiEndpoints(area) {
  const BASE = 'https://api.picotrack.fr/v1';
  const METHOD_COLORS = {GET:'#3b82f6', POST:'#10b981', PUT:'#f59e0b', DELETE:'#ef4444', PATCH:'#8b5cf6'};

  const endpoints = [
    // Auth
    {section:'Authentification', method:'POST', path:'/auth/token', desc:'Obtenir un token JWT', body:'{"email":"...","password":"..."}'},
    // Formulaires
    {section:'Formulaires', method:'GET',  path:'/forms',              desc:'Lister tous les formulaires actifs', body:null},
    {section:'Formulaires', method:'GET',  path:'/forms/{id}',         desc:'Détail d\'un formulaire', body:null},
    {section:'Formulaires', method:'GET',  path:'/forms/{id}/submissions', desc:'Toutes les saisies d\'un formulaire', body:null},
    {section:'Formulaires', method:'POST', path:'/forms/{id}/submissions', desc:'Créer une nouvelle saisie', body:'{"values":{"fieldId":"value",...}}'},
    // Services
    {section:'Services', method:'GET',  path:'/services',                    desc:'Lister tous les services actifs', body:null},
    {section:'Services', method:'GET',  path:'/services/{id}/instances',     desc:'Demandes d\'un service', body:null},
    {section:'Services', method:'POST', path:'/services/{id}/instances',     desc:'Créer une nouvelle demande', body:'{"submissionId":123,"values":{...}}'},
    {section:'Services', method:'GET',  path:'/services/{id}/instances/{ref}',desc:'Détail d\'une demande', body:null},
    {section:'Services', method:'POST', path:'/services/instances/{id}/action',desc:'Exécuter une action sur une demande', body:'{"actionId":"a1"}'},
    // Base de données
    {section:'Base de données', method:'GET',   path:'/database/{formId}',     desc:'Lire toutes les lignes d\'une base', body:null},
    {section:'Base de données', method:'PATCH', path:'/database/{formId}/{rowId}', desc:'Modifier une ligne', body:'{"values":{"fieldId":"newValue"}}'},
    // Webhooks
    {section:'Webhooks', method:'POST', path:'/webhooks',       desc:'Enregistrer un webhook', body:'{"url":"https://...","events":["form.submitted"]}'},
    {section:'Webhooks', method:'DELETE',path:'/webhooks/{id}', desc:'Supprimer un webhook', body:null},
  ];

  const sections = [...new Set(endpoints.map(e=>e.section))];
  let html = `<div style="max-width:860px;margin:0 auto">
    <div style="background:var(--pl);border:1.5px solid #bae6fd;border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px">
      <div style="font-size:20px">🔌</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--pd)">Base URL</div>
        <code style="font-family:'DM Mono',monospace;font-size:13px;color:var(--p)">${BASE}</code>
        <button onclick="copyKey('${BASE}')" style="margin-left:10px;padding:2px 9px;border-radius:6px;border:1.5px solid var(--p);background:transparent;font-size:11px;font-weight:700;cursor:pointer;color:var(--p);font-family:inherit">📋 Copier</button>
      </div>
    </div>`;

  sections.forEach(sec => {
    html += `<div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;overflow:hidden;margin-bottom:14px">
      <div style="padding:12px 16px;background:var(--bg);border-bottom:1.5px solid var(--bd);font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px">${sec}</div>`;
    endpoints.filter(e=>e.section===sec).forEach(ep => {
      const mc = METHOD_COLORS[ep.method]||'#6b7280';
      html += `<div style="padding:12px 16px;border-bottom:1px solid var(--bg);display:flex;align-items:flex-start;gap:12px" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
        <span style="padding:3px 9px;border-radius:6px;background:${mc}18;color:${mc};font-size:11px;font-weight:800;font-family:'DM Mono',monospace;flex-shrink:0;min-width:58px;text-align:center">${ep.method}</span>
        <div style="flex:1;min-width:0">
          <code style="font-family:'DM Mono',monospace;font-size:12.5px;color:var(--tx)">${ep.path}</code>
          <div style="font-size:11.5px;color:var(--tl);margin-top:3px">${ep.desc}</div>
          ${ep.body ? `<div style="margin-top:6px;background:var(--bg);border-radius:6px;padding:6px 10px"><code style="font-family:'DM Mono',monospace;font-size:11px;color:var(--tm)">${h(ep.body)}</code></div>` : ''}
        </div>
        <button onclick="copyKey('${BASE}${ep.path}')" style="padding:3px 9px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;cursor:pointer;color:var(--tl);font-family:inherit;flex-shrink:0">📋</button>
      </div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;
  area.innerHTML = html;
}

// ── Webhooks ──
function renderApiWebhooks(area) {
  const EVENTS = ['form.submitted','service.instance.created','service.instance.updated','service.action.executed','database.row.updated'];
  area.innerHTML = `<div style="max-width:800px;margin:0 auto">
    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div style="font-size:14px;font-weight:800">Webhooks sortants</div>
          <div style="font-size:12px;color:var(--tl);margin-top:2px">PicoTrack enverra un POST JSON à vos URLs lors des événements sélectionnés.</div>
        </div>
        <button class="btn bp pill" onclick="addWebhook()">＋ Ajouter</button>
      </div>
      ${!API_CONFIG.webhooks.length
        ? `<div style="text-align:center;padding:40px;color:var(--tl);border:2px dashed var(--bd);border-radius:10px">
             <div style="font-size:28px;margin-bottom:8px;opacity:.3">🔗</div>
             Aucun webhook configuré.</div>`
        : API_CONFIG.webhooks.map((w,i) => `
          <div style="border:1.5px solid var(--bd);border-radius:10px;padding:14px 16px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <div class="tog ${w.active?'on':'off'}" onclick="API_CONFIG.webhooks[${i}].active=!API_CONFIG.webhooks[${i}].active;renderApiTab()"></div>
              <input class="ci" style="flex:1" value="${h(w.name)}" placeholder="Nom..." oninput="API_CONFIG.webhooks[${i}].name=this.value">
              <button class="ic-btn" onclick="testWebhook(${i})" title="Tester">▶</button>
              <button class="ic-btn" onclick="API_CONFIG.webhooks.splice(${i},1);renderApiTab()">🗑</button>
            </div>
            <div style="margin-bottom:10px">
              <div class="fl2" style="margin-bottom:4px">URL</div>
              <input class="ci" value="${h(w.url)}" placeholder="https://..." oninput="API_CONFIG.webhooks[${i}].url=this.value" style="font-family:'DM Mono',monospace;font-size:12px">
            </div>
            <div>
              <div class="fl2" style="margin-bottom:6px">Événements déclencheurs</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${EVENTS.map(ev => {const on=w.events.includes(ev);return`<label style="display:flex;align-items:center;gap:5px;padding:4px 10px;border:1.5px solid ${on?'var(--p)':'var(--bd)'};border-radius:20px;cursor:pointer;font-size:11.5px;font-weight:600;background:${on?'var(--pl)':'#fff'};color:${on?'var(--p)':'var(--tm)'}"><input type="checkbox" ${on?'checked':''} style="display:none" onchange="toggleWebhookEvent(${i},'${ev}',this.checked)">${on?'✓ ':''}${ev}</label>`;}).join('')}
              </div>
            </div>
          </div>`).join('')}
    </div>
    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:16px">
      <div style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:12px">Format du payload</div>
      <pre style="background:var(--bg);border-radius:8px;padding:14px;font-family:'DM Mono',monospace;font-size:11.5px;color:var(--tx);overflow-x:auto;line-height:1.6">{
  "event": "form.submitted",
  "timestamp": "2026-05-09T21:42:07Z",
  "environment": "EDF Blayais",
  "data": {
    "formId": 1,
    "formNom": "Arrivage CNPE Blaye",
    "submissionId": 1715295727,
    "values": { "f1": "ONET Transport", "f2": 12 }
  }
}</pre>
    </div>
  </div>`;
}

function addWebhook() {
  const url = prompt('URL du webhook :');
  if (!url || !url.startsWith('http')) { toast('e','⚠️ URL invalide'); return; }
  const name = prompt('Nom du webhook :') || 'Webhook';
  API_CONFIG.webhooks.push({id:'w'+Date.now(), name, url, events:['form.submitted'], active:true});
  renderApiTab();
  toast('s','🔗 Webhook ajouté');
}
function toggleWebhookEvent(wi, ev, checked) {
  if (checked) { if (!API_CONFIG.webhooks[wi].events.includes(ev)) API_CONFIG.webhooks[wi].events.push(ev); }
  else API_CONFIG.webhooks[wi].events = API_CONFIG.webhooks[wi].events.filter(e => e !== ev);
  renderApiTab();
}
function testWebhook(wi) {
  const w = API_CONFIG.webhooks[wi];
  API_CONFIG.logs.unshift({id:Date.now(), method:'POST', endpoint:w.url, status:200, at:new Date().toLocaleString('fr-FR'), key:'webhook'});
  toast('s', `▶ Test envoyé → ${w.url.substring(0,40)}...`);
}

// ── Logs ──
function renderApiLogs(area) {
  const STATUS_COLORS = {200:'var(--s)', 201:'var(--s)', 400:'var(--w)', 401:'var(--d)', 404:'var(--w)', 500:'var(--d)'};
  area.innerHTML = `<div style="max-width:900px;margin:0 auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:14px;font-weight:800">Logs d'activité API</div>
      <button class="btn pill" onclick="API_CONFIG.logs=[];renderApiTab()">🗑 Vider</button>
    </div>
    ${!API_CONFIG.logs.length
      ? `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)"><div style="font-size:32px;margin-bottom:10px">📭</div>Aucun appel enregistré.</div>`
      : `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:hidden">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px">
            <thead><tr style="background:var(--bg);border-bottom:2px solid var(--bd)">
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Méthode</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Endpoint</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Statut</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Date</th>
              <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase">Clé</th>
            </tr></thead>
            <tbody>
              ${API_CONFIG.logs.map((l,i) => {
                const mc = {GET:'#3b82f6',POST:'#10b981',PUT:'#f59e0b',DELETE:'#ef4444',PATCH:'#8b5cf6'}[l.method]||'#6b7280';
                const sc = STATUS_COLORS[l.status]||'var(--tl)';
                const bg = i%2?'var(--bg)':'#fff';
                return `<tr style="border-bottom:1px solid var(--bd);background:${bg}">
                  <td style="padding:9px 14px"><span style="padding:2px 8px;border-radius:5px;background:${mc}18;color:${mc};font-size:11px;font-weight:800;font-family:'DM Mono',monospace">${l.method}</span></td>
                  <td style="padding:9px 14px;font-family:'DM Mono',monospace;font-size:12px;color:var(--tx);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(l.endpoint)}</td>
                  <td style="padding:9px 14px"><span style="font-size:12px;font-weight:800;color:${sc}">${l.status}</span></td>
                  <td style="padding:9px 14px;font-size:11.5px;color:var(--tl);white-space:nowrap">${l.at}</td>
                  <td style="padding:9px 14px;font-family:'DM Mono',monospace;font-size:11px;color:var(--tl)">${l.key}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
  </div>`;
}
