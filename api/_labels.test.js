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

/* ---------- connexions d'imprimante (Système, Bluetooth, TCP/IP, FTP) ---------- */
const ftp = require('./_printer-ftp');
const net = require('net');

test('imprimante : validation par type de connexion', () => {
  const sys = labels.cleanPrinter({ name: 'A', connection: 'nope', rotation: 45, dpi: 152, site: ' Cahors ' });
  assert.equal(sys.connection, 'system');
  assert.equal(sys.rotation, 0);
  assert.equal(sys.dpi, 152);
  assert.equal(sys.site, 'Cahors');
  assert.equal(sys.address, '');
  const bt = labels.cleanPrinter({ name: 'B', connection: 'bluetooth', address: 'ac-3f-a4-01-02-0f', rotation: 90 });
  assert.equal(bt.address, 'AC:3F:A4:01:02:0F');
  assert.equal(bt.kind, 'zpl');
  assert.equal(bt.rotation, 90);
  assert.throws(() => labels.cleanPrinter({ name: 'B', connection: 'bluetooth', address: 'zebra' }), /Bluetooth invalide/);
  const tcp = labels.cleanPrinter({ name: 'T', connection: 'tcp', address: '192.168.1.50' });
  assert.equal(tcp.port, 9100);
  assert.throws(() => labels.cleanPrinter({ name: 'T', connection: 'tcp', address: '192.168.1.50', port: 70000 }), /Port invalide/);
  assert.throws(() => labels.cleanPrinter({ name: 'T', connection: 'tcp', address: 'a b' }), /IP invalide/);
  const f = labels.cleanPrinter({ name: 'F', connection: 'ftp', address: 'Print.Example.com', ftp_user: 'zebra', ftp_dir: '/zpl' });
  assert.equal(f.port, 21);
  assert.equal(f.address, 'print.example.com');
  assert.throws(() => labels.cleanPrinter({ name: 'F', connection: 'ftp', address: 'x.fr', port: 22 }), /21 ou 1024/);
  assert.throws(() => labels.cleanPrinter({ name: 'F', connection: 'ftp', address: 'x.fr', ftp_user: 'a\r\nDELE x' }), /FTP invalide/);
  assert.throws(() => labels.cleanPrinter({ name: 'F', connection: 'ftp', address: 'x.fr', ftp_dir: '../etc' }), /Dossier/);
  // Champs FTP ignorés pour un autre type
  assert.equal(labels.cleanPrinter({ name: 'T', connection: 'tcp', address: '10.0.0.2', ftp_user: 'x' }).ftp_user, '');
});

test('FTP : mot de passe chiffré, jamais renvoyé au navigateur', async () => {
  const realSecret = labels.deps.secret;
  labels.deps.secret = () => 'cle-de-test';
  try {
    calls.length = 0;
    responder = (p, o) => (o && o.method === 'POST') ? [Object.assign({ id: 3 }, o.body)] : [];
    const res = await labels.handleLabels({}, { action: 'labels_save_printer', printer: { name: 'F', connection: 'ftp', address: 'print.example.com', ftp_password: 's3cret!' } }, admin);
    const sent = calls.find(c => c.opts && c.opts.method === 'POST').opts.body;
    assert.match(sent.ftp_password_enc, /^v1:/);
    assert.ok(!JSON.stringify(sent).includes('s3cret!'));
    assert.equal(ftp.decryptSecret(sent.ftp_password_enc, 'cle-de-test', 'GIT'), 's3cret!');
    assert.throws(() => ftp.decryptSecret(sent.ftp_password_enc, 'cle-de-test', 'EFC'), /illisible/);
    assert.equal(res.printer.ftp_password_set, true);
    assert.equal(res.printer.ftp_password_enc, undefined);
    assert.ok(!JSON.stringify(res).includes('v1:'));
    // Chargement : jamais le chiffré
    responder = (p) => String(p).includes('printer_profiles') ? [{ id: 3, name: 'F', connection: 'ftp', ftp_password_enc: sent.ftp_password_enc }] : [];
    const loaded = await labels.handleLabels({}, { action: 'labels_load' }, admin);
    assert.equal(loaded.printers[0].ftp_password_set, true);
    assert.ok(!JSON.stringify(loaded).includes('v1:'));
    // Modification sans mot de passe : la colonne n'est pas touchée ; effacement explicite : null
    calls.length = 0;
    responder = (p, o) => (o && o.method === 'PATCH') ? [Object.assign({ id: 3 }, o.body)] : [];
    await labels.handleLabels({}, { action: 'labels_save_printer', id: '3', printer: { name: 'F', connection: 'ftp', address: 'print.example.com', ftp_password: '' } }, admin);
    assert.equal('ftp_password_enc' in calls.find(c => c.opts.method === 'PATCH').opts.body, false);
    calls.length = 0;
    await labels.handleLabels({}, { action: 'labels_save_printer', id: '3', printer: { name: 'F', connection: 'tcp', address: '10.0.0.9' } }, admin);
    assert.equal(calls.find(c => c.opts.method === 'PATCH').opts.body.ftp_password_enc, null);
  } finally { labels.deps.secret = realSecret; }
});

