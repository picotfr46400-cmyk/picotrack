'use strict';

const zlib = require('zlib');

const PAGE_W = 595;
const PAGE_H = 842;
const LEFT = 48;
const RIGHT = 547;
const TEXT_W = RIGHT - LEFT;
const MAX_PAGES = 30;
const MAX_IMAGES = 8;
const MAX_DECODE_ATTEMPTS = 16;
const MAX_IMAGE_SLOTS = 16;
const MAX_IMAGE_BYTES = 1_200_000;
const MAX_JPEG_BUDGET = 2_500_000;
// Même seuil que records.js : pdf.length > PDF_BYTE_LIMIT → 413.
const PDF_BYTE_LIMIT = 3_000_000;
const TEXT_BYTE_MARGIN = 300_000;
// Flux réellement écrits (JPEG copiés + PNG recompressés), sous le plafond moins le texte.
const MAX_EMBEDDED_BUDGET = PDF_BYTE_LIMIT - TEXT_BYTE_MARGIN;
const IMAGE_TIME_BUDGET_MS = 8_000;
// En dessous de ce ratio, un PNG recompressé ne peut pas tenir dans le budget intégré.
const EMBEDDED_LOWER_DIVISOR = 8;
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_000_000;
const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const OMITTED_IMAGE = 'image non incluse';
const SKIP_TYPES = new Set(['separator', 'sep', 'image', 'titre', 'title', 'groupe', 'group', 'son', 'sound', 'video']);

const WIN_EXTRA = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A],
  [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92],
  [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C],
  [0x017E, 0x9E], [0x0178, 0x9F]
]);

const WIN_DECODE = new Map([...WIN_EXTRA].map(([cp, byte]) => [byte, cp]));

function encodeWinAnsi(value) {
  const text = String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0x0A) bytes.push(0x0A);
    else if (cp >= 0x20 && cp <= 0x7E) bytes.push(cp);
    else if (cp >= 0xA0 && cp <= 0xFF) bytes.push(cp);
    else if (WIN_EXTRA.has(cp)) bytes.push(WIN_EXTRA.get(cp));
    else bytes.push(0x3F);
  }
  return Buffer.from(bytes);
}

function decodeWinAnsi(buf) {
  let out = '';
  for (const byte of buf) {
    if (WIN_DECODE.has(byte)) out += String.fromCodePoint(WIN_DECODE.get(byte));
    else out += String.fromCharCode(byte);
  }
  return out;
}

function pdfLiteral(value) {
  const raw = Buffer.isBuffer(value) ? value : encodeWinAnsi(value);
  const parts = [Buffer.from('(')];
  for (const byte of raw) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5C) {
      parts.push(Buffer.from([0x5C, byte]));
    } else if (byte === 0x0A) {
      parts.push(Buffer.from('\\n'));
    } else if (byte === 0x0D) {
      parts.push(Buffer.from('\\r'));
    } else {
      parts.push(Buffer.from([byte]));
    }
  }
  parts.push(Buffer.from(')'));
  return Buffer.concat(parts);
}

function extractPdfText(pdf) {
  const raw = Buffer.isBuffer(pdf) ? pdf : Buffer.from(String(pdf || ''), 'latin1');
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== 0x28) continue;
    const bytes = [];
    let j = i + 1;
    let closed = false;
    while (j < raw.length) {
      const byte = raw[j];
      if (byte === 0x5C) {
        const next = raw[j + 1];
        if (next >= 0x30 && next <= 0x37) {
          let oct = '';
          let k = 0;
          while (k < 3 && raw[j + 1 + k] >= 0x30 && raw[j + 1 + k] <= 0x37) {
            oct += String.fromCharCode(raw[j + 1 + k]);
            k += 1;
          }
          bytes.push(parseInt(oct, 8) & 255);
          j += 1 + k;
          continue;
        }
        if (next === 0x6E) bytes.push(0x0A);
        else if (next === 0x72) bytes.push(0x0D);
        else if (next === 0x74) bytes.push(0x09);
        else if (next !== undefined) bytes.push(next);
        j += 2;
        continue;
      }
      if (byte === 0x29) { closed = true; break; }
      bytes.push(byte);
      j += 1;
    }
    if (!closed) continue;
    const after = raw.subarray(j + 1, Math.min(raw.length, j + 12)).toString('latin1');
    if (/\sTj/.test(after)) lines.push(decodeWinAnsi(Buffer.from(bytes)).replace(/\n/g, ' '));
    i = j;
  }
  return lines.join('\n');
}

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 3)) + '...';
}

