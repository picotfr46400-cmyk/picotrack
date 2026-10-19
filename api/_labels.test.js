'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const calls = [];
let responder = () => [];
const ss = require('./_server-supabase');
const realRest = ss.serviceRest;
ss.serviceRest = async (p, opts) => { calls.push({ path: p, opts }); return responder(p, opts); };
delete require.cache[require.resolve('./_labels')];
const labels = require('./_labels');
ss.serviceRest = realRest;

global.qrcode = require('../assets/qrcode.js');
const L = require('../assets/labels-core.js');

const admin = { id: 'u1', role: 'admin', environment_code: 'GIT', active: true };
const operator = { id: 'u2', role: 'operateur', environment_code: 'GIT', active: true };

test('modèle : validation stricte des éléments', () => {
  const t = labels.cleanTemplate({ name: ' Colis ', form_id: '4', width_mm: 1000, height_mm: 50, elements: [
    { type: 'field', field_id: '123', x: -5, y: 2, w: 40, h: 6, size: 200, bold: true, evil: 'x' },
    { type: 'qr', source: 'link', x: 70, y: 5, w: 25, h: 25 }
  ] });
  assert.equal(t.name, 'Colis');
  assert.equal(t.width_mm, 300);
  assert.equal(t.elements[0].x, 0);
  assert.equal(t.elements[0].size, 72);
  assert.equal(t.elements[0].evil, undefined);
  assert.equal(t.elements[1].source, 'link');
  assert.throws(() => labels.cleanTemplate({ name: 'x', elements: [{ type: 'script' }] }), /type inconnu/);
  assert.throws(() => labels.cleanTemplate({ name: 'x', elements: [{ type: 'field' }] }), /champ/);
  assert.throws(() => labels.cleanTemplate({ name: '' }), /Nom/);
  assert.throws(() => labels.cleanTemplate({ name: 'x', elements: new Array(41).fill({ type: 'text' }) }), /40/);
});

test('imprimante : valeurs bornées', () => {
  const p = labels.cleanPrinter({ name: 'Zebra', kind: 'tcp', dpi: 999, margin_mm: 50 });
  assert.equal(p.kind, 'system');
  assert.equal(p.dpi, 203);
  assert.equal(p.margin_mm, 20);
});

test('droits : lecture filtrée par environnement, écriture réservée aux admins', async () => {
  calls.length = 0;
  responder = () => [];
  const res = await labels.handleLabels({}, { action: 'labels_load', environment_code: 'EFC' }, operator);
  assert.equal(res.environment_code, 'GIT');
  assert.equal(res.can_manage, false);
  assert.ok(calls.every(c => c.path.includes('environment_code=eq.GIT')));
  await assert.rejects(labels.handleLabels({}, { action: 'labels_save_template', template: { name: 'x' } }, operator), e => e.status === 403);
  await assert.rejects(labels.handleLabels({}, { action: 'labels_load' }, { role: 'admin', environment_code: 'GLOBAL' }), e => e.status === 400);
  for (const p of [{ role: 'supervision_user', license_type: 'readonly', environment_code: 'GIT' }, { role: 'pad_user', environment_code: 'GIT' }]) {
    await assert.rejects(labels.handleLabels({}, { action: 'labels_delete_template', id: '1' }, p), e => e.status === 403);
  }
  const sup = await labels.handleLabels({}, { action: 'labels_load' }, { role: 'supervision_user', license_type: 'supervision', environment_code: 'GIT' });
  assert.equal(sup.can_manage, true);
});

test('écriture : formulaire vérifié dans l’environnement, PATCH et DELETE scopés', async () => {
  calls.length = 0;
  responder = (p) => p.startsWith('forms?') ? [] : [{ id: 1 }];
  await assert.rejects(labels.handleLabels({}, { action: 'labels_save_template', template: { name: 'x', form_id: '9' } }, admin), /Formulaire introuvable/);
  responder = () => [{ id: 1 }];
  calls.length = 0;
  await labels.handleLabels({}, { action: 'labels_save_template', id: '1', template: { name: 'x', form_id: '9' } }, admin);
  const patch = calls.find(c => c.opts.method === 'PATCH');
  assert.match(patch.path, /^label_templates\?id=eq\.1&environment_code=eq\.GIT/);
  assert.equal(patch.opts.body.environment_code, undefined);
  calls.length = 0;
  await labels.handleLabels({}, { action: 'labels_delete_printer', id: '5' }, admin);
  assert.match(calls[0].path, /^printer_profiles\?id=eq\.5&environment_code=eq\.GIT/);
  await assert.rejects(labels.handleLabels({}, { action: 'labels_delete_printer', id: '5;drop' }, admin), e => e.status === 400);
  calls.length = 0;
  await labels.handleLabels({}, { action: 'labels_save_printer', printer: { name: 'A', is_default: true } }, admin);
  assert.match(calls[0].path, /is_default=eq\.true/);
  assert.equal(calls[1].opts.body.environment_code, 'GIT');
});

