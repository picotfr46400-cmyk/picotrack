const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const zlib = require('zlib');
const records = require('./records');
const pdf = require('./_submission-pdf');

const SUPA = 'https://hotfix-test.supabase.co';

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(0);
  return Buffer.concat([len, body, crc]);
}

function redPixelPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

async function withSupabase(run) {
  const keys = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  process.env.SUPABASE_URL = SUPA;
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  try {
    return await run();
  } finally {
    global.fetch = previousFetch;
    for (const key of keys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
}

function authHeaders() {
  return {
    host: 'localhost',
    authorization: 'Bearer session-token',
    'x-picotrack-session': 'sess-1'
  };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = payload === undefined ? '' : String(payload); }
  };
}

async function callJson(body, headers) {
  const res = mockRes();
  await records({ method: 'POST', headers, body }, res);
  let payload = {};
  try { payload = JSON.parse(res.body || '{}'); } catch (_) { payload = { raw: res.body }; }
  return { status: res.statusCode, payload };
}

function inflatedImages(buffer) {
  const out = [];
  const marker = Buffer.from('stream\n');
  const end = Buffer.from('\nendstream');
  let i = 0;
  while (i < buffer.length) {
    const at = buffer.indexOf(marker, i);
    if (at < 0) break;
    const start = at + marker.length;
    const stop = buffer.indexOf(end, start);
    if (stop < 0) break;
    try { out.push(zlib.inflateSync(buffer.subarray(start, stop))); } catch (_) {}
    i = stop + end.length;
  }
  return out;
}

test('le PDF d’une saisie contient l’en-tête, les réponses et les images', () => {
  const png = redPixelPng();
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const doc = pdf.formatSubmissionDocument({
    environmentName: 'EFC Nord',
    environmentCode: 'EFC',
    formName: 'Contrôle arrivage',
    fields: [
      { id: 'client', nom: 'Client', type: 'text' },
      { id: 'photo', nom: 'Photo quai', type: 'photo' },
      { id: 'sign', nom: 'Signature', type: 'signature' },
      { id: 'sep', nom: 'Séparateur', type: 'separator' },
      { id: 'remote', nom: 'Lien', type: 'photo' }
    ],
    values: {
      client: 'Quai (nord)',
      photo: { name: 'quai.jpg', dataUrl },
      sign: dataUrl,
      remote: 'https://example.invalid/photo.jpg'
    },
    createdAt: '2026-10-08T09:15:00.000Z',
    device: 'pad',
    author: 'Marie Martin',
    status: 'Validée',
    reference: 'sub-1'
  });

  assert.equal(doc.environmentName, 'EFC Nord');
  assert.equal(doc.formName, 'Contrôle arrivage');
  assert.equal(doc.dateLabel, '08/10/2026 09:15 UTC');
  assert.equal(doc.author, 'Marie Martin');
  assert.equal(doc.status, 'Validée');
  assert.equal(doc.fields.some((field) => field.label === 'Séparateur'), false);
  const photo = doc.fields.find((field) => field.label === 'Photo quai');
  const sign = doc.fields.find((field) => field.label === 'Signature');
  const remote = doc.fields.find((field) => field.label === 'Lien');
  assert.equal(photo.images.length, 1);
  assert.equal(photo.images[0].width, 1);
  assert.equal(photo.images[0].height, 1);
  assert.deepEqual([...photo.images[0].rgb], [255, 0, 0]);
  assert.equal(sign.images.length, 1);
  assert.equal(remote.images.length, 0);

  const binary = pdf.buildSubmissionPdf(doc);
  assert.equal(binary.subarray(0, 8).toString('latin1'), '%PDF-1.4');
  assert.equal(binary.includes(Buffer.from('%%EOF')), true);
  const text = pdf.extractPdfText(binary);
  for (const expected of ['EFC Nord', 'Contrôle arrivage', '08/10/2026 09:15 UTC', 'Marie Martin', 'Validée', 'Client', 'Quai (nord)', 'Photo quai', 'Signature', 'sub-1']) {
    assert.equal(text.includes(expected), true, expected);
  }
  assert.equal((binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 2);
  const pixels = inflatedImages(binary);
  assert.equal(pixels.some((row) => row.includes(255) && row.includes(0)), true);
  assert.equal(pixels.some((row) => row.length === 3 && row[0] === 255 && row[1] === 0 && row[2] === 0), true);
});

test('export PDF refuse un autre environnement', async () => {
  const actor = {
    id: 'sup-1',
    email: 'sup@efc.picotrack.fr',
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC',
    active: true
  };
  await withSupabase(async () => {
    const calls = [];
    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [actor]);
      if (u.includes('/rest/v1/submissions')) {
        return jsonResponse(200, [{ id: 'sub-acme', environment_code: 'ACME', values: { secret: 'SECRET-ACME' }, form_id: 'form-acme' }]);
      }
      return jsonResponse(200, []);
    };

    const denied = await callJson({ action: 'export_submission_pdf', id: 'sub-acme', environment_code: 'ACME' }, authHeaders());
    assert.equal(denied.status, 403);
    assert.equal(denied.payload.error, 'Environnement refusé.');
    assert.equal(denied.payload.content, undefined);
    assert.equal(JSON.stringify(denied.payload).includes('SECRET-ACME'), false);
    assert.equal(calls.some((u) => u.includes('/rest/v1/submissions')), false);

    calls.length = 0;
    const leaked = await callJson({ action: 'export_submission_pdf', id: 'sub-acme', environment_code: 'EFC' }, authHeaders());
    assert.equal(leaked.status, 403);
    assert.equal(leaked.payload.content, undefined);
    assert.equal(JSON.stringify(leaked.payload).includes('SECRET-ACME'), false);
    const queried = calls.map(decodeURIComponent).filter((u) => u.includes('/rest/v1/submissions?'));
    assert.equal(queried.length, 1);
    assert.match(queried[0], /environment_code=eq\.EFC/);
    assert.equal(queried[0].includes('ACME'), false);
  });
});