test('FTP : classement des adresses (SSRF)', async () => {
  for (const ip of ['127.0.0.1', '0.0.0.0', '169.254.169.254', '100.64.1.1', '224.0.0.1', '::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254']) assert.equal(ftp.classifyAddress(ip), 'blocked', ip);
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.20', 'fd00::1', '::ffff:192.168.1.2']) assert.equal(ftp.classifyAddress(ip), 'private', ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2a01:cb00::1']) assert.equal(ftp.classifyAddress(ip), 'public', ip);
  await assert.rejects(ftp.resolveTarget('localhost'), /refusé/);
  await assert.rejects(ftp.resolveTarget('metadata.google.internal'), /refusé/);
  await assert.rejects(ftp.resolveTarget('127.0.0.1', { allowPrivate: true }), /refusée/);
  await assert.rejects(ftp.resolveTarget('169.254.169.254', { allowPrivate: true }), /refusée/);
  await assert.rejects(ftp.resolveTarget('192.168.1.20'), /privée/);
  assert.equal(await ftp.resolveTarget('192.168.1.20', { allowPrivate: true }), '192.168.1.20');
  // DNS qui renvoie une adresse interne : refusé ; une seule mauvaise adresse suffit
  await assert.rejects(ftp.resolveTarget('evil.example', { lookup: async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }] }), /refusée/);
  assert.equal(await ftp.resolveTarget('ok.example', { lookup: async () => [{ address: '93.184.216.34' }] }), '93.184.216.34');
  assert.equal(ftp.allowPrivate('ACME', { ACME_PRINTER_FTP_ALLOW_PRIVATE: '1' }), true);
  assert.equal(ftp.allowPrivate('ACME', { EFC_PRINTER_FTP_ALLOW_PRIVATE: '1' }), false);
  assert.throws(() => ftp.checkPort(22), /refusé/);
  assert.equal(ftp.checkPort(2121), 2121);
  assert.throws(() => ftp.ftpCommandSafe('a\r\nDELE b'), /invalide/);
});

