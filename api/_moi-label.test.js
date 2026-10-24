// Valeurs { id, label } (champ « moi ») : conditions, réenregistrement, bases autonomes et CSV.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const fv = require('./_field-validation');

const ME = { id: 'u-1', label: 'Marie Durand' };
const FIELDS = [
  { id: 'qui', type: 'requete', nom: 'Moi', lookup: { source: { kind: 'me' }, col: 'nom' } },
  { id: 'eq', type: 'text', nom: 'Eq', conditions: [{ field: 'Moi', op: '=', val: 'Marie Durand' }] },
  { id: 'ne', type: 'text', nom: 'Ne', conditions: [{ field: 'Moi', op: '!=', val: 'Paul' }] },
  { id: 'ct', type: 'text', nom: 'Ct', conditions: [{ field: 'Moi', op: 'contains', val: 'Durand' }] },
  { id: 'ko', type: 'text', nom: 'Ko', conditions: [{ field: 'Moi', op: '=', val: '[object Object]' }] }
];

test('serveur : « Moi = nom » vrai, != et contains sur l’objet, jamais [object Object]', () => {
  const v = { qui: ME, eq: 'a', ne: 'b', ct: 'c', ko: 'd' };
  assert.equal(fv.isVisible(FIELDS[1], FIELDS, v, 'sup'), true);
  assert.equal(fv.isVisible(FIELDS[2], FIELDS, v, 'sup'), true);
  assert.equal(fv.isVisible(FIELDS[3], FIELDS, v, 'sup'), true);
  assert.equal(fv.isVisible(FIELDS[4], FIELDS, v, 'sup'), false);
});

test('serveur : réenregistrement conserve les valeurs conditionnées par « Moi »', () => {
  const out = fv.stripHidden(FIELDS, { qui: ME, eq: 'a', ne: 'b', ct: 'c' }, 'sup');
  assert.deepEqual(out, { qui: ME, eq: 'a', ne: 'b', ct: 'c' });
});

function loadBundle() {
  const src = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  const grab = name => {
    const i = src.indexOf('function ' + name + '(');
    assert.ok(i >= 0, name);
    let d = 0, j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
    throw new Error(name);
  };
  const ctx = { saisieValues: {}, DATABASES_DATA: [], out: {}, document: { getElementById: () => null } };
  ctx.h = s => String(s).replace(/[&<>"]/g, c => '&#' + c.charCodeAt(0) + ';');
  ctx.dl = (data) => { ctx.out.csv = data; };
  ctx.toast = () => {};
  vm.createContext(ctx);
  vm.runInContext(['_ptValText', 'saisieEvalCond', '_renderSDBTable', '_filterSDB', 'exportStandaloneCSV'].map(grab).join('\n')
    + ';this._ptValText=_ptValText;this.saisieEvalCond=saisieEvalCond;this._renderSDBTable=_renderSDBTable;this._filterSDB=_filterSDB;this.exportStandaloneCSV=exportStandaloneCSV;', ctx);
  return ctx;
}

test('client : saisieEvalCond normalise { id, label } (=, !=, contains sans crash)', () => {
  const c = loadBundle();
  c.saisieValues.qui = ME;
  const f = op => ({ conditions: [{ field: 'Moi', op: op[0], val: op[1] }] });
  assert.equal(c.saisieEvalCond(f(['=', 'Marie Durand']), FIELDS), true);
  assert.equal(c.saisieEvalCond(f(['!=', 'Marie Durand']), FIELDS), false);
  assert.equal(c.saisieEvalCond(f(['contains', 'Durand']), FIELDS), true);
  assert.equal(c.saisieEvalCond(f(['=', '[object Object]']), FIELDS), false);
  c.saisieValues.qui = 7;
  assert.equal(c.saisieEvalCond(f(['contains', '7']), FIELDS), true);
});

test('client : bases autonomes et CSV affichent le libellé, filtre sur le libellé', () => {
  const c = loadBundle();
  const db = { id: 'db1', nom: 'Base', columns: [{ id: 'c1', nom: 'Qui' }], rows: [{ id: 'r1', source: 'form', dateLabel: '', values: { c1: ME } }] };
  c.DATABASES_DATA.push(db);
  const html = c._renderSDBTable(db, db.rows);
  assert.match(html, /Marie Durand/);
  assert.doesNotMatch(html, /object Object/);
  let shown = null;
  c.document.getElementById = () => ({ set innerHTML(v) { shown = v; } });
  c._filterSDB('db1', 'durand');
  assert.match(shown, /Marie Durand/);
  c._filterSDB('db1', 'object');
  assert.doesNotMatch(shown, /Marie Durand/);
  c.exportStandaloneCSV('db1');
  assert.match(c.out.csv, /"Marie Durand"/);
  assert.doesNotMatch(c.out.csv, /object Object/);
});
