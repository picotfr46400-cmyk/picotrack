/* ══ PicoTrack — Styles PAD / Mobile / Tablette ══ */

/* ─── Variables breakpoints ───────────────────────
   Téléphone  : < 600px
   Tablette   : 600px – 1024px
   Desktop    : > 1024px  (mode admin normal, pad.css inactif)
────────────────────────────────────────────────── */

/* ─── Reset base mode PAD ─────────────────────── */
body.pad-mode {
  overflow-x: hidden;
}

body.pad-mode #sb,
body.pad-mode #topbar,
body.pad-mode .breadcrumb {
  display: none !important;
}

body.pad-mode #main {
  left: 0 !important;
  width: 100% !important;
  padding-top: 56px !important;
  padding-bottom: 72px !important;
  background: #f1f5f9 !important;
}

/* ─── Topbar PAD ──────────────────────────────── */
#pad-topbar {
  height: 56px;
  display: flex;
  align-items: center;
}

/* ─── Navbar PAD bas d'écran ──────────────────── */
#pad-navbar {
  height: 60px;
}

#pad-navbar button {
  font-size: 9px !important;
}

/* ─── Vue production formulaires ─────────────── */
body.pad-mode #v-prod-forms {
  padding: 16px 12px !important;
  overflow-y: auto;
  height: calc(100vh - 56px - 60px);
  box-sizing: border-box;
}

body.pad-mode #v-prod-forms .sbar {
  max-width: 100% !important;
  width: 100% !important;
  margin-bottom: 16px;
}

body.pad-mode #v-prod-forms .sbar input {
  width: 100% !important;
  font-size: 15px !important;
  padding: 10px 12px !important;
}

/* Grille des cartes formulaires */
body.pad-mode #prod-forms-grid {
  display: grid !important;
  gap: 12px !important;
}

/* Téléphone → 1 colonne */
@media (max-width: 599px) {
  body.pad-mode #prod-forms-grid {
    grid-template-columns: 1fr !important;
  }
}

/* Tablette → 2 colonnes */
@media (min-width: 600px) and (max-width: 1024px) {
  body.pad-mode #prod-forms-grid {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}

/* ─── Cartes formulaire PAD ───────────────────── */
body.pad-mode #prod-forms-grid > div {
  border-radius: 16px !important;
  box-shadow: 0 4px 16px rgba(0,0,0,.1) !important;
  min-height: 130px !important;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* Bouton Saisir dans les cartes */
body.pad-mode #prod-forms-grid a,
body.pad-mode #prod-forms-grid .saisir-btn,
body.pad-mode #prod-forms-grid div[style*="Saisir"] {
  padding: 10px 20px !important;
  font-size: 13px !important;
  border-radius: 20px !important;
}

/* ─── Vue saisie formulaire ───────────────────── */
body.pad-mode #v-saisie {
  overflow-y: auto;
  height: calc(100vh - 56px - 60px);
  padding: 16px 12px !important;
  box-sizing: border-box;
}

body.pad-mode #saisie-wrap {
  max-width: 100% !important;
}

/* Carte principale saisie */
body.pad-mode #saisie-wrap > div {
  border-radius: 16px !important;
  padding: 20px 16px !important;
}

/* Labels de champs */
body.pad-mode .ap-field > div:first-child {
  font-size: 14px !important;
  margin-bottom: 8px !important;
}

/* Inputs, selects, textareas */
body.pad-mode input[type="text"],
body.pad-mode input[type="number"],
body.pad-mode input[type="date"],
body.pad-mode input[type="time"],
body.pad-mode input[type="datetime-local"],
body.pad-mode input[type="email"],
body.pad-mode select,
body.pad-mode textarea {
  font-size: 16px !important; /* évite le zoom auto iOS */
  padding: 12px 14px !important;
  border-radius: 10px !important;
  min-height: 48px !important;
  width: 100% !important;
  box-sizing: border-box !important;
}

/* Checkboxes et radios plus grandes */
body.pad-mode input[type="checkbox"],
body.pad-mode input[type="radio"] {
  width: 22px !important;
  height: 22px !important;
  min-height: unset !important;
}

/* Bouton de soumission */
body.pad-mode button[onclick*="submitSaisie"],
body.pad-mode button[onclick*="valider"],
body.pad-mode #saisie-wrap button[style*="background"] {
  min-height: 52px !important;
  font-size: 15px !important;
  border-radius: 14px !important;
  width: 100% !important;
}

