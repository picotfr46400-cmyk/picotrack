'use strict';

// Un seul normaliseur : bords, NFKC, minuscules. Un espace interne reste et
// rend l'adresse invalide. login_user n'est pas concerné.
function normalizeEmail(value) {
  // Un texte Postgres ne peut pas contenir NUL : on le retire avant la forme canonique.
  return String(value ?? '').replace(/\0/g, '').trim().normalize('NFKC').toLowerCase().slice(0, 320);
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
