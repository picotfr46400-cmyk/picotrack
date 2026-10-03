// Pont appareil pour le PAD : le bouton Localisation du formulaire
// enregistrait des coordonnées de démonstration. Ce script les remplace
// par navigator.geolocation, utilisé par le navigateur et par l'APK Android.
(function () {
  if (window.__ptPadDevice) return;

  var PLACEHOLDER_LAT = '45.0473';
  var PLACEHOLDER_LNG = '4.7277';

  function isPlaceholderGpsClick(onclick) {
    var value = String(onclick || '');
    return value.indexOf(PLACEHOLDER_LAT) !== -1 && value.indexOf(PLACEHOLDER_LNG) !== -1 && value.indexOf('saisieChange') !== -1;
  }

  function fieldIdFromOnclick(onclick) {
    var match = String(onclick || '').match(/saisieChange\('([^']*)'/);
    return match ? match[1] : '';
  }

  function jsAttr(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function ptCaptureGps(id, btn) {
    if (!id) return;
    if (!navigator.geolocation) {
      alert('GPS indisponible sur cet appareil.');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'GPS…';
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      var coords = (pos && pos.coords) || {};
      var lat = Number(coords.latitude);
      var lng = Number(coords.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Capturer';
        }
        alert('Position indisponible.');
        return;
      }
      var accuracy = Number(coords.accuracy);
      var text = 'GPS: ' + lat.toFixed(6) + ', ' + lng.toFixed(6);
      if (Number.isFinite(accuracy)) text += ' (±' + Math.round(accuracy) + ' m)';
      if (typeof window.saisieChange === 'function') window.saisieChange(id, text);
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✅ Capturé';
        btn.style.background = '#10b981';
        btn.style.color = '#fff';
      }
    }, function (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Capturer';
      }
      var code = err && err.code;
      var msg = code === 1 ? 'Accès à la position refusé.' : code === 3 ? 'Délai GPS dépassé. Réessayez dehors ou près d’une fenêtre.' : 'Position indisponible.';
      alert(msg);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
  }

  function onClickCapture(ev) {
    var target = ev && ev.target;
    var btn = target && target.closest ? target.closest('button') : null;
    if (!btn) return;
    var onclick = btn.getAttribute('onclick') || '';
    if (!isPlaceholderGpsClick(onclick)) return;
    var id = fieldIdFromOnclick(onclick);
    if (!id) return;
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    btn.setAttribute('onclick', "ptCaptureGps('" + jsAttr(id) + "', this)");
    ptCaptureGps(id, btn);
  }

  document.addEventListener('click', onClickCapture, true);
  window.ptCaptureGps = ptCaptureGps;
  window.__ptPadDevice = {
    isPlaceholderGpsClick: isPlaceholderGpsClick,
    fieldIdFromOnclick: fieldIdFromOnclick,
    onClickCapture: onClickCapture,
    ptCaptureGps: ptCaptureGps
  };
})();