/* ─── Vue services production ─────────────────── */
body.pad-mode #v-prod-services {
  overflow-y: auto;
  height: calc(100vh - 56px - 60px);
  padding: 16px 12px !important;
  box-sizing: border-box;
}

/* Cartes services : 1 col tel, 2 col tablette */
body.pad-mode .svc-kanban-col,
body.pad-mode .svc-instance-card {
  border-radius: 14px !important;
  padding: 14px !important;
}

@media (max-width: 599px) {
  body.pad-mode .kanban-board {
    flex-direction: column !important;
    gap: 12px !important;
  }
  body.pad-mode .kanban-col {
    width: 100% !important;
    min-width: unset !important;
  }
}

/* ─── Vue profil terminal ─────────────────────── */
body.pad-mode #pad-profile-view {
  overflow-y: auto;
  height: calc(100vh - 56px - 60px);
}

/* ─── Toasts : repositionner en haut sur mobile ─ */
@media (max-width: 599px) {
  body.pad-mode #toasts {
    bottom: auto !important;
    top: 64px !important;
    left: 12px !important;
    right: 12px !important;
    width: auto !important;
  }
  body.pad-mode .toast {
    max-width: 100% !important;
  }
}

/* ─── Suppression hover/transitions sur touch ── */
@media (hover: none) {
  body.pad-mode #prod-forms-grid > div:hover {
    transform: none !important;
    box-shadow: 0 4px 16px rgba(0,0,0,.1) !important;
  }
}

/* ─── Scrollbar plus discrète sur mobile ──────── */
body.pad-mode ::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
body.pad-mode ::-webkit-scrollbar-track { background: transparent; }
body.pad-mode ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
/* Contrôle des vues PAD — priorité absolue */
body.pad-mode .view { display: none !important; }
body.pad-mode .view.on { display: block !important; }

