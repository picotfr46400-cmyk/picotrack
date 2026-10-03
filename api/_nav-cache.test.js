const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { prefixForHost } = require('./_server-supabase');

const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const bundle = fs.readFileSync(path.join(__dirname, '../assets/app.secured.js'), 'utf8');

test('index.html : Babel absent, React conservé, cache-buster 20261003b', () => {
  assert.equal(/@babel\/standalone|babel\.min\.js|text\/babel/i.test(html), false);
  assert.match(html, /react@18\.3\.1\/umd\/react\.production\.min\.js/);
  assert.match(html, /react-dom@18\.3\.1\/umd\/react-dom\.production\.min\.js/);
  assert.match(html, /app\.secured\.js\?v=20261003b/);
  assert.match(html, /core-supervision\.js\?v=20261003b/);
  assert.equal(html.includes('20260916c'), false);
  assert.equal(html.includes('20260916d'), false);
  assert.equal(html.includes('20261003a'), false);
});

test('hotfix saisie: case groupe inchangé dans le bundle', () => {
  const idx = bundle.indexOf('case"groupe":');
  assert.ok(idx >= 0, 'case groupe présent');
  assert.match(bundle.slice(idx, idx + 1200), /break;/);
  assert.equal(bundle.includes('brea;'), false);
});

