'use strict';

// Identifiant court : trim et minuscules des deux côtés. La valeur stockée
// ne change pas. La comparaison SQL est une fonction paramétrée : aucune
// saisie n'est interpolée dans un filtre PostgREST.
const SHORT_LOGIN_RPC = 'rpc/match_short_logins';

function shortLoginKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function shortLoginRpcBody(environmentCode, rawLogin) {
  return {
    p_environment_code: String(environmentCode || '').trim().toUpperCase(),
    p_login: String(rawLogin ?? '')
  };
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
  SHORT_LOGIN_RPC,
  shortLoginKey,
  shortLoginKeys,
  findShortLoginMatches,
  conflictingShortLogin,
  shortLoginRpcBody
};
