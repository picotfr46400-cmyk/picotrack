// ══ INIT ══
if (typeof migrateDataToSupabase === 'function') migrateDataToSupabase();

if (typeof isPadMode === 'function' && isPadMode()) {
  initPadMode();
} else {
  if (typeof renderTable === 'function') renderTable();
  else if (typeof goList === 'function') goList();
  else if (typeof afficherTableau === 'function') afficherTableau();
}

// Écoute polling — nouvelles saisies formulaires
if (typeof onSync !== 'undefined') {
  onSync('submissions', (event, record) => {
    if (event !== 'INSERT' || !record) return;
    if (typeof SUBMISSIONS_DATA === 'undefined') return;

    // anti-doublon : ne pas réimporter une saisie déjà présente localement
    if (SUBMISSIONS_DATA.some(x => String(x.id) === String(record.id))) return;

    SUBMISSIONS_DATA.unshift({
      id: record.id,
      formId: record.form_id,
      date: record.created_at,
      dateLabel: new Date(record.created_at).toLocaleString('fr-FR'),
      utilisateur: record.device === 'pad' ? '📱 PAD Terrain' : 'Picot Clément',
      values: record.values || {}
    });

    const f = FORMS_DATA.find(x => x.id == record.form_id);
    if (f) {
      f.resp = SUBMISSIONS_DATA.filter(s => s.formId == f.id).length;
      if (document.getElementById('v-submissions')?.classList.contains('on')) {
        if (typeof openSubmissions === 'function') openSubmissions(f.id);
      }
      if (document.getElementById('v-prod-forms')?.classList.contains('on') && typeof renderProdForms === 'function') renderProdForms(FORMS_DATA);
      const isOtherDevice = (typeof isPadMode === 'function' && isPadMode()) ? record.device !== 'pad' : record.device === 'pad';
      if (isOtherDevice && typeof toast === 'function') toast('i', `📱 Nouvelle saisie ${record.device === 'pad' ? 'PAD' : 'Bureau'} — ${f.nom}`);
    }
  });

  // Écoute polling — nouvelles demandes services
  onSync('service_instances', (event, record) => {
    if (event !== 'INSERT' || !record) return;
    if (typeof SERVICE_INSTANCES_DATA === 'undefined') return;

    if (SERVICE_INSTANCES_DATA.some(x => String(x.id) === String(record.id))) return;

    const inst = mapDbToLocalInstance(record);
    SERVICE_INSTANCES_DATA.unshift(inst);

    if (document.getElementById('v-prod-services-list')?.classList.contains('on') && typeof renderProdServices === 'function') renderProdServices(SERVICES_DATA);
    if (document.getElementById('v-services')?.classList.contains('on') && typeof renderServices === 'function') renderServices();
    if (typeof curService !== 'undefined' && curService && curService.id == record.service_id) {
      if (document.getElementById('v-service-instances')?.classList.contains('on') && typeof openServiceInstances === 'function') openServiceInstances(curService.id);
      if (document.getElementById('v-prod-service-kanban')?.classList.contains('on') && typeof openServiceKanban === 'function') openServiceKanban(curService.id);
    }

    const svc = SERVICES_DATA.find(s => s.id == record.service_id);
    const isOtherDevice = (typeof isPadMode === 'function' && isPadMode()) ? record.device !== 'pad' : record.device === 'pad';
    if (svc && isOtherDevice && typeof toast === 'function') toast('i', `⚡ Nouvelle demande ${record.device === 'pad' ? 'PAD' : 'Bureau'} — ${svc.nom}`);
  });
}
