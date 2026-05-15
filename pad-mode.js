// ══ PicoTrack — Mode PAD Terrain ══
// Gère : détection mobile, écran de connexion, interface terrain

// ─── Détection ───────────────────────────────────────────────

function isPadMode() {
  return new URLSearchParams(location.search).get('mode') === 'pad'
    || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function getPadConfig() {
  try { return JSON.parse(localStorage.getItem('pt_pad') || 'null'); } catch { return null; }
}

function savePadConfig(cfg) {
  localStorage.setItem('pt_pad', JSON.stringify({ ...cfg, savedAt: new Date().toISOString() }));
}

function clearPadConfig() {
  localStorage.removeItem('pt_pad');
  location.reload();
}

// ─── Initialisation au chargement ────────────────────────────

let _padInitDone = false;
function initPadMode() {
  if (!isPadMode() || _padInitDone) return;
  _padInitDone = true;
// Patch show() pour compatibilité PAD
  const _origShow = window.show;
  window.show = function(id) {
    document.querySelectorAll('.view').forEach(v => v.style.removeProperty('display'));
    if (_origShow) _origShow(id);
  };
  // Injecter le CSS mobile
  if (!document.getElementById('pad-css')) {
    const link = document.createElement('link');
    link.id = 'pad-css';
    link.rel = 'stylesheet';
    link.href = 'pad.css';
    document.head.appendChild(link);
  }
  // Ajouter classe sur body pour les règles CSS
  document.body.classList.add('pad-mode');

  const cfg = getPadConfig();

  // Cacher la sidebar desktop
  const sb = document.getElementById('sb');
  if (sb) sb.style.display = 'none';

  // Géré par pad.css via body.pad-mode

  if (!cfg) {
    // Pas encore configuré → écran de connexion
    showPadConnectionScreen();
  } else {
    // Déjà configuré → mode terrain direct
    applyPadEnvironment(cfg);
    showPadHome();
  }
}

// ─── Écran de connexion PAD ───────────────────────────────────

function showPadConnectionScreen() {
  if (document.getElementById('pad-overlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
  <div id="pad-overlay" style="
    position:fixed;inset:0;background:#0f172a;
    display:flex;align-items:center;justify-content:center;
    z-index:99999;font-family:'DM Sans',sans-serif;padding:20px
  ">
    <div style="
      background:#1e293b;border-radius:20px;padding:36px 28px;
      width:100%;max-width:400px;border:1px solid #334155;
      box-shadow:0 30px 80px rgba(0,0,0,.6)
    ">
      <div style="text-align:center;margin-bottom:28px">
        <img src="logo-picotrack.png" style="height:36px" onerror="this.style.display='none'">
        <div style="font-size:22px;font-weight:900;color:#f1f5f9;margin-top:8px">PicoTrack</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">Connexion terminal terrain</div>
      </div>

      <div style="margin-bottom:18px">
        <label style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:8px">
          Code environnement
        </label>
        <input id="pad-env-code" placeholder="ex: DEMO" style="
          width:100%;box-sizing:border-box;background:#0f172a;border:1.5px solid #334155;
          border-radius:10px;padding:12px 14px;color:#f1f5f9;font-size:14px;
          font-family:inherit;outline:none
        " oninput="padCodeChanged(this.value)">
        <div id="pad-env-name" style="font-size:12px;color:#059669;margin-top:6px;min-height:18px"></div>
      </div>

      <div style="margin-bottom:18px">
        <label style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:8px">
          Identifiant
        </label>
        <input id="pad-login-id" placeholder="ex: PAD1" style="
          width:100%;box-sizing:border-box;background:#0f172a;border:1.5px solid #334155;
          border-radius:10px;padding:12px 14px;color:#f1f5f9;font-size:14px;
          font-family:inherit;outline:none
        " oninput="padCodeChanged(document.getElementById('pad-env-code').value)">
      </div>

      <div style="margin-bottom:20px">
        <label style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:8px">
          Mot de passe
        </label>
        <input id="pad-login-pass" type="password" placeholder="Mot de passe" style="
          width:100%;box-sizing:border-box;background:#0f172a;border:1.5px solid #334155;
          border-radius:10px;padding:12px 14px;color:#f1f5f9;font-size:14px;
          font-family:inherit;outline:none
        " oninput="padCodeChanged(document.getElementById('pad-env-code').value)">
      </div>

      <button id="pad-connect-btn" onclick="connectPad()" style="
        width:100%;padding:14px;border-radius:10px;border:none;
        background:#059669;color:#fff;font-size:14px;font-weight:700;
        cursor:pointer;font-family:inherit;opacity:.4;pointer-events:none
      ">
        Connecter ce terminal →
      </button>

      <div id="pad-error" style="color:#ef4444;font-size:12px;text-align:center;margin-top:12px;min-height:16px"></div>

      <div style="text-align:center;margin-top:24px;font-size:10px;color:#475569">
        PicoTrack · Terminal Nomade
      </div>
    </div>
  </div>`);
}
// ─── Logique de connexion ──────────────────────────────────────

// Mapping codes → environnements (en prod : viendra de l'API)
const ENV_CODES = {
  'EDF-BLAYAIS': { id: 'edf-blayais', nom: 'EDF Blayais', client: 'EDF', couleur: '#0ea5e9' },
  'DEMO':        { id: 'demo',        nom: 'Environnement Demo', client: 'PicoTrack', couleur: '#059669' },
};

function padCodeChanged(val) {
  const code = val.toUpperCase().trim();
  const identifiant = (document.getElementById('pad-login-id')?.value || '').trim();
  const pass = (document.getElementById('pad-login-pass')?.value || '').trim();
  const env = ENV_CODES[code];
  const nameEl = document.getElementById('pad-env-name');
  const btn = document.getElementById('pad-connect-btn');

  if (env) {
    nameEl.textContent = '✓ ' + env.nom + ' — ' + env.client;
    nameEl.style.color = '#059669';
  } else {
    nameEl.textContent = code.length > 2 ? 'Code non reconnu' : '';
    nameEl.style.color = code.length > 2 ? '#ef4444' : '#059669';
  }

  if (env && identifiant.length >= 1 && pass.length >= 1) {
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
  } else {
    btn.style.opacity = '.4';
    btn.style.pointerEvents = 'none';
  }
}

async function connectPad() {
  const code = document.getElementById('pad-env-code').value.toUpperCase().trim();
  const identifiant = document.getElementById('pad-login-id').value.trim();
  const pass = document.getElementById('pad-login-pass').value.trim();
  const env = ENV_CODES[code];
  const errorEl = document.getElementById('pad-error');

  if (!env) {
    errorEl.textContent = 'Code environnement invalide';
    return;
  }

  if (!identifiant || !pass) {
    errorEl.textContent = 'Identifiant et mot de passe obligatoires';
    return;
  }

  try {
    const rows = await sbFetch(
      `licenses?environment_code=eq.${encodeURIComponent(code)}&email=eq.${encodeURIComponent(identifiant)}&password_hash=eq.${encodeURIComponent(pass)}&license_type=in.(nomade,pad,PAD)&active=eq.true&select=*`
    );

    if (!rows || !rows.length) {
      errorEl.textContent = 'Identifiants PAD invalides ou licence inactive';
      return;
    }

    await sbFetch(
      `licenses?id=eq.${rows[0].id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          last_seen: new Date().toISOString(),
          device_name: navigator.userAgent.slice(0, 120)
        })
      }
    );

    savePadConfig({
      ...env,
      code,
      login: identifiant,
      licenseId: rows[0].id,
      licenseKey: rows[0].license_key,
      licenseLabel: rows[0].label || '',
      role: rows[0].role || '',
      roles: Array.isArray(rows[0].roles) ? rows[0].roles : (rows[0].role ? [rows[0].role] : [])
    });

    document.querySelectorAll('#pad-overlay').forEach(el => el.remove());
    applyPadEnvironment(env);
    showPadHome();
    if (typeof checkSupabaseConnection === 'function') await checkSupabaseConnection();
    if (typeof syncAllFromSupabase === 'function') await syncAllFromSupabase();
    if (typeof startSync === 'function') startSync();
    if (typeof padGoForms === 'function') padGoForms();

  } catch (e) {
    console.warn('[PAD] Login error:', e);
    errorEl.textContent = 'Erreur vérification connexion';
  }
}

