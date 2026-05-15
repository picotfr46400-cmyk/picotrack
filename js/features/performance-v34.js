// ══ PicoTrack V3.4 — vraie perf réponses ══
// Objectif : ne jamais charger les JSON lourds (photos/fichiers/base64) dans les listes.
// Les listes chargent uniquement id/form_id/created_at/device. Le détail complet charge au clic.
(function(){
  const PAGE_SIZE = 25;
  const pageByForm = new Map();
  const fullCache = new Map();
  const loadingByForm = new Set();

  function esc(v){ return (typeof h === 'function') ? h(v) : String(v ?? '').replace(/[&<>\"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m])); }
  function jsArg(v){ return JSON.stringify(String(v ?? '')).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }
  function formKey(id){ return String(id ?? ''); }
  function normalizeSummary(r){
    return {
      id: r.id,
      formId: r.form_id,
      formNom: '',
      date: r.created_at,
      dateLabel: r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '—',
      utilisateur: r.device === 'pad' ? '📱 PAD Terrain' : 'Bureau',
      values: {},
      _summaryOnly: true
    };
  }
  function normalizeFull(r){
    const mapped = (typeof mapSubmissionFromDb === 'function') ? mapSubmissionFromDb(r) : {
      id:r.id, formId:r.form_id, date:r.created_at,
      dateLabel:r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '—',
      utilisateur:r.device==='pad'?'📱 PAD Terrain':'Bureau', values:r.values||{}
    };
    mapped._summaryOnly = false;
    return mapped;
  }
  function upsertSubmission(row){
    const id = String(row.id);
    const idx = SUBMISSIONS_DATA.findIndex(x=>String(x.id)===id);
    if(idx >= 0) SUBMISSIONS_DATA[idx] = { ...SUBMISSIONS_DATA[idx], ...row };
    else SUBMISSIONS_DATA.push(row);
  }
  function getCachedSubmission(id){
    const key = String(id);
    return fullCache.get(key) || SUBMISSIONS_DATA.find(x=>String(x.id)===key) || null;
  }

  // Requêtes Supabase légères.
  if(typeof DB !== 'undefined'){
    DB.getSubmissionSummaries = async function(formId, limit=PAGE_SIZE, offset=0){
      return sbFetch(`submissions?form_id=eq.${encodeURIComponent(formId)}&select=id,form_id,created_at,device&order=created_at.desc&limit=${limit}&offset=${offset}`);
    };
    DB.getSubmissionById = async function(id){
      const rows = await sbFetch(`submissions?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
      return rows && rows.length ? rows[0] : null;
    };
    // Polling léger : aucune colonne values.
    DB.getAllSubmissions = async function(since){
      const q = since
        ? `submissions?select=id,form_id,created_at,device&order=created_at.desc&created_at=gt.${encodeURIComponent(since)}&limit=50`
        : `submissions?select=id,form_id,created_at,device&order=created_at.desc&limit=50`;
      return sbFetch(q);
    };
    // Compatibilité : l'ancien ensure appelle DB.getSubmissions.
    DB.getSubmissions = async function(formId, limit=PAGE_SIZE){
      return DB.getSubmissionSummaries(formId, limit, 0);
    };
  }

  window.ptEnsureSubmissionDetail = async function(id){
    const key = String(id);
    const cached = fullCache.get(key);
    if(cached && !cached._summaryOnly) return cached;
    const local = SUBMISSIONS_DATA.find(x=>String(x.id)===key);
    if(local && !local._summaryOnly && local.values && Object.keys(local.values).length){
      fullCache.set(key, local);
      return local;
    }
    if(typeof DB === 'undefined' || !DB.getSubmissionById) return local;
    updateSupabaseStatusUI?.('syncing','Chargement détail');
    const raw = await DB.getSubmissionById(id);
    if(!raw) return local;
    const full = normalizeFull(raw);
    fullCache.set(key, full);
    upsertSubmission(full);
    updateSupabaseStatusUI?.('online','Détail chargé');
    return full;
  };

  window.ensureSubmissionsLoaded = async function(formId, limit=PAGE_SIZE, force=false){
    const key = formKey(formId);
    if(!key || loadingByForm.has(key)) return;
    const state = pageByForm.get(key) || { page:0, loaded:false, hasNext:false };
    if(state.loaded && !force) return;
    loadingByForm.add(key);
    try{
      updateSupabaseStatusUI?.('syncing','Chargement liste');
      const rows = await DB.getSubmissionSummaries(formId, limit + 1, state.page * limit);
      // On remplace uniquement les résumés de la page courante pour ce formulaire,
      // sans supprimer les détails complets déjà ouverts.
      const existingFull = SUBMISSIONS_DATA.filter(s=>String(s.formId)===key && !s._summaryOnly);
      for(let i=SUBMISSIONS_DATA.length-1;i>=0;i--){
        if(String(SUBMISSIONS_DATA[i].formId)===key && SUBMISSIONS_DATA[i]._summaryOnly) SUBMISSIONS_DATA.splice(i,1);
      }
      rows.slice(0, limit).forEach(r=>upsertSubmission(normalizeSummary(r)));
      existingFull.forEach(s=>upsertSubmission(s));
      state.loaded = true;
      state.hasNext = rows.length > limit;
      pageByForm.set(key,state);
      const f=FORMS_DATA.find(x=>String(x.id)===key);
      if(f) f.resp = Math.max((state.page*limit) + Math.min(rows.length,limit), f.resp||0);
      updateSupabaseStatusUI?.('online','Liste chargée');
    }catch(e){
      console.warn('[V3.4] chargement liste réponses:', e);
      throw e;
    }finally{
      loadingByForm.delete(key);
    }
  };

  window.ptSubPage = async function(formId, delta){
    const key=formKey(formId);
    const state=pageByForm.get(key)||{page:0,loaded:false,hasNext:false};
    state.page=Math.max(0,(state.page||0)+delta);
    state.loaded=false;
    pageByForm.set(key,state);
    const f=FORMS_DATA.find(x=>String(x.id)===key);
    if(f){
      const wrap=document.getElementById('sub-table-wrap');
      if(wrap) wrap.innerHTML='<div style="padding:34px;text-align:center;color:var(--tl);font-weight:900">Chargement de la page…</div>';
      await ensureSubmissionsLoaded(formId, PAGE_SIZE, true);
      renderSubmissions(f);
    }
  };

  window.openSubmissions = async function(id){
    const f=FORMS_DATA.find(x=>String(x.id)===String(id)); if(!f) return;
    curSaisieFormId=id;
    const bc=document.getElementById('breadcrumb'); if(bc) bc.innerHTML=`<span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">${esc(f.nom)}</span>`;
    const tb=document.getElementById('tb-t'); if(tb) tb.textContent=f.nom;
    show('v-submissions');
    renderSubmissions(f);
    const key=formKey(id);
    const state=pageByForm.get(key)||{page:0,loaded:false,hasNext:false};
    if(!state.loaded){
      const wrap=document.getElementById('sub-table-wrap');
      if(wrap) wrap.innerHTML='<div style="text-align:center;padding:38px 20px;color:var(--tl);background:var(--card,#fff);border-radius:12px;border:1.5px dashed var(--bd);font-weight:900">Chargement liste rapide…</div>';
      try{ await ensureSubmissionsLoaded(id, PAGE_SIZE, true); }
      catch(e){ if(wrap) wrap.innerHTML='<div style="text-align:center;padding:38px 20px;color:#ef4444;background:#fff;border-radius:12px;border:1.5px dashed #fecaca;font-weight:900">Erreur de chargement de la liste.</div>'; }
      if(document.getElementById('v-submissions')?.classList.contains('on') && String(curSaisieFormId)===key) renderSubmissions(f);
    }
  };

  window.renderSubmissions = function(f){
    const key=formKey(f.id), color=f.couleur||'#3b82f6';
    const state=pageByForm.get(key)||{page:0,loaded:false,hasNext:false};
    const pageRows=SUBMISSIONS_DATA
      .filter(s=>String(s.formId)===key)
      .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
      .filter((s,i,arr)=>arr.findIndex(x=>String(x.id)===String(s.id))===i)
      .slice(0,PAGE_SIZE);
    let html='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">';
    html+=`<div><div style="font-size:17px;font-weight:900;color:var(--tx)">${esc(f.nom)}</div>`;
    html+=`<div style="font-size:12px;color:var(--tl);margin-top:2px" id="sub-count">Page ${state.page+1} · ${pageRows.length} réponse${pageRows.length>1?'s':''} chargée${pageRows.length>1?'s':''}</div></div>`;
    html+=`<button class="btn bp" onclick="openFormSaisie(${jsArg(f.id)})" style="background:${color};border-color:${color}">＋ Nouvelle saisie</button></div>`;
    html+='<div style="background:#fff;border:1.5px solid var(--bd);border-radius:12px;padding:12px 14px;margin-bottom:14px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">';
    html+='<div style="font-size:12px;color:var(--tl);font-weight:800">Liste optimisée : les fichiers/photos et le JSON complet sont chargés uniquement au clic.</div>';
    html+=`<div style="display:flex;gap:8px"><button onclick="ptSubPage(${jsArg(f.id)},-1)" ${state.page<=0?'disabled':''} style="padding:8px 12px;border:1px solid var(--bd);border-radius:10px;background:#fff;font-weight:900;cursor:pointer;opacity:${state.page<=0?.45:1}">← Précédent</button><button onclick="ptSubPage(${jsArg(f.id)},1)" ${!state.hasNext?'disabled':''} style="padding:8px 12px;border:1px solid var(--bd);border-radius:10px;background:#fff;font-weight:900;cursor:pointer;opacity:${!state.hasNext?.45:1}">Suivant →</button></div>`;
    html+='</div><div id="sub-table-wrap"></div>';
    const wrap=document.getElementById('sub-wrap'); if(wrap) wrap.innerHTML=html;
    renderSubTable(f,pageRows);
  };

  window.renderSubTable = function(f,subs){
    const wrap=document.getElementById('sub-table-wrap'); if(!wrap) return;
    if(!subs.length){ wrap.innerHTML='<div style="text-align:center;padding:58px 20px;color:var(--tl);background:#fff;border-radius:12px;border:1.5px dashed var(--bd)"><div style="font-size:30px;margin-bottom:10px">📭</div>Aucune réponse sur cette page</div>'; return; }
    let html='<div style="background:#fff;border-radius:12px;border:1.5px solid var(--bd);overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
    html+='<thead><tr style="background:var(--bg);border-bottom:2px solid var(--bd)"><th style="padding:11px 14px;text-align:left;color:var(--tl)">Date</th><th style="padding:11px 14px;text-align:left;color:var(--tl)">Utilisateur</th><th style="padding:11px 14px;text-align:left;color:var(--tl)">Détail</th></tr></thead><tbody>';
    subs.forEach((s,i)=>{
      const bg=i%2?'var(--bg)':'#fff';
      html+=`<tr onclick="openSubmission(${jsArg(s.id)})" style="cursor:pointer;border-bottom:1px solid var(--bd);background:${bg}" onmouseover="this.style.background='var(--pl)'" onmouseout="this.style.background='${bg}'"><td style="padding:12px 14px;color:var(--tl);white-space:nowrap">${esc(s.dateLabel)}</td><td style="padding:12px 14px;font-weight:700;color:var(--tx)">${esc(s.utilisateur)}</td><td style="padding:12px 14px;color:#2563eb;font-weight:900">Ouvrir la réponse complète →</td></tr>`;
    });
    html+='</tbody></table></div>';
    wrap.innerHTML=html;
  };

  window.openSubmission = async function(id){
    let s=getCachedSubmission(id);
    if(!s){ alert('Réponse introuvable. ID : '+id); return; }
    const f=FORMS_DATA.find(x=>String(x.id)===String(s.formId)); if(!f){ alert('Formulaire introuvable.'); return; }
    const bc=document.getElementById('breadcrumb');
    if(bc) bc.innerHTML=`<span class="bc-link" onclick="goProduction()">▶ Production / Formulaires</span><span style="color:var(--tl);margin:0 4px">/</span><span class="bc-link" onclick="openSubmissions(${jsArg(f.id)})">${esc(f.nom)}</span><span style="color:var(--tl);margin:0 4px">/</span><span style="font-weight:600">Saisie du ${esc(s.dateLabel)}</span>`;
    const tb=document.getElementById('tb-t'); if(tb) tb.textContent=f.nom;
    show('v-submission-detail');
    const main=document.getElementById('sd-main');
    if(s._summaryOnly){
      if(main) main.innerHTML='<div style="background:#fff;border:1.5px dashed var(--bd);border-radius:14px;padding:34px;text-align:center;color:var(--tl);font-weight:900">Chargement de la réponse complète…</div>';
      s = await ptEnsureSubmissionDetail(id);
    }
    renderSubmissionDetail(s,f);
  };

  window.ptOpenPlanningSubmission = async function(id){
    try{ if(typeof ptClosePlanningDetail==='function') ptClosePlanningDetail(); }catch(e){}
    let sub = getCachedSubmission(id);
    if(!sub){
      try{ sub = await ptEnsureSubmissionDetail(id); }catch(e){ console.warn(e); }
    }
    if(!sub){ alert('Réponse complète introuvable. ID : '+id); return; }
    openSubmission(sub.id);
  };

  // Les anciens filtres clients nécessitaient les valeurs complètes. Ils sont désactivés dans la liste rapide.
  window.filterSubs = function(formId){ const f=FORMS_DATA.find(x=>String(x.id)===String(formId)); if(f) renderSubmissions(f); };
  window.resetSubFilters = window.filterSubs;

  console.log('[PicoTrack] V3.4 performance réelle active : listes légères + détail au clic');
})();
