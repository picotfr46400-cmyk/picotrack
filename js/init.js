// ══ INIT ══
if (typeof isPadMode === 'function' && isPadMode()) {
  initPadMode();
} else {
  afficherTableau();
}
