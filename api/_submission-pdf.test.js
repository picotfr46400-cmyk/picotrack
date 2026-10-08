const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const zlib = require('zlib');
const crypto = require('crypto');
const records = require('./records');
const appointments = require('./appointments');
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

function jpegOfSize(size) {
  const buf = Buffer.alloc(size);
  buf[0] = 0xFF;
  buf[1] = 0xD8;
  buf[2] = 0xFF;
  buf[3] = 0xC0;
  buf.writeUInt16BE(11, 4);
  buf[6] = 8;
  buf.writeUInt16BE(2, 7);
  buf.writeUInt16BE(2, 9);
  buf[11] = 3;
  return buf;
}

async function exportAs(actor, submission) {
  return withSupabase(async () => {
    const calls = [];
    global.fetch = async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes(`user_profiles?id=eq.${actor.id}`)) return jsonResponse(200, [actor]);
      if (u.includes('/rest/v1/submissions')) return jsonResponse(200, [submission]);
      if (u.includes('/rest/v1/forms?')) {
        return jsonResponse(200, [{
          id: 'form-1',
          nom: 'Contrôle',
          environment_code: 'EFC',
          fields: [{ id: 'photo', nom: 'Photo', type: 'photo' }, { id: 'note', nom: 'Note', type: 'text' }]
        }]);
      }
      if (u.includes('/rest/v1/tenants?')) return jsonResponse(200, [{ nom: 'EFC', code: 'EFC' }]);
      return jsonResponse(200, []);
    };
    const out = await callJson({ action: 'export_submission_pdf', id: 'sub-1', environment_code: 'EFC' }, authHeaders());
    return { out, calls };
  });
}

for (const licenseType of ['pad', 'pad_terrain', 'terrain', 'mobile']) {
  test(`export PDF refuse la licence ${licenseType} même avec le rôle supervision_user`, async () => {
    const actor = {
      id: 'pad-1',
      email: 'pad@efc.picotrack.fr',
      role: 'supervision_user',
      license_type: licenseType,
      environment_code: 'EFC',
      active: true
    };
    const { out, calls } = await exportAs(actor, {
      id: 'sub-1',
      environment_code: 'EFC',
      values: { note: 'SECRET-PAD' }
    });
    assert.equal(out.status, 403);
    assert.equal(out.payload.error, 'Export PDF réservé à la supervision.');
    assert.equal(out.payload.content, undefined);
    assert.equal(JSON.stringify(out.payload).includes('SECRET-PAD'), false);
    assert.equal(calls.some((u) => u.includes('/rest/v1/submissions')), false);
  });
}

test('export PDF autorise une licence supervision', async () => {
  const roles = ['supervision_user', 'supervision', 'manager', 'gestionnaire', 'environment_admin', 'client_admin', 'plateforme'];
  for (const role of roles) {
    const actor = {
      id: 'sup-1',
      email: 'sup@efc.picotrack.fr',
      role,
      license_type: 'supervision',
      environment_code: 'EFC',
      active: true
    };
    const { out, calls } = await exportAs(actor, {
      id: 'sub-1',
      form_id: 'form-1',
      environment_code: 'EFC',
      device: 'bureau',
      created_at: '2026-10-08T09:15:00.000Z',
      values: { note: 'Visible' }
    });
    assert.equal(out.status, 200, `${role}: ${out.payload.error || ''}`);
    assert.equal(out.payload.contentType, 'application/pdf');
    assert.equal(pdf.extractPdfText(Buffer.from(out.payload.content, 'base64')).includes('Visible'), true, role);
    assert.equal(calls.some((u) => u.includes('/rest/v1/submissions')), true, role);
  }
  const platform = {
    id: 'plat-1',
    email: 'root@picotrack.fr',
    role: 'super_admin',
    license_type: 'super_admin',
    scope: 'platform',
    environment_code: 'GLOBAL',
    active: true
  };
  const platformOut = await exportAs(platform, {
    id: 'sub-1',
    form_id: 'form-1',
    environment_code: 'EFC',
    device: 'bureau',
    created_at: '2026-10-08T09:15:00.000Z',
    values: { note: 'Plateforme' }
  });
  assert.equal(platformOut.out.status, 200, platformOut.out.payload.error || '');
  assert.equal(pdf.extractPdfText(Buffer.from(platformOut.out.payload.content, 'base64')).includes('Plateforme'), true);

  const missingType = {
    id: 'sup-1',
    email: 'sup@efc.picotrack.fr',
    role: 'supervision_user',
    license_type: null,
    environment_code: 'EFC',
    active: true
  };
  const nullOut = await exportAs(missingType, {
    id: 'sub-1',
    form_id: 'form-1',
    environment_code: 'EFC',
    device: 'bureau',
    created_at: '2026-10-08T09:15:00.000Z',
    values: { note: 'Sans type' }
  });
  assert.equal(nullOut.out.status, 200, nullOut.out.payload.error || '');
});

