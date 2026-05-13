// ══ INIT ══
async function startPicoTrackApp() {
  if (typeof isPadMode === 'function' && isPadMode()) {
    if (typeof initPadMode === 'function') initPadMode();
  } else {
    const isLogged = await checkPcLogin();
    if (!isLogged) return;

    if (typeof migrateDataToSupabase === 'function') await migrateDataToSupabase();

    if (typeof renderTable === 'function') renderTable();
    else if (typeof goList === 'function') goList();
    else if (typeof afficherTableau === 'function') afficherTableau();

    injectLogoutButton();
  }
  initPicoTrackSync();
}

function injectLogoutButton() {
  if (document.getElementById('pt-logout-btn')) return;
  const sidebar = document.querySelector('#sb') || document.querySelector('.sidebar');
  if (!sidebar) return;
  const btn = document.createElement('button');
  btn.id = 'pt-logout-btn';
  btn.innerHTML = '<span>↩</span><b>Déconnexion</b>';
  btn.style.cssText = `
    margin:18px 14px 10px;
    width:calc(100% - 28px);
    padding:12px 14px;
    border:1px solid rgba(239,68,68,.28);
    border-radius:14px;
    background:rgba(239,68,68,.10);
    color:#fecaca;
    font-weight:800;
    cursor:pointer;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:8px;
    transition:.15s;
  `;
  btn.onmouseover = () => { btn.style.background='rgba(239,68,68,.20)'; btn.style.color='#fff'; };
  btn.onmouseout = () => { btn.style.background='rgba(239,68,68,.10)'; btn.style.color='#fecaca'; };
  btn.onclick = logoutPc;
  sidebar.appendChild(btn);
}

function initPicoTrackSync() {
  if (typeof onSync === 'undefined') return;

  onSync('submissions', (event, record) => {
    if (event !== 'INSERT' || !record) return;
    if (SUBMISSIONS_DATA.some(x => x.id == record.id)) return;
    SUBMISSIONS_DATA.unshift({
      id: record.id,
      formId: record.form_id,
      date: record.created_at,
      dateLabel: new Date(record.created_at).toLocaleString('fr-FR'),
      utilisateur: record.device === 'pad' ? '📱 PAD Terrain' : 'Bureau',
      values: record.values || {}
    });
    const f = FORMS_DATA.find(x => x.id == record.form_id);
    if (f) {
      f.resp = SUBMISSIONS_DATA.filter(s => s.formId == f.id).length;
      if (document.getElementById('v-submissions')?.classList.contains('on') && typeof openSubmissions === 'function') openSubmissions(f.id);
      const otherDevice = (typeof isPadMode === 'function' && isPadMode()) ? record.device !== 'pad' : record.device === 'pad';
      if (otherDevice && typeof toast === 'function') toast('i', `📥 Nouvelle saisie — ${f.nom}`);
    }
  });

  onSync('service_instances', (event, record) => {
    if (!record) return;
    const inst = typeof mapInstanceFromDb === 'function' ? mapInstanceFromDb(record) : null;
    if (!inst) return;
    const idx = SERVICE_INSTANCES_DATA.findIndex(x => String(x.id) === String(inst.id));
    const isNew = idx < 0;
    if (isNew) SERVICE_INSTANCES_DATA.unshift(inst);
    else SERVICE_INSTANCES_DATA[idx] = { ...SERVICE_INSTANCES_DATA[idx], ...inst };
    const svc = SERVICES_DATA.find(s => String(s.id) === String(inst.serviceId));
    if (curService && String(curService.id) === String(inst.serviceId)) {
      if (document.getElementById('v-service-instances')?.classList.contains('on') && typeof renderServiceInstances === 'function') renderServiceInstances(curService);
      if (document.getElementById('v-service-kanban')?.classList.contains('on') && typeof renderKanbanBoard === 'function') renderKanbanBoard(curService, curKanbanGroupId);
    }
    if (document.getElementById('v-services')?.classList.contains('on') && typeof renderServices === 'function') renderServices();
    if (document.getElementById('v-prod-services-list')?.classList.contains('on') && typeof renderProdServices === 'function') renderProdServices();
    const otherDevice = (typeof isPadMode === 'function' && isPadMode()) ? record.device !== 'pad' : record.device === 'pad';
    if (svc && otherDevice && typeof toast === 'function') toast('i', isNew ? `⚡ Nouvelle demande — ${svc.nom}` : `🔄 Demande mise à jour — ${svc.nom}`);
  });
}

startPicoTrackApp();
