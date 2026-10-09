'use strict';

// Module unique de masquage. La comparaison des noms est compacte :
// NFKD, accents retirés, minuscules, espaces et ponctuation supprimés.
// « masqué » remplace toujours un secret. Une chaîne vide reste vide.

const SECRET_FIELD_TYPES = new Set(['password', 'passwd', 'secret', 'hidden', 'pin', 'otp']);
const COMPACT_PHRASES = [
  'motdepasse',
  'password',
  'passwd',
  'apikey',
  'digicode',
  'cryptogramme',
  'numerodecarte',
  'codesecret',
  'codedacces',
  'codeacces',
  'codepin',
  'token',
  'secret',
  'session',
  'cookie',
  'licensekey',
  'cledelicence',
  'codeconfidentiel',
  'authorization',
  'bearer',
  'supakey',
  'supaurl',
  'codedeverification',
  'verificationcode',
  'cartebancaire',
  'creditcard',
  'cardnumber'
];
const EXACT_TOKENS = new Set(['pwd', 'mdp', 'cvv', 'cvc', 'pin', 'otp', 'iban']);
const SECRET_OBJECT_KEY = /password|passwd|token|secret|authorization|cookie|api[_-]?key|license[_-]?key|session|supa[_-]?(key|url)|bearer/i;
const AUDIT_TEXT_MAX = 500;
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const DATA_URL_RE = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MASK = 'masqué';

