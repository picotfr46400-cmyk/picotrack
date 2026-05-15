// ══ PicoTrack — Connexion PC supervision (Supabase Auth) ══

// ── Déconnexion ──
function logoutPc() {
  ptSignOut();
}

// ── Vérifier si une session active existe ──
async function checkPcLogin() {
  try {
    const user = await ptGetCurrentUser();
    if (user && user.active && ['super_admin', 'supervision', 'manager'].includes(user.role)) {
      window.PT_CURRENT_USER = user;
      return true;
    }
  } catch (e) {
    console.warn('[Login] vérification session:', e.message);
  }
  renderPcLogin();
  return false;
}

// ── Formulaire de connexion ──
function renderPcLogin() {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#071827,#0f2a3d);font-family:Inter,Arial,sans-serif;">
      <div style="width:420px;background:white;border-radius:24px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden;">
        <div style="padding:34px 34px 20px;text-align:center">
          <img src="logo-picotrack.png" style="max-width:210px;margin-bottom:20px" onerror="this.style.display='none'">
          <h1 style="font-size:24px;margin:0;color:#0f172a;font-family:inherit">Connexion supervision</h1>
          <p style="font-size:14px;color:#64748b;margin-top:8px">Accès sécurisé PicoTrack Nexus</p>
        </div>
        <div style="padding:0 34px 34px">
          <label style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase">Email</label>
          <input id="pc-login-id" type="email" autocomplete="email"
            style="width:100%;box-sizing:border-box;margin:8px 0 18px;padding:14px 16px;border:1.5px solid #dbeafe;border-radius:14px;font-size:15px;outline:none;font-family:inherit"
            placeholder="votre@email.com"
            onkeydown="if(event.key==='Enter')document.getElementById('pc-login-pass').focus()">
          <label style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase">Mot de passe</label>
          <input id="pc-login-pass" type="password" autocomplete="current-password"
            style="width:100%;box-sizing:border-box;margin:8px 0 18px;padding:14px 16px;border:1.5px solid #dbeafe;border-radius:14px;font-size:15px;outline:none;font-family:inherit"
            placeholder="••••••••"
            onkeydown="if(event.key==='Enter')doPcLogin()">
          <div id="pc-login-err" style="display:none;margin-bottom:14px;padding:12px 16px;background:#fef2f2;border:1.5px solid #fecaca;border-radius:12px;color:#dc2626;font-size:13px;font-weight:700"></div>
          <button onclick="doPcLogin()" id="pc-login-btn"
            style="width:100%;padding:16px;background:linear-gradient(135deg,#059669,#047857);color:white;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;transition:opacity .2s">
            Se connecter →
          </button>
          <p style="text-align:center;font-size:12px;color:#94a3b8;margin-top:18px">PicoTrack Nexus · Accès réservé</p>
        </div>
      </div>
    </div>
  `;
  setTimeout(() => {
    const el = document.getElementById('pc-login-id');
    if (el) el.focus();
  }, 100);
}

// ── Tentative de connexion ──
async function doPcLogin() {
  const emailEl = document.getElementById('pc-login-id');
  const passEl  = document.getElementById('pc-login-pass');
  const errEl   = document.getElementById('pc-login-err');
  const btn     = document.getElementById('pc-login-btn');

  const email    = (emailEl?.value || '').trim();
  const password = passEl?.value || '';

  if (!email || !password) {
    _showLoginErr('Veuillez saisir votre email et mot de passe.');
    return;
  }

  btn.textContent = 'Connexion en cours…';
  btn.disabled = true;
  if (errEl) errEl.style.display = 'none';

  try {
    // 1. Connexion Supabase Auth
    await ptSignIn(email, password);

    // 2. Récupérer le profil
    const user = await ptGetCurrentUser();

    if (!user) {
      _showLoginErr('Compte introuvable. Contactez votre administrateur.');
      _resetBtn();
      return;
    }
    if (!user.active) {
      _showLoginErr('Ce compte est désactivé. Contactez votre administrateur.');
      _resetBtn();
      return;
    }
    if (!['super_admin', 'supervision', 'manager'].includes(user.role)) {
      _showLoginErr('Accès non autorisé pour ce type de compte.');
      _resetBtn();
      return;
    }

    // 3. Stocker dans window et recharger
    window.PT_CURRENT_USER = user;
    location.reload();

  } catch (e) {
    console.warn('[Login] erreur:', e.message);
    if (e.message?.includes('Invalid login')) {
      _showLoginErr('Email ou mot de passe incorrect.');
    } else if (e.message?.includes('Email not confirmed')) {
      _showLoginErr('Email non confirmé. Contactez votre administrateur.');
    } else {
      _showLoginErr('Erreur de connexion. Réessayez.');
    }
    _resetBtn();
  }
}

function _showLoginErr(msg) {
  const el = document.getElementById('pc-login-err');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function _resetBtn() {
  const btn = document.getElementById('pc-login-btn');
  if (btn) { btn.textContent = 'Se connecter →'; btn.disabled = false; }
}
