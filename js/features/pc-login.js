// ══ PicoTrack — Connexion PC supervision ══

function getPcSession() {
  try {
    return JSON.parse(localStorage.getItem('pt_pc_session') || 'null');
  } catch (e) {
    return null;
  }
}

function setPcSession(user) {
  localStorage.setItem('pt_pc_session', JSON.stringify(user));
}

function logoutPc() {
  localStorage.removeItem('pt_pc_session');
  location.reload();
}

async function checkPcLogin() {
  const session = getPcSession();
  if (session && session.active === true && session.license_type === 'supervision') {
    window.PT_CURRENT_USER = session;
    return true;
  }

  renderPcLogin();
  return false;
}

function renderPcLogin() {
  document.body.innerHTML = `
    <div style="
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      background:linear-gradient(135deg,#071827,#0f2a3d);
      font-family:Inter,Arial,sans-serif;
    ">
      <div style="
        width:420px;
        background:white;
        border-radius:24px;
        box-shadow:0 30px 80px rgba(0,0,0,.35);
        overflow:hidden;
      ">
        <div style="padding:34px 34px 20px;text-align:center">
          <img src="logo-picotrack.png" style="max-width:210px;margin-bottom:20px">
          <h1 style="font-size:24px;margin:0;color:#0f172a">Connexion supervision</h1>
          <p style="font-size:14px;color:#64748b;margin-top:8px">
            Accès sécurisé PicoTrack Nexus
          </p>
        </div>

        <div style="padding:0 34px 34px">
          <label style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase">Identifiant</label>
          <input id="pc-login-id" autocomplete="username" style="
            width:100%;
            box-sizing:border-box;
            margin:8px 0 18px;
            padding:14px 16px;
            border:1.5px solid #dbeafe;
            border-radius:14px;
            font-size:15px;
            outline:none;
          " placeholder="Identifiant">

          <label style="font-size:12px;font-weight:800;color:#475569;text-transform:uppercase">Mot de passe</label>
          <input id="pc-login-pass" type="password" autocomplete="current-password" style="
            width:100%;
            box-sizing:border-box;
            margin:8px 0 18px;
            padding:14px 16px;
            border:1.5px solid #dbeafe;
            border-radius:14px;
            font-size:15px;
            outline:none;
          " placeholder="Mot de passe">

          <div id="pc-login-error" style="
            min-height:20px;
            color:#dc2626;
            font-size:13px;
            font-weight:700;
            margin-bottom:14px;
          "></div>

          <button onclick="doPcLogin()" style="
            width:100%;
            border:0;
            padding:15px;
            border-radius:14px;
            background:linear-gradient(135deg,#06b6d4,#14b8a6);
            color:white;
            font-size:15px;
            font-weight:900;
            cursor:pointer;
          ">
            Se connecter
          </button>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    const id = document.getElementById('pc-login-id');
    if (id) id.focus();
  }, 100);
}

async function doPcLogin() {
  const login = document.getElementById('pc-login-id').value.trim();
  const pass = document.getElementById('pc-login-pass').value.trim();
  const error = document.getElementById('pc-login-error');

  if (!login || !pass) {
    error.textContent = 'Identifiant et mot de passe obligatoires';
    return;
  }

  try {
    const rows = await sbFetch(
      `licenses?email=eq.${encodeURIComponent(login)}&password_hash=eq.${encodeURIComponent(pass)}&license_type=eq.supervision&active=eq.true&select=*`
    );

    if (!rows || !rows.length) {
      error.textContent = 'Identifiants invalides ou licence inactive';
      return;
    }

    const user = rows[0];

    setPcSession(user);

    await sbFetch(
      `licenses?id=eq.${user.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          last_seen: new Date().toISOString(),
          device_name: navigator.userAgent.slice(0, 120)
        })
      }
    );

    location.reload();

  } catch (e) {
    console.warn('[PC LOGIN]', e);
    error.textContent = 'Erreur de connexion';
  }
}