test('export PDF refuse sans session', async () => {
  await withSupabase(async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      return jsonResponse(401, { message: 'invalid' });
    };
    const out = await callJson(
      { action: 'export_submission_pdf', id: 'sub-1', environment_code: 'EFC' },
      { host: 'localhost' }
    );
    assert.equal(out.status, 401);
    assert.equal(out.payload.error, 'Authentification requise');
    assert.equal(out.payload.content, undefined);
    assert.equal(calls.some((u) => u.includes('/rest/v1/submissions')), false);
  });
});

test('export PDF relit la saisie dans l’environnement de la session', async () => {
  const actor = {
    id: 'sup-1',
    email: 'sup@efc.picotrack.fr',
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC',
    active: true
  };
  const png = redPixelPng();
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  await withSupabase(async () => {
    const calls = [];
    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [actor]);
      if (u.includes('/rest/v1/submissions?')) {
        return jsonResponse(200, [{
          id: 'sub-1',
          form_id: 'form-1',
          environment_code: 'EFC',
          device: 'pad',
          created_at: '2026-10-08T09:15:00.000Z',
          values: { client: 'Quai (nord)', photo: { name: 'quai.jpg', dataUrl }, sign: dataUrl }
        }]);
      }
      if (u.includes('/rest/v1/forms?')) {
        return jsonResponse(200, [{
          id: 'form-1',
          nom: 'Contrôle arrivage',
          environment_code: 'EFC',
          fields: [
            { id: 'client', nom: 'Client', type: 'text' },
            { id: 'photo', nom: 'Photo quai', type: 'photo' },
            { id: 'sign', nom: 'Signature', type: 'signature' }
          ]
        }]);
      }
      if (u.includes('/rest/v1/service_instances?')) {
        return jsonResponse(200, [{
          id: 'inst-1',
          service_id: 'svc-1',
          current_status_id: 'st-1',
          created_by: 'Marie Martin',
          environment_code: 'EFC'
        }]);
      }
      if (u.includes('/rest/v1/services?')) {
        return jsonResponse(200, [{ id: 'svc-1', environment_code: 'EFC', statuses: [{ id: 'st-1', nom: 'Validée' }] }]);
      }
      if (u.includes('/rest/v1/tenants?')) return jsonResponse(200, [{ nom: 'EFC Nord', code: 'EFC' }]);
      return jsonResponse(200, []);
    };

    const out = await callJson({
      action: 'export_submission_pdf',
      id: 'sub-1',
      environment_code: 'EFC',
      values: { client: 'FROM-CLIENT' }
    }, authHeaders());
    assert.equal(out.status, 200, out.payload.error || '');
    assert.equal(out.payload.environment_code, 'EFC');
    assert.equal(out.payload.filename, 'saisie-sub-1.pdf');
    assert.equal(out.payload.contentType, 'application/pdf');
    const binary = Buffer.from(out.payload.content, 'base64');
    const text = pdf.extractPdfText(binary);
    for (const expected of ['EFC Nord', 'Contrôle arrivage', '08/10/2026 09:15 UTC', 'Marie Martin', 'Validée', 'Quai (nord)', 'Photo quai', 'Signature']) {
      assert.equal(text.includes(expected), true, expected);
    }
    assert.equal(text.includes('FROM-CLIENT'), false);
    assert.equal((binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 2);
    const queried = calls.map(decodeURIComponent).find((u) => u.includes('/rest/v1/submissions?'));
    assert.match(queried, /environment_code=eq\.EFC/);
    assert.equal(queried.includes('password_hash'), false);
    assert.match(queried, /select=id,form_id,values,device,created_at,environment_code/);
  });
});

