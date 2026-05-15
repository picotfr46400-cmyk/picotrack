// ══ PicoTrack — Connexion PC supervision v2 (multi-env) ══

let _ptLoginUser = null;

// ── Déconnexion ──
function logoutPc() {
  _ptLoginUser = null;
  sessionStorage.removeItem('pt_active_env');
  sessionStorage.removeItem('pt_active_tenant');
  ptSignOut();
}

// ── Init : session existante ? ──
async function checkPcLogin() {
  try {
    const user = await ptGetCurrentUser();
    if (user && user.active && _isSupervisionRole(user.role)) {
      const envCode = sessionStorage.getItem('pt_active_env');
      if (!envCode) {
        _ptLoginUser = user;
        const envs = await _getEnvs(user);
        renderEnvPicker(envs);
        return false;
      }
      window.PT_CURRENT_USER = {
        ...user,
        active_env: envCode,
        active_tenant_id: sessionStorage.getItem('pt_active_tenant')
      };
      return true;
    }
  } catch (e) {
    console.warn('[Login] session check:', e.message);
  }
  renderPcLogin();
  return false;
}

function _isSupervisionRole(role) {
  return ['super_admin', 'supervision', 'manager', 'admin'].includes(role);
}

async function _getEnvs(user) {
  try {
    if (user.role === 'super_admin') {
      return await sbFetch('tenants?select=*&actif=eq.true&order=nom.asc');
    }
    return await sbFetch(`tenants?id=eq.${user.tenant_id}&select=*`);
  } catch (e) {
    console.warn('[Login] envs fetch:', e.message);
    return [];
  }
}

// ════════════════════════════════════════
// ÉTAPE 1 — Email / Password
// ════════════════════════════════════════
function renderPcLogin() {
  document.body.innerHTML = `
    <style>
      *{box-sizing:border-box}
      body{margin:0;font-family:'DM Sans',sans-serif}
      .pli{width:100%;padding:14px 16px;border:1.5px solid #E2E8F0;border-radius:12px;font-size:15px;outline:none;font-family:inherit;transition:border-color .2s}
      .pli:focus{border-color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,.1)}
      .plb{width:100%;padding:16px;background:linear-gradient(135deg,#059669,#047857);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;transition:opacity .2s;margin-top:8px}
      .plb:hover{opacity:.9}
      .plb:disabled{opacity:.6;cursor:not-allowed}
    </style>
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#071827 0%,#0f2a3d 50%,#071827 100%)">
      <div style="width:440px;background:#fff;border-radius:24px;box-shadow:0 40px 100px rgba(0,0,0,.4);overflow:hidden">
        <div style="padding:36px 36px 24px;text-align:center;border-bottom:1px solid #F1F5F9">
          <img src="logo-picotrack.png" style="max-width:180px;margin-bottom:16px" onerror="this.style.display='none'">
          <h1 style="font-size:22px;margin:0;color:#0F172A;font-weight:800">Connexion</h1>
          <p style="font-size:13px;color:#64748B;margin-top:6px">Interface de supervision PicoTrack</p>
        </div>
        <div style="padding:28px 36px 36px">
          <div style="margin-bottom:18px">
            <label style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.6px">Email</label>
            <input id="pc-login-id" type="email" autocomplete="email" class="pli" style="margin-top:8px" placeholder="votre@email.com"
              onkeydown="if(event.key==='Enter')document.getElementById('pc-login-pass').focus()">
          </div>
          <div style="margin-bottom:18px">
            <label style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.6px">Mot de passe</label>
            <input id="pc-login-pass" type="password" autocomplete="current-password" class="pli" style="margin-top:8px" placeholder="••••••••"
              onkeydown="if(event.key==='Enter')doPcLogin()">
          </div>
          <div id="pc-login-err" style="display:none;margin-bottom:14px;padding:12px 16px;background:#FEF2F2;border:1.5px solid #FECACA;border-radius:12px;color:#DC2626;font-size:13px;font-weight:700;text-align:center"></div>
          <button onclick="doPcLogin()" id="pc-login-btn" class="plb">Continuer →</button>
          <p style="text-align:center;font-size:11.5px;color:#CBD5E1;margin-top:20px">PicoTrack Nexus · Accès réservé</p>
        </div>
      </div>
    </div>
  `;
  setTimeout(() => { document.getElementById('pc-login-id')?.focus(); }, 80);
}

