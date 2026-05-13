// ══ INIT ══
if (typeof migrateDataToSupabase === 'function') migrateDataToSupabase();

if (typeof isPadMode === 'function' && isPadMode()) {
  initPadMode();
} else {
  if (typeof renderTable === 'function') renderTable();
  else if (typeof goList === 'function') goList();
  else if (typeof afficherTableau === 'function') afficherTableau();
}