function num(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return (Math.round(n * 100) / 100).toString();
}

function fill(r, g, b) {
  return `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} rg\n`;
}

function stroke(r, g, b) {
  return `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} RG\n`;
}

function wrapLine(text, size) {
  const max = Math.max(8, Math.floor(TEXT_W / (size * 0.52)));
  const src = String(text ?? '');
  if (!src) return [''];
  const out = [];
  src.split('\n').forEach((paragraph) => {
    let rest = paragraph;
    if (!rest) { out.push(''); return; }
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max);
      if (cut < 8) cut = max;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
  });
  return out.slice(0, 40);
}

function formatSubmissionDate(value) {
  if (value == null || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clip(value, 80) || '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getUTCDate())}/${p(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())} UTC`;
}

function deviceAuthor(device) {
  const kind = String(device || '').trim().toLowerCase();
  if (kind === 'pad' || kind === 'mobile' || kind === 'terrain') return 'PAD Terrain';
  if (!kind || kind === 'desktop' || kind === 'bureau' || kind === 'web') return 'Bureau';
  return clip(device, 80) || '—';
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch (_) {}
    }
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return '';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'jpeg';
  return '';
}

function withinRasterLimits(width, height) {
  return width > 0 && height > 0
    && width <= MAX_DIMENSION
    && height <= MAX_DIMENSION
    && width * height <= MAX_PIXELS;
}

function decodeJpeg(buf, room) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
    if (buf.length > MAX_IMAGE_BYTES) return null;
    let i = 2;
    let width = 0;
    let height = 0;
    let components = 0;
    while (i + 1 < buf.length) {
      if (buf[i] !== 0xFF) { i += 1; continue; }
      while (i < buf.length && buf[i] === 0xFF) i += 1;
      if (i >= buf.length) return null;
      const marker = buf[i];
      i += 1;
      if (marker === 0xD9 || marker === 0xDA) break;
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
      if (i + 1 >= buf.length) return null;
      const len = buf.readUInt16BE(i);
      if (len < 2 || i + len > buf.length) return null;
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        if (len < 8 || i + 7 >= buf.length) return null;
        height = buf.readUInt16BE(i + 3);
        width = buf.readUInt16BE(i + 5);
        components = buf[i + 7];
        break;
      }
      i += len;
    }
    if (!withinRasterLimits(width, height) || ![1, 3, 4].includes(components)) return null;
    const limit = Math.min(MAX_DECODED_BYTES, room);
    if (buf.length > limit) return null;
    const colorSpace = components === 1 ? '/DeviceGray' : (components === 4 ? '/DeviceCMYK' : '/DeviceRGB');
    return { kind: 'jpeg', width, height, buf, colorSpace, decodedBytes: buf.length };
  } catch (_) {
    return null;
  }
}

function pngChannels(colorType) {
  return { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType] || 0;
}

function readPngParts(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || buf.length > MAX_IMAGE_BYTES) return null;
  if (buf.readUInt32BE(0) !== 0x89504E47) return null;
  let offset = 8;
  let info = null;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    if (!Number.isFinite(len) || len < 0 || len > buf.length || offset + 12 + len > buf.length) return null;
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      if (data.length < 13) return null;
      info = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12]
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    offset += 12 + len;
  }
  if (!info) return null;
  return { ...info, idat };
}

