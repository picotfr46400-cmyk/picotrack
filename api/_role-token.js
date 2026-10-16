'use strict';

// Normalisation partagée des noms de rôle. api/_access.js (#24) pourra
// l'importer tel quel : la tabulation sépare, une chaîne ["x"] est lue comme
// un tableau JSON, puis NFC, retrait des invisibles (ZWSP compris), trim,
// minuscules. Les espaces internes ne sont pas compactés.

const INVISIBLE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff\ufff9-\ufffb]/g;

function normalizeRoleToken(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .trim()
    .toLowerCase();
}

function roleTokens(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(item => roleTokens(item));
  if (typeof value === 'object') return [];
  const text = String(value);
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.flatMap(item => roleTokens(item));
    } catch (_) {}
  }
  if (text.includes('\t')) return text.split('\t').flatMap(part => roleTokens(part));
  const token = normalizeRoleToken(text);
  return token ? [token] : [];
}

module.exports = {
  normalizeRoleToken,
  roleTokens
};