function applyPadEnvironment(cfg) {
  // Forcer l'environnement courant
  if (typeof CURRENT_ENVIRONMENT_ID !== 'undefined') {
    window.CURRENT_ENVIRONMENT_ID = cfg.id;
  }
}

// ─── QR Code Scanner ──────────────────────────────────────────

function startQRScan() {
  // On utilise jsQR (à charger) ou l'API native Android
  // Implémentation Phase 2 avec jsQR.js
  // Format QR attendu : picotrack://connect?env=EDF-BLAYAIS&token=XXXX
  alert('Scanner QR → disponible Phase 2\n\nPour l\'instant, entrez le code manuellement.');
}

// ─── Interface PAD Home (après connexion) ─────────────────────

function showPadHome() {
  const cfg = getPadConfig();
  if (!cfg) return;

  // Masquer topbar et breadcrumb desktop
  const tb = document.getElementById('topbar');
  const bc = document.getElementById('breadcrumb');
  if (tb) tb.style.display = 'none';
  if (bc) bc.style.display = 'none';

  // Injecter la navbar PAD en bas d'écran
  if (!document.getElementById('pad-navbar')) {
    document.body.insertAdjacentHTML('beforeend', `
    <div id="pad-navbar" style="
      position:fixed;bottom:0;left:0;right:0;
      background:#1e293b;border-top:1px solid #334155;
      display:flex;z-index:1000;padding-bottom:env(safe-area-inset-bottom)
    ">
      <button onclick="padGoForms()" id="pnav-forms" style="
        flex:1;padding:12px 8px;border:none;background:transparent;
        color:#059669;font-size:10px;font-weight:700;cursor:pointer;
        display:flex;flex-direction:column;align-items:center;gap:3px;font-family:inherit
      "><span style="font-size:20px">📋</span>Formulaires</button>

      <button onclick="padGoServices()" id="pnav-services" style="
        flex:1;padding:12px 8px;border:none;background:transparent;
        color:#94a3b8;font-size:10px;font-weight:700;cursor:pointer;
        display:flex;flex-direction:column;align-items:center;gap:3px;font-family:inherit
      "><span style="font-size:20px">⚡</span>Services</button>

      <button onclick="padGoProfile()" id="pnav-profile" style="
        flex:1;padding:12px 8px;border:none;background:transparent;
        color:#94a3b8;font-size:10px;font-weight:700;cursor:pointer;
        display:flex;flex-direction:column;align-items:center;gap:3px;font-family:inherit
      "><span style="font-size:20px">👤</span>Terminal</button>
    </div>`);
  }

  // Injecter la topbar PAD
  if (!document.getElementById('pad-topbar')) {
    document.body.insertAdjacentHTML('afterbegin', `
    <div id="pad-topbar" style="
      position:fixed;top:0;left:0;right:0;height:56px;
      background:#1e293b;border-bottom:1px solid #334155;
      display:flex;align-items:center;padding:0 16px;
      z-index:999;gap:12px
    ">
      <img src="logo-picotrack.png" style="height:24px" onerror="this.style.display='none'">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:800;color:#f1f5f9" id="pad-tb-title">Formulaires</div>
        <div style="font-size:10px;color:#059669;font-weight:600">${cfg.nom}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:#94a3b8;font-weight:700">
        <span id="pad-sync-dot" style="width:8px;height:8px;border-radius:50%;background:#f59e0b;display:inline-block" title="Synchronisation"></span>
        <span id="pad-sync-text">Synchronisation…</span>
      </div>
    </div>`);
  }

  // Ajuster le padding du main pour la topbar et navbar fixe
  const main = document.getElementById('main');
  if (main) {
    main.style.paddingTop = '56px';
    main.style.paddingBottom = '70px';
  }

    padGoForms();
}

