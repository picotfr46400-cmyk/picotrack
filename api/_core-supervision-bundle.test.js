const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

test('hotfix saisie: case groupe conserve un break valide', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  const idx = bundle.indexOf('case"groupe":');
  assert.ok(idx >= 0, 'case groupe présent');
  const chunk = bundle.slice(idx, idx + 1200);
  assert.match(chunk, /break;/);
  assert.equal(bundle.includes('brea;'), false);
});

test('cache-buster et overlay core-supervision sont branchés', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.equal((html.match(/app\.secured\.js\?v=20261008p/g) || []).length, 2);
  assert.match(html, /core-supervision\.js\?v=20261008p/);
  assert.match(html, /pad-device\.js\?v=20261008a/);
  assert.equal(html.includes('20260916c'), false);
  assert.equal(html.includes('20260916d'), false);
  assert.equal(html.includes('20261003a'), false);
  assert.equal(html.includes('20261003b'), false);
  assert.equal(html.includes('20261003c'), false);
  assert.equal(html.includes('20261003d'), false);
  assert.equal(html.includes('20261003e'), false);
  assert.equal(html.includes('20261003f'), false);
  assert.equal(html.includes('20261003g'), false);
  assert.equal(html.includes('20260827d'), false);
});

test('Babel standalone est retiré de index.html (Form Builder = React.createElement)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.equal(/@babel\/standalone|babel\.min\.js|text\/babel/i.test(html), false);
  assert.match(html, /react@18\.3\.1\/umd\/react\.production\.min\.js/);
  assert.match(html, /react-dom@18\.3\.1\/umd\/react-dom\.production\.min\.js/);
});

test('Importer / filtres / étiquette ne sont plus des no-op dans le bundle', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  assert.match(bundle, /onclick="importForms\(\)"/);
  assert.match(bundle, /ptToggleExecFilters\(\)/);
  assert.match(bundle, /ptOpenMoreExecFilters\(\)/);
  assert.match(bundle, /id="exec-responsable"/);
  assert.match(bundle, /Impression navigateur/);
  assert.equal(bundle.includes('"Disponible","goAutomations()","Configurer"'), false);
});

test('intégrations restent dans /api/records (limite Hobby 12 fonctions)', () => {
  const apiDir = path.join(__dirname);
  const serverless = fs.readdirSync(apiDir).filter((name) => name.endsWith('.js') && !name.startsWith('_') && !name.endsWith('.test.js'));
  assert.equal(serverless.includes('integrations.js'), false);
  assert.ok(serverless.length <= 12, 'trop de fonctions serverless: ' + serverless.join(','));
  const records = fs.readFileSync(path.join(apiDir, 'records.js'), 'utf8');
  assert.match(records, /integrations_load/);
  assert.match(records, /handleIntegrations/);
  const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
  assert.match(overlay, /integrationsPost\('integrations_test_webhook'/);
  assert.equal(overlay.includes("apiPost('/api/integrations'"), false);
});

test('declItems / printLabel / workflow toast sont branchés', () => {
  const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
  assert.match(overlay, /triggers\.decl/);
  assert.match(overlay, /ptRunSubmitTriggers/);
  assert.match(overlay, /ptRunWorkflowDeclaredAction/);
  assert.match(overlay, /normalizeSubmission/);
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  assert.match(bundle, /ptRunWorkflowDeclaredAction/);
  assert.equal((bundle.match(/ptRunWorkflowDeclaredAction/g) || []).length >= 3, true);
});

test('créneau plein : le bouton redevient cliquable et le message s’affiche', async () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');
  const start = bundle.indexOf('async function submitSaisie()');
  const end = bundle.indexOf('function ptTimeToMinutes', start);
  assert.ok(start >= 0 && end > start, 'submitSaisie introuvable');
  const btn = {
    disabled: false,
    textContent: '✅ Valider la saisie',
    style: { pointerEvents: 'auto', opacity: '1' }
  };
  const toasts = [];
  const deleted = [];
  let createCalls = 0;
  let resolveCreate;
  const created = new Promise((resolve) => { resolveCreate = resolve; });
  let rejectSlot;
  const slotFull = new Promise((_, reject) => { rejectSlot = reject; });
  const ctx = {
    console,
    Promise,
    setTimeout,
    clearTimeout,
    document: {
      getElementById(id) { return id === 'btn-submit-saisie' ? btn : null; }
    },
    FORMS_DATA: [{ id: 'f-rdv', nom: 'Rendez-vous', fields: [], resp: 0 }],
    curSaisieFormId: 'f-rdv',
    saisieValues: { rdv: { date: '2026-10-03', start_time: '09:00', end_time: '09:30' } },
    saisieEvalCond() { return true; },
    SUBMISSIONS_DATA: [],
    isPadMode() { return false; },
    toast(type, msg) { toasts.push({ type, msg }); },
    ptCheckAppointmentCapacityBeforeSubmit() { return true; },
    ptCreateAppointmentsForSubmission() { return slotFull; },
    DB: {
      createSubmission() {
        createCalls += 1;
        return created;
      },
      deleteSubmission(id) {
        deleted.push(id);
        return Promise.resolve();
      }
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(bundle.slice(start, end), ctx, { filename: 'submitSaisie.js' });

  const rejections = [];
  function onRejection(err) { rejections.push(err); }
  process.on('unhandledRejection', onRejection);
  try {
    const pending = ctx.submitSaisie();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(createCalls, 1);
    assert.equal(btn.textContent, '⏳ Enregistrement...');
    assert.equal(btn.style.pointerEvents, 'none');
    resolveCreate({ id: 'sub-full' });
    await new Promise((resolve) => setImmediate(resolve));
    rejectSlot(Object.assign(new Error('Créneau complet pour cette date et cette heure : 09:00 (1/1)'), { code: 'SLOT_FULL' }));
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rejections.length, 0, 'le rollback ne doit pas lever en restaurant le bouton');
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, '✅ Valider la saisie');
    assert.equal(btn.style.pointerEvents, 'auto');
    assert.equal(String(btn.style.opacity), '1');
    assert.equal(ctx.__ptSubmittingSaisie, false);
    assert.deepEqual(deleted, ['sub-full']);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].type, 'e');
    assert.match(toasts[0].msg, /Saisie annulée/);
    assert.match(toasts[0].msg, /Créneau complet pour cette date et cette heure : 09:00/);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});