function zlibBomb(matches) {
  class BitWriter {
    constructor() { this.bytes = []; this.bit = 0; this.cur = 0; }
    write(value, n) {
      for (let i = 0; i < n; i++) {
        if ((value >>> i) & 1) this.cur |= 1 << this.bit;
        this.bit += 1;
        if (this.bit === 8) { this.bytes.push(this.cur); this.cur = 0; this.bit = 0; }
      }
    }
    huff(code, len) {
      for (let i = len - 1; i >= 0; i--) this.write((code >> i) & 1, 1);
    }
    finish() {
      if (this.bit) this.bytes.push(this.cur);
      return Buffer.from(this.bytes);
    }
  }
  const w = new BitWriter();
  w.write(1, 1);
  w.write(2, 2);
  w.write(286 - 257, 5);
  w.write(0, 5);
  w.write(14, 4);
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1];
  const clLen = { 18: 1, 2: 2, 1: 2 };
  for (const sym of order) w.write(clLen[sym] || 0, 3);
  const emitZeros = (count) => {
    while (count > 0) {
      const n = Math.min(138, count);
      w.huff(0, 1);
      w.write(n - 11, 7);
      count -= n;
    }
  };
  w.huff(3, 2);
  emitZeros(255);
  w.huff(3, 2);
  emitZeros(28);
  w.huff(2, 2);
  w.huff(2, 2);
  w.huff(2, 2);
  for (let i = 0; i < matches; i++) {
    w.huff(0, 1);
    w.huff(0, 1);
  }
  w.huff(3, 2);
  const raw = w.finish();
  const total = 1 + matches * 258;
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE((total % 65521) * 65536 + 1);
  return Buffer.concat([Buffer.from([0x78, 0x9c]), raw, adler]);
}

function pngSized(width, height, idat) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

