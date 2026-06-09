// PicoTrack — Génération PDF professionnelle côté navigateur
// Sans dépendance externe : génération PDF native, compatible Vercel/Resend attachments.
// Objectif : produire un document client propre, lisible, brandé et exploitable.
(function(){
  const BRAND = {
    navy: [6, 35, 54],
    cyan: [0, 179, 216],
    teal: [18, 184, 134],
    slate: [71, 85, 105],
    light: [248, 250, 252],
    border: [226, 232, 240],
    text: [15, 23, 42],
    muted: [100, 116, 139]
  };

  function stripAccents(s){
    try { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
    catch(e){ return String(s || ''); }
  }

  function safePdfText(s){
    return stripAccents(String(s ?? ''))
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/€/g, 'EUR')
      .replace(/[–—]/g, '-')
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escPdf(str){
    return safePdfText(str)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function rgb(c){ return (c[0]/255).toFixed(3)+' '+(c[1]/255).toFixed(3)+' '+(c[2]/255).toFixed(3); }
  function fill(c){ return rgb(c)+' rg\n'; }
  function stroke(c){ return rgb(c)+' RG\n'; }

  function slugName(s){
    return stripAccents(String(s || 'document'))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document';
  }

  function humanLabel(label){
    return safePdfText(label || 'Champ')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, function(m){ return m.toUpperCase(); });
  }

  function humanValue(value){
    if(value === null || value === undefined || value === '') return '';
    if(Array.isArray(value)) return value.map(humanValue).filter(Boolean).join(', ');
    if(typeof value === 'boolean') return value ? 'Oui' : 'Non';
    if(typeof value === 'number') return String(value);
    if(typeof value === 'object'){
      const parts = [];
      const date = value.date || value.appointment_date || value.day || value.selectedDate;
      const start = value.start_time || value.startTime || value.time || value.appointment_time || value.slot || value.creneau;
      const end = value.end_time || value.endTime || value.fin;
      const fileName = value.name || value.filename || value.fileName;
      const url = value.url || value.href;
      if(date) parts.push('Date : ' + humanValue(date));
      if(start) parts.push('Heure : ' + humanValue(start));
      if(end) parts.push('Fin : ' + humanValue(end));
      if(value.status) parts.push('Statut : ' + humanValue(value.status));
      if(fileName) parts.push('Fichier : ' + humanValue(fileName));
      if(url && !fileName) parts.push('Lien : ' + humanValue(url));
      if(parts.length) return parts.join(' | ');
      return Object.entries(value)
        .filter(function(entry){
          const k = entry[0], v = entry[1];
          return v !== undefined && v !== null && v !== '' && !['id','_id','fieldId','field_id','raw','blob','base64'].includes(k);
        })
        .map(function(entry){ return humanLabel(entry[0]) + ' : ' + humanValue(entry[1]); })
        .filter(Boolean)
        .join(' | ');
    }
    return String(value);
  }

  function getFieldValue(form, values, fld){
    const keys = [fld && fld.id, fld && fld.field_key, fld && fld.key, fld && fld.nom, fld && fld.label]
      .filter(Boolean)
      .map(String);
    for(const k of keys){
      if(values && Object.prototype.hasOwnProperty.call(values, k)) return values[k];
    }
    return '';
  }

  function rowsFromSubmission(form, submission){
    const values = (submission && submission.values) || {};
    const rows = [];
    const usedKeys = new Set();
    function markKeys(fld){
      [fld && fld.id, fld && fld.field_key, fld && fld.key, fld && fld.nom, fld && fld.label]
        .filter(Boolean)
        .map(String)
        .forEach(function(k){ usedKeys.add(k); });
    }
    (form.fields || []).forEach(function(fld){
      if(!fld || ['separator','separateur','titre','title','image','groupe','group','son','video'].includes(fld.type)) return;
      const label = fld.nom || fld.label || fld.field_key || fld.key || fld.id || 'Champ';
      const value = humanValue(getFieldValue(form, values, fld));
      markKeys(fld);
      if(String(value || '').trim()) rows.push({ label: humanLabel(label), value: safePdfText(value) });
    });
    Object.entries(values || {}).forEach(function(entry){
      const key = String(entry[0]);
      if(usedKeys.has(key)) return;
      const cleanLabel = humanLabel(key);
      if(rows.some(r => r.label.toLowerCase() === cleanLabel.toLowerCase())) return;
      const value = humanValue(entry[1]);
      if(String(value || '').trim()) rows.push({ label: cleanLabel, value: safePdfText(value) });
    });
    return rows.length ? rows : [{ label: 'Information', value: 'Aucune donnée exploitable dans cette saisie.' }];
  }

  function wrapText(text, maxChars){
    text = safePdfText(text);
    if(!text) return [''];
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    words.forEach(function(w){
      if(w.length > maxChars){
        if(cur){ lines.push(cur); cur = ''; }
        for(let i=0;i<w.length;i+=maxChars) lines.push(w.slice(i, i+maxChars));
        return;
      }
      if(!cur){ cur = w; return; }
      if((cur + ' ' + w).length > maxChars){ lines.push(cur); cur = w; }
      else cur += ' ' + w;
    });
    if(cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function buildPdfDocument(model){
    const pageW = 595, pageH = 842;
    const objects = [];
    function addObj(s){ objects.push(s); return objects.length; }

    const fontRegular = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBold = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const pages = [];
    let ops = [];
    let y = 0;
    let pageNumber = 0;

    function text(x, yPos, value, size, bold, color){
      ops.push('BT\n' + fill(color || BRAND.text) + '/' + (bold ? 'F2' : 'F1') + ' ' + (size || 10) + ' Tf\n1 0 0 1 ' + x + ' ' + yPos + ' Tm (' + escPdf(value) + ') Tj\nET\n');
    }
    function rect(x, yPos, w, h, color, borderColor){
      ops.push(fill(color || [255,255,255]) + (borderColor ? stroke(borderColor) : '') + x+' '+yPos+' '+w+' '+h+' re '+(borderColor ? 'B' : 'f')+'\n');
    }
    function line(x1, y1, x2, y2, color, width){
      ops.push(stroke(color || BRAND.border) + (width || 1) + ' w\n' + x1+' '+y1+' m '+x2+' '+y2+' l S\n');
    }
    function circle(x, yPos, r, color){
      // Approximation simple avec rectangle arrondi non nécessaire : badge carré coloré.
      rect(x-r, yPos-r, r*2, r*2, color || BRAND.cyan, null);
    }

    function flushPage(){
      const stream = ops.join('');
      const content = addObj('<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
      const page = addObj('<< /Type /Page /Parent 0 0 R /MediaBox [0 0 '+pageW+' '+pageH+'] /Resources << /Font << /F1 '+fontRegular+' 0 R /F2 '+fontBold+' 0 R >> >> /Contents '+content+' 0 R >>');
      pages.push(page);
      ops = [];
    }

    function newPage(){
      if(pageNumber > 0) flushPage();
      pageNumber += 1;
      y = 792;
      // Header
      rect(36, 760, 523, 54, BRAND.navy, null);
      rect(52, 774, 26, 26, BRAND.cyan, null);
      rect(59, 781, 12, 12, [255,255,255], null);
      text(90, 789, model.brandName || 'PicoTrack Nexus', 17, true, [255,255,255]);
      text(90, 773, 'Operational Intelligence', 8, false, [203, 213, 225]);
      text(438, 789, 'Document operationnel', 9, true, [226,232,240]);
      text(438, 774, 'Page ' + pageNumber, 8, false, [203,213,225]);
      y = 724;
    }

    function ensure(space){
      if(y - space < 74){
        newPage();
      }
    }

    function sectionTitle(label){
      ensure(34);
      text(48, y, label, 13, true, BRAND.navy);
      line(48, y - 8, 547, y - 8, BRAND.border, 1);
      y -= 28;
    }

    function infoGrid(items){
      const boxH = 48;
      ensure(boxH + 18);
      const cols = 2;
      const gap = 10;
      const w = (499 - gap) / cols;
      items.forEach(function(item, idx){
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = 48 + col * (w + gap);
        const yy = y - row * (boxH + 8) - boxH;
        rect(x, yy, w, boxH, BRAND.light, BRAND.border);
        text(x + 12, yy + 29, item.label, 8, true, BRAND.muted);
        wrapText(item.value, col === 0 ? 38 : 40).slice(0,1).forEach(function(l){ text(x + 12, yy + 13, l, 10, true, BRAND.text); });
      });
      y -= Math.ceil(items.length / cols) * (boxH + 8) + 10;
    }

    function fieldTable(rows){
      ensure(70);
      const x = 48, w = 499, labelW = 155;
      rect(x, y - 26, w, 26, BRAND.navy, null);
      text(x + 12, y - 17, 'Champ', 9, true, [255,255,255]);
      text(x + labelW + 18, y - 17, 'Valeur saisie', 9, true, [255,255,255]);
      y -= 26;

      rows.forEach(function(row, idx){
        const valueLines = wrapText(row.value, 64);
        const labelLines = wrapText(row.label, 24);
        const lineCount = Math.max(valueLines.length, labelLines.length, 1);
        const h = Math.max(32, 14 * lineCount + 14);
        ensure(h + 4);
        const bg = idx % 2 === 0 ? [255,255,255] : BRAND.light;
        rect(x, y - h, w, h, bg, BRAND.border);
        line(x + labelW, y, x + labelW, y - h, BRAND.border, 1);
        labelLines.slice(0, Math.max(1, lineCount)).forEach(function(l, i){ text(x + 12, y - 18 - i*14, l, 9, true, BRAND.text); });
        valueLines.forEach(function(l, i){ text(x + labelW + 16, y - 18 - i*14, l, 9, false, BRAND.text); });
        y -= h;
      });
      y -= 12;
    }

    function footer(){
      line(48, 48, 547, 48, BRAND.border, 1);
      text(48, 30, 'Document genere automatiquement par PicoTrack - Ne pas modifier manuellement.', 8, false, BRAND.muted);
      text(482, 30, 'Ref. ' + (model.reference || '-'), 8, false, BRAND.muted);
    }

    newPage();
    text(48, y, model.title || 'Saisie formulaire', 20, true, BRAND.text);
    y -= 28;
    text(48, y, 'Rapport genere automatiquement apres validation du formulaire.', 10, false, BRAND.muted);
    y -= 28;

    sectionTitle('Informations generales');
    infoGrid([
      { label: 'FORMULAIRE', value: model.formName || '-' },
      { label: 'REFERENCE SAISIE', value: model.reference || '-' },
      { label: 'DATE', value: model.dateLabel || '-' },
      { label: 'UTILISATEUR', value: model.user || '-' }
    ]);

    sectionTitle('Details de la saisie');
    fieldTable(model.rows || []);
    footer();
    flushPage();

    const pagesObjIndex = objects.length + 1;
    for(let i=0;i<objects.length;i++) objects[i] = objects[i].replace(/\/Parent 0 0 R/g, '/Parent '+pagesObjIndex+' 0 R');
    addObj('<< /Type /Pages /Kids [' + pages.map(p => p + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>');
    const catalog = addObj('<< /Type /Catalog /Pages ' + pagesObjIndex + ' 0 R >>');

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach(function(obj, idx){ offsets.push(pdf.length); pdf += (idx+1) + ' 0 obj\n' + obj + '\nendobj\n'; });
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    for(let i=1;i<offsets.length;i++) pdf += String(offsets[i]).padStart(10,'0') + ' 00000 n \n';
    pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return pdf;
  }

  function toBase64Binary(str){
    let binary = '';
    for(let i=0;i<str.length;i++) binary += String.fromCharCode(str.charCodeAt(i) & 255);
    return btoa(binary);
  }

  function buildModel(form, submission, options){
    options = options || {};
    const now = new Date();
    return {
      brandName: options.brandName || 'PicoTrack Nexus',
      title: options.title || ('Saisie - ' + (form.nom || 'Formulaire')),
      formName: form.nom || 'Formulaire',
      reference: String(submission.id || '-'),
      dateLabel: submission.dateLabel || now.toLocaleString('fr-FR'),
      user: submission.utilisateur || submission.created_by || '-',
      rows: rowsFromSubmission(form, submission)
    };
  }

  window.ptBuildSubmissionPdfAttachment = function ptBuildSubmissionPdfAttachment(form, submission, options){
    options = options || {};
    const model = buildModel(form || {}, submission || {}, options);
    const filename = (options.filename || (slugName((form && form.nom) || 'formulaire') + '-' + (submission && submission.id || Date.now()) + '.pdf'))
      .replace(/[^a-zA-Z0-9_.-]/g,'-');
    const pdf = buildPdfDocument(model);
    return {
      filename: filename,
      content: toBase64Binary(pdf),
      contentType: 'application/pdf'
    };
  };

  window.ptDownloadSubmissionPdf = function ptDownloadSubmissionPdf(form, submission, options){
    const att = window.ptBuildSubmissionPdfAttachment(form, submission, options || {});
    const bytes = atob(att.content);
    const arr = new Uint8Array(bytes.length);
    for(let i=0;i<bytes.length;i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], {type:'application/pdf'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  };
})();
