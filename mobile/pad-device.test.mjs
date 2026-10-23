import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

function loadPadDevice(geolocation) {
  const alerts = [];
  const saved = [];
  const sandbox = {
    navigator: { geolocation },
    alert(msg) { alerts.push(msg); },
    document: {
      addEventListener(type, fn) { sandbox.listener = fn; }
    }
  };
  sandbox.window = sandbox;
  sandbox.saisieChange = (id, value) => { saved.push({ id, value }); };
  const code = readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'pad-device.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'pad-device.js' });
  return { sandbox, alerts, saved };
}

function button(onclick) {
  const el = {
    onclick,
    attrs: { onclick },
    disabled: false,
    textContent: 'Capturer',
    style: {},
    getAttribute(name) { return this.attrs[name] || ''; },
    setAttribute(name, value) { this.attrs[name] = value; },
    closest(sel) { return sel === 'button' ? this : null; }
  };
  return el;
}

const PLACEHOLDER = "saisieChange('champ_gps','GPS: 45.0473° N, 4.7277° E');this.textContent='Capturé'";

test('placeholder GPS click requests a real position and does not store the demo coordinate', () => {
  let requested = null;
  const { sandbox, saved } = loadPadDevice({
    getCurrentPosition(ok, _err, opts) {
      requested = opts;
      ok({ coords: { latitude: 44.1234567, longitude: 4.7654321, accuracy: 8.4 } });
    }
  });
  const btn = button(PLACEHOLDER);
  sandbox.listener({
    target: btn,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });
  assert.equal(requested.enableHighAccuracy, true);
  assert.deepEqual(saved, [{ id: 'champ_gps', value: 'GPS: 44.123457, 4.765432 (±8 m)' }]);
  assert.equal(saved.some(row => row.value.includes('45.0473')), false);
  assert.equal(btn.textContent, '✅ Capturé');
  assert.match(btn.getAttribute('onclick'), /ptCaptureGps\('champ_gps'/);
});

test('denied GPS does not write a value', () => {
  const { sandbox, alerts, saved } = loadPadDevice({
    getCurrentPosition(_ok, err) { err({ code: 1 }); }
  });
  const btn = button(PLACEHOLDER);
  sandbox.listener({ target: btn, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.deepEqual(saved, []);
  assert.equal(alerts[0], 'Accès à la position refusé.');
  assert.equal(btn.textContent, 'Capturer');
});

test('other buttons are left alone', () => {
  const { sandbox, saved } = loadPadDevice({ getCurrentPosition() { throw new Error('should not run'); } });
  const btn = button("saisieChange('nom','atelier')");
  sandbox.listener({ target: btn, preventDefault() { throw new Error('prevent'); } });
  assert.deepEqual(saved, []);
  assert.equal(btn.getAttribute('onclick'), "saisieChange('nom','atelier')");
});