// ─── Navigation PAD ───────────────────────────────────────────

function padHideAll() {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('on');
    v.style.removeProperty('display');
  });
}

function padGoForms() {
  padSetActive('pnav-forms');
  setPadTitle('Formulaires');
  padHideAll();
  if (typeof goProduction === 'function') goProduction();
  // Forcer : une seule vue visible
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  const pf = document.getElementById('v-prod-forms');
 if (pf) { pf.style.removeProperty('display'); pf.classList.add('on'); }
}

function padGoServices() {
  padSetActive('pnav-services');
  setPadTitle('Services');
  padHideAll();
  if (typeof goProdServices === 'function') goProdServices();
  // Forcer : une seule vue visible
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
const ps = document.getElementById('v-prod-services-list');
  if (ps) { ps.style.removeProperty('display'); ps.classList.add('on'); }
}

function padGoProfile() {
  padSetActive('pnav-profile');
  setPadTitle('Terminal');
  padHideAll();
  showPadProfileView();
}

function padSetActive(id) {
  ['pnav-forms','pnav-services','pnav-profile'].forEach(i => {
    const el = document.getElementById(i);
    if (el) el.style.color = i === id ? '#059669' : '#94a3b8';
  });
}

function setPadTitle(t) {
  const el = document.getElementById('pad-tb-title');
  if (el) el.textContent = t;
}

// ─── Vue Profil Terminal ──────────────────────────────────────