async function doPcLogin() {
  const email    = document.getElementById('pc-login-id')?.value.trim();
  const password = document.getElementById('pc-login-pass')?.value;
  const btn      = document.getElementById('pc-login-btn');

  if (!email || !password) { _loginErr('Veuillez saisir votre email et mot de passe.'); return; }

  btn.textContent = 'Vérification…'; btn.disabled = true;
  document.getElementById('pc-login-err').style.display = 'none';

  try {
    await ptSignIn(email, password);
    const user = await ptGetCurrentUser();

    if (!user)                        { _loginErr('Compte introuvable. Contactez votre administrateur.'); _resetBtn(); return; }
    if (!user.active)                 { _loginErr('Compte désactivé. Contactez votre administrateur.'); _resetBtn(); return; }
    if (!_isSupervisionRole(user.role)) { _loginErr('Accès non autorisé pour ce rôle.'); _resetBtn(); return; }

    _ptLoginUser = user;
    const envs = await _getEnvs(user);

    if (!envs || envs.length === 0) { _loginErr('Aucun environnement disponible.'); _resetBtn(); return; }
    if (envs.length === 1)          { _selectEnv(envs[0]); return; }

    renderEnvPicker(envs);

  } catch (e) {
    console.warn('[Login]', e.message);
    _loginErr(e.message?.includes('Invalid login') ? 'Email ou mot de passe incorrect.' : 'Erreur de connexion. Réessayez.');
    _resetBtn();
  }
}

// ════════════════════════════════════════
// ÉTAPE 2 — Sélecteur d'environnement
// ════════════════════════════════════════
function renderEnvPicker(envs) {
  const isSuperAdmin = _ptLoginUser?.role === 'super_admin';

  const cards = envs.map(env => {
    const couleur = env.couleur || '#059669';
    return `
      <div onclick="_selectEnvById('${env.id}','${env.code}')"
        style="display:flex;align-items:center;gap:14px;padding:16px 20px;border:1.5px solid #E2E8F0;border-radius:16px;cursor:pointer;transition:all .15s;background:#fff"
        onmouseover="this.style.borderColor='${couleur}';this.style.background='#F0FDF4';this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'"
        onmouseout="this.style.borderColor='#E2E8F0';this.style.background='#fff';this.style.transform='none';this.style.boxShadow='none'">
        <div style="width:44px;height:44px;border-radius:12px;background:${couleur}18;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏢</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:800;color:#0F172A">${env.nom}</div>
          <div style="font-size:12px;color:#64748B;margin-top:2px">
            Code : <strong>${env.code}</strong> · Plan <strong>${env.plan || 'starter'}</strong>
            · ${env.max_pad || 10} licences PAD · ${env.max_supervision || 3} supervision
          </div>
        </div>
        <div style="color:${couleur};font-size:18px;flex-shrink:0">→</div>
      </div>`;
  }).join('');

  document.body.innerHTML = `
    <style>*{box-sizing:border-box}body{margin:0;font-family:'DM Sans',sans-serif}</style>
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#071827,#0f2a3d)">
      <div style="width:540px;background:#fff;border-radius:24px;box-shadow:0 40px 100px rgba(0,0,0,.4);overflow:hidden">

        <div style="padding:28px 36px 20px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:14px">
          <div style="width:44px;height:44px;border-radius:12px;background:#ECFDF5;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">👋</div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:800;color:#0F172A">
              ${isSuperAdmin ? '<span style="color:#059669">Super Admin</span>' : 'Bienvenue'}
            </div>
            <div style="font-size:12.5px;color:#64748B">${_ptLoginUser?.email || ''}</div>
          </div>
          <button onclick="logoutPc()" style="padding:7px 14px;border:1.5px solid #E2E8F0;border-radius:10px;background:#fff;color:#64748B;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
            ← Déconnexion
          </button>
        </div>

        <div style="padding:24px 36px 36px">
          <div style="font-size:11px;font-weight:800;color:#94A3B8;text-transform:uppercase;letter-spacing:.7px;margin-bottom:14px">
            Choisir un environnement
            ${isSuperAdmin ? `<span style="background:#059669;color:#fff;padding:2px 9px;border-radius:20px;font-size:10px;margin-left:8px;font-weight:700">${envs.length} dispo</span>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">${cards}</div>
        </div>
      </div>
    </div>
  `;
}

async function _selectEnvById(tenantId, code) {
  try {
    const rows = await sbFetch(`tenants?id=eq.${tenantId}&select=*&limit=1`);
    _selectEnv(rows && rows.length ? rows[0] : { id: tenantId, code });
  } catch {
    _selectEnv({ id: tenantId, code });
  }
}

function _selectEnv(env) {
  sessionStorage.setItem('pt_active_env', env.code);
  sessionStorage.setItem('pt_active_tenant', env.id || '');
  window.PT_CURRENT_USER = {
    ..._ptLoginUser,
    active_env: env.code,
    active_tenant_id: env.id
  };
  location.reload();
}

// ── Helpers ──
function _loginErr(msg) {
  const el = document.getElementById('pc-login-err');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function _resetBtn() {
  const btn = document.getElementById('pc-login-btn');
  if (btn) { btn.textContent = 'Continuer →'; btn.disabled = false; }
}
