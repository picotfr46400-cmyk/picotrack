// ══ PERMISSIONS & VISIBILITÉ PAR RÔLES ══
// ══ HELPER : sélecteur de visibilité par rôles ══
function renderVisibilitySelector(currentRoles, onChangeCallback) {
  const opts = ROLES_DATA.map(r => {
    const selected = (currentRoles||[]).includes(r.id);
    return `<label style="display:flex;align-items:center;gap:7px;padding:6px 10px;border-radius:7px;cursor:pointer;background:${selected?'var(--pl)':'#fff'};border:1.5px solid ${selected?'var(--p)':'var(--bd)'}" onclick="${onChangeCallback}(${r.id},this)">
      <div style="width:14px;height:14px;border-radius:4px;border:2px solid ${selected?'var(--p)':'var(--bd)'};background:${selected?'var(--p)':'#fff'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;color:#fff">${selected?'✓':''}</div>
      <span style="font-size:12px;font-weight:600">${h(r.nom)}</span>
    </label>`;
  }).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${opts}</div>`;
}

function visibilityBadge(visibleBy) {
  if (!visibleBy || !visibleBy.length) return `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#f1f5f9;color:var(--tl)">Tous</span>`;
  return visibleBy.map(rid => {
    const r = ROLES_DATA.find(x=>x.id===rid);
    return r ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--pl);color:var(--p);font-weight:700">${h(r.nom)}</span>` : '';
  }).join('');
}
function _toggleStatusVis(i, roleId, labelEl) {
  if (!svcBuilderStatuses[i].visibleBy) svcBuilderStatuses[i].visibleBy = [];
  const idx = svcBuilderStatuses[i].visibleBy.indexOf(roleId);
  const on = idx < 0;
  if (on) svcBuilderStatuses[i].visibleBy.push(roleId);
  else svcBuilderStatuses[i].visibleBy.splice(idx,1);
  labelEl.style.background = on ? 'var(--pl)' : '#fff';
  labelEl.style.borderColor = on ? 'var(--p)' : 'var(--bd)';
  const chk = labelEl.querySelector('div');
  if(chk){chk.style.background=on?'var(--p)':'#fff';chk.style.borderColor=on?'var(--p)':'var(--bd)';chk.textContent=on?'✓':'';}
}
function _toggleActionVis(i, roleId, labelEl) {
  if (!svcBuilderActions[i].visibleBy) svcBuilderActions[i].visibleBy = [];
  const idx = svcBuilderActions[i].visibleBy.indexOf(roleId);
  const on = idx < 0;
  if (on) svcBuilderActions[i].visibleBy.push(roleId);
  else svcBuilderActions[i].visibleBy.splice(idx,1);
  labelEl.style.background = on ? 'var(--pl)' : '#fff';
  labelEl.style.borderColor = on ? 'var(--p)' : 'var(--bd)';
  const chk = labelEl.querySelector('div');
  if(chk){chk.style.background=on?'var(--p)':'#fff';chk.style.borderColor=on?'var(--p)':'var(--bd)';chk.textContent=on?'✓':'';}
}
function _toggleFormVis(roleId, labelEl) {
  if (!curForm) curForm = {};
  if (!curForm.visibleBy) curForm.visibleBy = [];
  const idx = curForm.visibleBy.indexOf(roleId);
  const isOn = idx >= 0;
  if (isOn) { curForm.visibleBy.splice(idx, 1); }
  else { curForm.visibleBy.push(roleId); }
  const on = !isOn;
  labelEl.style.background = on ? 'var(--pl)' : '#fff';
  labelEl.style.borderColor = on ? 'var(--p)' : 'var(--bd)';
  const chk = labelEl.querySelector('div');
  if (chk) { chk.style.background = on ? 'var(--p)' : '#fff'; chk.style.borderColor = on ? 'var(--p)' : 'var(--bd)'; chk.textContent = on ? '✓' : ''; }
}
function _toggleFieldRole(roleId, checked) {
  if(curFieldIdx===null)return;
  const f=builderFields[curFieldIdx];
  if(!f.visibleByRoles)f.visibleByRoles=[];
  if(checked){if(!f.visibleByRoles.includes(roleId))f.visibleByRoles.push(roleId);}
  else f.visibleByRoles=f.visibleByRoles.filter(id=>id!==roleId);
}
