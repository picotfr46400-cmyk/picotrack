// ══ INIT ══
if (typeof migrateDataToSupabase === 'function') migrateDataToSupabase();

if (typeof isPadMode === 'function' && isPadMode()) {
  initPadMode();
} else {
  if (typeof renderTable === 'function') renderTable();
  else if (typeof goList === 'function') goList();
  else if (typeof afficherTableau === 'function') afficherTableau();
}
// Écoute temps réel — nouvelles saisies PAD
if (typeof realtime !== 'undefined') {
  realtime.on('submissions', (event, record) => {
    if (event === 'INSERT' && record) {
      // Ajouter à la liste locale
      SUBMISSIONS_DATA.unshift({
        id: record.id,
        formId: record.form_id,
        date: record.created_at,
        dateLabel: new Date(record.created_at).toLocaleString('fr-FR'),
        utilisateur: record.device === 'pad' ? '📱 PAD Terrain' : '🖥 Bureau',
        values: record.values || {}
      });
      // Rafraîchir la vue si ouverte
      const f = FORMS_DATA.find(x => x.id === record.form_id);
      if (f) {
        f.resp = (f.resp || 0) + 1;
        if (document.getElementById('v-submissions')?.classList.contains('on')) {
          renderSubmissions(f);
        }
        toast('i', `📱 Nouvelle saisie PAD — ${f.nom}`);
      }
    }
  });
}