function decodePng(buf, room) {
  try {
    const info = readPngParts(buf);
    if (!info) return null;
    const { width, height, bitDepth, colorType, interlace, idat } = info;
    const channels = pngChannels(colorType);
    if (bitDepth !== 8 || interlace !== 0 || !channels) return null;
    if (!withinRasterLimits(width, height)) return null;
    const bytesPerPixel = channels;
    const maxOutputLength = height * (1 + width * bytesPerPixel);
    const rgbBytes = width * height * 3;
    const limit = Math.min(MAX_DECODED_BYTES, room);
    if (!idat.length || maxOutputLength <= 0 || rgbBytes <= 0) return null;
    if (maxOutputLength > limit || rgbBytes > limit) return null;
    let raw;
    try {
      raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength });
    } catch (_) {
      return null;
    }
    if (!raw || raw.length !== maxOutputLength) return null;
    const stride = width * channels;
    const rgb = Buffer.alloc(rgbBytes);
    let src = 0;
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
      const filter = raw[src];
      src += 1;
      if (filter > 4 || src + stride > raw.length) return null;
      const row = Buffer.alloc(stride);
      for (let i = 0; i < stride; i++) {
        const left = i >= channels ? row[i - channels] : 0;
        const up = prev[i];
        const ul = i >= channels ? prev[i - channels] : 0;
        const x = raw[src + i];
        let v = x;
        if (filter === 1) v = (x + left) & 255;
        else if (filter === 2) v = (x + up) & 255;
        else if (filter === 3) v = (x + Math.floor((left + up) / 2)) & 255;
        else if (filter === 4) v = (x + paeth(left, up, ul)) & 255;
        row[i] = v;
      }
      src += stride;
      for (let x = 0; x < width; x++) {
        const o = x * channels;
        let r;
        let g;
        let b;
        let a = 255;
        if (colorType === 2) { r = row[o]; g = row[o + 1]; b = row[o + 2]; }
        else if (colorType === 6) { r = row[o]; g = row[o + 1]; b = row[o + 2]; a = row[o + 3]; }
        else if (colorType === 0) { r = g = b = row[o]; }
        else { r = g = b = row[o]; a = row[o + 1]; }
        const alpha = a / 255;
        const dst = (y * width + x) * 3;
        rgb[dst] = Math.round(r * alpha + 255 * (1 - alpha));
        rgb[dst + 1] = Math.round(g * alpha + 255 * (1 - alpha));
        rgb[dst + 2] = Math.round(b * alpha + 255 * (1 - alpha));
      }
      prev = row;
    }
    return { kind: 'png', width, height, rgb, colorSpace: '/DeviceRGB', decodedBytes: rgbBytes };
  } catch (_) {
    return null;
  }
}

function decodeImageBuffer(buf, room = MAX_DECODED_BYTES) {
  try {
    if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    const kind = sniffImage(buf);
    if (kind === 'jpeg') return decodeJpeg(buf, room);
    if (kind === 'png') return decodePng(buf, room);
    return null;
  } catch (_) {
    return null;
  }
}

function createImageBudget() {
  return {
    kept: 0,
    attempts: 0,
    decodedBytes: 0,
    slots: 0,
    jpegBytes: 0,
    embeddedBytes: 0,
    startedAt: Date.now(),
    closed: false
  };
}

function imageBudgetExhausted(budget) {
  return budget.closed
    || budget.decodedBytes >= MAX_DECODED_BYTES
    || budget.embeddedBytes >= MAX_EMBEDDED_BUDGET
    || Date.now() - budget.startedAt >= IMAGE_TIME_BUDGET_MS;
}

function pngHeaderCost(buf) {
  const info = readPngParts(buf);
  if (!info) return null;
  const channels = pngChannels(info.colorType);
  if (info.bitDepth !== 8 || info.interlace !== 0 || !channels) return { undecodable: true };
  if (!withinRasterLimits(info.width, info.height)) return { undecodable: true };
  const rgbBytes = info.width * info.height * 3;
  const maxOutputLength = info.height * (1 + info.width * channels);
  if (rgbBytes <= 0 || maxOutputLength <= 0) return { undecodable: true };
  return {
    kind: 'png',
    rgbBytes,
    maxOutputLength,
    embeddedLowerBound: Math.ceil(rgbBytes / EMBEDDED_LOWER_DIVISOR)
  };
}

function headerCost(buf) {
  const kind = sniffImage(buf);
  if (kind === 'png') return pngHeaderCost(buf);
  if (kind === 'jpeg') {
    if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf.length > MAX_IMAGE_BYTES) return { undecodable: true };
    return { kind: 'jpeg', rgbBytes: buf.length, embeddedLowerBound: buf.length, jpegBytes: buf.length };
  }
  return { undecodable: true };
}

function headerExceedsBudget(cost, budget) {
  const decodeRoom = MAX_DECODED_BYTES - budget.decodedBytes;
  if (cost.maxOutputLength > decodeRoom || cost.rgbBytes > decodeRoom) return true;
  if (budget.embeddedBytes + cost.embeddedLowerBound > MAX_EMBEDDED_BUDGET) return true;
  if (cost.kind === 'jpeg' && budget.jpegBytes + cost.jpegBytes > MAX_JPEG_BUDGET) return true;
  return false;
}

