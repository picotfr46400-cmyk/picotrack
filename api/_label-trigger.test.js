'use strict';
// Form Builder > Actions après validation > « Imprimer une étiquette » :
// le sélecteur liste les vrais modèles/imprimantes de l'environnement et le choix est utilisé à l'impression.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function el() {
  return { style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], insertBefore() {}, innerHTML: '',
    contentWindow: { document: { open() {}, write() {}, close() {} }, focus() {}, print() {} } };
}

function boot(server) {
  const listeners = {};
  const calls = [];
  const printed = [];
  const toasts = [];
  const win = {
    console, Promise, Object, Array, String, Number, Math, JSON, Date, isFinite, parseInt, encodeURIComponent,
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    navigator: { userAgent: 'node' }, location: { origin: 'https://efc.test', href: '', hash: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    CustomEvent: function (type) { this.type = type; },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    dispatchEvent: (e) => { (listeners[e.type] || []).slice().forEach(f => f(e)); return true; },
    toast: (k, m) => toasts.push([k, m]),
    PT_ENVIRONMENT_CODE: 'EFC',
    _apiPost: async (url, body) => { calls.push(body); return server(body); },
    document: { readyState: 'complete', getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: el, body: el(), addEventListener() {} }
  };
  win.window = win; win.globalThis = win;
  vm.createContext(win);
  vm.runInContext(read('assets/qrcode.js'), win);
  vm.runInContext(read('assets/labels-core.js'), win);
  vm.runInContext(read('assets/labels.js'), win);
  // Capture de l'impression sans DOM : on remplace le rendu HTML par un enregistreur.
  const L = win.PTLabels;
  const realDoc = L.printDocument;
  L.printDocument = (tpl, ctxs, opts) => { printed.push({ tpl: tpl.name, n: ctxs.length, ref: ctxs[0].reference, opts }); return realDoc(tpl, ctxs, opts); };
  return { win, calls, printed, toasts, listeners };
}

const TPL = [
  { id: 1, name: 'Test 1', form_id: 32, width_mm: 100, height_mm: 50, elements: [{ type: 'text', x: 1, y: 1, w: 50, h: 5, text: 'x' }] },
  { id: 7, name: 'Etiquette arrivage', form_id: null, width_mm: 60, height_mm: 40, elements: [] }
];
const PRN = [{ id: 3, name: 'Zebra quai', connection: 'system', kind: 'html', width_mm: 100, height_mm: 50, dpi: 203, margin_mm: 0, rotation: 0 }];

test('bundle : plus de liste en dur, le sélecteur vient de labels.js et l’action est lancée après validation', () => {
  const app = read('assets/app.secured.js');
  assert.ok(!app.includes('template:"Etiquette arrivage"'), 'défaut en dur supprimé');
  assert.ok(!/placeholder:"Mod\\xe8le d'\\xe9tiquette"/.test(app), 'champ texte libre supprimé');
  assert.ok(app.includes('React.createElement(window.PtLabelTriggerPicker,{value:y.printLabel,onChange:e=>S("printLabel",e)})'));
  assert.equal((app.match(/window\.ptRunPrintLabelTrigger\(e,[np]\)/g) || []).length, 2, 'saisie directe et saisie via service');
  const html = read('index.html');
  assert.match(html, /labels\.js\?v=20261024-4/);
});

test('sélecteur : tous les modèles de l’environnement, mis à jour sans recharger, état vide sinon', async () => {
  let templates = [];
  const env = boot(b => b.action === 'labels_load' ? { templates, printers: PRN, can_manage: true } : {});
  const { win } = env;
  await win.PTLabelsUI.load(true);
  // React minimal : on rend la fonction composant, hooks simulés.
  const effects = [];
  win.React = {
    useState: (v) => [v, () => {}],
    useEffect: (fn) => effects.push(fn),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
  };
  const flat = n => !n || typeof n !== 'object' ? [n] : [n].concat(...n.children.map(flat));
  let tree = win.PtLabelTriggerPicker({ value: { enabled: true }, onChange() {} });
  assert.ok(flat(tree).some(n => n && n.props && n.props['data-empty']), 'état vide');
  assert.ok(flat(tree).includes('Aucun modèle d’étiquette dans cet environnement.'));

  // Clement crée « Test 1 » : la relecture prévient le sélecteur, sans recharger la page.
  let notified = 0;
  win.addEventListener('pt-labels-changed', () => notified++);
  templates = TPL;
  await win.PTLabelsUI.load(true);
  assert.ok(notified >= 1);
  assert.equal(env.calls.filter(c => c.action === 'labels_load').every(c => c.environment_code === 'EFC'), true);
  let changed = null;
  tree = win.PtLabelTriggerPicker({ value: { enabled: true, template: 'Etiquette arrivage' }, onChange: v => { changed = v; } });
  const selects = flat(tree).filter(n => n && n.type === 'select');
  assert.equal(selects.length, 2);
  const opts = flat(selects[0]).filter(n => n && n.type === 'option').map(n => n.props.value);
  assert.deepEqual(opts, ['', '1', '7']);
  assert.equal(selects[0].props.value, '7', 'ancien réglage texte retrouvé par son nom');
  selects[0].props.onChange({ target: { value: '1' } });
  assert.deepEqual(JSON.parse(JSON.stringify(changed)), { templateId: 1, template: 'Test 1' });
  selects[1].props.onChange({ target: { value: '3' } });
  assert.deepEqual(JSON.parse(JSON.stringify(changed)), { printerId: 3, printer: 'Zebra quai' });
  assert.deepEqual(flat(selects[1]).filter(n => n && n.type === 'option').map(n => n.props.value), ['', '3']);
});

test('impression après validation : le modèle et l’imprimante choisis sont ceux utilisés', async () => {
  const env = boot(b => b.action === 'labels_load' ? { templates: TPL, printers: PRN, can_manage: true } : []);
  const form = { id: 36, triggers: { printLabel: { enabled: true, templateId: 1, template: 'Test 1', printerId: 3 } } };
  const sub = { id: 900, form_id: 36, values: { a: 'b' } };
  assert.equal(await env.win.ptRunPrintLabelTrigger(form, sub, 'REF-1'), 'printed');
  assert.equal(env.printed.length, 1);
  assert.equal(env.printed[0].tpl, 'Test 1');
  assert.equal(env.printed[0].ref, 'REF-1');
  assert.equal(env.printed[0].opts.dpi, 203, 'réglages de l’imprimante choisie');

  assert.equal(await env.win.ptRunPrintLabelTrigger({ triggers: { printLabel: { enabled: false, templateId: 1 } } }, sub), 'off');
  assert.equal(await env.win.ptRunPrintLabelTrigger({ triggers: { printLabel: { enabled: true, templateId: 99 } } }, sub), 'no-template');
  assert.ok(env.toasts.some(t => /choisissez un modèle/.test(t[1])), 'jamais silencieux');
  assert.equal(env.printed.length, 1);
});
