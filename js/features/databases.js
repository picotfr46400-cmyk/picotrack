// ══ BASES AUTONOMES ══
function createDatabaseModal(editId) {
  const db = editId ? DATABASES_DATA.find(x=>x.id===editId) : null;
  const TYPES = [{v:'text',l:'Texte'},{v:'number',l:'Nombre'},{v:'date',l:'Date'},{v:'boolean',l:'Oui/Non'},{v:'select',l:'Liste'}];
  const modal = document.createElement('div');
  modal.id = 'db-create-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal._cols = db ? db.columns.map(c=>({...c})) : [{id:'col_'+Date.now(),nom:'',type:'text'}];
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:560px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:18px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:15px;font-weight:800">${editId?'Modifier':'Créer'} une base de données</div>
        <button onclick="document.getElementById('db-create-modal').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--tl)">×</button>
      </div>
      <div style="padding:20px">
        <div class="fl2">Nom <span class="req">*</span></div>
        <input id="db-modal-nom" class="fi" placeholder="Ex : Stock matériel" value="${h(db?.nom||'')}" style="margin-bottom:14px">
        <div class="fl2" style="margin-bottom:6px">Couleur</div>
        <div class="color-row" id="db-modal-colors" style="margin-bottom:16px">
          ${['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16'].map(c=>`<div class="c-swatch${(db?.couleur||'#3b82f6')===c?' on':''}" style="background:${c}" onclick="document.querySelectorAll('#db-modal-colors .c-swatch').forEach(x=>x.classList.remove('on'));this.classList.add('on')"></div>`).join('')}
        </div>
        <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Colonnes</div>
        <div id="db-modal-cols"></div>
        <button class="btn btn-sm" style="margin-top:4px" onclick="document.getElementById('db-create-modal')._cols.push({id:'col_'+Date.now(),nom:'',type:'text'});_refreshDBCols()">＋ Ajouter une colonne</button>
      </div>
      <div style="padding:14px 20px;border-top:1px solid var(--bd);display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" onclick="document.getElementById('db-create-modal').remove()">Annuler</button>
        <button class="btn bp" onclick="saveStandaloneDB(${editId||'null'})">${editId?'Enregistrer':'Créer la base'}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  _refreshDBCols();
}

function _refreshDBCols() {
  const modal = document.getElementById('db-create-modal'); if (!modal) return;
  const TYPES = [{v:'text',l:'Texte'},{v:'number',l:'Nombre'},{v:'date',l:'Date'},{v:'boolean',l:'Oui/Non'},{v:'select',l:'Liste'}];
  document.getElementById('db-modal-cols').innerHTML = modal._cols.map((c,i)=>`
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:7px">
      <input class="fi" style="flex:1" placeholder="Nom de la colonne" value="${h(c.nom)}" oninput="document.getElementById('db-create-modal')._cols[${i}].nom=this.value">
      <select class="fi" style="width:110px" onchange="document.getElementById('db-create-modal')._cols[${i}].type=this.value">
        ${TYPES.map(t=>`<option value="${t.v}" ${c.type===t.v?'selected':''}>${t.l}</option>`).join('')}
      </select>
      <button onclick="document.getElementById('db-create-modal')._cols.splice(${i},1);_refreshDBCols()" style="border:none;background:none;cursor:pointer;color:var(--tl);font-size:16px;padding:0 4px">🗑</button>
    </div>`).join('');
}

function saveStandaloneDB(editId) {
  const modal = document.getElementById('db-create-modal');
  const nom = document.getElementById('db-modal-nom').value.trim();
  if (!nom) { toast('e','⚠ Nom requis'); return; }
  const cols = (modal._cols||[]).filter(c=>c.nom.trim());
  if (!cols.length) { toast('e','⚠ Au moins une colonne requise'); return; }
  const couleur = document.querySelector('#db-modal-colors .c-swatch.on')?.style?.background || '#3b82f6';
  if (editId) {
    const db = DATABASES_DATA.find(x=>x.id===editId);
    if (db) { db.nom=nom; db.couleur=couleur; db.columns=cols; }
    modal.remove(); toast('s','✅ Base modifiée'); renderStandaloneDBTable(DATABASES_DATA.find(x=>x.id===editId));
  } else {
    DATABASES_DATA.push({id:Date.now(),nom,couleur,columns:cols,rows:[]});
    modal.remove(); toast('s','✅ Base créée'); renderProDatabase();
  }
}

function openStandaloneDB(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goProDatabase()">▶ Base de données</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(db.nom)}</span>`;
  document.getElementById('tb-t').textContent = db.nom;
  show('v-prod-database-table');
  renderStandaloneDBTable(db);
}