function showPadProfileView() {
  const cfg = getPadConfig();
  const views = document.querySelectorAll('.view');
  views.forEach(v => v.style.display = 'none');

  const wrap = document.getElementById('main');
  let el = document.getElementById('pad-profile-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pad-profile-view';
    el.className = 'view';
    wrap.appendChild(el);
  }
  el.style.removeProperty('display');
  el.classList.add('on');
  el.style.padding = '24px 16px';
  el.style.overflowY = 'auto';
  el.style.height = 'calc(100vh - 56px - 70px)';

  el.innerHTML = `
    <div style="max-width:400px;margin:0 auto">
      <div style="background:#1e293b;border-radius:14px;padding:20px;margin-bottom:16px;border:1px solid #334155">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px;font-weight:700">Environnement connecté</div>
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:44px;height:44px;border-radius:12px;background:${cfg?.couleur || '#059669'}22;display:flex;align-items:center;justify-content:center;font-size:20px">🏢</div>
          <div>
            <div style="font-weight:800;color:#f1f5f9;font-size:15px">${cfg?.nom || '—'}</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px">${cfg?.client || ''}</div>
            <div style="font-size:10px;color:#059669;margin-top:4px;font-weight:700">● Connecté</div>
          </div>
        </div>
      </div>

      <div style="background:#1e293b;border-radius:14px;padding:20px;margin-bottom:16px;border:1px solid #334155">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px;font-weight:700">Informations terminal</div>
        <div style="font-size:13px;color:#94a3b8;line-height:2">
          <div>📱 ${navigator.userAgent.includes('Android') ? 'Android' : navigator.userAgent.includes('iPhone') ? 'iOS' : 'Tablette/PC'}</div>
          <div>📶 ${navigator.onLine ? 'En ligne' : '⚠️ Hors ligne'}</div>
          <div>🕐 Connecté le ${cfg?.savedAt ? new Date(cfg.savedAt).toLocaleDateString('fr-FR') : '—'}</div>
        </div>
      </div>

      <button onclick="clearPadConfig()" style="
        width:100%;padding:14px;border-radius:12px;border:1.5px solid #ef4444;
        background:transparent;color:#ef4444;font-size:14px;font-weight:700;
        cursor:pointer;font-family:inherit
      ">
        🔌 Déconnecter ce terminal
      </button>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   PAD LITE V3 — interface terrain simplifiée
   Objectif : exécution rapide, pas cockpit de pilotage.
   Ajouté en surcouche sans toucher au moteur formulaire/service.
═══════════════════════════════════════════════════════════════ */

function _padH(v){
  if (typeof h === 'function') return h(v == null ? '' : String(v));
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _padNow(){
  try { return new Date().toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}); }
  catch(e){ return ''; }
}

function _padVisibleForms(){
  const rows = Array.isArray(window.FORMS_DATA) ? window.FORMS_DATA : (typeof FORMS_DATA !== 'undefined' ? FORMS_DATA : []);
  return rows.filter(f => f && f.actif !== false && (!f.published || f.published !== false) && (typeof _ptCanSeeByRoles !== 'function' || _ptCanSeeByRoles(f.visibleRoles || f.visible_roles || [])));
}

function _padFormCount(formId){
  const subs = Array.isArray(window.SUBMISSIONS_DATA) ? window.SUBMISSIONS_DATA : (typeof SUBMISSIONS_DATA !== 'undefined' ? SUBMISSIONS_DATA : []);
  return subs.filter(s => String(s.formId) === String(formId)).length;
}

function _padLastSubmission(){
  const subs = Array.isArray(window.SUBMISSIONS_DATA) ? window.SUBMISSIONS_DATA : (typeof SUBMISSIONS_DATA !== 'undefined' ? SUBMISSIONS_DATA : []);
  return subs.slice().sort((a,b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))[0] || null;
}

function _padFormById(id){
  return _padVisibleForms().find(f => String(f.id) === String(id));
}

function _padInitials(name){
  const words = String(name || 'NA').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'NA';
  if (words.length === 1) return words[0].slice(0,2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function _padIconFor(name){
  const n = String(name || '').toLowerCase();
  if (n.includes('arriv') || n.includes('réception') || n.includes('reception')) return '📦';
  if (n.includes('check') || n.includes('sécurité') || n.includes('securite')) return '🛡️';
  if (n.includes('rapport') || n.includes('intervention')) return '📝';
  if (n.includes('poste')) return '👤';
  return '📋';
}

function _padPrimaryForm(){
  const forms = _padVisibleForms();
  return forms[0] || null;
}

function showPadHome(){
  const cfg = getPadConfig();
  if (!cfg) return;

  const tb = document.getElementById('topbar');
  const bc = document.getElementById('breadcrumb');
  if (tb) tb.style.display = 'none';
  if (bc) bc.style.display = 'none';
  document.body.classList.add('pad-mode', 'pad-lite-v3');

  const sb = document.getElementById('sb');
  if (sb) sb.style.display = 'none';

  document.querySelectorAll('#pad-navbar,#pad-topbar').forEach(el => el.remove());

  document.body.insertAdjacentHTML('afterbegin', `
    <div id="pad-topbar" class="pad-lite-topbar">
      <div class="pad-lite-logo"><img src="logo-picotrack.png" onerror="this.style.display='none'"><span>PicoTrack</span></div>
      <div class="pad-lite-sync"><i></i><span>Synchro OK</span></div>
      <button class="pad-lite-user" onclick="padGoProfile()">👤 ${_padH(cfg.login || cfg.licenseLabel || 'PAD')}</button>
    </div>
  `);

  document.body.insertAdjacentHTML('beforeend', `
    <div id="pad-navbar" class="pad-lite-nav">
      <button id="pnav-home" onclick="padGoForms()"><span>🏠</span><b>Accueil</b></button>
      <button id="pnav-services" onclick="padGoServices()"><span>⚡</span><b>Services</b></button>
      <button id="pnav-scan" onclick="padGoScanner()"><span>▣</span><b>Scanner</b></button>
      <button id="pnav-profile" onclick="padGoProfile()"><span>👤</span><b>Profil</b></button>
    </div>
  `);

  const main = document.getElementById('main');
  if (main) {
    main.style.paddingTop = '64px';
    main.style.paddingBottom = '76px';
  }

  padGoForms();
}

function padHideAll(){
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('on');
    v.style.display = 'none';
  });
}

function padSetActive(id){
  ['pnav-home','pnav-scan','pnav-profile','pnav-forms','pnav-services'].forEach(i => {
    const el = document.getElementById(i);
    if (el) el.classList.toggle('active', i === id);
  });
}

function setPadTitle(t){
  const title = document.querySelector('#pad-topbar .pad-lite-logo span');
  if (title) title.textContent = t || 'PicoTrack';
}

function padGoForms(){
  padSetActive('pnav-home');
  setPadTitle('PicoTrack');
  padHideAll();

  const main = document.getElementById('main');
  if (!main) return;

  let el = document.getElementById('pad-home-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pad-home-view';
    el.className = 'view pad-lite-home';
    main.appendChild(el);
  }
  el.style.display = '';
  el.classList.add('on');
  renderPadLiteHome();
}

function renderPadLiteHome(){
  const cfg = getPadConfig() || {};
  const forms = _padVisibleForms();
  const quick = forms.slice(0,4);
  const last = _padLastSubmission();
  const lastForm = last ? _padFormById(last.formId) : null;
  const primary = _padPrimaryForm();
  const el = document.getElementById('pad-home-view');
  if (!el) return;

  el.innerHTML = `
    <div class="pad-lite-wrap">
      <section class="pad-lite-hello">
        <div>
          <div class="pad-lite-time">${_padH(_padNow())}</div>
          <h1>Bonjour ${_padH(cfg.login || cfg.licenseLabel || 'terrain')}</h1>
          <p>Prêt à enregistrer vos données terrain.</p>
        </div>
      </section>

      <button class="pad-lite-main-action" onclick="padShowFormPicker()">
        <span>＋</span>
        <strong>Nouvelle saisie</strong>
        <small>Créer une mission ou remplir un formulaire</small>
      </button>

      <section class="pad-lite-section">
        <h2>Accès rapides</h2>
        <div class="pad-lite-quick-grid">
          ${quick.map(f => `
            <button class="pad-lite-quick-card" onclick="padStartQuickForm('${_padH(f.id)}')">
              <i style="background:${_padH(f.couleur || '#2563eb')}18;color:${_padH(f.couleur || '#2563eb')}">${_padIconFor(f.nom)}</i>
              <span><b>${_padH(f.nom)}</b><small>${_padH(f.desc || (_padFormCount(f.id) + ' saisie' + (_padFormCount(f.id)>1?'s':'')))}</small></span>
              <em>›</em>
            </button>
          `).join('')}
          ${quick.length < 4 ? `
            <button class="pad-lite-quick-card" onclick="padGoScanner()">
              <i style="background:#8b5cf618;color:#7c3aed">▣</i>
              <span><b>Scanner</b><small>QR / Code-barres</small></span>
              <em>›</em>
            </button>
          ` : ''}
        </div>
      </section>

      <section class="pad-lite-section">
        <h2>Dernière saisie</h2>
        ${last && lastForm ? `
          <button class="pad-lite-last" onclick="padStartQuickForm('${_padH(lastForm.id)}')">
            <i>✅</i>
            <span><b>${_padH(lastForm.nom)}</b><small>${_padH(last.dateLabel || 'Dernière saisie')}</small></span>
            <strong>Refaire</strong>
          </button>
        ` : `
          <div class="pad-lite-empty">
            <b>Aucune saisie récente</b>
            <span>${primary ? 'Commencez avec “Nouvelle saisie”.' : 'Aucun formulaire disponible.'}</span>
          </div>
        `}
      </section>
    </div>
  `;
}

function padShowFormPicker(){
  const forms = _padVisibleForms();
  document.querySelectorAll('.pad-lite-modal').forEach(x => x.remove());
  document.body.insertAdjacentHTML('beforeend', `
    <div class="pad-lite-modal" onclick="if(event.target===this)this.remove()">
      <div class="pad-lite-sheet">
        <div class="pad-lite-sheet-head">
          <div><b>Nouvelle saisie</b><small>Choisissez un formulaire</small></div>
          <button onclick="document.querySelector('.pad-lite-modal')?.remove()">×</button>
        </div>
        <div class="pad-lite-form-list">
          ${forms.length ? forms.map(f => `
            <button onclick="padStartQuickForm('${_padH(f.id)}')">
              <i style="background:${_padH(f.couleur || '#2563eb')}18;color:${_padH(f.couleur || '#2563eb')}">${_padIconFor(f.nom)}</i>
              <span><b>${_padH(f.nom)}</b><small>${_padH(f.desc || (_padFormCount(f.id) + ' réponse' + (_padFormCount(f.id)>1?'s':'')))}</small></span>
              <em>›</em>
            </button>
          `).join('') : `<div class="pad-lite-empty"><b>Aucun formulaire disponible</b><span>Publiez un formulaire depuis le PC.</span></div>`}
        </div>
      </div>
    </div>
  `);
}

function padStartQuickForm(id){
  document.querySelectorAll('.pad-lite-modal').forEach(x => x.remove());
  const form = _padFormById(id);
  if (!form) { alert('Formulaire introuvable ou non disponible.'); return; }
  if (typeof openFormSaisie === 'function') {
    document.getElementById('pad-home-view')?.classList.remove('on');
    document.getElementById('pad-home-view') && (document.getElementById('pad-home-view').style.display = 'none');
    openFormSaisie(form.id);
    setPadTitle('Saisie');
  } else {
    alert('Module de saisie indisponible.');
  }
}

function padGoScanner(){
  padSetActive('pnav-scan');
  setPadTitle('Scanner');
  padHideAll();
  const main = document.getElementById('main');
  if (!main) return;
  let el = document.getElementById('pad-scanner-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pad-scanner-view';
    el.className = 'view pad-lite-home';
    main.appendChild(el);
  }
  el.style.display = '';
  el.classList.add('on');
  el.innerHTML = `
    <div class="pad-lite-wrap">
      <div class="pad-lite-scanner-card">
        <div class="pad-lite-scanner-icon">▣</div>
        <h1>Scanner</h1>
        <p>Lecture QR / code-barres.</p>
        <button onclick="startQRScan()">Démarrer le scan</button>
        <button class="ghost" onclick="padShowFormPicker()">Choisir un formulaire</button>
      </div>
    </div>`;
}


function _padServices(){
  return (typeof SERVICES_DATA !== 'undefined' ? SERVICES_DATA : []).filter(s => s && s.actif !== false);
}
function _padServiceInstances(){
  return (typeof SERVICE_INSTANCES_DATA !== 'undefined' ? SERVICE_INSTANCES_DATA : []).filter(Boolean);
}
function _padTerminalStatusIds(svc){
  return (svc.statuses || []).filter(s => s.type === 'terminal').map(s => s.id);
}
function _padStatusOf(svc, inst){
  return (svc.statuses || []).find(s => String(s.id) === String(inst.currentStatusId)) || null;
}
function _padIsTerminal(svc, inst){
  return _padTerminalStatusIds(svc).includes(inst.currentStatusId);
}
function _padInstanceTitle(svc, inst){
  try {
    if (typeof getInstanceTitle === 'function') return getInstanceTitle(svc, inst) || inst.reference || 'Mission';
  } catch(e) {}
  const sub = (typeof SUBMISSIONS_DATA !== 'undefined' ? SUBMISSIONS_DATA : []).find(x => String(x.id) === String(inst.submissionId));
  if (sub && sub.values) {
    const first = Object.values(sub.values).find(v => v !== null && v !== undefined && String(v).trim() !== '');
    if (first) return Array.isArray(first) ? first.join(', ') : String(first);
  }
  return inst.reference || svc.nom || 'Mission';
}
function _padMissionDateLabel(v){
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString('fr-FR', {day:'2-digit', month:'2-digit'}) + ' ' + d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
}
function _padActionsForInstance(svc, inst){
  const statusId = inst.currentStatusId;
  return (svc.actions || []).filter(a => (svc.flux || []).some(fl => String(fl.statusId) === String(statusId) && String(fl.actionId) === String(a.id) && fl.enabled !== false));
}
function _padCanTake(svc, inst){
  const st = _padStatusOf(svc, inst);
  const initial = st && st.type === 'initial';
  return initial && !inst.assignedTo && !_padIsTerminal(svc, inst);
}
function _padMyName(){
  const cfg = getPadConfig() || {};
  return cfg.login || cfg.licenseLabel || 'PAD';
}
function _padMissionCard(inst, svc, mode){
  const st = _padStatusOf(svc, inst) || {nom:'Statut', couleur:svc.couleur || '#2563eb'};
  const title = _padInstanceTitle(svc, inst);
  const acts = _padActionsForInstance(svc, inst);
  const primary = acts[0];
  const btnLabel = mode === 'take' ? 'Prendre' : (_padIsTerminal(svc, inst) ? 'Voir' : 'Continuer');
  return `
    <article class="pad-svc-card" onclick="padOpenMission('${_padH(inst.id)}')" style="--svc:${_padH(st.couleur || svc.couleur || '#2563eb')}">
      <div class="pad-svc-icon">⚡</div>
      <div class="pad-svc-body">
        <div class="pad-svc-top"><b>${_padH(svc.nom)}</b><span>${_padH(st.nom)}</span></div>
        <h3>${_padH(title)}</h3>
        <p>${_padH(inst.reference || '')}${inst.assignedTo ? ' · ' + _padH(inst.assignedTo) : ''}</p>
        <small>${_padH(_padMissionDateLabel(inst.createdAt))}</small>
      </div>
      <button onclick="event.stopPropagation();${primary && mode !== 'view' ? `padServiceExecute('${_padH(inst.id)}','${_padH(primary.id)}')` : `padOpenMission('${_padH(inst.id)}')`}">${btnLabel}</button>
    </article>`;
}
function padGoServices(){
  padSetActive('pnav-services');
  setPadTitle('Services');
  padHideAll();

  const main = document.getElementById('main');
  if (!main) return;
  let el = document.getElementById('pad-services-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pad-services-view';
    el.className = 'view pad-lite-home';
    main.appendChild(el);
  }
  el.style.display = '';
  el.classList.add('on');
  renderPadServicesLite();
}
function renderPadServicesLite(){
  const el = document.getElementById('pad-services-view');
  if (!el) return;
  const services = _padServices();
  const instances = _padServiceInstances();
  const me = _padMyName();
  const active = [];
  const toTake = [];
  const done = [];

  instances.forEach(inst => {
    const svc = services.find(s => String(s.id) === String(inst.serviceId));
    if (!svc) return;
    if (_padIsTerminal(svc, inst)) done.push({inst, svc});
    else if (_padCanTake(svc, inst)) toTake.push({inst, svc});
    else if (!inst.assignedTo || String(inst.assignedTo).toLowerCase() === String(me).toLowerCase()) active.push({inst, svc});
  });

  const activeSorted = active.slice().sort((a,b) => new Date(b.inst.createdAt||0) - new Date(a.inst.createdAt||0));
  const takeSorted = toTake.slice().sort((a,b) => new Date(a.inst.createdAt||0) - new Date(b.inst.createdAt||0));
  const doneSorted = done.slice().sort((a,b) => new Date(b.inst.updatedAt||b.inst.createdAt||0) - new Date(a.inst.updatedAt||a.inst.createdAt||0));

  el.innerHTML = `
    <div class="pad-lite-wrap pad-services-wrap">
      <section class="pad-svc-head">
        <div>
          <div class="pad-lite-time">${_padH(_padNow())}</div>
          <h1>Mes missions</h1>
          <p>Traitez uniquement les dossiers terrain utiles maintenant.</p>
        </div>
        <button onclick="padShowServicePicker()">＋ Nouveau</button>
      </section>

      ${activeSorted.length ? `
        <section class="pad-svc-focus">
          <span>Mission en cours</span>
          ${_padMissionCard(activeSorted[0].inst, activeSorted[0].svc, 'continue')}
        </section>` : ''}

      <section class="pad-lite-section">
        <h2>À prendre ${takeSorted.length ? `<em class="pad-svc-count">${takeSorted.length}</em>` : ''}</h2>
        <div class="pad-svc-list">
          ${takeSorted.slice(0,4).map(x => _padMissionCard(x.inst, x.svc, 'take')).join('') || `<div class="pad-lite-empty"><b>Aucune mission à prendre</b><span>Tout est traité ou déjà assigné.</span></div>`}
        </div>
      </section>

      <section class="pad-lite-section">
        <h2>En cours ${activeSorted.length ? `<em class="pad-svc-count">${activeSorted.length}</em>` : ''}</h2>
        <div class="pad-svc-list">
          ${activeSorted.slice(0,5).map(x => _padMissionCard(x.inst, x.svc, 'continue')).join('') || `<div class="pad-lite-empty"><b>Aucune mission en cours</b><span>Vous n’avez rien à traiter pour le moment.</span></div>`}
        </div>
      </section>

      <section class="pad-lite-section">
        <h2>Terminées récemment</h2>
        <div class="pad-svc-list compact">
          ${doneSorted.slice(0,3).map(x => _padMissionCard(x.inst, x.svc, 'view')).join('') || `<div class="pad-lite-empty"><b>Aucune mission terminée</b><span>Les dernières clôtures apparaîtront ici.</span></div>`}
        </div>
      </section>
    </div>`;
}
function padShowServicePicker(){
  const services = _padServices();
  document.querySelectorAll('.pad-lite-modal').forEach(x => x.remove());
  document.body.insertAdjacentHTML('beforeend', `
    <div class="pad-lite-modal" onclick="if(event.target===this)this.remove()">
      <div class="pad-lite-sheet">
        <div class="pad-lite-sheet-head">
          <div><b>Nouveau dossier</b><small>Choisissez un service</small></div>
          <button onclick="document.querySelector('.pad-lite-modal')?.remove()">×</button>
        </div>
        <div class="pad-lite-form-list">
          ${services.length ? services.map(svc => `
            <button onclick="document.querySelector('.pad-lite-modal')?.remove(); if(typeof openCreateInstance==='function'){openCreateInstance('${_padH(svc.id)}')} else {alert('Création indisponible.')} ">
              <i style="background:${_padH(svc.couleur || '#2563eb')}18;color:${_padH(svc.couleur || '#2563eb')}">⚡</i>
              <span><b>${_padH(svc.nom)}</b><small>${_padH(svc.desc || 'Créer un dossier terrain')}</small></span>
              <em>›</em>
            </button>
          `).join('') : `<div class="pad-lite-empty"><b>Aucun service disponible</b><span>Créez un service depuis le PC.</span></div>`}
        </div>
      </div>
    </div>`);
}
function padOpenMission(instId){
  const inst = _padServiceInstances().find(i => String(i.id) === String(instId));
  if (!inst) { alert('Mission introuvable.'); return; }
  const svc = _padServices().find(s => String(s.id) === String(inst.serviceId));
  if (!svc) { alert('Service introuvable.'); return; }
  const st = _padStatusOf(svc, inst) || {nom:'Statut', couleur:svc.couleur || '#2563eb'};
  const title = _padInstanceTitle(svc, inst);
  const actions = _padActionsForInstance(svc, inst);
  document.querySelectorAll('.pad-lite-modal').forEach(x => x.remove());
  document.body.insertAdjacentHTML('beforeend', `
    <div class="pad-lite-modal" onclick="if(event.target===this)this.remove()">
      <div class="pad-lite-sheet pad-mission-sheet">
        <div class="pad-lite-sheet-head">
          <div><b>${_padH(title)}</b><small>${_padH(svc.nom)} · ${_padH(inst.reference || '')}</small></div>
          <button onclick="document.querySelector('.pad-lite-modal')?.remove()">×</button>
        </div>
        <div class="pad-mission-status" style="--svc:${_padH(st.couleur || svc.couleur || '#2563eb')}">
          <span>${_padH(st.nom)}</span>
          <small>${_padH(_padMissionDateLabel(inst.createdAt))}</small>
        </div>
        <div class="pad-mission-actions">
          ${actions.length ? actions.map((a,idx) => `<button class="${idx===0?'main':''}" style="--svc:${_padH(a.couleur || svc.couleur || '#2563eb')}" onclick="padServiceExecute('${_padH(inst.id)}','${_padH(a.id)}')">${idx===0?'▶':'↳'} ${_padH(a.nom)}</button>`).join('') : `<div class="pad-lite-empty"><b>Aucune action disponible</b><span>Cette mission ne demande rien sur ce statut.</span></div>`}
          <button class="ghost" onclick="if(typeof openInstanceDetail==='function'){document.querySelector('.pad-lite-modal')?.remove();openInstanceDetail('${_padH(inst.id)}')}else{alert('Détail indisponible.')} ">Voir la fiche complète</button>
        </div>
      </div>
    </div>`);
}
function padServiceExecute(instId, actionId){
  if (typeof executeAction !== 'function') { alert('Action indisponible.'); return; }
  executeAction(instId, actionId);
  document.querySelectorAll('.pad-lite-modal').forEach(x => x.remove());
  setTimeout(() => {
    if (document.getElementById('pad-services-view')?.classList.contains('on')) renderPadServicesLite();
  }, 80);
}