test('huit JPEG d’environ 1,2 Mo restent dans un export 200 sous la limite', async () => {
  const jpeg = jpegOfSize(1_150_000);
  assert.ok(jpeg.length < 1_200_000);
  assert.ok(jpeg.length > 1_000_000);
  const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  const values = {};
  for (let i = 0; i < 8; i++) values[`p${i}`] = dataUrl;
  const actor = {
    id: 'sup-1',
    email: 'sup@efc.picotrack.fr',
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC',
    active: true
  };
  await withSupabase(async () => {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [actor]);
      if (u.includes('/rest/v1/submissions?')) {
        return jsonResponse(200, [{
          id: 'sub-jpeg',
          form_id: 'form-1',
          environment_code: 'EFC',
          device: 'bureau',
          created_at: '2026-10-08T09:15:00.000Z',
          values
        }]);
      }
      if (u.includes('/rest/v1/forms?')) {
        return jsonResponse(200, [{
          id: 'form-1',
          nom: 'Photos',
          environment_code: 'EFC',
          fields: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, nom: `Photo ${i}`, type: 'photo' }))
        }]);
      }
      if (u.includes('/rest/v1/tenants?')) return jsonResponse(200, [{ nom: 'EFC', code: 'EFC' }]);
      return jsonResponse(200, []);
    };
    const out = await callJson({ action: 'export_submission_pdf', id: 'sub-jpeg', environment_code: 'EFC' }, authHeaders());
    assert.equal(out.status, 200, out.payload.error || '');
    const binary = Buffer.from(out.payload.content, 'base64');
    const text = pdf.extractPdfText(binary);
    const mentions = text.split('image non incluse').length - 1;
    const images = (binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length;
    assert.equal(images, 2);
    assert.ok(mentions >= 6);
    assert.ok(binary.length <= pdf.PDF_BYTE_LIMIT);
    assert.ok(out.payload.content.length < 4_500_000);
  });
});

function noisyPng(width, height) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + stride);
    raw[row] = 0;
    crypto.randomFillSync(raw, row + 1, stride);
  }
  return pngSized(width, height, zlib.deflateSync(raw, { level: 1 }));
}

function expandingPng(width, height) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + stride);
    raw[row] = 1;
    for (let i = 0; i < stride; i++) raw[row + 1 + i] = (i * 17 + y * 3) & 255;
  }
  return pngSized(width, height, zlib.deflateSync(raw, { level: 9 }));
}

function embeddedPngBytes(png) {
  const image = pdf.decodeImageBuffer(png);
  assert.ok(image && image.rgb);
  return zlib.deflateSync(image.rgb).length;
}

function keptWithin(sizes, budget) {
  let sum = 0;
  let kept = 0;
  sizes.forEach((size) => {
    if (sum + size > budget) return;
    sum += size;
    kept += 1;
  });
  return { kept, sum };
}

async function exportPhotoValues(id, values) {
  const actor = {
    id: 'sup-1',
    email: 'sup@efc.picotrack.fr',
    role: 'supervision_user',
    license_type: 'supervision',
    environment_code: 'EFC',
    active: true
  };
  const ids = Object.keys(values);
  return withSupabase(async () => {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
      if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
      if (u.includes('user_profiles?id=eq.sup-1')) return jsonResponse(200, [actor]);
      if (u.includes('/rest/v1/submissions?')) {
        return jsonResponse(200, [{
          id,
          form_id: 'form-1',
          environment_code: 'EFC',
          device: 'bureau',
          created_at: '2026-10-08T09:15:00.000Z',
          values
        }]);
      }
      if (u.includes('/rest/v1/forms?')) {
        return jsonResponse(200, [{
          id: 'form-1',
          nom: 'Photos',
          environment_code: 'EFC',
          fields: ids.map((key, index) => ({ id: key, nom: `Photo ${index}`, type: 'photo' }))
        }]);
      }
      if (u.includes('/rest/v1/tenants?')) return jsonResponse(200, [{ nom: 'EFC', code: 'EFC' }]);
      return jsonResponse(200, []);
    };
    return callJson({ action: 'export_submission_pdf', id, environment_code: 'EFC' }, authHeaders());
  });
}