test('overlay : skip innerHTML + dirty flags pour les go* listés', () => {
  assert.match(overlay, /window\.ptNavShouldSkip/);
  assert.match(overlay, /window\.ptNavMarkDirty/);
  assert.match(overlay, /wrapPainter\('renderDashboard'/);
  assert.match(overlay, /wrapPainter\('renderTable'/);
  assert.match(overlay, /wrapPainter\('renderProdForms'/);
  assert.match(overlay, /wrapPainter\('renderUsersList'/);
  assert.match(overlay, /wrapPainter\('renderServices'/);
  assert.match(overlay, /function wrapGoServices/);
  assert.match(overlay, /function wrapGoWorkflows/);
  assert.match(overlay, /function wrapGoProdServices/);
  assert.match(overlay, /function wrapAutomations/);
  assert.match(overlay, /function wrapPlanningCache/);
});

test('Planning TTL 30–60s : pas de cascade full-history sur cache chaud', () => {
  assert.match(overlay, /PLANNING_TTL_MS = 45000/);
  assert.match(overlay, /function planningCacheFresh/);
  assert.match(overlay, /if \(planningCacheFresh\(\)\) return window\._ptPlanningCache/);
  assert.equal(overlay.includes("loadAppointments('2000-01-01'"), false);
  assert.match(overlay, /paintPlanningFromCache/);
});

test('Dashboard : cache /api/users ≥60s, pas de loadFromSupabase à chaque goDashboard', () => {
  assert.match(overlay, /USERS_SUMMARY_TTL_MS = 60000/);
  assert.match(overlay, /usersSummaryCache/);
  const kpi = overlay.slice(overlay.indexOf('window.ptFillLiveKpis'), overlay.indexOf('function wrapDashboard'));
  assert.equal(kpi.includes('loadFromSupabase'), false);
  assert.match(kpi, /ptEnsureServicesLoaded/);
  assert.equal(overlay.includes("['goDashboard', 'renderDashboard']"), false);
  const dash = overlay.slice(overlay.indexOf('function wrapDashboard'), overlay.indexOf('function notInternalDb'));
  assert.match(dash, /wrapPainter\('renderDashboard'/);
  assert.equal((dash.match(/ptFillLiveKpis/g) || []).length, 1);
});

test('wrapGoProdServices : un seul renderProdServices (orig), ensureAllInstancesLoaded sans cascade', () => {
  const wrap = overlay.slice(overlay.indexOf('function wrapGoProdServices'), overlay.indexOf('function wireExecToolbar'));
  assert.equal(/renderProdServices\(\)/.test(wrap), false);
  assert.match(overlay, /window\.ensureAllInstancesLoaded/);
  const ensure = overlay.slice(overlay.indexOf('window.ensureAllInstancesLoaded'), overlay.indexOf('function wrapDbDirtyFlags'));
  assert.equal(/for\s*\(.*page|offset\s*\+|while\s*\(.*loaded/.test(ensure), false);
  assert.match(ensure, /__ptInstancesLoaded/);
});

test('maps de counts instances/submissions (plus de N×M overlay)', () => {
  assert.match(overlay, /function instancesByService/);
  assert.match(overlay, /function submissionsByForm/);
  assert.match(overlay, /wrapSvcStatsMaps/);
  const filter = overlay.slice(overlay.indexOf('function filterServicesForExec'), overlay.indexOf('function populateResponsableSelect'));
  assert.equal(filter.includes('SERVICE_INSTANCES_DATA.filter'), false);
});

test('SheetJS / Form Builder restent branchés', () => {
  assert.match(overlay, /xlsx@0\.18\.5\/dist\/xlsx\.full\.min\.js/);
  assert.match(overlay, /window\.exportExcel/);
  assert.match(overlay, /function wrapOpenBuilder/);
  assert.match(bundle, /React\.createElement/);
  assert.match(bundle, /window\.PicoBuilderApp/);
});

test('isolation tenant efc inchangée par ce lot', () => {
  assert.equal(prefixForHost('efc.picotrack.fr'), 'EFC');
  assert.equal(prefixForHost('picotrack.fr'), 'PROD');
  assert.equal(overlay.includes('api/_server-supabase'), false);
});

test('ptNavShouldSkip : skip seulement si painted + fp identique + pas dirty + pas Chargement', () => {
  const start = overlay.indexOf('window.ptNavShouldSkip = function');
  const end = overlay.indexOf('function markPainted', start);
  const fnSrc = overlay.slice(start, end).replace('window.ptNavShouldSkip = function', 'function ptNavShouldSkip');
  const ctx = {
    window: { __ptNavDirty: {}, __ptNavPainted: { dash: 'a1' } }
  };
  const fn = new Function('window', fnSrc + '; return ptNavShouldSkip;')(ctx.window);
  const painted = { childElementCount: 3, textContent: 'Dashboard EFC' };
  const loading = { childElementCount: 1, textContent: 'Chargement du planning...' };
  assert.equal(fn('dash', painted, 'a1'), true);
  assert.equal(fn('dash', painted, 'a2'), false);
  ctx.window.__ptNavDirty.dash = true;
  assert.equal(fn('dash', painted, 'a1'), false);
  ctx.window.__ptNavDirty.dash = false;
  assert.equal(fn('dash', loading, 'a1'), false);
  assert.equal(fn('dash', { childElementCount: 0, textContent: '' }, 'a1'), false);
});

function extractFn(fromMarker, untilMarker) {
  const start = overlay.indexOf(fromMarker);
  const end = overlay.indexOf(untilMarker, start);
  assert.ok(start >= 0 && end > start, 'extrait ' + fromMarker);
  return new Function(overlay.slice(start, end) + '; return ' + fromMarker.replace(/^function\s+/, '').split('(')[0] + ';')();
}

test('Bug A : listFp change si actif/published bascule (même count / ids / resp)', () => {
  const listFp = extractFn('function listFp', 'function mergeFormResp');
  const rows = [
    { id: 'f1', nom: 'Alpha', resp: 100, actif: true, published: true },
    { id: 'f2', nom: 'Beta', resp: 2, actif: true, published: true }
  ];
  const before = listFp(rows);
  assert.match(String(before), /:/);
  rows[0].actif = false;
  const afterToggle = listFp(rows);
  assert.notEqual(afterToggle, before, 'toggle actif doit invalider le fingerprint');
  rows[0].actif = true;
  assert.equal(listFp(rows), before, 'rollback actif doit retrouver le fingerprint initial');
  rows[1].published = false;
  assert.notEqual(listFp(rows), before, 'toggle published doit invalider le fingerprint');
});

test('Bug A : renderTable n’est plus skip après toggle / rollback', () => {
  const listFp = extractFn('function listFp', 'function mergeFormResp');
  const start = overlay.indexOf('window.ptNavShouldSkip = function');
  const end = overlay.indexOf('function markPainted', start);
  const fnSrc = overlay.slice(start, end).replace('window.ptNavShouldSkip = function', 'function ptNavShouldSkip');
  const ctx = { window: { __ptNavDirty: {}, __ptNavPainted: {} } };
  const shouldSkip = new Function('window', fnSrc + '; return ptNavShouldSkip;')(ctx.window);
  const painted = { childElementCount: 4, textContent: 'Alpha Oui 100' };
  const rows = [{ id: 'f1', nom: 'Alpha', resp: 100, actif: true, published: true }];
  const fpOn = listFp(rows) + '|p1|s10';
  ctx.window.__ptNavPainted.renderTable = fpOn;
  assert.equal(shouldSkip('renderTable', painted, fpOn), true);
  rows[0].actif = false;
  const fpOff = listFp(rows) + '|p1|s10';
  assert.equal(shouldSkip('renderTable', painted, fpOff), false);
  ctx.window.__ptNavPainted.renderTable = fpOff;
  rows[0].actif = true;
  assert.equal(shouldSkip('renderTable', painted, fpOn), false);
  assert.match(overlay, /function wrapToggleActive/);
  assert.match(overlay, /ptNavMarkDirty\(\['renderTable', 'renderProdForms', 'renderDashboard'\]\)/);
});

test('Bug B : mergeFormResp ne baisse jamais un compteur connu', () => {
  const mergeFormResp = extractFn('function mergeFormResp', 'window.ptNavListFp');
  assert.equal(mergeFormResp(100, 2), 100);
  assert.equal(mergeFormResp(100, 0), 100);
  assert.equal(mergeFormResp(100, undefined), 100);
  assert.equal(mergeFormResp(2, 100), 100);
  assert.equal(mergeFormResp(undefined, 5), 5);
  assert.equal(mergeFormResp('100', 2), 100);
  assert.equal(mergeFormResp(0, 0), 0);
  const wrap = overlay.slice(overlay.indexOf('function wrapRenderProdFormsCounts'), overlay.indexOf('function paintPlanningFromCache'));
  assert.match(wrap, /mergeFormResp\(/);
  assert.equal(/form\.resp\s*=\s*counts/.test(wrap), false);
  assert.match(overlay, /function bumpProdFormCardCounts/);
});

test('Promise.resolve(ret).then : afterResolved + .catch (pas de rejet non géré)', () => {
  assert.match(overlay, /function afterResolved/);
  assert.match(overlay, /Promise\.resolve\(ret\)\.then\(onOk\)\.catch/);
  const lines = overlay.split('\n');
  let bare = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('Promise.resolve(ret).then')) continue;
    const chunk = lines.slice(i, i + 8).join('\n');
    if (!/\.catch\s*\(/.test(chunk)) bare += 1;
  }
  assert.equal(bare, 0, 'chaque Promise.resolve(ret).then doit avoir un .catch');
});

function makeFloorApi(form) {
  const mergeFormResp = extractFn('function mergeFormResp', 'window.ptNavListFp');
  const windowObj = { __ptRespFloor: {}, __ptNavDirty: {} };
  windowObj.ptNavMarkDirty = function (keys) {
    (Array.isArray(keys) ? keys : [keys]).forEach((k) => { windowObj.__ptNavDirty[k] = true; });
  };
  const forms = form ? [form] : [];
  const src = overlay.slice(overlay.indexOf('function formKey'), overlay.indexOf('function respWord'));
  const factory = new Function(
    'window',
    'mergeFormResp',
    'dataList',
    src + '; return { getRespFloor, raiseRespFloor, applyRespFloorToForm, bumpRespFloor };'
  );
  return factory(windowObj, mergeFormResp, (name) => (name === 'forms' ? forms : []));
}

test('Bug B complet : plancher resp par form.id, +1 submit/realtime, pas de chute', () => {
  const form = { id: 'f1', nom: 'Alpha', resp: 100 };
  const api = makeFloorApi(form);
  api.applyRespFloorToForm(form);
  assert.equal(form.resp, 100);
  assert.equal(api.getRespFloor('f1'), 100);
  form.resp = 2;
  assert.equal(form.resp, 100, 'assignation depuis SUBMISSIONS_DATA partiel ne baisse pas');
  const afterSubmit = api.bumpRespFloor('f1', 1);
  assert.equal(afterSubmit, 101);
  assert.equal(form.resp, 101);
  form.resp = 3;
  assert.equal(form.resp, 101, 'submitSaisie / realtime filter.length ne casse plus le plancher');
  const other = { id: 'f2', resp: 2 };
  api.raiseRespFloor('f2', 100);
  api.applyRespFloorToForm(other);
  assert.equal(other.resp, 100);
  assert.match(overlay, /function wrapRenderTableFloor/);
  assert.match(overlay, /function wrapSubmitSaisieResp/);
  assert.match(overlay, /function wrapSubmissionsArray/);
  assert.match(overlay, /function wrapOnSyncSubmissions/);
  assert.match(overlay, /applyRespFloorToList\(source\)/);
  const excel = overlay.slice(overlay.indexOf('window.exportExcel'), overlay.indexOf('function filterServicesForExec'));
  assert.match(excel, /applyRespFloorToForm/);
  const tableWrap = overlay.slice(overlay.indexOf('function wrapRenderTableFloor'), overlay.indexOf('function wrapNavPainters'));
  assert.match(tableWrap, /applyRespFloorToList\(dataList\('filtered'\)\)/);
  const prod = overlay.slice(overlay.indexOf('function wrapRenderProdFormsCounts'), overlay.indexOf('function paintPlanningFromCache'));
  assert.match(prod, /applyRespFloorToForm\(form\)/);
});

test('Planning : invalidation aussi sur update/delete RDV', () => {
  assert.match(overlay, /function invalidatePlanningCache/);
  assert.match(overlay, /updateAppointment: \['renderPlanning', 'goPlanning'\]/);
  assert.match(overlay, /deleteAppointment: \['renderPlanning', 'goPlanning'\]/);
  assert.match(overlay, /fn === 'createAppointment' \|\| fn === 'updateAppointment' \|\| fn === 'deleteAppointment'/);
  assert.match(overlay, /String\(entity \|\| ''\) === 'appointments'/);
  assert.match(overlay, /function wrapApiAppointmentMutations/);
  const src = overlay.slice(overlay.indexOf('function invalidatePlanningCache'), overlay.indexOf('window.ptGetRespFloor'));
  const windowObj = { _ptPlanningLoadedAt: 99, _ptPlanningCache: [1], _ptPlanningCacheRange: 'x', __ptNavDirty: {} };
  windowObj.ptNavMarkDirty = function (keys) {
    (Array.isArray(keys) ? keys : [keys]).forEach((k) => { windowObj.__ptNavDirty[k] = true; });
  };
  const invalidate = new Function('window', src + '; return invalidatePlanningCache;')(windowObj);
  invalidate();
  assert.equal(windowObj._ptPlanningLoadedAt, 0);
  assert.equal(windowObj._ptPlanningCache, null);
  assert.equal(windowObj.__ptNavDirty.renderPlanning, true);
  assert.equal(windowObj.__ptNavDirty.goPlanning, true);
});

test('Pluriel réponse / réponses selon le compteur', () => {
  const respWord = extractFn('function respWord', 'function respPhrase');
  assert.equal(respWord(0), 'réponses');
  assert.equal(respWord(1), 'réponse');
  assert.equal(respWord(2), 'réponses');
  assert.equal(respWord(100), 'réponses');
  const bump = overlay.slice(overlay.indexOf('function bumpProdFormCardCounts'), overlay.indexOf('function wrapRenderProdFormsCounts'));
  assert.match(bump, /respPhrase\(/);
});
