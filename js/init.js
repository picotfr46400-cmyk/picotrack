// ══ INIT ══
if (typeof migrateDataToSupabase === 'function') migrateDataToSupabase();

if (typeof isPadMode === 'function' && isPadMode()) {
  initPadMode();
} else {
  if (typeof renderTable === 'function') renderTable();
  else if (typeof goList === 'function') goList();
  else if (typeof afficherTableau === 'function') afficherTableau();
}

// Synchro polling — formulaires
if (typeof onSync !== 'undefined') {
  onSync('submissions', (event, record) => {
    if (event !== 'INSERT' || !record) return;

    if (SUBMISSIONS_DATA.some(x => x.id == record.id)) return;

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
      if (document.getElementById('v-submissions')?.classList.contains('on') && typeof openSubmissions === 'function') openSubmissions(f.id);
      const otherDevice = (typeof isPadMode === 'function' && isPadMode()) ? record.device !== 'pad' : record.device === 'pad';
      if (otherDevice && typeof toast === 'function') toast('i', `📥 Nouvelle saisie — ${f.nom}`);
    }
  });

  // Synchro polling — demandes de services + changements de statut
  onSync('service_instances', (event, record) => {
    if (!record) return;

    const inst = typeof mapInstanceFromDb === 'function' ? mapInstanceFromDb(record) : null;
    if (!inst) return;

    const idx = SERVICE_INSTANCES_DATA.findIndex(x => String(x.id) === String(inst.id));
    const isNew = idx < 0;

    if (isNew) {
      SERVICE_INSTANCES_DATA.unshift(inst);
    } else {
      // Mise à jour locale : statut, historique, priorité, affectation, etc.
      SERVICE_INSTANCES_DATA[idx] = { ...SERVICE_INSTANCES_DATA[idx], ...inst };
    }

    const svc = SERVICES_DATA.find(s => String(s.id) === String(inst.serviceId));

    // Rafraîchir toutes les vues services possibles
    if (curService && String(curService.id) === String(inst.serviceId)) {
      if (document.getElementById('v-service-instances')?.classList.contains('on') && typeof renderServiceInstances === 'function') {
        renderServiceInstances(curService);
      }
      if (document.getElementById('v-service-kanban')?.classList.contains('on') && typeof renderKanbanBoard === 'function') {
        renderKanbanBoard(curService, curKanbanGroupId);
      }
    }
    if (document.getElementById('v-services')?.classList.contains('on') && typeof renderServices === 'function') renderServices();
    if (document.getElementById('v-prod-services-list')?.classList.contains('on') && typeof renderProdServices === 'function') renderProdServices();

    const otherDevice = (typeof isPadMode === 'function' && isPadMode()) ? record.device !== 'pad' : record.device === 'pad';
    if (svc && otherDevice && typeof toast === 'function') {
      toast('i', isNew ? `⚡ Nouvelle demande — ${svc.nom}` : `🔄 Demande mise à jour — ${svc.nom}`);
    }
  });
}
