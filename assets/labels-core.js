/* PicoTrack — Étiquettes : rendu partagé (aperçu, impression navigateur, ZPL).
   Fonctions pures, testées par api/_labels.test.js. Aucune donnée fictive. */
(function (root) {
  'use strict';

  var CODE128 = ('212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,' +
    '221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,' +
    '221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,' +
    '212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,' +
    '231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,' +
    '231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,' +
    '314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,' +
    '112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,' +
    '111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,' +
    '214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,' +
    '114131,311141,411131,211412,211214,211232,2331112').split(',');

  var PRESETS = [
    { id: '100x50', label: '100 × 50 mm (logistique)', w: 100, h: 50 },
    { id: '100x150', label: '100 × 150 mm (colis)', w: 100, h: 150 },
    { id: '62x29', label: '62 × 29 mm (Brother DK-11209)', w: 62, h: 29 },
    { id: '62x100', label: '62 × 100 mm (Brother DK-11202)', w: 62, h: 100 },
    { id: '57x32', label: '57 × 32 mm', w: 57, h: 32 },
    { id: '50x25', label: '50 × 25 mm', w: 50, h: 25 },
    { id: '89x36', label: '89 × 36 mm (Dymo 99012)', w: 89, h: 36 },
    { id: '70x37', label: '70 × 37 mm (planche A4 24 étiquettes)', w: 70, h: 37 }
  ];

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Code 128 B (ASCII 32 à 126). Les autres caractères deviennent « ? ».
  function code128Modules(text) {
    var s = String(text == null ? '' : text);
    var codes = [104];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      codes.push(c >= 32 && c <= 126 ? c - 32 : 31);
    }
    var sum = 104;
    for (var j = 1; j < codes.length; j++) sum += codes[j] * j;
    codes.push(sum % 103);
    codes.push(106);
    var modules = [];
    codes.forEach(function (code) {
      var p = CODE128[code];
      for (var k = 0; k < p.length; k++) {
        var width = +p[k];
        for (var m = 0; m < width; m++) modules.push(k % 2 === 0 ? 1 : 0);
      }
    });
    return modules;
  }

  function barcodeSvg(text, wMm, hMm) {
    var mods = code128Modules(text);
    var total = mods.length + 20; // zone de silence de 10 modules de chaque côté
    var rects = '';
    var x = 10;
    for (var i = 0; i < mods.length;) {
      if (!mods[i]) { i++; x++; continue; }
      var start = x;
      while (i < mods.length && mods[i]) { i++; x++; }
      rects += '<rect x="' + start + '" y="0" width="' + (x - start) + '" height="1"/>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' 1" preserveAspectRatio="none" style="width:' + wMm + 'mm;height:' + hMm + 'mm;display:block" shape-rendering="crispEdges">' + rects + '</svg>';
  }

  function qrMatrix(text) {
    var lib = root.qrcode;
    if (typeof lib !== 'function') return null;
    if (lib.stringToBytesFuncs && lib.stringToBytesFuncs['UTF-8']) lib.stringToBytes = lib.stringToBytesFuncs['UTF-8'];
    var qr = lib(0, 'M');
    qr.addData(String(text || ''), 'Byte');
    qr.make();
    var n = qr.getModuleCount();
    var rows = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) row.push(qr.isDark(r, c) ? 1 : 0);
      rows.push(row);
    }
    return rows;
  }

  function qrSvg(text, sizeMm) {
    var m = qrMatrix(text);
    if (!m) return '<div style="font-size:2.5mm">QR indisponible</div>';
    var n = m.length, q = 2, rects = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (m[r][c]) rects += '<rect x="' + (c + q) + '" y="' + (r + q) + '" width="1" height="1"/>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q) + '" style="width:' + sizeMm + 'mm;height:' + sizeMm + 'mm;display:block" shape-rendering="crispEdges">' + rects + '</svg>';
  }

  function valueText(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(', ');
    if (typeof value === 'object') {
      if (value.label != null) return String(value.label);
      if (value.date) return [value.date, value.start_time].filter(Boolean).join(' ');
      if (value.name != null) return String(value.name);
      if (value.value != null) return valueText(value.value);
      return '';
    }
    if (value === true) return 'Oui';
    if (value === false) return 'Non';
    return String(value);
  }

  function frDate(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  // ctx : { submission: {id, values, created_at}, reference, origin, today }
  function resolveElement(el, ctx) {
    ctx = ctx || {};
    var sub = ctx.submission || {};
    var values = sub.values && typeof sub.values === 'object' ? sub.values : {};
    var ref = ctx.reference || (sub.id != null ? 'S-' + sub.id : '');
    function src() {
      if (el.source === 'field' || el.type === 'field') return valueText(values[el.field_id]);
      if (el.source === 'text') return el.text || '';
      if (el.source === 'link') return sub.id != null && ctx.origin ? ctx.origin.replace(/\/+$/, '') + '/?saisie=' + encodeURIComponent(sub.id) : '';
      return ref;
    }
    var out;
    switch (el.type) {
      case 'text': out = el.text || ''; break;
      case 'field': out = src(); break;
      case 'date': out = el.date_source === 'today' ? frDate(ctx.today || null) : frDate(sub.created_at); break;
      case 'reference': out = ref; break;
      default: out = src();
    }
    if ((el.type === 'field' || el.type === 'date' || el.type === 'reference') && el.prefix && out) out = el.prefix + out;
    return out;
  }

  function elementHtml(el, ctx) {
    var v = resolveElement(el, ctx);
    var box = 'position:absolute;left:' + el.x + 'mm;top:' + el.y + 'mm;width:' + el.w + 'mm;height:' + el.h + 'mm;overflow:hidden;';
    if (el.type === 'qr') {
      var size = Math.min(el.w, el.h);
      return '<div style="' + box + '">' + (v ? qrSvg(v, size) : '') + '</div>';
    }
    if (el.type === 'barcode') {
      var textH = el.h > 8 ? Math.min(3, el.h * 0.25) : 0;
      return '<div style="' + box + '">' + (v ? barcodeSvg(v, el.w, el.h - textH) +
        (textH ? '<div style="font:' + (textH * 0.85) + 'mm/1 monospace;text-align:center;white-space:nowrap">' + esc(v) + '</div>' : '') : '') + '</div>';
    }
    var font = 'font-family:Arial,Helvetica,sans-serif;font-size:' + el.size + 'pt;line-height:1.15;font-weight:' + (el.bold ? 700 : 400) + ';text-align:' + (el.align || 'left') + ';color:#000;word-break:break-word;';
    return '<div style="' + box + font + '">' + esc(v) + '</div>';
  }

  function labelHtml(template, ctx, opts) {
    opts = opts || {};
    var margin = Number(opts.margin_mm) || 0;
    var inner = (template.elements || []).map(function (el) { return elementHtml(el, ctx); }).join('');
    return '<div class="pt-label" style="position:relative;width:' + template.width_mm + 'mm;height:' + template.height_mm + 'mm;overflow:hidden;background:#fff;box-sizing:border-box">' +
      '<div style="position:absolute;left:' + margin + 'mm;top:' + margin + 'mm;right:0;bottom:0">' + inner + '</div>' +
      (opts.frame ? testFrameHtml(template.width_mm, template.height_mm) : '') + '</div>';
  }

  // Document complet : une étiquette par page, au format exact.
  function printDocument(template, contexts, opts) {
    var pages = contexts.map(function (ctx) { return '<div class="pt-page">' + labelHtml(template, ctx, opts) + '</div>'; }).join('');
    return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>' + esc(template.name || 'Étiquettes') + '</title><style>' +
      '@page{size:' + template.width_mm + 'mm ' + template.height_mm + 'mm;margin:0}' +
      'html,body{margin:0;padding:0;background:#fff}' +
      '.pt-page{width:' + template.width_mm + 'mm;height:' + template.height_mm + 'mm;overflow:hidden;page-break-after:always;break-after:page}' +
      '.pt-page:last-child{page-break-after:auto;break-after:auto}' +
      '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '</style></head><body>' + pages + '</body></html>';
  }

  // ZPL II (imprimantes Zebra et compatibles). ^CI28 = UTF-8.
  function zplEscape(s) { return String(s == null ? '' : s).replace(/[\^~\\]/g, ' '); }
  function zplLabel(template, ctx, opts) {
    opts = opts || {};
    var dpi = Number(opts.dpi) || 203;
    var margin = Number(opts.margin_mm) || 0;
    var d = function (mm) { return Math.max(0, Math.round((Number(mm) + 0) * dpi / 25.4)); };
    var out = ['^XA', '^CI28', '^PW' + d(template.width_mm), '^LL' + d(template.height_mm), '^LH' + d(margin) + ',' + d(margin)];
    (template.elements || []).forEach(function (el) {
      var v = resolveElement(el, ctx);
      if (!v) return;
      var fo = '^FO' + d(el.x) + ',' + d(el.y);
      if (el.type === 'qr') {
        var n = (qrMatrix(v) || [[]]).length + 4;
        var mag = Math.max(1, Math.min(10, Math.floor(d(Math.min(el.w, el.h)) / n)));
        out.push(fo + '^BQN,2,' + mag + '^FDMA,' + zplEscape(v) + '^FS');
      } else if (el.type === 'barcode') {
        out.push(fo + '^BY2^BCN,' + Math.max(10, d(el.h) - (el.h > 8 ? d(3) : 0)) + ',' + (el.h > 8 ? 'Y' : 'N') + ',N,N^FD' + zplEscape(v) + '^FS');
      } else {
        var dots = Math.max(10, Math.round(el.size * dpi / 72));
        var just = el.align === 'center' ? 'C' : el.align === 'right' ? 'R' : 'L';
        var lines = Math.max(1, Math.floor(d(el.h) / dots));
        out.push(fo + '^A0N,' + dots + ',' + dots + '^FB' + d(el.w) + ',' + lines + ',0,' + just + '^FD' + zplEscape(v) + '^FS');
      }
    });
    out.push('^XZ');
    return out.join('\n');
  }

  function zplDocument(template, contexts, opts) {
    return contexts.map(function (ctx) { return zplLabel(template, ctx, opts); }).join('\n') + '\n';
  }

  // Page de test : cadre au bord, repères tous les 10 mm, nom et format.
  function testTemplate(printer) {
    var w = Number(printer.width_mm) || 100, h = Number(printer.height_mm) || 50;
    var s = Math.max(6, Math.min(14, h / 5));
    return {
      name: 'Page de test ' + (printer.name || ''),
      width_mm: w, height_mm: h,
      elements: [
        { type: 'text', x: 2, y: 2, w: w - 4, h: s * 0.5, size: s, bold: true, align: 'center', text: 'PicoTrack : test d’impression' },
        { type: 'text', x: 2, y: 2 + s * 0.55, w: w - 4, h: s * 0.4, size: s * 0.6, align: 'center', text: (printer.name || '') + ' : ' + w + ' × ' + h + ' mm, ' + (printer.dpi || 203) + ' dpi' },
        { type: 'barcode', x: 4, y: h * 0.55, w: Math.max(10, w * 0.55), h: Math.max(6, h * 0.35), source: 'text', text: 'PICOTRACK-TEST' },
        { type: 'qr', x: w - Math.min(w, h) * 0.4 - 3, y: h - Math.min(w, h) * 0.4 - 3, w: Math.min(w, h) * 0.4, h: Math.min(w, h) * 0.4, source: 'text', text: 'PicoTrack test ' + w + 'x' + h }
      ]
    };
  }

  function testFrameHtml(w, h) {
    // Cadre à 1 mm du bord pour vérifier le cadrage réel.
    return '<div style="position:absolute;left:1mm;top:1mm;width:' + (w - 2) + 'mm;height:' + (h - 2) + 'mm;border:0.3mm solid #000;box-sizing:border-box"></div>';
  }

  root.PTLabels = {
    PRESETS: PRESETS, code128Modules: code128Modules, barcodeSvg: barcodeSvg, qrMatrix: qrMatrix, qrSvg: qrSvg,
    valueText: valueText, resolveElement: resolveElement, labelHtml: labelHtml, printDocument: printDocument,
    zplLabel: zplLabel, zplDocument: zplDocument, testTemplate: testTemplate, testFrameHtml: testFrameHtml, esc: esc, frDate: frDate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PTLabels;
})(typeof window !== 'undefined' ? window : globalThis);
