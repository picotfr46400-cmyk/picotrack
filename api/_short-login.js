'use strict';

// Identifiant court : trim et minuscules des deux côtés. La valeur stockée
// ne change pas. Pas de ilike, donc pas de jokers.
function shortLoginKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function shortLoginKeys(row) {
  const keys = [];
  for (const value of [row?.login_user, row?.username]) {
    const key = shortLoginKey(value);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

function findShortLoginMatches(rows, rawLogin) {
  const key = shortLoginKey(rawLogin);
  if (!key) return [];
  return (Array.isArray(rows) ? rows : []).filter(row => shortLoginKeys(row).includes(key));
}

function conflictingShortLogin(rows, environmentCode, keys, exceptId) {
  const wanted = [...new Set((keys || []).map(shortLoginKey).filter(Boolean))];
  if (!wanted.length) return null;
  const env = String(environmentCode || '').trim().toUpperCase();
  return (Array.isArray(rows) ? rows : []).find(row => {
    if (exceptId && String(row?.id) === String(exceptId)) return false;
    if (env && String(row?.environment_code || '').trim().toUpperCase() !== env) return false;
    return shortLoginKeys(row).some(key => wanted.includes(key));
  }) || null;
}

module.exports = {
  shortLoginKey,
  shortLoginKeys,
  findShortLoginMatches,
  conflictingShortLogin
};