test('le budget images suit le plafond PDF de 3 Mo moins 300 Ko de texte', () => {
  assert.equal(pdf.PDF_BYTE_LIMIT, 3_000_000);
  assert.equal(pdf.TEXT_BYTE_MARGIN, 300_000);
  assert.equal(pdf.MAX_EMBEDDED_BUDGET, pdf.PDF_BYTE_LIMIT - pdf.TEXT_BYTE_MARGIN);
  assert.equal(pdf.MAX_JPEG_BUDGET, 2_500_000);
  assert.equal(pdf.IMAGE_TIME_BUDGET_MS, 8_000);
  const recordsSrc = fs.readFileSync(path.join(__dirname, 'records.js'), 'utf8');
  assert.match(recordsSrc, /PDF_BYTE_LIMIT/);
  assert.match(recordsSrc, /pdf\.length > PDF_BYTE_LIMIT/);
  assert.equal(recordsSrc.includes('pdf.length > 3_000_000'), false);
});

function heavyZeroPng() {
  const width = 4000;
  const height = 4000;
  const raw = Buffer.alloc(height * (1 + width * 3));
  return pngSized(width, height, zlib.deflateSync(raw, { level: 1 }));
}

test('seize PNG lourds restent un export 200 sans être décodés', async () => {
  const png = heavyZeroPng();
  assert.ok(png.length <= 1_200_000, String(png.length));
  assert.equal(png.readUInt32BE(16), 4000);
  assert.equal(png.readUInt32BE(20), 4000);
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const fields = [];
  const values = {};
  for (let i = 0; i < 16; i++) {
    fields.push({ id: `p${i}`, nom: `Photo ${i}`, type: 'photo' });
    values[`p${i}`] = dataUrl;
  }
  const started = Date.now();
  const doc = pdf.formatSubmissionDocument({ fields, values, environmentName: 'EFC' });
  assert.equal(doc.imageStats.kept, 0);
  assert.equal(doc.imageStats.attempts, 0);
  assert.equal(doc.imageStats.decodedBytes, 0);
  const out = await exportPhotoValues('sub-heavy', values);
  const elapsed = Date.now() - started;
  assert.equal(out.status, 200, out.payload.error || '');
  const binary = Buffer.from(out.payload.content, 'base64');
  const mentions = pdf.extractPdfText(binary).split('image non incluse').length - 1;
  assert.equal(mentions, 16);
  assert.equal((binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 0);
  assert.ok(binary.length <= pdf.PDF_BYTE_LIMIT);
  assert.ok(elapsed < 3_000, `trop lent: ${elapsed} ms`);
});

test('une image suivante reste décodée après un PNG refusé sur l’en-tête', () => {
  const heavy = heavyZeroPng();
  const small = redPixelPng();
  const doc = pdf.formatSubmissionDocument({
    fields: [
      { id: 'big', nom: 'Lourde', type: 'photo' },
      { id: 'small', nom: 'Petite', type: 'photo' }
    ],
    values: {
      big: `data:image/png;base64,${heavy.toString('base64')}`,
      small: `data:image/png;base64,${small.toString('base64')}`
    },
    environmentName: 'EFC'
  });
  assert.equal(doc.imageStats.kept, 1);
  assert.equal(doc.imageStats.attempts, 1);
  assert.equal(doc.imageStats.decodedBytes, 3);
  const binary = pdf.buildSubmissionPdf(doc);
  assert.equal((binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 1);
  assert.equal(pdf.extractPdfText(binary).includes('image non incluse'), true);
  assert.ok(binary.length <= pdf.PDF_BYTE_LIMIT);
});

test('des PNG bruités restent un export 200 sous le plafond, avec des images écartées', async () => {
  const pngs = [noisyPng(600, 500), noisyPng(600, 500), noisyPng(520, 500), noisyPng(600, 500)];
  const sizes = pngs.map(embeddedPngBytes);
  pngs.forEach((png) => assert.ok(png.length <= 1_200_000, String(png.length)));
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) > pdf.PDF_BYTE_LIMIT);
  const withinEmbedded = keptWithin(sizes, pdf.MAX_EMBEDDED_BUDGET);
  const withinJpegFigure = keptWithin(sizes, pdf.MAX_JPEG_BUDGET);
  assert.ok(withinEmbedded.kept > withinJpegFigure.kept);
  assert.ok(withinEmbedded.kept < pngs.length);
  assert.ok(withinEmbedded.sum <= pdf.MAX_EMBEDDED_BUDGET);
  const values = {};
  pngs.forEach((png, index) => {
    values[`p${index}`] = `data:image/png;base64,${png.toString('base64')}`;
  });
  const out = await exportPhotoValues('sub-noisy', values);
  assert.equal(out.status, 200, out.payload.error || '');
  const binary = Buffer.from(out.payload.content, 'base64');
  const text = pdf.extractPdfText(binary);
  const mentions = text.split('image non incluse').length - 1;
  const images = (binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length;
  assert.equal(images, withinEmbedded.kept);
  assert.equal(mentions, pngs.length - withinEmbedded.kept);
  assert.ok(binary.length <= pdf.PDF_BYTE_LIMIT);
  assert.ok(binary.length > withinEmbedded.sum);
  assert.equal(out.payload.error, undefined);
});

test('un mélange JPEG et PNG bruités reste sous le plafond', async () => {
  const jpeg = jpegOfSize(1_150_000);
  const pngs = [noisyPng(600, 500), noisyPng(600, 500)];
  const pngSizes = pngs.map(embeddedPngBytes);
  let embedded = 0;
  let jpegBytes = 0;
  let kept = 0;
  const items = [{ embedded: jpeg.length, jpeg: jpeg.length }, ...pngSizes.map((size) => ({ embedded: size, jpeg: 0 }))];
  items.forEach((item) => {
    if (item.jpeg && jpegBytes + item.jpeg > pdf.MAX_JPEG_BUDGET) return;
    if (embedded + item.embedded > pdf.MAX_EMBEDDED_BUDGET) return;
    jpegBytes += item.jpeg;
    embedded += item.embedded;
    kept += 1;
  });
  assert.ok(kept >= 2);
  assert.ok(kept < items.length);
  const values = {
    p0: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    p1: `data:image/png;base64,${pngs[0].toString('base64')}`,
    p2: `data:image/png;base64,${pngs[1].toString('base64')}`
  };
  const out = await exportPhotoValues('sub-mix', values);
  assert.equal(out.status, 200, out.payload.error || '');
  const binary = Buffer.from(out.payload.content, 'base64');
  const latin = binary.toString('latin1');
  const images = (latin.match(/\/Subtype \/Image/g) || []).length;
  const mentions = pdf.extractPdfText(binary).split('image non incluse').length - 1;
  assert.equal(images, kept);
  assert.equal(mentions, items.length - kept);
  assert.match(latin, /\/DCTDecode/);
  assert.match(latin, /\/FlateDecode/);
  assert.ok(binary.length <= pdf.PDF_BYTE_LIMIT);
});

test('un PNG petit à l’écran mais lourd une fois recompressé est écarté sur sa taille intégrée', () => {
  const pngs = [expandingPng(1500, 1100), expandingPng(1500, 1100)];
  pngs.forEach((png) => assert.ok(png.length < 100_000, String(png.length)));
  const sizes = pngs.map(embeddedPngBytes);
  assert.ok(sizes[0] > 1_000_000);
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) > pdf.PDF_BYTE_LIMIT);
  const fields = pngs.map((png, index) => ({ id: `p${index}`, nom: `Photo ${index}`, type: 'photo' }));
  const values = {};
  pngs.forEach((png, index) => {
    values[`p${index}`] = `data:image/png;base64,${png.toString('base64')}`;
  });
  const doc = pdf.formatSubmissionDocument({ fields, values, environmentName: 'EFC' });
  assert.equal(doc.imageStats.kept, 1);
  assert.equal(doc.imageStats.embeddedBytes, sizes[0]);
  assert.ok(sizes[0] + sizes[1] > pdf.MAX_EMBEDDED_BUDGET);
  assert.ok(doc.imageStats.embeddedBytes <= pdf.MAX_EMBEDDED_BUDGET);
  const binary = pdf.buildSubmissionPdf(doc);
  assert.equal((binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 1);
  assert.equal(pdf.extractPdfText(binary).includes('image non incluse'), true);
  assert.ok(binary.length <= pdf.PDF_BYTE_LIMIT);
});