test('une PNG bombe sous le plafond compressé est écartée sans s’étendre', () => {
  const matches = Math.ceil((1_150_000_000 - 1) / 258);
  const png = pngSized(1, 1, zlibBomb(matches));
  assert.ok(png.length < 1_200_000, String(png.length));
  assert.ok(png.length > 1_000_000, String(png.length));
  assert.equal(pdf.decodeImageBuffer(pngSized(4097, 1, zlib.deflateSync(Buffer.from([0, 1, 2, 3])))), null);
  assert.equal(pdf.decodeImageBuffer(pngSized(4000, 4001, zlib.deflateSync(Buffer.from([0, 1, 2, 3])))), null);
  const before = process.memoryUsage().heapUsed;
  const started = Date.now();
  const image = pdf.decodeImageBuffer(png);
  const elapsed = Date.now() - started;
  const delta = process.memoryUsage().heapUsed - before;
  assert.equal(image, null);
  assert.ok(elapsed < 500, `décodage trop lent: ${elapsed} ms`);
  assert.ok(delta < 16 * 1024 * 1024, `mémoire non bornée: ${delta}`);
  const doc = pdf.formatSubmissionDocument({
    fields: [{ id: 'photo', nom: 'Photo', type: 'photo' }],
    values: { photo: `data:image/png;base64,${png.toString('base64')}` }
  });
  assert.equal(doc.imageStats.kept, 0);
  assert.equal(doc.imageStats.attempts, 1);
  assert.equal(doc.imageStats.decodedBytes, 0);
  const binary = pdf.buildSubmissionPdf(doc);
  assert.equal(pdf.extractPdfText(binary).includes('image non incluse'), true);
  assert.equal((binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 0);
});

test('un PNG tronqué reste dans l’export avec la mention, sans erreur interne', async () => {
  const broken = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', Buffer.from([0x00])),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  assert.equal(pdf.decodeImageBuffer(broken), null);
  const shortJpeg = Buffer.alloc(11);
  shortJpeg[0] = 0xFF;
  shortJpeg[1] = 0xD8;
  shortJpeg[2] = 0xFF;
  shortJpeg[3] = 0xC0;
  shortJpeg.writeUInt16BE(7, 4);
  assert.equal(pdf.decodeImageBuffer(shortJpeg), null);
  const actor = {
    id: 'sup-1',
    email: 'sup@efc.picotrack.fr',
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC',
    active: true
  };
  const dataUrl = `data:image/png;base64,${broken.toString('base64')}`;
  await withSupabase(async () => {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [actor]);
      if (u.includes('/rest/v1/submissions?')) {
        return jsonResponse(200, [{
          id: 'sub-broken',
          form_id: 'form-1',
          environment_code: 'EFC',
          device: 'bureau',
          created_at: '2026-10-08T09:15:00.000Z',
          values: { photo: dataUrl }
        }]);
      }
      if (u.includes('/rest/v1/forms?')) {
        return jsonResponse(200, [{
          id: 'form-1',
          nom: 'Contrôle',
          environment_code: 'EFC',
          fields: [{ id: 'photo', nom: 'Photo', type: 'photo' }]
        }]);
      }
      if (u.includes('/rest/v1/tenants?')) return jsonResponse(200, [{ nom: 'EFC', code: 'EFC' }]);
      return jsonResponse(200, []);
    };
    const out = await callJson({ action: 'export_submission_pdf', id: 'sub-broken' }, authHeaders());
    assert.equal(out.status, 200, out.payload.error || '');
    assert.equal(out.payload.error, undefined);
    const raw = JSON.stringify(out.payload);
    assert.equal(raw.includes('ERR_OUT_OF_RANGE'), false);
    assert.equal(raw.includes('RangeError'), false);
    assert.equal(/out of range/i.test(raw), false);
    const text = pdf.extractPdfText(Buffer.from(out.payload.content, 'base64'));
    assert.equal(text.includes('image non incluse'), true);
  });
});