test('FTP : garde-fous de l’action labels_print_ftp', async () => {
  const realDeps = Object.assign({}, labels.deps);
  const sentJobs = [];
  labels.deps.secret = () => 'cle-de-test';
  labels.deps.allowPrivate = () => false;
  labels.deps.uploadFtp = async (o) => { sentJobs.push(o); return { bytes: o.content.length }; };
  try {
    const enc = ftp.encryptSecret('pw', 'cle-de-test', 'GIT');
    const row = { id: 7, name: 'F', connection: 'ftp', address: 'print.example.com', port: 21, ftp_user: 'u', ftp_dir: '/zpl', ftp_password_enc: enc };
    responder = () => [row];
    labels.deps.resolveTarget = async () => '93.184.216.34';
    const zpl = '^XA^FDok^FS^XZ';
    // Lecteur simple (opérateur) autorisé, scope environnement dans la requête
    calls.length = 0;
    const res = await labels.handleLabels({}, { action: 'labels_print_ftp', printer_id: '7', zpl, address: '127.0.0.1' }, operator);
    assert.equal(res.sent, true);
    assert.match(calls[0].path, /^printer_profiles\?id=eq\.7&environment_code=eq\.GIT/);
    assert.equal(sentJobs[0].address, '93.184.216.34');
    assert.equal(sentJobs[0].password, 'pw');
    assert.equal(sentJobs[0].dir, '/zpl');
    assert.match(sentJobs[0].filename, /^picotrack-\d+-[0-9a-f]{6}\.zpl$/);
    assert.ok(!JSON.stringify(res).includes('pw'));
    // Contenu non ZPL, trop gros, imprimante absente, autre type, compte inactif
    await assert.rejects(labels.handleLabels({}, { action: 'labels_print_ftp', printer_id: '7', zpl: 'USER x' }, admin), e => e.status === 400);
    await assert.rejects(labels.handleLabels({}, { action: 'labels_print_ftp', printer_id: '7', zpl: '^XA' + 'x'.repeat(300 * 1024) + '^XZ' }, admin), e => e.status === 413);
    await assert.rejects(labels.handleLabels({}, { action: 'labels_print_ftp', printer_id: 'x', zpl }, admin), e => e.status === 400);
    await assert.rejects(labels.handleLabels({}, { action: 'labels_print_ftp', printer_id: '7', zpl }, Object.assign({}, admin, { active: false })), e => e.status === 403);
    responder = () => [];
    await assert.rejects(labels.handleLabels({}, { action: 'labels_print_ftp', printer_id: '7', zpl }, admin), e => e.status === 404);
    responder = () => [Object.assign({}, row, { connection: 'tcp' })];
    await assert.rejects(labels.handleLabels({}, { action: 'labels_print_ftp', printer_id: '7', zpl }, admin), /pas en FTP/);
    // Le vrai garde SSRF s'applique à l'hôte enregistré
    labels.deps.resolveTarget = ftp.resolveTarget;
    responder = () => [Object.assign({}, row, { address: '10.0.0.5' })];
    await assert.rejects(labels.handleLabels({}, { action: 'labels_print_ftp', printer_id: '7', zpl }, admin), /privée/);
    responder = () => [Object.assign({}, row, { address: '127.0.0.1' })];
    labels.deps.allowPrivate = () => true;
    await assert.rejects(labels.handleLabels({}, { action: 'labels_print_ftp', printer_id: '7', zpl }, admin), /refusée/);
    assert.equal(sentJobs.length, 1);
  } finally { Object.assign(labels.deps, realDeps); }
});

