/* PicoTrack : ergonomie (2026-10-24)
 * - En-tête commun : un seul titre par page (le titre de la barre du haut), fil d'Ariane « ▶ Section / Page ».
 * - Composants génériques d'épuration : accordéon, résumé en une ligne, aide en info-bulle (window.ptUi).
 * - Épuration de l'éditeur de service : actions repliées en résumé, rôles sous « Options avancées ».
 * Aucune donnée n'est lue ni écrite ici : uniquement de la mise en forme du DOM déjà rendu.
 */
(function () {
  'use strict';
  if (window.ptUi && window.ptUi.__v) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[’'`]/g, "'").replace(/\s+/g, ' ').trim();
  }

  /* ---------- Composants génériques ---------- */
  var ptUi = {
    __v: 1,
    esc: esc,
    /** Aide en info-bulle : remplace un texte d'aide permanent. */
    tip: function (text) {
      var t = esc(text);
      return '<span class="pt-tip" tabindex="0" role="note" aria-label="' + t + '" data-tip="' + t + '">i</span>';
    },
    /** Résumé en une ligne : liste de morceaux (texte) séparés par « · ». */
    summary: function (parts) {
      return (parts || []).filter(function (p) { return p != null && String(p).trim() !== ''; }).map(esc).join(' · ');
    },
    /** Accordéon HTML. opts : { open, summary (texte), key (mémorise l'état ouvert) , cls } */
    accordion: function (title, bodyHtml, opts) {
      opts = opts || {};
      var open = opts.key && ptUi._open.hasOwnProperty(opts.key) ? ptUi._open[opts.key] : !!opts.open;
      return '<details class="pt-acc' + (opts.cls ? ' ' + esc(opts.cls) : '') + '"' + (open ? ' open' : '') +
        (opts.key ? ' data-acc-key="' + esc(opts.key) + '"' : '') + '>' +
        '<summary><span class="pt-acc-t">' + esc(title) + '</span>' +
        (opts.summary ? '<span class="pt-acc-s">' + esc(opts.summary) + '</span>' : '') +
        '<span class="pt-acc-chev" aria-hidden="true">▾</span></summary><div class="pt-acc-b">' + (bodyHtml || '') + '</div></details>';
    },
    /** « Options avancées » : accordéon fermé par défaut. */
    advanced: function (bodyHtml, summaryText, key) {
      return ptUi.accordion('Options avancées', bodyHtml, { summary: summaryText, key: key, cls: 'pt-acc-adv' });
    },
    /** Replie des éléments déjà rendus dans un accordéon (sans les recréer : les gestionnaires restent). */
    wrapNodes: function (nodes, title, summaryText, key, open) {
      nodes = (nodes || []).filter(Boolean);
      if (!nodes.length || nodes[0].closest('details.pt-acc')) return null;
      var tmp = document.createElement('div');
      tmp.innerHTML = ptUi.accordion(title, '', { summary: summaryText, key: key, open: open });
      var d = tmp.firstChild, body = d.querySelector('.pt-acc-b');
      nodes[0].parentNode.insertBefore(d, nodes[0]);
      nodes.forEach(function (n) { body.appendChild(n); });
      return d;
    },
    _open: {}
  };
  /* Mémorise l'état ouvert/fermé des accordéons entre deux rendus. */
  document.addEventListener('toggle', function (ev) {
    var d = ev.target;
    if (d && d.matches && d.matches('details.pt-acc[data-acc-key]')) ptUi._open[d.getAttribute('data-acc-key')] = d.open;
  }, true);

  /* Composant React équivalent (pour les éditeurs React : Form Builder, futurs éditeurs). */
  if (window.React) {
    ptUi.Accordion = function (props) {
      var R = window.React, st = R.useState(!!props.defaultOpen), open = st[0], setOpen = st[1];
      return R.createElement('div', { className: 'pt-acc' + (open ? ' is-open' : '') },
        R.createElement('button', { type: 'button', className: 'pt-acc-head', 'aria-expanded': open, onClick: function () { setOpen(!open); } },
          R.createElement('span', { className: 'pt-acc-t' }, props.title),
          props.summary ? R.createElement('span', { className: 'pt-acc-s' }, props.summary) : null,
          R.createElement('span', { className: 'pt-acc-chev', 'aria-hidden': true }, '▾')),
        open ? R.createElement('div', { className: 'pt-acc-b' }, props.children) : null);
    };
  }
  window.ptUi = ptUi;

  /* ---------- En-tête commun ---------- */
  function activeView() {
    var vs = document.querySelectorAll('#main .view');
    for (var i = 0; i < vs.length; i++) if (vs[i].offsetParent !== null) return vs[i];
    return document.querySelector('.view.on') || null;
  }
  function sectionOfActiveItem() {
    var it = document.querySelector('#sb .sb-i.on');
    for (var n = it && it.previousElementSibling; n; n = n.previousElementSibling) {
      if (n.classList && n.classList.contains('sb-s')) return n.textContent.trim();
    }
    return '';
  }
  function cap(s) { s = String(s || '').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }

  function fixBreadcrumb() {
    var bc = document.getElementById('breadcrumb');
    if (!bc) return;
    var txt = bc.textContent.replace(/\s+/g, ' ').trim();
    if (!txt || bc.getAttribute('data-pt-bc') === txt) return;
    var plain = txt.replace(/^▶\s*/, '');
    if (!/[\/›]/.test(plain)) {
      var sec = cap(sectionOfActiveItem());
      if (sec && norm(sec) !== norm(plain) && norm(sec) !== 'cockpit') {
        var s = document.createElement('span');
        s.className = 'pt-bc-sec';
        s.textContent = sec + ' / ';
        bc.insertBefore(s, bc.firstChild);
      }
    }
    if (!/^▶/.test(bc.textContent.trim())) {
      var a = document.createElement('span');
      a.className = 'pt-bc-arrow';
      a.textContent = '▶ ';
      bc.insertBefore(a, bc.firstChild);
    }
    bc.setAttribute('data-pt-bc', bc.textContent.replace(/\s+/g, ' ').trim());
  }

  function hideDuplicateTitle() {
    var tb = document.getElementById('tb-t'), v = activeView();
    if (!tb || !v) return;
    var title = norm(tb.textContent);
    if (!title) return;
    var cands = v.querySelectorAll('h1,h2,h3,div,span');
    var seen = 0;
    for (var i = 0; i < cands.length && seen < 80; i++) {
      var el = cands[i];
      if (el.children.length > 1 || el.offsetParent === null) continue;
      seen++;
      if (el.closest('.pt-dup-title,details,table,select,button,[contenteditable]')) continue;
      if (norm(el.textContent) !== title) continue;
      var fs = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (!/^H[123]$/.test(el.tagName) && fs < 17) continue;
      el.classList.add('pt-dup-title');
      break;
    }
  }

  var lastKey = '', timers = [];
  function run() {
    try { fixBreadcrumb(); } catch (e) {}
    try { hideDuplicateTitle(); } catch (e) {}
  }
  function schedule() {
    var tb = document.getElementById('tb-t');
    var key = (tb ? tb.textContent : '') + '|' + ((document.getElementById('breadcrumb') || {}).textContent || '');
    if (key === lastKey) return;
    lastKey = key;
    timers.forEach(clearTimeout);
    timers = [0, 350, 1200, 2500, 5000].map(function (ms) { return setTimeout(run, ms); });
  }

  /* ---------- Éditeur de service : épuration ---------- */
  function selText(sel) {
    var o = sel && sel.options && sel.options[sel.selectedIndex];
    return o && sel.value !== '' ? o.textContent.trim() : '';
  }
  function enhanceSvcActions(root) {
    if (!root) return;
    var cards = [].slice.call(root.querySelectorAll('.b-sec > div')).filter(function (d) {
      return d.querySelector('input.ci') && d.querySelector('select.ci, .ic-btn');
    });
    var prevCount = enhanceSvcActions._count || 0;
    cards.forEach(function (card, idx) {
      if (card.classList.contains('pt-svc-card')) return;
      card.classList.add('pt-svc-card');
      var input = card.querySelector('input.ci');
      var effects = [].slice.call(card.querySelectorAll('select.ci')).filter(function (s) {
        return s.getAttribute('onchange') && /'type'/.test(s.getAttribute('onchange'));
      });
      var parts = effects.map(function (s) {
        var next = s.nextElementSibling && s.nextElementSibling.tagName === 'SELECT' ? selText(s.nextElementSibling) : '';
        return selText(s) + (next ? ' → ' + next : '');
      });
      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'pt-svc-sum';
      head.setAttribute('aria-expanded', 'false');
      var color = (card.querySelector('[style*="box-shadow:0 0 0 2px"]') || {}).style;
      head.innerHTML = '<span class="pt-svc-dot" style="background:' + esc(color ? color.backgroundColor : '#94a3b8') + '"></span>' +
        '<b>' + esc(input.value || 'Action sans nom') + '</b><span class="pt-acc-s">' +
        esc(parts.length ? parts.length + (parts.length > 1 ? ' effets : ' : ' effet : ') + parts.join(', ') : 'Aucun effet') +
        '</span><span class="pt-acc-chev" aria-hidden="true">▾</span>';
      var key = 'svc-act-' + idx;
      var open = ptUi._open.hasOwnProperty(key) ? ptUi._open[key] : (cards.length > prevCount && prevCount > 0 && idx === cards.length - 1);
      function apply() { card.classList.toggle('is-open', open); head.setAttribute('aria-expanded', String(open)); }
      head.onclick = function () { open = !open; ptUi._open[key] = open; apply(); };
      card.insertBefore(head, card.firstChild);
      apply();
    });
    enhanceSvcActions._count = cards.length;
  }
  function enhanceSvcGen(root) {
    if (!root) return;
    var secs = [].slice.call(root.querySelectorAll('.b-sec'));
    var roles = secs.filter(function (s) { var t = s.querySelector('.b-sec-t'); return t && /r[ôo]les du service/i.test(t.textContent); })[0];
    if (roles && !roles.closest('details.pt-acc')) {
      var checked = roles.querySelectorAll('input[type=checkbox]:checked').length;
      var hint = roles.querySelector('.f-hint'); if (hint) hint.remove();
      var t = roles.querySelector('.b-sec-t'); if (t) t.remove();
      var d = ptUi.wrapNodes([roles], 'Options avancées : rôles et accès', checked ? checked + ' restriction(s) de rôle' : 'Tous les rôles (aucune restriction)', 'svc-gen-roles');
      if (d) d.querySelector('.pt-acc-t').insertAdjacentHTML('beforeend', ' ' + ptUi.tip('Vide = tous les rôles de l’environnement. Ces règles sont aussi contrôlées côté serveur.'));
    }
    [].slice.call(root.querySelectorAll('.f-hint')).forEach(function (h) {
      var lab = h.parentNode && h.parentNode.querySelector('.fl2, .b-sec-t');
      if (!lab || lab.querySelector('.pt-tip')) return;
      lab.insertAdjacentHTML('beforeend', ' ' + ptUi.tip(h.textContent.trim()));
      h.remove();
    });
  }
  function wrapFn(name, after) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__ptErgo) return false;
    var w = function (el) {
      var r = orig.apply(this, arguments);
      try { after(el); } catch (e) { console.warn('[PicoTrack ergo]', name, e); }
      return r;
    };
    w.__ptErgo = true;
    window[name] = w;
    return true;
  }

  function boot() {
    wrapFn('renderSvcActions', enhanceSvcActions);
    wrapFn('renderSvcGen', enhanceSvcGen);
    var tb = document.getElementById('tb-t'), bc = document.getElementById('breadcrumb'), main = document.getElementById('main');
    if (!tb || !bc || !main) return setTimeout(boot, 400);
    var mo = new MutationObserver(schedule);
    mo.observe(tb, { childList: true, characterData: true, subtree: true });
    mo.observe(bc, { childList: true, characterData: true, subtree: true });
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