test('un PDF au-dessus du plafond est régénéré sans images', () => {
  const fields = [];
  for (let i = 0; i < 12; i++) {
    fields.push({
      label: `Note ${i}`,
      value: 'Texte de la saisie. '.repeat(12),
      images: []
    });
  }
  fields.push({
    label: 'Photo',
    value: 'Image',
    images: [{ kind: 'jpeg', width: 2, height: 2, colorSpace: '/DeviceRGB', buf: jpegOfSize(3_200_000) }]
  });
  const model = {
    environmentName: 'EFC',
    formName: 'Contrôle',
    dateLabel: '08/10/2026 09:15 UTC',
    author: 'Marie',
    status: 'Validée',
    reference: 'sub-gros',
    fields
  };
  const open = pdf.buildSubmissionPdf(model, { enforceLimit: false });
  assert.ok(open.length > pdf.PDF_BYTE_LIMIT);
  assert.equal((open.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 1);
  const binary = pdf.buildSubmissionPdf(model);
  assert.ok(binary.length <= pdf.PDF_BYTE_LIMIT);
  const text = pdf.extractPdfText(binary);
  assert.equal(text.includes('image non incluse'), true);
  assert.equal(text.includes('Texte de la saisie'), true);
  assert.equal((binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 0);
  const forced = pdf.renderSubmissionPdf(model);
  assert.ok(forced.length > pdf.PDF_BYTE_LIMIT);
});

test('le repli retire d’abord la dernière image', () => {
  const model = {
    environmentName: 'EFC',
    formName: 'Contrôle',
    dateLabel: '08/10/2026 09:15 UTC',
    author: 'Marie',
    status: 'Validée',
    reference: 'sub-repli',
    fields: [
      {
        label: 'Petite',
        value: 'Image',
        images: [{ kind: 'jpeg', width: 2, height: 2, colorSpace: '/DeviceRGB', buf: jpegOfSize(400_000) }]
      },
      {
        label: 'Grosse',
        value: 'Image',
        images: [{ kind: 'jpeg', width: 2, height: 2, colorSpace: '/DeviceRGB', buf: jpegOfSize(2_800_000) }]
      }
    ]
  };
  const binary = pdf.buildSubmissionPdf(model);
  assert.ok(binary.length <= pdf.PDF_BYTE_LIMIT);
  assert.equal((binary.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 1);
  const text = pdf.extractPdfText(binary);
  assert.equal(text.includes('image non incluse'), true);
  assert.equal(text.includes('Petite'), true);
  assert.equal(text.includes('Grosse'), true);
});

test('les alias PAD sont écrits et lus comme pad, pas le vide ni supervision', () => {
  const { normalizeLicenseType, interpretedLicenseType } = require('./_license-type');
  for (const alias of ['pad', 'pad_terrain', 'terrain', 'mobile']) {
    assert.equal(normalizeLicenseType(alias), 'pad', alias);
    assert.equal(interpretedLicenseType(alias), 'pad', alias);
    const record = { role: 'supervision_user', license_type: alias };
    records.demotePrivilegedFields(record);
    assert.equal(record.license_type, 'pad', alias);
  }
  assert.equal(normalizeLicenseType(null), 'supervision');
  assert.equal(normalizeLicenseType(''), 'supervision');
  assert.equal(normalizeLicenseType('supervision'), 'supervision');
  assert.equal(interpretedLicenseType(null), '');
  assert.equal(interpretedLicenseType(''), '');
  assert.equal(interpretedLicenseType('supervision'), 'supervision');
  const kept = { role: 'manager', license_type: 'supervision' };
  records.demotePrivilegedFields(kept);
  assert.equal(kept.license_type, 'supervision');
  const empty = { role: 'supervision_user', license_type: null };
  records.demotePrivilegedFields(empty);
  assert.equal(empty.license_type, 'supervision');
});

function targetedForm(id, roleName) {
  return {
    id,
    nom: id,
    environment_code: 'EFC',
    visible_roles: [roleName],
    permissions: { view: [roleName], submit: [roleName] }
  };
}

async function callAppointments(body) {
  const res = mockRes();
  await appointments({ method: 'POST', headers: authHeaders(), body }, res);
  let payload = {};
  try { payload = JSON.parse(res.body || '{}'); } catch (_) { payload = { raw: res.body }; }
  return { status: res.statusCode, payload };
}

for (const alias of ['pad_terrain', 'terrain', 'mobile', 'operator', 'operateur']) {
  test(`licence ${alias} : alias et pad autorisés, supervision refusé, export PDF 403`, async () => {
    const actor = {
      id: 'pad-1',
      email: 'pad@efc.picotrack.fr',
      role: 'pad_user',
      license_type: alias,
      environment_code: 'EFC',
      active: true
    };
    const forms = [
      targetedForm('form-alias', alias),
      targetedForm('form-pad', 'pad'),
      targetedForm('form-sup', 'supervision')
    ];
    const expectStatus = { 'form-alias': 200, 'form-pad': 200, 'form-sup': 403 };

    await withSupabase(async () => {
      global.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
        if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
        if (u.includes('user_profiles?id=eq.pad-1')) return jsonResponse(200, [actor]);
        if (u.includes('/rest/v1/forms')) {
          const match = u.match(/id=eq\.([^&]+)/);
          if (!match) return jsonResponse(200, forms);
          const id = decodeURIComponent(match[1]);
          return jsonResponse(200, forms.filter((form) => form.id === id));
        }
        if (u.includes('/rest/v1/submissions') && !u.includes('?')) return jsonResponse(200, [{ id: 'sub-new' }]);
        return jsonResponse(200, []);
      };

      const listed = await callJson({
        action: 'list',
        entity: 'forms',
        select: 'id,nom,visible_roles,permissions,environment_code'
      }, authHeaders());
      assert.equal(listed.status, 200, listed.payload.error || alias);
      const ids = (Array.isArray(listed.payload) ? listed.payload : []).map((row) => row.id).sort();
      assert.deepEqual(ids, ['form-alias', 'form-pad'], alias);

      for (const formId of Object.keys(expectStatus)) {
        const saved = await callJson({
          action: 'save',
          entity: 'submissions',
          record: { form_id: formId, values: { note: 'saisie' }, device: 'pad' }
        }, authHeaders());
        assert.equal(saved.status, expectStatus[formId], `${alias} saisie ${formId}: ${saved.payload.error || ''}`);
      }
    });

    await withSupabase(async () => {
      global.fetch = async (url, options = {}) => {
        const u = String(url);
        const method = String(options.method || 'GET').toUpperCase();
        if (u.includes('/auth/v1/user')) return jsonResponse(200, { id: actor.id, email: actor.email });
        if (u.includes('active_device_sessions')) return jsonResponse(200, [{ id: 'sess' }]);
        if (u.includes('user_profiles?id=eq.pad-1')) return jsonResponse(200, [actor]);
        if (u.includes('/rest/v1/forms')) {
          const match = u.match(/id=eq\.([^&]+)/);
          const id = match ? decodeURIComponent(match[1]) : '';
          return jsonResponse(200, forms.filter((form) => form.id === id));
        }
        if (u.includes('/rest/v1/appointments') && method === 'POST') return jsonResponse(200, [{ id: 'rdv-1' }]);
        if (u.includes('/rest/v1/appointments')) return jsonResponse(200, [{ id: 'rdv-1' }]);
        return jsonResponse(200, []);
      };

      for (const formId of Object.keys(expectStatus)) {
        const viewed = await callAppointments({ action: 'list', environment_code: 'EFC', form_id: formId });
        assert.equal(viewed.status, expectStatus[formId], `${alias} rdv ${formId}: ${viewed.payload.error || ''}`);
        const reserved = await callAppointments({
          action: 'create',
          environment_code: 'EFC',
          record: { form_id: formId, field_id: 'slot', date: '2026-10-08', start_time: '09:00' }
        });
        assert.equal(reserved.status, expectStatus[formId], `${alias} réservation ${formId}: ${reserved.payload.error || ''}`);
      }
    });

    const denied = await exportAs(actor, { id: 'sub-1', environment_code: 'EFC', values: { note: 'SECRET-PAD' } });
    assert.equal(denied.out.status, 403, alias);
    assert.equal(denied.out.payload.error, 'Export PDF réservé à la supervision.');
    assert.equal(denied.calls.some((u) => u.includes('/rest/v1/submissions')), false, alias);

    const supervisor = { ...actor, id: 'sup-pad', email: 'sup@efc.picotrack.fr', role: 'supervision_user' };
    const stillDenied = await exportAs(supervisor, { id: 'sub-1', environment_code: 'EFC', values: { note: 'SECRET-PAD' } });
    assert.equal(stillDenied.out.status, 403, `${alias} supervision_user`);
    assert.equal(stillDenied.calls.some((u) => u.includes('/rest/v1/submissions')), false, alias);
  });
}

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
