// ══ NAVIGATION ADMIN ══
function goDashboard() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  show('v-list'); // placeholder dashboard
  document.getElementById('tb-t').textContent = 'Dashboard';
}

function goUsers() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-users').classList.add('on');
  show('v-users');
  document.getElementById('tb-t').textContent = 'Utilisateurs';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Utilisateurs</span>';
  renderUsersList();
}

function goRoles() {
  document.querySelectorAll('.sb-i').forEach(i=>i.classList.remove('on'));
  document.getElementById('sb-roles').classList.add('on');
  show('v-roles');
  document.getElementById('tb-t').textContent = 'Rôles';
  document.getElementById('breadcrumb').innerHTML = '<span style="color:var(--tl)">▶ Administration / Rôles</span>';
  renderRolesList();
}