function foldText(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function normalizeSecretText(value) {
  return foldText(value).replace(/[^a-z0-9]+/g, '');
}

function nameTokens(value) {
  const split = String(value ?? '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u0060\u02BC]/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return foldText(split).split(/[^a-z0-9]+/).filter(Boolean);
}

function isSecretObjectKey(value) {
  return SECRET_OBJECT_KEY.test(String(value ?? ''));
}

function isSensitiveName(value) {
  const compact = normalizeSecretText(value);
  if (!compact || compact === 'codepostal') return false;
  if (COMPACT_PHRASES.some(phrase => compact.includes(phrase))) return true;
  const tokens = nameTokens(value);
  if (tokens.some(token => EXACT_TOKENS.has(token))) return true;
  return EXACT_TOKENS.has(compact);
}

function isSensitiveField(keyOrField, label) {
  if (keyOrField && typeof keyOrField === 'object') {
    const field = keyOrField;
    const type = normalizeSecretText(field.type || '');
    if (SECRET_FIELD_TYPES.has(type)) return true;
    return [field.id, field.key, field.field_key, field.nom, field.label, field.name].some(isSensitiveName);
  }
  return isSensitiveName(keyOrField) || isSensitiveName(label);
}

function maskKindForType(type) {
  const raw = String(type || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'signature' || raw === 'sign') return 'signature';
  if (SECRET_FIELD_TYPES.has(normalizeSecretText(raw)) || isSensitiveName(raw)) return 'secret';
  return '';
}

function luhnOk(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function cardDigits(value) {
  const digits = String(value ?? '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits) || !luhnOk(digits)) return '';
  return digits;
}

function shannonEntropy(text) {
  const freq = new Map();
  for (const ch of text) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  const total = text.length || 1;
  for (const count of freq.values()) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isStandardUuid(text) {
  return UUID_RE.test(String(text || '').trim());
}

function isHighEntropyToken(text) {
  if (!text || text.length < 32 || /\s/.test(text)) return false;
  if (isStandardUuid(text)) return false;
  if (!/^[A-Za-z0-9+/_-]+$/.test(text)) return false;
  if (new Set(text).size < 8) return false;
  return shannonEntropy(text) >= 3.5;
}

function ibanChecksumOk(iban) {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let expanded = '';
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) expanded += ch;
    else if (code >= 65 && code <= 90) expanded += String(code - 55);
    else return false;
  }
  let rem = 0;
  for (let i = 0; i < expanded.length; i += 1) {
    rem = (rem * 10 + (expanded.charCodeAt(i) - 48)) % 97;
  }
  return rem === 1;
}

function isIban(value) {
  const compact = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  if (compact.length < 15 || compact.length > 34) return false;
  return ibanChecksumOk(compact);
}

function looksLikeSecret(value) {
  const text = String(value ?? '').trim();
  if (!text || /^data:/i.test(text) || isStandardUuid(text)) return false;
  if (new RegExp(`^${JWT_RE.source}$`).test(text)) return true;
  if (isHighEntropyToken(text)) return true;
  if (cardDigits(text)) return true;
  if (isIban(text)) return true;
  return false;
}

function looksLikeAuditSecret(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (JWT_RE.test(text)) return true;
  if (!/\s/.test(text) && /^[0-9a-fA-F]{32,}$/.test(text)) return true;
  if (!/\s/.test(text) && text.length >= 32 && /^[A-Za-z0-9+/_=-]+$/.test(text)) return true;
  if (cardDigits(text)) return true;
  if (isIban(text)) return true;
  return false;
}

function shieldDataUrls(text) {
  const holders = [];
  const shielded = String(text || '').replace(DATA_URL_RE, (match) => {
    const token = `\u0000DATA${holders.length}\u0000`;
    holders.push(match);
    return token;
  });
  return { shielded, holders };
}

function restoreDataUrls(text, holders) {
  let out = text;
  holders.forEach((value, index) => {
    out = out.replace(`\u0000DATA${index}\u0000`, value);
  });
  return out;
}

function maskEmbeddedSecrets(text) {
  const { shielded, holders } = shieldDataUrls(text);
  let out = shielded.replace(new RegExp(JWT_RE.source, 'g'), MASK);
  out = out.replace(/(^|[^A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{32,})(?![A-Za-z0-9+/_-])/g, (full, lead, token) => (
    isStandardUuid(token) || !isHighEntropyToken(token) ? full : lead + MASK
  ));
  out = out.replace(/(^|[^\d])((?:\d[ -]?){12,18}\d)(?!\d)/g, (full, lead, card) => (
    cardDigits(card) ? lead + MASK : full
  ));
  out = out.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g, (match) => (isIban(match) ? MASK : match));
  return restoreDataUrls(out, holders);
}

function maskAuditEmbedded(text) {
  let out = String(text || '')
    .replace(new RegExp(JWT_RE.source, 'g'), MASK)
    .replace(/\b[0-9a-fA-F]{32,}\b/g, MASK)
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (match) => {
      const digits = match.replace(/\D/g, '');
      return /^\d{13,19}$/.test(digits) && luhnOk(digits) ? MASK : match;
    });
  out = out.replace(/(^|[^A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{32,})(?![A-Za-z0-9+/_-])/g, (full, lead, token) => (
    isStandardUuid(token) || !isHighEntropyToken(token) ? full : lead + MASK
  ));
  out = out.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g, (match) => (isIban(match) ? MASK : match));
  return out;
}

function maskSecretText(value) {
  const text = value == null ? '' : String(value);
  if (!text) return '';
  if (looksLikeSecret(text.trim())) return MASK;
  return maskEmbeddedSecrets(text);
}

function maskAuditText(value) {
  const text = value == null ? '' : String(value);
  if (!text) return '';
  const chars = Array.from(text);
  const clipped = chars.length <= AUDIT_TEXT_MAX ? text : chars.slice(0, AUDIT_TEXT_MAX).join('');
  if (looksLikeAuditSecret(text) || looksLikeAuditSecret(clipped)) return MASK;
  return maskAuditEmbedded(clipped);
}

module.exports = {
  SECRET_FIELD_TYPES,
  AUDIT_TEXT_MAX,
  foldText,
  normalizeSecretText,
  isSecretObjectKey,
  isSensitiveName,
  isSensitiveField,
  maskKindForType,
  luhnOk,
  looksLikeSecret,
  looksLikeAuditSecret,
  maskEmbeddedSecrets,
  maskAuditEmbedded,
  maskSecretText,
  maskAuditText
};
