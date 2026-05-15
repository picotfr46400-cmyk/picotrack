// ══ PicoTrack — Panneau Licences (super_admin) ══

async function goLicensing() {
  if (!isSuperAdmin()) {
    showToast('Accès réservé au Super Admin.', 'error');
    return;
  }
  show('v-licensing');
  setTopbar('Licences & Environnements');
  setBreadcrumb([{ label: 'Licences' }]);
  await renderLicensingPanel();
}

async function renderLicensingPanel() {
  const wrap = document.getElementById('licensing-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--tl)">Chargement…</div>`;

  try {
    const [tenants] = await Promise.all([DB.getTenants()]);

    // Charger users par tenant en parallèle
    const tenantsWithData = await Promise.all(tenants.map(async t => {
      try {
        const users = await DB.getUsersByTenant(t.id);
        const supUsed = users.filter(u => u.active && ['supervision','manager','admin','super_admin'].includes(u.role)).length;
        const padUsed = users.filter(u => u.active && u.license_type === 'pad').length;
        return { ...t, users, supUsed, padUsed };
      } catch {
        return { ...t, users: [], supUsed: 0, padUsed: 0 };
      }
    }));

    wrap.innerHTML = `
      <div style="max-width:900px;margin:0 auto;padding:24px">

        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px">
          <div>
            <div style="font-size:22px;font-weight:900;color:var(--tx)">Licences & Environnements</div>
            <div style="font-size:13px;color:var(--tl);margin-top:4px">${tenantsWithData.length} environnement(s) actif(s)</div>
          </div>
          <button class="btn bp pill" onclick="openNewTenantModal()">＋ Nouvel environnement</button>
        </div>

        <!-- Cards -->
        <div style="display:flex;flex-direction:column;gap:16px">
          ${tenantsWithData.map(t => _renderTenantCard(t)).join('')}
        </div>

        <!-- Tarifs -->
        <div style="margin-top:32px;padding:20px;background:var(--bg);border-radius:14px;border:1.5px solid var(--bd)">
          <div style="font-size:13px;font-weight:800;color:var(--tm);margin-bottom:12px">Grille tarifaire</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="padding:14px;background:#fff;border-radius:10px;border:1px solid var(--bd)">
              <div style="font-size:13px;font-weight:800">🖥 Supervision</div>
              <div style="font-size:22px;font-weight:900;color:var(--em);margin:6px 0">65€<span style="font-size:13px;font-weight:400;color:var(--tl)">/mois</span></div>
              <div style="font-size:12px;color:var(--tl)">Accès interface web complète</div>
            </div>
            <div style="padding:14px;background:#fff;border-radius:10px;border:1px solid var(--bd)">
              <div style="font-size:13px;font-weight:800">📱 PAD Terrain</div>
              <div style="font-size:22px;font-weight:900;color:var(--em);margin:6px 0">29€<span style="font-size:13px;font-weight:400;color:var(--tl)">/mois</span></div>
              <div style="font-size:12px;color:var(--tl)">Licence terminal nomade terrain</div>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    wrap.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444">Erreur : ${e.message}</div>`;
  }
}

function _renderTenantCard(t) {
  const supPct  = Math.min(100, Math.round((t.supUsed / (t.max_supervision || 1)) * 100));
  const padPct  = Math.min(100, Math.round((t.padUsed / (t.max_pad || 1)) * 100));
  const supClr  = supPct >= 90 ? '#ef4444' : supPct >= 70 ? '#f59e0b' : '#059669';
  const padClr  = padPct >= 90 ? '#ef4444' : padPct >= 70 ? '#f59e0b' : '#059669';
  const mrr     = (t.supUsed * 65) + (t.padUsed * 29);

  return `
    <div style="background:#fff;border:1.5px solid var(--bd);border-radius:16px;overflow:hidden">

      <!-- Tenant header -->
      <div style="padding:18px 22px;display:flex;align-items:center;gap:14px;border-bottom:1px solid var(--bd)">
        <div style="width:42px;height:42px;border-radius:12px;background:${t.couleur||'#059669'}18;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🏢</div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:800;color:var(--tx)">${t.nom}</div>
          <div style="font-size:12px;color:var(--tl)">Code : <strong>${t.code}</strong> · Plan <strong>${t.plan||'starter'}</strong></div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:900;color:var(--em)">${mrr}€<span style="font-size:11px;font-weight:400;color:var(--tl)">/mois</span></div>
          <div style="font-size:11px;color:var(--tl)">MRR estimé</div>
        </div>
      </div>

      <!-- Licences -->
      <div style="padding:18px 22px;display:grid;grid-template-columns:1fr 1fr;gap:20px">

        <!-- Supervision -->
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:13px;font-weight:800">🖥 Supervision</div>
            <div style="font-size:12px;color:var(--tl)">${t.supUsed} / ${t.max_supervision||3} utilisés</div>
          </div>
          <div style="height:6px;background:var(--bg);border-radius:3px;margin-bottom:12px">
            <div style="height:6px;border-radius:3px;background:${supClr};width:${supPct}%;transition:width .3s"></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button onclick="adjustLicense('${t.id}','supervision',-1,${t.max_supervision||3})"
              style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--bd);background:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--tl)">−</button>
            <div style="flex:1;text-align:center;font-size:18px;font-weight:900;color:var(--tx)" id="sup-count-${t.id}">${t.max_supervision||3}</div>
            <button onclick="adjustLicense('${t.id}','supervision',1,${t.max_supervision||3})"
              style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--em);background:var(--eml);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--em)">+</button>
          </div>
          <div style="font-size:11px;color:var(--tl);text-align:center;margin-top:6px">${(t.max_supervision||3) * 65}€/mois</div>
        </div>

        <!-- PAD -->
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:13px;font-weight:800">📱 PAD Terrain</div>
            <div style="font-size:12px;color:var(--tl)">${t.padUsed} / ${t.max_pad||10} utilisés</div>
          </div>
          <div style="height:6px;background:var(--bg);border-radius:3px;margin-bottom:12px">
            <div style="height:6px;border-radius:3px;background:${padClr};width:${padPct}%;transition:width .3s"></div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button onclick="adjustLicense('${t.id}','pad',-1,${t.max_pad||10})"
              style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--bd);background:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--tl)">−</button>
            <div style="flex:1;text-align:center;font-size:18px;font-weight:900;color:var(--tx)" id="pad-count-${t.id}">${t.max_pad||10}</div>
            <button onclick="adjustLicense('${t.id}','pad',1,${t.max_pad||10})"
              style="width:32px;height:32px;border-radius:8px;border:1.5px solid var(--em);background:var(--eml);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--em)">+</button>
          </div>
          <div style="font-size:11px;color:var(--tl);text-align:center;margin-top:6px">${(t.max_pad||10) * 29}€/mois</div>
        </div>
      </div>

      <!-- Actions -->
      <div style="padding:12px 22px;background:var(--bg);border-top:1px solid var(--bd);display:flex;gap:8px">
        <button onclick="saveLicenses('${t.id}')" class="btn bp btn-sm">💾 Enregistrer</button>
        <button onclick="openEditTenantModal('${t.id}')" class="btn btn-sm">✏️ Modifier</button>
        <button onclick="toggleTenantActif('${t.id}',${t.actif})" class="btn btn-sm" style="${t.actif?'color:#ef4444':'color:#059669'}">
          ${t.actif ? '⏸ Suspendre' : '▶ Réactiver'}
        </button>
      </div>
    </div>
  `;
}

// ── Ajuster compteur en mémoire ──
function adjustLicense(tenantId, type, delta, current) {
  const elId = `${type === 'pad' ? 'pad' : 'sup'}-count-${tenantId}`;
  const el   = document.getElementById(elId);
  if (!el) return;
  const val  = Math.max(0, (parseInt(el.textContent) || current) + delta);
  el.textContent = val;
  // MRR live
  _updateMrrDisplay(tenantId);
}

function _updateMrrDisplay(tenantId) {
  const supEl = document.getElementById(`sup-count-${tenantId}`);
  const padEl = document.getElementById(`pad-count-${tenantId}`);
  if (!supEl || !padEl) return;
  const sup = parseInt(supEl.textContent) || 0;
  const pad = parseInt(padEl.textContent) || 0;
  // màj prix sous compteurs
  const supPriceEl = supEl.closest('div')?.parentElement?.querySelector(':last-child');
  const padPriceEl = padEl.closest('div')?.parentElement?.querySelector(':last-child');
  if (supPriceEl) supPriceEl.textContent = `${sup * 65}€/mois`;
  if (padPriceEl) padPriceEl.textContent = `${pad * 29}€/mois`;
}

// ── Enregistrer les licences ──
async function saveLicenses(tenantId) {
  const supEl = document.getElementById(`sup-count-${tenantId}`);
  const padEl = document.getElementById(`pad-count-${tenantId}`);
  if (!supEl || !padEl) return;
  const maxSup = parseInt(supEl.textContent) || 0;
  const maxPad = parseInt(padEl.textContent) || 0;
  try {
    await DB.updateLicenses(tenantId, maxSup, maxPad);
    showToast(`Licences mises à jour ✓`, 'success');
  } catch (e) {
    showToast(`Erreur : ${e.message}`, 'error');
  }
}

// ── Suspendre / Réactiver un tenant ──
async function toggleTenantActif(tenantId, actif) {
  try {
    await DB.updateTenant(tenantId, { actif: !actif });
    showToast(`Environnement ${!actif ? 'réactivé' : 'suspendu'}.`, 'success');
    await renderLicensingPanel();
  } catch (e) {
    showToast(`Erreur : ${e.message}`, 'error');
  }
}

// ════════════════════════════════════════
// MODAL — Nouvel environnement
// ════════════════════════════════════════
function openNewTenantModal() {
  _openTenantModal(null);
}
function openEditTenantModal(tenantId) {
  _openTenantModal(tenantId);
}

async function _openTenantModal(tenantId) {
  let tenant = { nom:'', code:'', plan:'starter', couleur:'#059669', max_supervision:3, max_pad:10 };
  if (tenantId) {
    try {
      const rows = await sbFetch(`tenants?id=eq.${tenantId}&select=*&limit=1`);
      if (rows && rows.length) tenant = rows[0];
    } catch {}
  }

  const modal = document.createElement('div');
  modal.id = 'tenant-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = `
    <div style="width:480px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.3)">
      <div style="padding:22px 26px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:16px;font-weight:800">${tenantId ? 'Modifier' : 'Nouvel'} environnement</div>
        <button onclick="document.getElementById('tenant-modal').remove()" style="width:28px;height:28px;border:none;background:var(--bg);border-radius:8px;cursor:pointer;font-size:14px">✕</button>
      </div>
      <div style="padding:22px 26px;display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Nom du client</label>
          <input id="tm-nom" value="${tenant.nom||''}" placeholder="Ex : Groupe EDF" style="width:100%;box-sizing:border-box;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px;font-family:inherit;outline:none">
        </div>
        <div>
          <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Code unique</label>
          <input id="tm-code" value="${tenant.code||''}" placeholder="ex : edf-blayais" ${tenantId ? 'disabled' : ''}
            style="width:100%;box-sizing:border-box;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px;font-family:inherit;outline:none;${tenantId?'opacity:.6':''}">
          <div style="font-size:11px;color:var(--tl);margin-top:4px">Minuscules, tirets uniquement. Non modifiable après création.</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Plan</label>
            <select id="tm-plan" style="width:100%;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px;font-family:inherit;outline:none;background:#fff">
              <option value="starter" ${tenant.plan==='starter'?'selected':''}>Starter</option>
              <option value="pro" ${tenant.plan==='pro'?'selected':''}>Pro</option>
              <option value="enterprise" ${tenant.plan==='enterprise'?'selected':''}>Enterprise</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Couleur</label>
            <input id="tm-couleur" type="color" value="${tenant.couleur||'#059669'}"
              style="width:100%;margin-top:6px;height:44px;border:1.5px solid var(--bd);border-radius:10px;cursor:pointer;padding:4px 8px">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Licences supervision</label>
            <input id="tm-sup" type="number" min="0" value="${tenant.max_supervision||3}"
              style="width:100%;box-sizing:border-box;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px">
          </div>
          <div>
            <label style="font-size:11px;font-weight:800;color:var(--tl);text-transform:uppercase">Licences PAD</label>
            <input id="tm-pad" type="number" min="0" value="${tenant.max_pad||10}"
              style="width:100%;box-sizing:border-box;margin-top:6px;padding:11px 14px;border:1.5px solid var(--bd);border-radius:10px;font-size:14px">
          </div>
        </div>
      </div>
      <div style="padding:16px 26px;background:var(--bg);border-top:1px solid var(--bd);display:flex;gap:10px;justify-content:flex-end">
        <button onclick="document.getElementById('tenant-modal').remove()" class="btn btn-sm">Annuler</button>
        <button onclick="saveTenantModal('${tenantId||''}')" class="btn bp btn-sm">💾 ${tenantId ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function saveTenantModal(tenantId) {
  const nom     = document.getElementById('tm-nom')?.value.trim();
  const code    = document.getElementById('tm-code')?.value.trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
  const plan    = document.getElementById('tm-plan')?.value;
  const couleur = document.getElementById('tm-couleur')?.value;
  const maxSup  = parseInt(document.getElementById('tm-sup')?.value) || 3;
  const maxPad  = parseInt(document.getElementById('tm-pad')?.value) || 10;

  if (!nom || !code) { showToast('Nom et code obligatoires.', 'error'); return; }

  try {
    if (tenantId) {
      await DB.updateTenant(tenantId, { nom, plan, couleur, max_supervision: maxSup, max_pad: maxPad });
      showToast('Environnement mis à jour ✓', 'success');
    } else {
      await DB.createTenant({ nom, code, plan, couleur, max_supervision: maxSup, max_pad: maxPad, actif: true });
      showToast(`Environnement "${nom}" créé ✓`, 'success');
    }
    document.getElementById('tenant-modal')?.remove();
    await renderLicensingPanel();
  } catch (e) {
    showToast(`Erreur : ${e.message}`, 'error');
  }
}