function embeddedLowerBound(image) {
  if (!image) return MAX_EMBEDDED_BUDGET + 1;
  if (image.kind === 'jpeg') return image.buf.length;
  const raw = image.rgb ? image.rgb.length : image.decodedBytes;
  return Math.ceil(raw / EMBEDDED_LOWER_DIVISOR);
}

function imageStream(image) {
  if (!image || image.omitted) return null;
  if (Buffer.isBuffer(image.payload) && image.payload.length) return image.payload;
  try {
    if (image.kind === 'jpeg' && Buffer.isBuffer(image.buf) && image.buf.length) image.payload = image.buf;
    else if (Buffer.isBuffer(image.rgb) && image.rgb.length) image.payload = zlib.deflateSync(image.rgb);
    else return null;
  } catch (_) {
    return null;
  }
  return image.payload.length ? image.payload : null;
}

function omitImage(out, budget) {
  if (imageBudgetExhausted(budget)) budget.closed = true;
  out.push({ omitted: true });
  return true;
}

function acceptImageSource(value, out, budget) {
  const text = String(value || '').trim();
  if (!/^data:image\/(png|jpe?g);base64,/i.test(text)) return false;
  if (budget.slots >= MAX_IMAGE_SLOTS) return true;
  budget.slots += 1;
  if (budget.kept >= MAX_IMAGES || budget.attempts >= MAX_DECODE_ATTEMPTS || imageBudgetExhausted(budget)) {
    return omitImage(out, budget);
  }
  const match = text.match(/^data:image\/(png|jpe?g);base64,([a-z0-9+/=\s]+)$/i);
  let buf = null;
  if (match) {
    try { buf = Buffer.from(match[2].replace(/\s+/g, ''), 'base64'); }
    catch (_) { buf = null; }
  }
  if (!buf || !buf.length || buf.length > MAX_IMAGE_BYTES) {
    budget.attempts += 1;
    return omitImage(out, budget);
  }
  const cost = headerCost(buf);
  if (cost && cost.undecodable) {
    budget.attempts += 1;
    return omitImage(out, budget);
  }
  if (cost && headerExceedsBudget(cost, budget)) return omitImage(out, budget);
  if (imageBudgetExhausted(budget)) return omitImage(out, budget);
  budget.attempts += 1;
  const image = decodeImageBuffer(buf, MAX_DECODED_BYTES - budget.decodedBytes);
  if (!image) return omitImage(out, budget);
  budget.decodedBytes += image.decodedBytes;
  if (budget.decodedBytes >= MAX_DECODED_BYTES) budget.closed = true;
  if (image.kind === 'jpeg' && budget.jpegBytes + image.buf.length > MAX_JPEG_BUDGET) return omitImage(out, budget);
  if (budget.embeddedBytes + embeddedLowerBound(image) > MAX_EMBEDDED_BUDGET) return omitImage(out, budget);
  if (imageBudgetExhausted(budget)) return omitImage(out, budget);
  const payload = imageStream(image);
  if (!payload || budget.embeddedBytes + payload.length > MAX_EMBEDDED_BUDGET) return omitImage(out, budget);
  if (image.kind === 'jpeg') budget.jpegBytes += image.buf.length;
  budget.embeddedBytes += payload.length;
  if (budget.embeddedBytes >= MAX_EMBEDDED_BUDGET) budget.closed = true;
  budget.kept += 1;
  out.push(image);
  return true;
}

function collectImages(value, out, budget) {
  if (!value || budget.slots >= MAX_IMAGE_SLOTS) return;
  if (typeof value === 'string') {
    acceptImageSource(value, out, budget);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectImages(item, out, budget));
    return;
  }
  if (typeof value === 'object') {
    const direct = value.dataUrl || value.data_url || value.url || '';
    if (typeof direct === 'string') collectImages(direct, out, budget);
    if (Array.isArray(value.files)) value.files.forEach((item) => collectImages(item, out, budget));
  }
}

function fileName(value) {
  if (!value || typeof value !== 'object') return '';
  return clip(value.name || value.filename || '', 80);
}