test('FTP : envoi réel sur un serveur FTP local de test (PASV, IP annoncée ignorée)', async () => {
  let stored = '';
  let storedName = '';
  const commands = [];
  let lastData = null;
  const dataServer = net.createServer(sock => { lastData = sock; sock.on('data', d => { stored += d.toString('utf8'); }); });
  await new Promise(r => dataServer.listen(0, '127.0.0.1', r));
  const dport = dataServer.address().port;
  const ctrl = net.createServer(sock => {
    sock.write('220 test\r\n');
    let buf = '';
    sock.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        commands.push(line.startsWith('PASS') ? 'PASS ***' : line);
        if (line.startsWith('USER')) sock.write('331 pass\r\n');
        else if (line.startsWith('PASS')) sock.write(line === 'PASS pw' ? '230 ok\r\n' : '530 no\r\n');
        else if (line.startsWith('TYPE')) sock.write('200 ok\r\n');
        else if (line.startsWith('CWD')) sock.write('250 ok\r\n');
        else if (line === 'EPSV') sock.write('500 no\r\n');
        // IP annoncée volontairement différente (rebond FTP) : le client doit l'ignorer.
        else if (line === 'PASV') sock.write(`227 Entering Passive Mode (10,9,8,7,${dport >> 8},${dport & 255})\r\n`);
        else if (line.startsWith('STOR')) {
          storedName = line.slice(5);
          sock.write('150 go\r\n');
          lastData.on('end', () => sock.write('226 done\r\n'));
        } else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  await new Promise(r => ctrl.listen(0, '127.0.0.1', r));
  try {
    const res = await ftp.uploadFtp({ address: '127.0.0.1', port: ctrl.address().port, user: 'zebra', password: 'pw', dir: '/zpl', filename: 'a.zpl', content: '^XA^FDÉté^FS^XZ', timeoutMs: 3000 });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(stored, '^XA^FDÉté^FS^XZ');
    assert.equal(storedName, 'a.zpl');
    assert.ok(res.bytes > 0);
    assert.deepEqual(commands.slice(0, 5), ['USER zebra', 'PASS ***', 'TYPE I', 'CWD /zpl', 'EPSV']);
    await assert.rejects(ftp.uploadFtp({ address: '127.0.0.1', port: ctrl.address().port, user: 'zebra', password: 'bad', filename: 'a.zpl', content: '^XA^XZ', timeoutMs: 3000 }), /mot de passe refusé/);
  } finally { ctrl.close(); dataServer.close(); }
});

test('ZPL : résolutions et rotations', () => {
  const tpl = { width_mm: 100, height_mm: 50, elements: [
    { type: 'text', x: 10, y: 5, w: 80, h: 10, size: 12, text: 'A' },
    { type: 'barcode', source: 'text', text: 'ABC', x: 5, y: 20, w: 60, h: 15 }
  ] };
  const dots = { 152: [598, 299], 203: [799, 400], 300: [1181, 591], 600: [2362, 1181] };
  for (const dpi of [152, 203, 300, 600]) {
    const z = L.zplLabel(tpl, {}, { dpi });
    assert.match(z, new RegExp('\\^PW' + dots[dpi][0] + '\\n\\^LL' + dots[dpi][1]), String(dpi));
  }
  assert.match(L.zplLabel(tpl, {}, { dpi: 150 }), /\^PW598/); // ancien 150 dpi = 6 dpmm
  assert.match(L.zplLabel(tpl, {}, { dpi: 600 }), /\^BY6\^BCN/);
  const r0 = L.zplLabel(tpl, {}, { dpi: 203, rotation: 0 });
  assert.match(r0, /\^FO80,40\^A0N/);
  const r90 = L.zplLabel(tpl, {}, { dpi: 203, rotation: 90 });
  assert.match(r90, /\^PW400\n\^LL799/); // support tourné : largeur et longueur inversées
  assert.match(r90, /\^FO280,80\^A0R/); // x = 50-5-10 = 35 mm, y = 10 mm
  assert.match(r90, /\^BCR/);
  const r180 = L.zplLabel(tpl, {}, { dpi: 203, rotation: 180 });
  assert.match(r180, /\^PW799\n\^LL400/);
  assert.match(r180, /\^FO80,280\^A0I/); // x = 100-10-80 = 10 mm, y = 50-5-10 = 35 mm
  const r270 = L.zplLabel(tpl, {}, { dpi: 203, rotation: 270 });
  assert.match(r270, /\^FO40,80\^A0B/); // x = 5 mm, y = 100-10-80 = 10 mm
  assert.match(L.zplLabel(tpl, {}, { dpi: 203, rotation: 45 }), /\^A0N/);
  assert.deepEqual(L.rotateBox({ x: 1, y: 2, w: 3, h: 4 }, 10, 20, 90), { x: 14, y: 1, w: 4, h: 3 });
});

test('Android : PrintActivity déclarée, ZPL seul, IP privées, permission Bluetooth', () => {
  const fs = require('fs');
  const root = path.join(__dirname, '../mobile/android/app/src/main');
  const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:name="\.PrintActivity"/);
  assert.match(manifest, /android:scheme="picotrack-print"/);
  assert.match(manifest, /BLUETOOTH_CONNECT/);
  const java = fs.readFileSync(path.join(root, 'java/fr/picotrack/pad/PrintActivity.java'), 'utf8');
  assert.match(java, /startsWith\("\^XA"\)/);
  assert.match(java, /privateIpv4\(addr\)/);
  assert.match(java, /00001101-0000-1000-8000-00805F9B34FB/);
  assert.match(java, /getBondedDevices/);
  assert.match(java, /AlertDialog/);
});