test('migration absente : 503 lisible', async () => {
  responder = () => { const e = new Error('relation "public.label_templates" does not exist'); e.status = 404; throw e; };
  await assert.rejects(labels.handleLabels({}, { action: 'labels_load' }, admin), e => e.status === 503 && /migration/.test(e.message));
});

test('records.js route les actions étiquettes', () => {
  const src = require('fs').readFileSync(path.join(__dirname, 'records.js'), 'utf8');
  for (const a of labels.LABEL_ACTIONS) assert.ok(src.includes(`case '${a}'`), a);
});

test('Code 128 : structure et somme de contrôle', () => {
  const m = L.code128Modules('PT-0042');
  assert.equal(m.length, 11 * (1 + 7 + 1) + 13);
  // Début B = 11010010000
  assert.equal(m.slice(0, 11).join(''), '11010010000');
  assert.equal(m.slice(-13).join(''), '1100011101011');
});

test('QR, rendu et valeurs de saisie', () => {
  assert.ok(L.qrMatrix('Référence é').length >= 21);
  const tpl = { name: 'T', width_mm: 62, height_mm: 29, elements: [
    { type: 'field', field_id: '1', x: 1, y: 1, w: 40, h: 5, size: 9, prefix: 'Nom : ' },
    { type: 'field', field_id: '2', x: 1, y: 7, w: 40, h: 5, size: 9 },
    { type: 'reference', x: 1, y: 13, w: 40, h: 5, size: 9 },
    { type: 'text', x: 1, y: 19, w: 40, h: 5, size: 9, text: '<b>' },
    { type: 'qr', source: 'link', x: 40, y: 2, w: 20, h: 20 }
  ] };
  const ctx = { submission: { id: 7, values: { 1: 'Dupont', 2: { date: '2026-10-20', start_time: '13:30', label: '2026-10-20 13:30' } } }, reference: 'SVC-1', origin: 'https://efc.picotrack.fr' };
  const html = L.labelHtml(tpl, ctx);
  assert.match(html, /Nom : Dupont/);
  assert.match(html, /2026-10-20 13:30/);
  assert.match(html, /SVC-1/);
  assert.match(html, /&lt;b&gt;/);
  assert.equal(L.resolveElement(tpl.elements[4], ctx), 'https://efc.picotrack.fr/?saisie=7');
  const doc = L.printDocument(tpl, [ctx, ctx]);
  assert.match(doc, /@page\{size:62mm 29mm;margin:0\}/);
  assert.equal((doc.match(/class="pt-page"/g) || []).length, 2);
  // Saisie vide : aucune valeur inventée
  assert.doesNotMatch(L.labelHtml(tpl, { submission: {} }), /Dupont|SVC/);
});

test('ZPL : format en points et UTF-8', () => {
  const z = L.zplLabel({ width_mm: 100, height_mm: 50, elements: [
    { type: 'text', x: 10, y: 5, w: 80, h: 10, size: 12, text: 'Été ^XZ' },
    { type: 'barcode', source: 'text', text: 'ABC', x: 5, y: 20, w: 60, h: 15 },
    { type: 'qr', source: 'text', text: 'x', x: 70, y: 20, w: 25, h: 25 }
  ] }, {}, { dpi: 203 });
  assert.match(z, /^\^XA\n\^CI28\n\^PW799\n\^LL400/);
  assert.match(z, /\^FO80,40\^A0N,34,34/);
  assert.match(z, /Été  XZ/);
  assert.match(z, /\^BCN/);
  assert.match(z, /\^BQN,2,\d+\^FDMA,x/);
  assert.match(z, /\^XZ$/);
});