function appointmentText(value) {
  let row = value;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try { row = JSON.parse(value); } catch (_) { return clip(value, 200); }
  }
  if (!row || typeof row !== 'object') return clip(value, 200) || '—';
  const day = row.date || row.appointment_date || row.day || '';
  const start = row.time || row.start || row.start_time || '';
  const end = row.end || row.end_time || '';
  const when = [day, start ? (end ? `${start} - ${end}` : start) : ''].filter(Boolean).join(' · ');
  return when || '—';
}

function plainText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value.trim())) return '';
    return clip(value, 1500);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => plainText(item)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    if (value.label) return clip(value.label, 300);
    const name = fileName(value);
    if (name) return name;
    if (value.lat != null && value.lng != null) return clip(`${value.lat}, ${value.lng}`, 80);
    if (value.latitude != null && value.longitude != null) return clip(`${value.latitude}, ${value.longitude}`, 80);
    return '';
  }
  return '';
}

function formatAnswer(type, value, images, budget) {
  const kind = String(type || '').toLowerCase();
  if (value == null || value === '') return '—';
  if (kind === 'checkbox' || kind === 'boolean') {
    const on = value === true || value === 1 || value === '1' || value === 'true';
    return on ? 'Coché' : 'Non coché';
  }
  if (kind === 'appointment') return appointmentText(value);
  if (kind === 'photo' || kind === 'sign' || kind === 'signature' || kind === 'file') {
    const before = images.length;
    collectImages(value, images, budget);
    const names = [];
    const pushName = (item) => {
      const name = fileName(item);
      if (name) names.push(name);
    };
    if (Array.isArray(value)) value.forEach(pushName);
    else pushName(value);
    if (images.length > before) return names.join(', ') || (kind === 'sign' || kind === 'signature' ? 'Signature' : 'Image');
    const text = plainText(value);
    return text || '—';
  }
  const before = images.length;
  collectImages(value, images, budget);
  const text = plainText(value);
  if (text) return text;
  if (images.length > before) return 'Image';
  return '—';
}

function formatSubmissionDocument(input) {
  const source = input || {};
  const values = asObject(source.values);
  const fields = Array.isArray(source.fields) ? source.fields : [];
  const used = new Set();
  const rows = [];
  const budget = createImageBudget();
  fields.forEach((field) => {
    if (!field || typeof field !== 'object') return;
    const type = String(field.type || '').toLowerCase();
    if (SKIP_TYPES.has(type)) return;
    const id = field.id != null ? String(field.id) : '';
    if (id) used.add(id);
    const raw = id ? values[id] : undefined;
    const images = [];
    rows.push({
      label: clip(field.nom || field.label || field.name || id || 'Champ', 160) || 'Champ',
      value: formatAnswer(type, raw, images, budget),
      images
    });
  });
  Object.keys(values).forEach((key) => {
    if (used.has(key) || key.startsWith('_')) return;
    const images = [];
    rows.push({
      label: clip(key, 160) || 'Champ',
      value: formatAnswer('', values[key], images, budget),
      images
    });
  });
  const environmentCode = clip(source.environmentCode, 80) || '—';
  return {
    environmentName: clip(source.environmentName || source.environmentCode, 80) || environmentCode,
    environmentCode,
    formName: clip(source.formName, 160) || 'Formulaire',
    dateLabel: formatSubmissionDate(source.createdAt),
    author: clip(source.author, 120) || deviceAuthor(source.device),
    status: clip(source.status, 80) || 'Enregistrée',
    reference: clip(source.reference, 80) || '—',
    fields: rows,
    imageStats: {
      kept: budget.kept,
      attempts: budget.attempts,
      decodedBytes: budget.decodedBytes,
      embeddedBytes: budget.embeddedBytes
    }
  };
}

