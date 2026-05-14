// ══ REACT BUILDER BRIDGE ══
let _reactBuilderRoot = null;

function mountReactBuilder(formData, onSave) {
  const container = document.getElementById('react-builder-root');
  if (!container) { console.error('react-builder-root introuvable'); return; }

  // Forcer la hauteur visible
  container.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;width:100%';

  // Vérifier PicoBuilderApp
  if (!window.PicoBuilderApp) {
    container.innerHTML = '<div style="padding:40px;text-align:center"><div style="font-size:28px;margin-bottom:12px">⚠️</div><div style="font-size:15px;font-weight:700;color:#ef4444">Builder non chargé</div><div style="font-size:13px;color:#94a3b8;margin-top:8px">Faites Ctrl+Maj+R pour forcer le rechargement</div></div>';
    return;
  }

  // Démonter l'ancien root si existant
  if (_reactBuilderRoot) {
    try { _reactBuilderRoot.unmount(); } catch(e) {}
    _reactBuilderRoot = null;
  }

  // Mapper les champs
  var initialFields = formData ? (formData.fields || []).map(function(f) {
    return {
      id: f.id,
      type: _mapType(f.type),
      label: f.nom || f.label || '',
      req: f.obligatoire || false,
      opts: f.valeurs || [],
      ph: f.placeholder || '',
      leg: f.legendeText || '',
      showLeg: f.afficher_legende || false,
      vSup: f.vis_sup !== false,
      vNom: f.vis_nom !== false,
      dup: f.duplicable || false,
      vlds: f.validateurs || [],
      conds: (f.conditions || []).map(function(c){return {fn:c.fn||c.field||'', op:c.op||'=', val:c.val||''};}),
      key: f.field_key || f.key || '',
      section: f.section || '',
      def: f.defaultValue !== undefined ? f.defaultValue : (f.default_value || ''),
      roles: f.roles || [],
    };
  }) : [];

  try {
    _reactBuilderRoot = ReactDOM.createRoot(container);
    _reactBuilderRoot.render(
      React.createElement(window.PicoBuilderApp, {
        initialFields: initialFields,
        initialName: formData ? formData.nom : '',
        initialMeta: formData ? { visibleRoles: formData.visibleRoles || [], triggers: formData.triggers || null } : null,
        onSave: onSave,
      })
    );
  } catch(e) {
    console.error('Erreur mount React:', e);
    container.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444">Erreur React : ' + e.message + '</div>';
  }
}

function unmountReactBuilder() {
  if (_reactBuilderRoot) {
    try { _reactBuilderRoot.unmount(); } catch(e) {}
    _reactBuilderRoot = null;
  }
}

function _mapType(t) {
  var map = {
    text:'text', textarea:'textarea', number:'number',
    checkbox:'checkbox', select:'select', multiselect:'multi',
    date:'date', heure:'time', datetime:'datetime',
    photo:'photo', file:'file', location:'location',
    signature:'sign', separator:'sep', titre:'titre',
    image:'image', son:'son', video:'video', groupe:'groupe',
    calcul:'calcul', requete:'requete',
    table_unique:'table_unique', table_multiple:'table_multi',
  };
  return map[t] || 'text';
}
