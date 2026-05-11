// ══ REACT BUILDER BRIDGE ══
let _reactBuilderRoot = null;

function mountReactBuilder(formData, onSave) {
  const container = document.getElementById('react-builder-root');
  if (!container) return;
  if (_reactBuilderRoot) {
    _reactBuilderRoot.unmount();
    _reactBuilderRoot = null;
  }
  _reactBuilderRoot = ReactDOM.createRoot(container);
  _reactBuilderRoot.render(
    React.createElement(PicoBuilderApp, {
      initialFields: formData ? (formData.fields || []).map(f => ({
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
        conds: f.conditions || [],
      })) : [],
      initialName: formData ? formData.nom : '',
      onSave: onSave,
    })
  );
}

function unmountReactBuilder() {
  if (_reactBuilderRoot) {
    _reactBuilderRoot.unmount();
    _reactBuilderRoot = null;
  }
}

// Mapping des types PicoTrack → React builder
function _mapType(t) {
  const map = {
    text:'text', textarea:'textarea', number:'number',
    checkbox:'checkbox', select:'select', multiselect:'multi',
    date:'date', heure:'time', photo:'photo',
    location:'location', signature:'sign', separator:'sep',
  };
  return map[t] || 'text';
}

// Mapping inverse React builder → PicoTrack
function _mapTypeBack(t) {
  const map = {
    text:'text', textarea:'textarea', number:'number',
    checkbox:'checkbox', select:'select', multi:'multiselect',
    date:'date', time:'heure', photo:'photo',
    location:'location', sign:'signature', sep:'separator',
  };
  return map[t] || 'text';
}