function imageObject(image) {
  const data = imageStream(image);
  const filter = image.kind === 'jpeg' ? '/DCTDecode' : '/FlateDecode';
  const dict = Buffer.from(
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${image.colorSpace} /BitsPerComponent 8 /Filter ${filter} /Length ${data.length} >>\nstream\n`
  );
  return Buffer.concat([dict, data, Buffer.from('\nendstream')]);
}

function hasIncludedImages(model) {
  return (model.fields || []).some((field) =>
    Array.isArray(field && field.images) && field.images.some((image) => image && !image.omitted)
  );
}

function modelWithoutImages(model) {
  return {
    ...model,
    fields: (model.fields || []).map((field) => {
      if (!field || !Array.isArray(field.images) || !field.images.length) return field;
      return { ...field, images: field.images.map(() => ({ omitted: true })) };
    })
  };
}

function omitLastIncludedImage(model) {
  const fields = (model.fields || []).map((field) => (
    field && Array.isArray(field.images) ? { ...field, images: field.images.slice() } : field
  ));
  for (let f = fields.length - 1; f >= 0; f--) {
    const images = fields[f] && fields[f].images;
    if (!Array.isArray(images)) continue;
    for (let i = images.length - 1; i >= 0; i--) {
      if (images[i] && !images[i].omitted) {
        images[i] = { omitted: true };
        return { ...model, fields };
      }
    }
  }
  return null;
}

function renderSubmissionPdf(doc) {
  const model = doc && doc.fields ? doc : formatSubmissionDocument(doc);
  const pages = [];
  let page = null;
  let y = 0;
  let imageCount = 0;

  function op(chunk) {
    page.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  function textAt(x, baseline, value, size, bold, color) {
    op(Buffer.concat([
      Buffer.from(`${fill(color[0], color[1], color[2])}BT\n/${bold ? 'F2' : 'F1'} ${size} Tf\n1 0 0 1 ${num(x)} ${num(baseline)} Tm\n`),
      pdfLiteral(value),
      Buffer.from(' Tj\nET\n')
    ]));
  }

  function rule(at) {
    op(`${stroke(226, 232, 240)}0.6 w\n${num(LEFT)} ${num(at)} m ${num(RIGHT)} ${num(at)} l S\n`);
  }

  function openPage(first) {
    if (page) pages.push(page);
    page = { chunks: [], images: [] };
    const name = model.environmentName || model.environmentCode || 'PicoTrack';
    op(`${fill(5, 150, 105)}${num(0)} ${num(PAGE_H - 64)} ${num(PAGE_W)} 64 re f\n`);
    textAt(LEFT, PAGE_H - 30, clip(name, 42), 16, true, [255, 255, 255]);
    textAt(LEFT, PAGE_H - 48, first ? 'Saisie' : 'Saisie — suite', 9, false, [236, 253, 245]);
    y = PAGE_H - 88;
  }

  function need(height) {
    if (page && y - height >= 52) return true;
    if (pages.length + (page ? 1 : 0) >= MAX_PAGES) return false;
    openPage(!page && pages.length === 0);
    return true;
  }

  function writeLines(lines, size, bold, color, gap) {
    lines.forEach((line) => {
      if (!need(size + gap)) return;
      textAt(LEFT, y, line, size, bold, color);
      y -= size + gap;
    });
  }

  function meta(label, value) {
    writeLines([label], 8, true, [100, 116, 139], 3);
    writeLines(wrapLine(value || '—', 12), 12, true, [15, 23, 42], 4);
    y -= 6;
  }

  openPage(true);
  meta('Environnement', model.environmentName);
  meta('Formulaire', model.formName);
  meta('Date', model.dateLabel);
  meta('Auteur', model.author);
  meta('Statut', model.status);
  meta('Référence', model.reference);
  y -= 4;
  if (need(22)) {
    textAt(LEFT, y, 'Réponses', 13, true, [5, 150, 105]);
    y -= 8;
    rule(y);
    y -= 16;
  }

  (model.fields || []).forEach((field) => {
    if (!need(28)) return;
    writeLines(wrapLine(field.label || 'Champ', 9), 9, true, [100, 116, 139], 3);
    const images = Array.isArray(field.images) ? field.images : [];
    if (!images.length) {
      writeLines(wrapLine(field.value || '—', 11), 11, false, [15, 23, 42], 3);
    } else if (field.value && field.value !== 'Image' && field.value !== 'Signature') {
      writeLines(wrapLine(field.value, 10), 10, false, [71, 85, 105], 3);
    }
    images.forEach((image) => {
      if (!image || image.omitted || imageCount >= MAX_IMAGES) {
        writeLines([OMITTED_IMAGE], 9, false, [100, 116, 139], 3);
        return;
      }
      const scale = Math.min(260 / image.width, 160 / image.height, 1);
      const dw = Math.max(1, image.width * scale);
      const dh = Math.max(1, image.height * scale);
      if (!need(dh + 12)) return;
      const name = `Im${imageCount + 1}`;
      imageCount += 1;
      page.images.push({ name, image });
      const bottom = y - dh;
      op(`q\n${num(dw)} 0 0 ${num(dh)} ${num(LEFT)} ${num(bottom)} cm\n/${name} Do\nQ\n`);
      y = bottom - 12;
    });
    y -= 4;
    if (need(8)) {
      rule(y);
      y -= 14;
    }
  });

  // La frise de traçabilité s'insère ici, avant le pied de page.
  // Son repli (retirer la frise, puis rappeler renderSubmissionPdf) reste à l'appelant.

  if (page) {
    page.chunks.push(Buffer.from(
      `${fill(148, 163, 184)}BT\n/F1 8 Tf\n1 0 0 1 ${num(LEFT)} 28 Tm\n`
    ));
    page.chunks.push(pdfLiteral('PicoTrack'));
    page.chunks.push(Buffer.from(` Tj\n1 0 0 1 ${num(RIGHT - 120)} 28 Tm\n`));
    page.chunks.push(pdfLiteral(clip(model.reference, 24)));
    page.chunks.push(Buffer.from(' Tj\nET\n'));
    pages.push(page);
  }

  const objects = [];
  objects[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>');
  objects[3] = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects[4] = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  let next = 5;
  const pageIds = [];
  pages.forEach((item) => {
    item.contentId = next;
    next += 1;
    item.pageId = next;
    next += 1;
    pageIds.push(item.pageId);
    item.images.forEach((slot) => {
      slot.id = next;
      next += 1;
    });
  });
  objects[2] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  pages.forEach((item) => {
    const content = Buffer.concat(item.chunks);
    objects[item.contentId] = Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from('\nendstream')
    ]);
    const xobjects = item.images.map((slot) => `/${slot.name} ${slot.id} 0 R`).join(' ');
    const xobjDict = xobjects ? ` /XObject << ${xobjects} >>` : '';
    objects[item.pageId] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjDict} >> /Contents ${item.contentId} 0 R >>`
    );
    item.images.forEach((slot) => {
      objects[slot.id] = imageObject(slot.image);
    });
  });

  let out = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets.push(out.length);
    out = Buffer.concat([out, Buffer.from(`${i} 0 obj\n`), objects[i], Buffer.from('\nendobj\n')]);
  }
  const xrefAt = out.length;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.concat([out, Buffer.from(xref)]);
}

