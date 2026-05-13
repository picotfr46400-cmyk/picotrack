// ══ PicoTrack — Mode PAD Terrain ══
// Gère : détection mobile, écran de connexion, interface terrain

// ─── Détection ───────────────────────────────────────────────

function isPadMode() {
  return new URLSearchParams(location.search).get('mode') === 'pad'
    || !!localStorage.getItem('pt_pad')
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

function initPadMode() {
  if (!isPadMode()) return; // Desktop normal → rien à faire

  const cfg = getPadConfig();

  // Cacher la sidebar desktop
  const sb = document.getElementById('sb');
  if (sb) sb.style.display = 'none';

  // Ajuster le main pour plein écran
  const main = document.getElementById('main');
  if (main) { main.style.marginLeft = '0'; main.style.width = '100%'; }

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
      <!-- Logo -->
      <div style="text-align:center;margin-bottom:28px">
        <img src="logo-picotrack.png" style="height:36px" onerror="this.style.display='none'">
        <div style="font-size:22px;font-weight:900;color:#f1f5f9;margin-top:8px">PicoTrack</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">Connexion terminal terrain</div>
      </div>

      <!-- Méthode 1 : Code environnement -->
      <div style="margin-bottom:20px">
        <label style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:8px">
          Code environnement
        </label>
        <input id="pad-env-code" placeholder="ex: EDF-BLAYAIS" style="
          width:100%;box-sizing:border-box;background:#0f172a;border:1.5px solid #334155;
          border-radius:10px;padding:12px 14px;color:#f1f5f9;font-size:14px;
          font-family:inherit;outline:none
        " oninput="padCodeChanged(this.value)">
        <div id="pad-env-name" style="font-size:12px;color:#059669;margin-top:6px;min-height:18px"></div>
      </div>

      <!-- OU séparateur -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
        <div style="flex:1;height:1px;background:#334155"></div>
        <span style="font-size:11px;color:#475569">ou</span>
        <div style="flex:1;height:1px;background:#334155"></div>
      </div>

      <!-- Méthode 2 : Scanner QR -->
      <button onclick="startQRScan()" style="
        width:100%;padding:13px;border-radius:10px;border:1.5px dashed #334155;
        background:transparent;color:#94a3b8;font-size:13px;font-weight:600;
        cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;
        font-family:inherit;margin-bottom:20px
      ">
        📷 Scanner un QR code d'environnement
      </button>

      <!-- Bouton connexion -->
      <button id="pad-connect-btn" onclick="connectPad()" style="
        width:100%;padding:14px;border-radius:10px;border:none;
        background:#059669;color:#fff;font-size:14px;font-weight:700;
        cursor:pointer;font-family:inherit;opacity:.4;pointer-events:none
      ">
        Connecter ce terminal →
      </button>

      <div id="pad-error" style="color:#ef4444;font-size:12px;text-align:center;margin-top:12px;min-height:16px"></div>

      <!-- Info version -->
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
  const env = ENV_CODES[code];
  const nameEl = document.getElementById('pad-env-name');
  const btn = document.getElementById('pad-connect-btn');
  if (env) {
    nameEl.textContent = '✓ ' + env.nom + ' — ' + env.client;
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
  } else {
    nameEl.textContent = code.length > 2 ? 'Code non reconnu' : '';
    nameEl.style.color = code.length > 2 ? '#ef4444' : '#059669';
    btn.style.opacity = '.4';
    btn.style.pointerEvents = 'none';
  }
}

function connectPad() {
  const code = document.getElementById('pad-env-code').value.toUpperCase().trim();
  const env = ENV_CODES[code];
  if (!env) {
    document.getElementById('pad-error').textContent = 'Code environnement invalide';
    return;
  }
  savePadConfig(env);
 document.querySelectorAll('#pad-overlay').forEach(el => el.remove());
  applyPadEnvironment(env);
  showPadHome();
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
      <div style="width:8px;height:8px;border-radius:50%;background:#10b981" title="Connecté"></div>
    </div>`);
  }

  // Ajuster le padding du main pour la topbar et navbar fixe
  const main = document.getElementById('main');
  if (main) {
    main.style.paddingTop = '56px';
    main.style.paddingBottom = '70px';
  }

  setTimeout(() => { padGoForms(); }, 150);
}

// ─── Navigation PAD ───────────────────────────────────────────

function padGoForms() {
  padSetActive('pnav-forms');
  setPadTitle('Formulaires');
  const main = document.getElementById('main');
  if (main) main.style.display = 'block';
  if (typeof goProduction === 'function') goProduction();
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  const pf = document.getElementById('v-prod-forms');
  if (pf) { pf.style.display = 'block'; pf.classList.add('on'); }
}

function padGoServices() {
  padSetActive('pnav-services');
  setPadTitle('Services');
  if (typeof goProdServices === 'function') goProdServices();
}

function padGoProfile() {
  padSetActive('pnav-profile');
  setPadTitle('Terminal');
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
  el.style.display = 'block';
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
// Auto-init
initPadMode();