function renderStandaloneDBTable(db) {
  const wrap = document.getElementById('prod-db-table-wrap');
  const color = db.couleur || '#3b82f6';
  const total = db.rows.length;
  const activeKey = API_CONFIG.keys.find(k => k.active);
  const apiUrl = `https://api.picotrack.fr/v1/database/sdb_${db.id}`;
  const apiBlock = `<div id="sdb-api-block-${db.id}" style="display:none;background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:18px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px"><div style="width:28px;height:28px;border-radius:7px;background:var(--pl);display:flex;align-items:center;justify-content:center;font-size:14px">🔌</div><div style="font-size:13px;font-weight:800">Accès API</div></div>
      <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:${activeKey?'var(--sl)':'var(--dl)'};color:${activeKey?'var(--s)':'var(--d)'};font-weight:700">${activeKey?'✓ Clé active':'⚠ Aucune clé active'}</span>
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Endpoint</div>
      <div style="display:flex;align-items:center;gap:8px;background:var(--bg);border-radius:8px;padding:10px 13px">
        <span style="padding:2px 8px;border-radius:5px;background:#3b82f618;color:#3b82f6;font-size:11px;font-weight:800;font-family:'DM Mono',monospace;flex-shrink:0">GET</span>
        <code style="font-family:'DM Mono',monospace;font-size:12.5px;color:var(--tx);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${apiUrl}</code>
        <button onclick="copyKey('${apiUrl}')" style="padding:4px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit;flex-shrink:0">📋 Copier</button>
      </div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">cURL</div>
      <div style="background:#1e293b;border-radius:8px;padding:11px 14px;display:flex;align-items:flex-start;gap:10px">
        <code style="font-family:'DM Mono',monospace;font-size:11.5px;color:#e2e8f0;flex:1;line-height:1.6;white-space:pre-wrap">curl -X GET "${apiUrl}" \\
  -H "Authorization: Bearer ${activeKey?activeKey.key.substring(0,20)+'...':'&lt;votre-clé&gt;'}" \\
  -H "Accept: application/json"</code>
        <button onclick="copyKey('curl -X GET &quot;${apiUrl}&quot; -H &quot;Authorization: Bearer ${activeKey?activeKey.key:'<clé>'}&quot;')" style="padding:4px 10px;border-radius:6px;border:1.5px solid #334155;background:#334155;font-size:11px;font-weight:700;cursor:pointer;color:#94a3b8;font-family:inherit;flex-shrink:0;margin-top:2px">📋</button>
      </div>
    </div>
  </div>`;
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-size:17px;font-weight:800">${h(db.nom)}</div>
        <div style="font-size:12px;color:var(--tl);margin-top:2px">${total} ligne${total>1?'s':''} · ${db.columns.length} colonne${db.columns.length>1?'s':''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div class="sbar"><span style="color:var(--tl)">🔍</span><input placeholder="Filtrer..." oninput="_filterSDB(${db.id},this.value)" style="width:160px"></div>
        <button class="btn bp pill" onclick="addManualRowModal(${db.id})">＋ Ligne</button>
        <button class="btn pill" onclick="exportStandaloneCSV(${db.id})">📤 CSV</button>
       <button class="btn pill" onclick="createDatabaseModal(${db.id})">⚙ Colonnes</button>
        <button class="btn pill" id="sdb-api-btn-${db.id}" onclick="_toggleSdbApi(${db.id})">🔌 API</button>
      </div>
    </div>
    ${apiBlock}
    <div id="sdb-table-${db.id}">${_renderSDBTable(db, db.rows)}</div>`;
}

function _renderSDBTable(db, rows) {
  const color = db.couleur || '#3b82f6';
  if (!rows.length) return `<div style="text-align:center;padding:50px;color:var(--tl);border:2px dashed var(--bd);border-radius:12px"><div style="font-size:28px;opacity:.3;margin-bottom:8px">🗃</div>Aucune ligne — cliquez sur "+ Ligne"</div>`;
  return `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:auto">
    <table style="width:100%;border-collapse:collapse;min-width:600px">
      <thead style="background:var(--bg)"><tr>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd);white-space:nowrap">#</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd);white-space:nowrap">Date</th>
        <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd)">Source</th>
        ${db.columns.map(c=>`<th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--tl);text-align:left;border-bottom:1.5px solid var(--bd);white-space:nowrap">${h(c.nom)}</th>`).join('')}
        <th style="border-bottom:1.5px solid var(--bd);width:40px"></th>
      </tr></thead>
      <tbody>${rows.map((row,i)=>{
        const src = row.source==='manual'
          ? `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:#f1f5f9;color:var(--tl)">Manuel</span>`
          : `<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${color}18;color:${color}">Formulaire</span>`;
        return `<tr style="border-bottom:1px solid var(--bg)" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <td style="padding:9px 14px;font-size:12px;color:var(--tl)">${i+1}</td>
          <td style="padding:9px 14px;font-size:12px;color:var(--tl);white-space:nowrap">${row.dateLabel||''}</td>
          <td style="padding:9px 14px">${src}</td>
          ${db.columns.map(c=>{const v=row.values[c.id];return`<td style="padding:9px 14px;font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(String(v!==undefined&&v!==''?v:'—'))}</td>`;}).join('')}
          <td style="padding:9px 14px;text-align:center"><button onclick="deleteStandaloneRow(${db.id},${row.id})" style="border:none;background:none;cursor:pointer;color:var(--tl);font-size:13px;opacity:.4" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.4">🗑</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}
function _toggleSdbApi(dbId) {
  const block = document.getElementById('sdb-api-block-'+dbId);
  const btn   = document.getElementById('sdb-api-btn-'+dbId);
  if (!block) return;
  const isOpen = block.style.display !== 'none';
  block.style.display = isOpen ? 'none' : 'block';
  if (btn) { btn.style.background=isOpen?'':'var(--p)'; btn.style.color=isOpen?'':'#fff'; btn.style.borderColor=isOpen?'':'var(--p)'; }
}
function _filterSDB(dbId, q) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const lower = q.toLowerCase();
  const filtered = db.rows.filter(r=>(r.dateLabel||'').toLowerCase().includes(lower)||db.columns.some(c=>String(r.values[c.id]||'').toLowerCase().includes(lower)));
  const el = document.getElementById('sdb-table-'+dbId);
  if (el) el.innerHTML = _renderSDBTable(db, filtered);
}

function deleteStandaloneRow(dbId, rowId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  db.rows = db.rows.filter(r=>r.id!==rowId);
  renderStandaloneDBTable(db); toast('s','🗑 Ligne supprimée');
}

function exportStandaloneCSV(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const header = ['#','Date','Source',...db.columns.map(c=>c.nom)];
  const lines = db.rows.map((r,i)=>[i+1,r.dateLabel||'',r.source,...db.columns.map(c=>r.values[c.id]||'')]);
  const csv = [header,...lines].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  dl('\ufeff'+csv,`${db.nom.replace(/\s/g,'_')}_export.csv`,'text/csv;charset=utf-8');
  toast('s','📤 Export CSV');
}

function addManualRowModal(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const inputFor = c => ({
    text:    `<input id="mrow-${c.id}" class="fi" placeholder="${h(c.nom)}">`,
    number:  `<input id="mrow-${c.id}" class="fi" type="number" placeholder="0">`,
    date:    `<input id="mrow-${c.id}" class="fi" type="date">`,
    boolean: `<select id="mrow-${c.id}" class="fi"><option value="">—</option><option>Oui</option><option>Non</option></select>`,
    select:  `<input id="mrow-${c.id}" class="fi" placeholder="Valeur...">`,
  })[c.type] || `<input id="mrow-${c.id}" class="fi">`;

  const modal = document.createElement('div');
  modal.id = 'db-row-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:460px;max-width:95vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:16px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:14px;font-weight:800">Ajouter une ligne — ${h(db.nom)}</div>
        <button onclick="document.getElementById('db-row-modal').remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--tl)">×</button>
      </div>
      <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
        ${db.columns.map(c=>`<div><div class="fl2">${h(c.nom)}</div>${inputFor(c)}</div>`).join('')}
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--bd);display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" onclick="document.getElementById('db-row-modal').remove()">Annuler</button>
        <button class="btn bp" onclick="saveManualRow(${dbId})">Enregistrer</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function saveManualRow(dbId) {
  const db = DATABASES_DATA.find(x=>x.id===dbId); if (!db) return;
  const values = {};
  db.columns.forEach(c=>{ const el=document.getElementById('mrow-'+c.id); if(el) values[c.id]=el.value; });
  db.rows.push({id:Date.now(),date:new Date().toISOString(),dateLabel:new Date().toLocaleString('fr-FR'),source:'manual',values});
  document.getElementById('db-row-modal')?.remove();
  toast('s','✅ Ligne ajoutée');
  renderStandaloneDBTable(db);
}
// ══ PRODUCTION : BASE DE DONNÉES DYNAMIQUE ══
function goProDatabase() {
  document.querySelectorAll('.sb-i').forEach(i => i.classList.remove('on'));
  document.getElementById('sb-prod-db').classList.add('on');
  show('v-prod-database');
  document.getElementById('tb-t').textContent = 'Base de données';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Production / Base de données</span>';
 renderProDatabase();
}
function renderProDatabase(filterQ) {
  const q = (filterQ||'').toLowerCase();
  const grid = document.getElementById('prod-db-grid');
  // Bases autonomes
  const standalones = DATABASES_DATA.filter(db => !q || db.nom.toLowerCase().includes(q));
  // Bases liées aux formulaires actifs
  const formDBs = FORMS_DATA.filter(f => f.actif !== false && (!q || f.nom.toLowerCase().includes(q)));

  if (!standalones.length && !formDBs.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--tl)"><div style="font-size:32px;margin-bottom:12px;opacity:.3">🗃</div><div>Aucune base. Créez-en une ou activez le déclencheur "Base de données" dans un formulaire.</div></div>`;
    return;
  }

  let html = '';

  if (standalones.length) {
    html += `<div style="grid-column:1/-1;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin-bottom:4px">Bases autonomes</div>`;
    html += standalones.map(db => {
      const color = db.couleur || '#3b82f6';
      return `<div onclick="openStandaloneDB(${db.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${color}';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--bd)';this.style.transform=''">
        <div style="height:5px;background:${color}"></div>
        <div style="padding:16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:36px;height:36px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:18px">🗃</div>
            <div style="flex:1"><div style="font-weight:800;font-size:14px">${h(db.nom)}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${db.columns.length} colonne${db.columns.length>1?'s':''}</div></div>
            <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:var(--tl);font-weight:700">Autonome</span>
          </div>
          <div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between">
            <div><span style="font-size:20px;font-weight:800">${db.rows.length}</span><span style="font-size:11px;color:var(--tl);margin-left:4px">ligne${db.rows.length>1?'s':''}</span></div>
            <div style="padding:5px 14px;border-radius:20px;background:${color};color:#fff;font-size:12px;font-weight:700">Ouvrir →</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  if (formDBs.length) {
    html += `<div style="grid-column:1/-1;font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.7px;margin:${standalones.length?'12px':0} 0 4px">Liées aux formulaires</div>`;
    html += formDBs.map(f => {
      const total = Math.max((DB_DATA[f.id]||[]).length, SUBMISSIONS_DATA.filter(s=>s.formId===f.id).length);
      const color = f.couleur || '#3b82f6';
      const fields = (f.fields||[]).filter(x=>!['separator','image','titre','son','video'].includes(x.type));
      return `<div onclick="openDatabaseTable(${f.id})" style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);box-shadow:0 2px 8px rgba(0,0,0,.06);overflow:hidden;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='${color}';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--bd)';this.style.transform=''">
        <div style="height:5px;background:${color}"></div>
        <div style="padding:16px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:36px;height:36px;border-radius:9px;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:18px">🗃</div>
            <div style="flex:1"><div style="font-weight:800;font-size:14px">${h(f.nom)}</div><div style="font-size:11px;color:var(--tl);margin-top:2px">${fields.length} colonne${fields.length>1?'s':''}</div></div>
            <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--pl);color:var(--p);font-weight:700">Formulaire</span>
          </div>
          <div style="border-top:1px solid var(--bd);padding-top:10px;display:flex;align-items:center;justify-content:space-between">
            <div><span style="font-size:20px;font-weight:800">${total}</span><span style="font-size:11px;color:var(--tl);margin-left:4px">ligne${total>1?'s':''}</span></div>
            <div style="padding:5px 14px;border-radius:20px;background:${color};color:#fff;font-size:12px;font-weight:700">Ouvrir →</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  grid.innerHTML = html;
}
function searchProDatabase(q) { renderProDatabase(q); }

function openDatabaseTable(formId) {
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-link" onclick="goProDatabase()">▶ Base de données</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${h(f.nom)}</span>`;
  document.getElementById('tb-t').textContent = f.nom;
  show('v-prod-database-table');
  renderDatabaseTable(f);
}

function renderDatabaseTable(f) {
  const wrap = document.getElementById('prod-db-table-wrap');
  const color = f.couleur || '#3b82f6';
  const fields = (f.fields || []).filter(x => !['separator','image','titre','son','video'].includes(x.type));
  // Fusionner DB_DATA et SUBMISSIONS_DATA pour ce form
  const dbRows = DB_DATA[f.id] || [];
  const subRows = SUBMISSIONS_DATA.filter(s => s.formId === f.id);
  // Dédupliquer : on prend les submissions comme source de vérité
  const allRows = subRows.length ? subRows.map(s => ({
    id: s.id, dateLabel: s.dateLabel, user: s.utilisateur, values: s.values
  })) : dbRows;
  const total = allRows.length;
  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <div style="font-size:17px;font-weight:800">${h(f.nom)}</div>
      <div style="font-size:12px;color:var(--tl);margin-top:2px" id="db-row-count">${total.toLocaleString()} ligne${total > 1 ? 's' : ''} · ${fields.length} colonne${fields.length > 1 ? 's' : ''}</div>
    </div>
    <div style="display:flex;gap:8px">
      <div class="sbar"><span style="color:var(--tl)">🔍</span><input placeholder="Filtrer..." oninput="filterDatabaseTable(${f.id}, this.value)" style="width:180px"></div>
      <button class="btn pill" onclick="exportDatabaseCSV(${f.id})">📤 Exporter CSV</button>
      <button class="btn pill" id="api-toggle-${f.id}" onclick="toggleDbApiBlock(${f.id})">🔌 API</button>
    </div>
  </div>`;
// Bloc API
  const activeKey = API_CONFIG.keys.find(k => k.active);
  const apiUrl = `https://api.picotrack.fr/v1/database/${f.id}`;
 html += `<div id="db-api-block-${f.id}" style="display:none;background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:18px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:28px;height:28px;border-radius:7px;background:var(--pl);display:flex;align-items:center;justify-content:center;font-size:14px">🔌</div>
        <div style="font-size:13px;font-weight:800">Accès API</div>
      </div>
      <span style="font-size:11px;padding:3px 10px;border-radius:20px;background:${activeKey?'var(--sl)':'var(--dl)'};color:${activeKey?'var(--s)':'var(--d)'};font-weight:700">${activeKey?'✓ Clé active':'⚠ Aucune clé active'}</span>
    </div>

    <!-- Endpoint -->
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Endpoint</div>
      <div style="display:flex;align-items:center;gap:8px;background:var(--bg);border-radius:8px;padding:10px 13px">
        <span style="padding:2px 8px;border-radius:5px;background:#3b82f618;color:#3b82f6;font-size:11px;font-weight:800;font-family:'DM Mono',monospace;flex-shrink:0">GET</span>
        <code style="font-family:'DM Mono',monospace;font-size:12.5px;color:var(--tx);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${apiUrl}</code>
        <button onclick="copyKey('${apiUrl}')" style="padding:4px 10px;border-radius:6px;border:1.5px solid var(--bd);background:#fff;font-size:11px;font-weight:700;cursor:pointer;color:var(--tm);font-family:inherit;flex-shrink:0">📋 Copier</button>
      </div>
    </div>

    <!-- cURL -->
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">cURL</div>
      <div style="background:#1e293b;border-radius:8px;padding:11px 14px;display:flex;align-items:flex-start;gap:10px">
        <code style="font-family:'DM Mono',monospace;font-size:11.5px;color:#e2e8f0;flex:1;line-height:1.6;white-space:pre-wrap">curl -X GET "${apiUrl}" \\
  -H "Authorization: Bearer ${activeKey?activeKey.key.substring(0,20)+'...':'&lt;votre-clé&gt;'}" \\
  -H "Accept: application/json"</code>
        <button onclick="copyKey('curl -X GET &quot;${apiUrl}&quot; -H &quot;Authorization: Bearer ${activeKey?activeKey.key:'<votre-clé>'}&quot; -H &quot;Accept: application/json&quot;')" style="padding:4px 10px;border-radius:6px;border:1.5px solid #334155;background:#334155;font-size:11px;font-weight:700;cursor:pointer;color:#94a3b8;font-family:inherit;flex-shrink:0;margin-top:2px">📋</button>
      </div>
    </div>

    <!-- Power Query -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px">Power Query (Excel / Power BI)</div>
        <span style="font-size:10px;padding:2px 8px;border-radius:20px;background:var(--wl);color:#92400e;font-weight:700">⏳ Disponible avec le backend</span>
      </div>
      <div style="background:#1e293b;border-radius:8px;padding:11px 14px;display:flex;align-items:flex-start;gap:10px">
        <code style="font-family:'DM Mono',monospace;font-size:11px;color:#e2e8f0;flex:1;line-height:1.7;white-space:pre-wrap">let
  Source = Json.Document(
    Web.Contents("${apiUrl}",
      [Headers = [
        Authorization = "Bearer ${activeKey?activeKey.key:'<votre-clé>'}",
        Accept = "application/json"
      ]]
    )
  ),
  Rows = Source[rows],
  Table = Table.FromList(Rows, Splitter.SplitByNothing()),
  Expanded = Table.ExpandRecordColumn(Table, "Column1",
    {"date", "user", ${(f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)).slice(0,3).map(fld=>`"${fld.id}"`).join(', ')}})
in
  Expanded</code>
        <button onclick="copyKey('let\\n  Source = Json.Document(Web.Contents(&quot;${apiUrl}&quot;,[Headers=[Authorization=&quot;Bearer ${activeKey?activeKey.key:'<clé>'}&quot;,Accept=&quot;application/json&quot;]]))\\nin\\n  Source')" style="padding:4px 10px;border-radius:6px;border:1.5px solid #334155;background:#334155;font-size:11px;font-weight:700;cursor:pointer;color:#94a3b8;font-family:inherit;flex-shrink:0;margin-top:2px">📋</button>
      </div>
      <div style="font-size:11px;color:var(--tl);margin-top:7px;line-height:1.5">
        Dans Excel : <strong>Données → Obtenir des données → Depuis le web</strong> → coller l'URL + ajouter le header Authorization. Ou utiliser l'éditeur avancé Power Query avec le script ci-dessus.
      </div>
    </div>
  </div>`;
  if (!fields.length) {
    wrap.innerHTML = html + `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">Ce formulaire n'a aucun champ de données.</div>`;
    return;
  }
  html += renderDbTableHtml(f, fields, allRows, color);
  wrap.innerHTML = html;
}

function renderDbTableHtml(f, fields, rows, color) {
  if (!rows.length) {
    return `<div style="text-align:center;padding:60px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)">
      <div style="font-size:32px;margin-bottom:10px">📭</div>Aucune donnée. Remplissez le formulaire en production.</div>`;
  }
  let html = `<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:auto">
    <table style="width:100%;border-collapse:collapse;font-size:12.5px">
      <thead>
        <tr style="background:var(--bg);border-bottom:2px solid var(--bd)">
          <th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">#</th>
          <th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Date</th>
          <th style="padding:10px 14px;text-align:left;color:var(--tl);white-space:nowrap;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px">Utilisateur</th>`;
  fields.forEach(fld => {
    const fd = FD[fld.type] || {ic:'?', bg:'#6b7280'};
    html += `<th style="padding:10px 14px;text-align:left;white-space:nowrap;min-width:120px">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:18px;height:18px;border-radius:4px;background:${fd.bg};display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;flex-shrink:0">${fd.ic}</div>
        <span style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;letter-spacing:.5px">${h(fld.nom)}</span>
      </div>
    </th>`;
  });
  html += `</tr></thead><tbody>`;
  rows.forEach((row, i) => {
    const bg = i % 2 ? 'var(--bg)' : '#fff';
    html += `<tr style="border-bottom:1px solid var(--bd);background:${bg}" onmouseover="this.style.background='var(--pl)'" onmouseout="this.style.background='${bg}'">
      <td style="padding:9px 14px;color:var(--tl);font-family:'DM Mono',monospace;font-size:11px">${i + 1}</td>
      <td style="padding:9px 14px;color:var(--tl);white-space:nowrap;font-size:12px">${row.dateLabel}</td>
      <td style="padding:9px 14px;font-weight:600;white-space:nowrap">${h(row.user)}</td>`;
    fields.forEach(fld => {
      const v = row.values[fld.id];
      const val = Array.isArray(v) ? v.join(', ') : (v !== undefined && v !== '' ? v : '—');
      const isEmpty = val === '—';
      html += `<td style="padding:9px 14px;color:${isEmpty ? 'var(--tl)' : 'var(--tx)'};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(String(val))}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table></div>`;
  return html;
}

function filterDatabaseTable(formId, q) {
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;
  const fields = (f.fields || []).filter(x => !['separator','image','titre','son','video'].includes(x.type));
  const subRows = SUBMISSIONS_DATA.filter(s => s.formId === formId);
  const allRows = subRows.map(s => ({id:s.id, dateLabel:s.dateLabel, user:s.utilisateur, values:s.values}));
  const lower = q.toLowerCase();
  const filtered = allRows.filter(row =>
    row.user.toLowerCase().includes(lower) ||
    row.dateLabel.toLowerCase().includes(lower) ||
    fields.some(fld => {const v = row.values[fld.id]; return String(Array.isArray(v)?v.join(', '):(v||'')).toLowerCase().includes(lower);})
  );
  const color = f.couleur || '#3b82f6';
  const cnt = document.getElementById('db-row-count');
  if (cnt) cnt.textContent = `${filtered.length.toLocaleString()} ligne${filtered.length > 1 ? 's' : ''} · ${fields.length} colonne${fields.length > 1 ? 's' : ''}`;
  const wrap = document.getElementById('prod-db-table-wrap');
  // Remplacer seulement le tableau (après les 2 premiers divs)
  const existing = wrap.querySelector('div:last-child');
  if (existing) existing.outerHTML = renderDbTableHtml(f, fields, filtered, color);
}
function toggleDbApiBlock(formId) {
  const block = document.getElementById('db-api-block-' + formId);
  const btn   = document.getElementById('api-toggle-' + formId);
  if (!block) return;
  const isOpen = block.style.display !== 'none';
  block.style.display = isOpen ? 'none' : 'block';
  if (btn) {
    btn.style.background    = isOpen ? '' : 'var(--p)';
    btn.style.color         = isOpen ? '' : '#fff';
    btn.style.borderColor   = isOpen ? '' : 'var(--p)';
  }
}
function exportDatabaseCSV(formId) {
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;
  const fields = (f.fields || []).filter(x => !['separator','image','titre','son','video'].includes(x.type));
  const rows = SUBMISSIONS_DATA.filter(s => s.formId === formId);
  const header = ['#', 'Date', 'Utilisateur', ...fields.map(fld => fld.nom)];
  const lines = rows.map((s, i) => [
    i + 1, s.dateLabel, s.utilisateur,
    ...fields.map(fld => { const v = s.values[fld.id]; return Array.isArray(v) ? v.join(', ') : (v || ''); })
  ]);
  const csv = [header, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  dl('\ufeff' + csv, `${f.nom.replace(/\s/g,'_')}_export.csv`, 'text/csv;charset=utf-8');
  toast('s', '📤 Export CSV téléchargé');
}
                                     // ── DB Effect helpers ──
function renderDbEffectHtml(ai,ei,ef){
  const svcForm=svcBuilderFormId?FORMS_DATA.find(x=>x.id===svcBuilderFormId):null;
  const svcFields=svcForm?(svcForm.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type)):[];
  // Support bases autonomes (sdb_ID) et formulaires (ID numérique)
  const isSdb = String(ef.config?.formId||'').startsWith('sdb_');
  const targetForm = !isSdb && ef.config?.formId ? FORMS_DATA.find(x=>x.id===ef.config.formId) : null;
  const targetSDB  = isSdb ? DATABASES_DATA.find(x=>x.id===parseInt(String(ef.config.formId).replace('sdb_',''))) : null;
  const dbFields = targetForm ? (targetForm.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type))
                 : targetSDB  ? targetSDB.columns : [];
  const fOpts = [
    `<optgroup label="Bases autonomes">${DATABASES_DATA.map(db=>`<option value="sdb_${db.id}" ${ef.config?.formId==='sdb_'+db.id?'selected':''}>${h(db.nom)}</option>`).join('')}</optgroup>`,
    `<optgroup label="Liées aux formulaires">${FORMS_DATA.filter(f=>f.actif!==false).map(f=>`<option value="${f.id}" ${ef.config?.formId===f.id?'selected':''}>${h(f.nom)}</option>`).join('')}</optgroup>`
  ].join('');
  const dbFOpts=(sel)=>dbFields.map(f=>`<option value="${f.id}" ${sel===f.id?'selected':''}>${h(f.nom)}</option>`).join('');
  const svcFOpts=(sel)=>svcFields.map(f=>`<option value="${f.id}" ${sel===f.id?'selected':''}>${h(f.nom)}</option>`).join('');
  const criteria=ef.config?.matchCriteria||[];const updates=ef.config?.updates||[];
  let html=`<div style="margin-top:6px"><div class="fl2" style="margin-bottom:4px">Base de données cible</div>
    <select class="ci" onchange="updateEffect(${ai},${ei},'formId',this.value)">
      <option value="">— Choisir —</option>${fOpts}
    </select></div>`;
  if(!targetForm&&!targetSDB)return html;
  html+=`<div style="margin-top:10px"><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;margin-bottom:6px">🔍 Critères (identifier la ligne)</div>`;
  criteria.forEach((c,ci)=>{html+=`<div style="display:flex;gap:5px;align-items:center;margin-bottom:6px;background:#f8fafc;border-radius:7px;padding:7px 8px">
    <select class="ci" style="flex:1;font-size:11.5px" onchange="updateMatchCriteria(${ai},${ei},${ci},'dbFieldId',this.value)"><option value="">Colonne DB</option>${dbFOpts(c.dbFieldId)}</select>
    <span style="font-size:11px;color:var(--tl);flex-shrink:0">=</span>
    <select class="ci" style="width:120px;font-size:11.5px" onchange="updateMatchCriteria(${ai},${ei},${ci},'sourceType',this.value)">
      <option value="form_field" ${c.sourceType==='form_field'?'selected':''}>Champ actuel</option>
      <option value="fixed" ${c.sourceType==='fixed'?'selected':''}>Valeur fixe</option>
    </select>
    ${c.sourceType==='form_field'?`<select class="ci" style="flex:1;font-size:11.5px" onchange="updateMatchCriteria(${ai},${ei},${ci},'sourceFieldId',this.value)"><option value="">Champ</option>${svcFOpts(c.sourceFieldId)}</select>`:`<input class="ci" style="flex:1;font-size:11.5px" value="${h(c.value||'')}" placeholder="Valeur fixe..." oninput="updateMatchCriteria(${ai},${ei},${ci},'value',this.value)">`}
    <button class="ic-btn" onclick="removeMatchCriteria(${ai},${ei},${ci})">✕</button>
  </div>`;});
  html+=`<button style="width:100%;padding:5px;border-radius:6px;border:1.5px dashed var(--p);background:transparent;color:var(--p);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit" onclick="addMatchCriteria(${ai},${ei})">＋ Ajouter un critère</button></div>`;
  html+=`<div style="margin-top:10px"><div style="font-size:10px;font-weight:800;color:var(--tl);text-transform:uppercase;margin-bottom:6px">✏️ Modifications à appliquer</div>`;
  updates.forEach((u,ui)=>{html+=`<div style="display:flex;gap:5px;align-items:center;margin-bottom:6px;background:#f8fafc;border-radius:7px;padding:7px 8px">
    <select class="ci" style="flex:1;font-size:11.5px" onchange="updateDbUpdate(${ai},${ei},${ui},'dbFieldId',this.value)"><option value="">Colonne DB</option>${dbFOpts(u.dbFieldId)}</select>
    <span style="font-size:11px;color:var(--tl);flex-shrink:0">=</span>
    <select class="ci" style="width:120px;font-size:11.5px" onchange="updateDbUpdate(${ai},${ei},${ui},'sourceType',this.value)">
      <option value="fixed" ${u.sourceType==='fixed'?'selected':''}>Valeur fixe</option>
      <option value="form_field" ${u.sourceType==='form_field'?'selected':''}>Champ actuel</option>
    </select>
    ${u.sourceType==='form_field'?`<select class="ci" style="flex:1;font-size:11.5px" onchange="updateDbUpdate(${ai},${ei},${ui},'sourceFieldId',this.value)"><option value="">Champ</option>${svcFOpts(u.sourceFieldId)}</select>`:`<input class="ci" style="flex:1;font-size:11.5px" value="${h(u.value||'')}" placeholder="Nouvelle valeur..." oninput="updateDbUpdate(${ai},${ei},${ui},'value',this.value)">`}
    <button class="ic-btn" onclick="removeDbUpdate(${ai},${ei},${ui})">✕</button>
  </div>`;});
  html+=`<button style="width:100%;padding:5px;border-radius:6px;border:1.5px dashed var(--s);background:transparent;color:var(--s);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit" onclick="addDbUpdate(${ai},${ei})">＋ Ajouter une modification</button></div>`;
  return html;
}
function addMatchCriteria(ai,ei){const ef=svcBuilderActions[ai].effects[ei];if(!ef.config)ef.config={};if(!ef.config.matchCriteria)ef.config.matchCriteria=[];ef.config.matchCriteria.push({dbFieldId:'',sourceType:'form_field',sourceFieldId:'',value:''});renderSvcTab();}
function removeMatchCriteria(ai,ei,ci){svcBuilderActions[ai].effects[ei].config.matchCriteria.splice(ci,1);renderSvcTab();}
function updateMatchCriteria(ai,ei,ci,key,val){const c=svcBuilderActions[ai].effects[ei].config.matchCriteria[ci];if(!c)return;c[key]=val;if(key==='sourceType')renderSvcTab();}
function addDbUpdate(ai,ei){const ef=svcBuilderActions[ai].effects[ei];if(!ef.config)ef.config={};if(!ef.config.updates)ef.config.updates=[];ef.config.updates.push({dbFieldId:'',sourceType:'fixed',value:''});renderSvcTab();}
function removeDbUpdate(ai,ei,ui){svcBuilderActions[ai].effects[ei].config.updates.splice(ui,1);renderSvcTab();}
function updateDbUpdate(ai,ei,ui,key,val){const u=svcBuilderActions[ai].effects[ei].config.updates[ui];if(!u)return;u[key]=val;if(key==='sourceType')renderSvcTab();}
function addComment(instId) {
  const inst = SERVICE_INSTANCES_DATA.find(x => x.id === instId); if (!inst) return;
  const svc  = SERVICES_DATA.find(s => s.id === inst.serviceId);
  const input = document.getElementById('comment-input-' + instId);
  const text  = input ? input.value.trim() : '';
  if (!text) { toast('e','⚠️ Saisissez un commentaire'); if (input) input.focus(); return; }
  const now = new Date().toLocaleString('fr-FR');
  inst.events.push({id:Date.now(), type:'commented', actor:'Picot Clément', at:now, payload:{comment:text}});
  if (input) input.value = '';
  toast('s','💬 Commentaire ajouté');
  if (svc) renderInstanceDetail(inst, svc);
}

// ── Modal formulaire lié (fill_form) ──
function openLinkedFormModal(inst, svc, action, f) {
  const old = document.getElementById('linked-form-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'linked-form-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:1100;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.dataset.instId = inst.id;
  modal.dataset.actionId = action.id;
  modal.dataset.formId = f.id;

  const color = f.couleur || '#3b82f6';
  const fields = (f.fields||[]).filter(x=>!['separator','image','titre'].includes(x.type));

  let fieldsHtml = '';
  fields.forEach(fld => {
    const fd = FD[fld.type]||{l:fld.nom};
    fieldsHtml += `<div style="margin-bottom:14px">
      <div style="font-size:12.5px;font-weight:600;margin-bottom:5px">${h(fld.nom)}${fld.obligatoire?'<span style="color:#ef4444"> *</span>':''}</div>`;
    if (fld.type==='text')     fieldsHtml += `<input class="ci" data-fid="${fld.id}" placeholder="Saisir..." style="width:100%">`;
    else if (fld.type==='textarea') fieldsHtml += `<textarea class="ci" data-fid="${fld.id}" style="width:100%;height:72px;resize:none" placeholder="Saisir..."></textarea>`;
    else if (fld.type==='select') fieldsHtml += `<select class="ci" data-fid="${fld.id}" style="width:100%"><option value="">— Sélectionner —</option>${(fld.valeurs||[]).map(v=>`<option>${h(v)}</option>`).join('')}</select>`;
    else if (fld.type==='date') fieldsHtml += `<input type="date" class="ci" data-fid="${fld.id}">`;
    else if (fld.type==='number') fieldsHtml += `<input type="number" class="ci" data-fid="${fld.id}" value="0">`;
    else fieldsHtml += `<input class="ci" data-fid="${fld.id}" placeholder="${fd.l}" style="width:100%">`;
    fieldsHtml += `</div>`;
  });

  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:100%;max-width:560px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="padding:16px 20px;border-bottom:1.5px solid var(--bd);display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div style="font-size:15px;font-weight:800;flex:1">${h(action.nom)} — ${h(f.nom)}</div>
        <button onclick="document.getElementById('linked-form-modal').remove()" style="width:30px;height:30px;border-radius:7px;border:1.5px solid var(--bd);background:#fff;cursor:pointer;font-size:14px;color:var(--tm)">✕</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:20px">${fieldsHtml||'<div style="color:var(--tl);text-align:center;padding:20px">Ce formulaire n\'a pas de champ de saisie.</div>'}</div>
      <div style="padding:14px 20px;border-top:1.5px solid var(--bd);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">
        <button onclick="document.getElementById('linked-form-modal').remove()" class="btn btn-sm">Annuler</button>
        <button onclick="submitLinkedForm()" class="btn bp btn-sm">✅ Valider</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function submitLinkedForm() {
  const modal = document.getElementById('linked-form-modal'); if (!modal) return;
  const instId = +modal.dataset.instId;
  const formId = +modal.dataset.formId;
  const inst = SERVICE_INSTANCES_DATA.find(x => x.id === instId); if (!inst) return;
  const svc  = SERVICES_DATA.find(s => s.id === inst.serviceId);
  const f = FORMS_DATA.find(x => x.id === formId); if (!f) return;

  const values = {};
  modal.querySelectorAll('[data-fid]').forEach(el => { values[el.dataset.fid] = el.value; });

  const now = new Date().toLocaleString('fr-FR');
  const subId = Date.now();
  SUBMISSIONS_DATA.push({id:subId, formId:f.id, formNom:f.nom, date:new Date().toISOString(), dateLabel:now, utilisateur:'Picot Clément', values});
  f.resp = (f.resp||0) + 1;
  inst.events.push({id:Date.now(), type:'form_filled', actor:'Picot Clément', at:now, payload:{formNom:f.nom, submissionId:subId}});

  modal.remove();
  toast('s', `📋 "${f.nom}" soumis`);
  if (svc) renderInstanceDetail(inst, svc);
}