// Rend le PDF dans le plafond de records.js. Les images sont bornées à
// PDF_BYTE_LIMIT − TEXT_BYTE_MARGIN. Si le fichier dépasse quand même,
// les dernières images sont retirées une par une, puis toutes s'il le faut.
// options.omitImages force un rendu sans images.
// options.enforceLimit === false rend une seule fois, pour enchaîner un autre repli avant.
function buildSubmissionPdf(doc, options) {
  const omitImages = !!(options && options.omitImages);
  const enforceLimit = !(options && options.enforceLimit === false);
  const source = doc && doc.fields ? doc : formatSubmissionDocument(doc);
  const model = omitImages ? modelWithoutImages(source) : source;
  let binary = renderSubmissionPdf(model);
  if (!enforceLimit || omitImages || binary.length <= PDF_BYTE_LIMIT || !hasIncludedImages(model)) return binary;
  let current = model;
  const started = Date.now();
  for (let step = 0; step < MAX_IMAGES && Date.now() - started < 2_000; step++) {
    const next = omitLastIncludedImage(current);
    if (!next) break;
    current = next;
    binary = renderSubmissionPdf(current);
    if (binary.length <= PDF_BYTE_LIMIT || !hasIncludedImages(current)) return binary;
  }
  return renderSubmissionPdf(modelWithoutImages(model));
}

module.exports = {
  PDF_BYTE_LIMIT,
  TEXT_BYTE_MARGIN,
  MAX_EMBEDDED_BUDGET,
  MAX_JPEG_BUDGET,
  IMAGE_TIME_BUDGET_MS,
  formatSubmissionDate,
  deviceAuthor,
  formatSubmissionDocument,
  renderSubmissionPdf,
  buildSubmissionPdf,
  extractPdfText,
  decodeImageBuffer
};
