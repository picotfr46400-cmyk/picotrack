'use strict';

// Un seul normaliseur : bords, NFKC, minuscules. Un espace interne reste et
// rend l'adresse invalide. login_user n'est pas concerné.
function normalizeEmail(value) {
  return String(value ?? '').trim().normalize('NFKC').toLowerCase().slice(0, 320);
}

function isEmailLike(value) {
  return normalizeEmail(value).includes('@');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function assertWritableEmail(value) {
  const email = normalizeEmail(value);
  if (!isValidEmail(email)) {
    throw Object.assign(new Error('e-mail invalide'), { status: 400 });
  }
  return email;
}

module.exports = {
  normalizeEmail,
  isEmailLike,
  isValidEmail,
  assertWritableEmail
};