/* ══ PAD LITE V3 — simple terrain ══ */
body.pad-lite-v3{background:#f4f8fd!important;color:#0f172a!important;overflow:hidden}
body.pad-lite-v3 #main{margin-left:0!important;width:100%!important;min-height:100vh!important;background:linear-gradient(180deg,#f8fbff 0%,#eef5fb 100%)!important;overflow:auto!important}
.pad-lite-topbar{position:fixed;top:0;left:0;right:0;height:64px;background:#071a31;color:#fff;z-index:9999;display:flex;align-items:center;padding:0 28px;gap:18px;box-shadow:0 8px 28px rgba(2,8,23,.18)}
.pad-lite-logo{display:flex;align-items:center;gap:10px;font-weight:900;font-size:18px;letter-spacing:-.02em}.pad-lite-logo img{height:30px;max-width:110px;object-fit:contain}.pad-lite-sync{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:#dbeafe}.pad-lite-sync i{width:10px;height:10px;border-radius:999px;background:#10b981;box-shadow:0 0 0 5px rgba(16,185,129,.14)}.pad-lite-user{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;border-radius:999px;padding:9px 14px;font-weight:800;font-family:inherit}
.pad-lite-nav{position:fixed;bottom:0;left:0;right:0;height:72px;background:#071a31;z-index:9999;display:flex;align-items:center;justify-content:space-around;padding-bottom:env(safe-area-inset-bottom);box-shadow:0 -10px 35px rgba(2,8,23,.18)}.pad-lite-nav button{border:0;background:transparent;color:#94a3b8;display:flex;flex-direction:column;align-items:center;gap:4px;font-family:inherit;font-size:12px;font-weight:800;min-width:92px;padding:8px 10px;border-radius:16px}.pad-lite-nav button span{font-size:23px;line-height:1}.pad-lite-nav button.active{color:#1d7cff;background:rgba(29,124,255,.12)}
.pad-lite-home{min-height:calc(100vh - 136px);overflow:auto!important}.pad-lite-wrap{max-width:980px;margin:0 auto;padding:44px 30px 34px}.pad-lite-hello{display:flex;justify-content:space-between;align-items:center;margin-bottom:26px}.pad-lite-time{font-size:15px;color:#64748b;font-weight:800;margin-bottom:6px}.pad-lite-hello h1{margin:0;font-size:34px;line-height:1.05;letter-spacing:-.04em;color:#0f172a}.pad-lite-hello p{margin:8px 0 0;color:#526174;font-size:17px;font-weight:700}
.pad-lite-main-action{width:100%;min-height:160px;border:0;border-radius:28px;background:linear-gradient(135deg,#2385ff,#0f63e9);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;box-shadow:0 18px 45px rgba(29,124,255,.28);font-family:inherit;cursor:pointer;margin-bottom:34px}.pad-lite-main-action span{width:70px;height:70px;border-radius:22px;background:rgba(255,255,255,.96);color:#126eea;display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:900}.pad-lite-main-action strong{font-size:30px;letter-spacing:-.03em}.pad-lite-main-action small{font-size:16px;opacity:.92;font-weight:700}
.pad-lite-section{margin-top:28px}.pad-lite-section h2{font-size:22px;margin:0 0 16px;color:#0f172a;letter-spacing:-.03em}.pad-lite-quick-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.pad-lite-quick-card,.pad-lite-last{border:1px solid #dbe7f4;background:#fff;border-radius:22px;box-shadow:0 10px 30px rgba(15,23,42,.06);padding:22px 24px;display:flex;align-items:center;gap:18px;text-align:left;font-family:inherit;cursor:pointer;color:#0f172a;min-height:98px}.pad-lite-quick-card i,.pad-lite-last i{width:58px;height:58px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:27px;flex:0 0 auto}.pad-lite-quick-card span,.pad-lite-last span{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}.pad-lite-quick-card b,.pad-lite-last b{font-size:18px;line-height:1.15;color:#0f172a}.pad-lite-quick-card small,.pad-lite-last small{font-size:14px;color:#64748b;font-weight:700}.pad-lite-quick-card em{font-style:normal;font-size:34px;color:#64748b;margin-left:auto}.pad-lite-last strong{font-size:14px;color:#059669;background:#dcfce7;border-radius:999px;padding:8px 12px}.pad-lite-empty{border:1.5px dashed #cbd8e8;border-radius:22px;background:rgba(255,255,255,.65);padding:26px;color:#64748b;display:flex;flex-direction:column;gap:6px}.pad-lite-empty b{color:#0f172a;font-size:17px}
.pad-lite-modal{position:fixed;inset:0;background:rgba(2,8,23,.42);z-index:20000;display:flex;align-items:flex-end;justify-content:center;padding:20px}.pad-lite-sheet{width:min(720px,100%);max-height:82vh;overflow:auto;background:#fff;border-radius:30px 30px 20px 20px;box-shadow:0 30px 90px rgba(2,8,23,.28);padding:22px}.pad-lite-sheet-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}.pad-lite-sheet-head div{display:flex;flex-direction:column}.pad-lite-sheet-head b{font-size:24px}.pad-lite-sheet-head small{color:#64748b;font-weight:700;margin-top:4px}.pad-lite-sheet-head button{width:42px;height:42px;border:1px solid #dbe7f4;background:#fff;border-radius:14px;font-size:28px;color:#64748b}.pad-lite-form-list{display:grid;gap:12px}.pad-lite-form-list button{border:1px solid #dbe7f4;background:#fff;border-radius:20px;padding:18px;display:flex;align-items:center;gap:16px;text-align:left;font-family:inherit}.pad-lite-form-list i{width:52px;height:52px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:24px}.pad-lite-form-list span{display:flex;flex-direction:column;gap:4px;flex:1}.pad-lite-form-list b{font-size:17px;color:#0f172a}.pad-lite-form-list small{font-size:13px;color:#64748b;font-weight:700}.pad-lite-form-list em{font-style:normal;font-size:30px;color:#64748b}.pad-lite-scanner-card{max-width:520px;margin:40px auto;background:#fff;border:1px solid #dbe7f4;border-radius:28px;box-shadow:0 18px 50px rgba(15,23,42,.08);padding:36px;text-align:center}.pad-lite-scanner-icon{width:90px;height:90px;margin:0 auto 18px;border-radius:28px;background:#ede9fe;color:#7c3aed;display:flex;align-items:center;justify-content:center;font-size:48px}.pad-lite-scanner-card h1{margin:0;color:#0f172a}.pad-lite-scanner-card p{color:#64748b;font-weight:700}.pad-lite-scanner-card button{width:100%;border:0;background:#1d7cff;color:#fff;border-radius:18px;padding:17px;font-weight:900;font-size:16px;margin-top:12px;font-family:inherit}.pad-lite-scanner-card button.ghost{background:#fff;color:#0f172a;border:1px solid #dbe7f4}
@media(max-width:700px){.pad-lite-topbar{padding:0 16px}.pad-lite-user{display:none}.pad-lite-wrap{padding:28px 18px 28px}.pad-lite-hello h1{font-size:28px}.pad-lite-main-action{min-height:142px;border-radius:24px}.pad-lite-quick-grid{grid-template-columns:1fr}.pad-lite-main-action strong{font-size:26px}.pad-lite-main-action small{font-size:14px}.pad-lite-nav{height:68px}}

/* PAD Services Lite V1 - terrain simple */
.pad-services-wrap{max-width:980px}.pad-svc-head{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:24px}.pad-svc-head h1{margin:0;font-size:34px;letter-spacing:-.04em;color:#0f172a}.pad-svc-head p{margin:8px 0 0;color:#526174;font-size:17px;font-weight:700}.pad-svc-head button{border:0;background:#1d7cff;color:#fff;border-radius:18px;padding:16px 22px;font-weight:900;font-size:16px;font-family:inherit;box-shadow:0 12px 30px rgba(29,124,255,.22)}.pad-svc-count{font-style:normal;font-size:13px;background:#eaf3ff;color:#1d7cff;border-radius:999px;padding:5px 10px;margin-left:8px}.pad-svc-focus{background:linear-gradient(135deg,#eef6ff,#ffffff);border:1px solid #cfe1f6;border-radius:26px;padding:18px;margin-bottom:26px;box-shadow:0 12px 35px rgba(15,23,42,.05)}.pad-svc-focus>span{display:block;text-transform:uppercase;letter-spacing:.08em;font-size:12px;color:#64748b;font-weight:900;margin:0 0 12px}.pad-svc-list{display:grid;gap:12px}.pad-svc-card{--svc:#2563eb;border:1px solid #dbe7f4;background:#fff;border-left:6px solid var(--svc);border-radius:22px;box-shadow:0 10px 30px rgba(15,23,42,.06);padding:18px;display:flex;align-items:center;gap:15px;text-align:left;color:#0f172a;cursor:pointer}.pad-svc-icon{width:54px;height:54px;border-radius:17px;background:color-mix(in srgb,var(--svc) 14%,#fff);color:var(--svc);display:flex;align-items:center;justify-content:center;font-size:25px;flex:0 0 auto}.pad-svc-body{min-width:0;flex:1}.pad-svc-top{display:flex;align-items:center;gap:10px;margin-bottom:4px}.pad-svc-top b{font-size:14px;color:#64748b}.pad-svc-top span{font-size:12px;font-weight:900;background:color-mix(in srgb,var(--svc) 12%,#fff);color:var(--svc);border-radius:999px;padding:4px 9px}.pad-svc-card h3{margin:0 0 5px;font-size:19px;line-height:1.15;color:#0f172a}.pad-svc-card p{margin:0 0 4px;color:#526174;font-size:14px;font-weight:700}.pad-svc-card small{color:#94a3b8;font-size:12px;font-weight:800}.pad-svc-card>button{border:0;background:var(--svc);color:#fff;border-radius:15px;padding:13px 16px;font-weight:900;font-family:inherit;min-width:104px}.pad-svc-list.compact .pad-svc-card{opacity:.9}.pad-mission-sheet{max-width:640px}.pad-mission-status{--svc:#2563eb;border-radius:20px;background:color-mix(in srgb,var(--svc) 10%,#fff);border:1px solid color-mix(in srgb,var(--svc) 24%,#dbe7f4);padding:16px;margin:10px 0 18px;display:flex;justify-content:space-between;align-items:center}.pad-mission-status span{color:var(--svc);font-weight:900}.pad-mission-status small{color:#64748b;font-weight:800}.pad-mission-actions{display:grid;gap:12px}.pad-mission-actions button{width:100%;border:1px solid #dbe7f4;background:#fff;color:#0f172a;border-radius:18px;padding:16px;font-weight:900;font-family:inherit;font-size:15px}.pad-mission-actions button.main{background:var(--svc);border-color:var(--svc);color:#fff}.pad-mission-actions button.ghost{background:#fff;color:#0f172a}
@media(max-width:700px){.pad-svc-head{align-items:flex-start;flex-direction:column}.pad-svc-head h1{font-size:28px}.pad-svc-head button{width:100%}.pad-svc-card{align-items:flex-start}.pad-svc-card>button{min-width:auto;padding:12px}.pad-svc-icon{width:48px;height:48px}.pad-svc-card h3{font-size:17px}}
