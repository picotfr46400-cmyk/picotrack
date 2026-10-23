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

test('captured GPS updates the label next to the button (no more « Non capturé »)', () => {
  const { sandbox } = loadPadDevice({
    getCurrentPosition(ok) { ok({ coords: { latitude: 43.7810254, longitude: 1.3729781, accuracy: 12 } }); }
  });
  const btn = button(PLACEHOLDER);
  const label = { textContent: '📍 Non capturé' };
  btn.parentNode = { querySelector(sel) { return sel === 'span' ? label : null; } };
  sandbox.listener({ target: btn, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(btn.textContent, '✅ Capturé');
  assert.equal(label.textContent, '📍 GPS: 43.781025, 1.372978 (±12 m)');
});