test('au plus 8 images sont décodées', () => {
  const dataUrl = `data:image/png;base64,${redPixelPng().toString('base64')}`;
  const fields = [];
  const values = {};
  for (let i = 0; i < 10; i++) {
    fields.push({ id: `p${i}`, nom: `Photo ${i}`, type: 'photo' });
    values[`p${i}`] = dataUrl;
  }
  const doc = pdf.formatSubmissionDocument({ fields, values, environmentName: 'EFC' });
  assert.equal(doc.imageStats.kept, 8);
  assert.equal(doc.imageStats.attempts, 8);
  assert.equal(doc.fields.filter((field) => field.images.some((image) => image && image.rgb)).length, 8);
  assert.equal(doc.fields.filter((field) => field.images.some((image) => image && image.omitted)).length, 2);
  const binary = pdf.buildSubmissionPdf(doc);
  assert.equal((binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 8);
  assert.equal(pdf.extractPdfText(binary).includes('image non incluse'), true);
});

test('le PDF déclare WinAnsiEncoding et conserve les accents', () => {
  const doc = pdf.formatSubmissionDocument({
    environmentName: 'Été',
    fields: [{ id: 'note', nom: 'Note', type: 'text' }],
    values: { note: 'éèàçô«»€☺' },
    formName: 'Contrôle',
    author: 'Joël',
    status: 'Validée'
  });
  const binary = pdf.buildSubmissionPdf(doc);
  const latin = binary.toString('latin1');
  assert.equal((latin.match(/\/Encoding \/WinAnsiEncoding/g) || []).length, 2);
  assert.match(latin, /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.match(latin, /\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/);
  const expected = Buffer.from([0xE9, 0xE8, 0xE0, 0xE7, 0xF4, 0xAB, 0xBB, 0x80, 0x3F]);
  assert.equal(binary.includes(expected), true);
  const text = pdf.extractPdfText(binary);
  assert.equal(text.includes('éèàçô«»€?'), true);
  assert.equal(text.includes('Été'), true);
  assert.equal(text.includes('Joël'), true);
  assert.equal(text.includes('Validée'), true);
});

test('export PDF refuse un compte pad_user', async () => {
  const actor = {
    id: 'pad-1',
    email: 'pad@efc.picotrack.fr',
    role: 'pad_user',
    license_type: 'pad',
    environment_code: 'EFC',
    active: true
  };
  await withSupabase(async () => {
    const calls = [];
    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.pad-1')) return jsonResponse(200, [actor]);
      if (u.includes('/rest/v1/submissions')) {
        return jsonResponse(200, [{ id: 'sub-1', environment_code: 'EFC', values: { secret: 'SECRET-PAD' } }]);
      }
      return jsonResponse(200, []);
    };
    const out = await callJson({ action: 'export_submission_pdf', id: 'sub-1', environment_code: 'EFC' }, authHeaders());
    assert.equal(out.status, 403);
    assert.equal(out.payload.error, 'Export PDF réservé à la supervision.');
    assert.equal(out.payload.content, undefined);
    assert.equal(JSON.stringify(out.payload).includes('SECRET-PAD'), false);
    assert.equal(calls.some((u) => u.includes('/rest/v1/submissions')), false);
  });
});

test('le détail supervision expose Exporter en PDF via /api/records', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(html, /core-supervision\.js\?v=20261008a/);
  const overlay = fs.readFileSync(path.join(__dirname, '../assets/core-supervision.js'), 'utf8');
  assert.match(overlay, /Exporter en PDF/);
  assert.match(overlay, /export_submission_pdf/);
  const recordsSrc = fs.readFileSync(path.join(__dirname, 'records.js'), 'utf8');
  assert.match(recordsSrc, /case 'export_submission_pdf'/);

  function makeEl(tag) {
    const el = {
      tag,
      style: {},
      className: '',
      type: '',
      textContent: '',
      classList: { contains() { return false; }, add() {}, remove() {} },
      children: [],
      firstChild: null,
      attrs: {},
      listeners: {},
      setAttribute(name, value) { this.attrs[name] = value; },
      appendChild(child) {
        this.children.push(child);
        if (!this.firstChild) this.firstChild = child;
        return child;
      },
      insertBefore(child) {
        this.children.unshift(child);
        this.firstChild = child;
        return child;
      },
      querySelector(sel) {
        if (sel === '[data-pt-export-pdf]') {
          return this.children.find((child) => child.attrs && child.attrs['data-pt-export-pdf']) || null;
        }
        return null;
      },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      click() { if (this.listeners.click) return this.listeners.click(); },
      remove() {}
    };
    let htmlText = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return htmlText; },
      set(value) {
        htmlText = value;
        el.children = [];
        el.firstChild = null;
      }
    });
    return el;
  }

  const main = makeEl('div');
  const body = makeEl('body');
  const posts = [];
  const downloads = [];
  const toasts = [];
  const document = {
    readyState: 'complete',
    body,
    head: makeEl('head'),
    getElementById(id) { return id === 'sd-main' ? main : null; },
    createElement(tag) { return makeEl(tag); },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const sandbox = {
    console,
    Promise,
    Blob,
    atob,
    Uint8Array,
    document,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    setTimeout() { return 0; },
    clearTimeout() {},
    URL: { createObjectURL() { return 'blob:pdf'; }, revokeObjectURL() {} },
    renderSubmissionDetail() { main.innerHTML = '<div>detail</div>'; },
    _getEnvironmentCode() { return 'EFC'; },
    toast(kind, msg) { toasts.push({ kind, msg }); },
    addEventListener() {},
    removeEventListener() {},
    _apiPost(apiPath, body) {
      posts.push({ apiPath, body });
      return Promise.resolve({
        filename: 'saisie-sub-1.pdf',
        contentType: 'application/pdf',
        content: Buffer.from('%PDF-1.4\n').toString('base64')
      });
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(overlay, sandbox, { filename: 'core-supervision.js' });
  sandbox.renderSubmissionDetail({ id: 'sub-1' }, { nom: 'Contrôle arrivage' });
  const bar = main.children.find((child) => child.attrs && child.attrs['data-pt-export-pdf']);
  assert.ok(bar, 'barre d’export absente');
  const button = bar.children[0];
  assert.equal(button.textContent, 'Exporter en PDF');
  await button.click();
  const exportPost = posts.find((item) => item.body && item.body.action === 'export_submission_pdf');
  assert.ok(exportPost, 'appel export absent');
  assert.equal(exportPost.apiPath, '/api/records');
  assert.equal(exportPost.body.id, 'sub-1');
  assert.equal(exportPost.body.environment_code, 'EFC');
  assert.equal(exportPost.body.values, undefined);
  const link = body.children.find((child) => child.tag === 'a');
  assert.equal(link.download, 'saisie-sub-1.pdf');
  assert.equal(toasts.some((item) => item.kind === 's'), true);
});
