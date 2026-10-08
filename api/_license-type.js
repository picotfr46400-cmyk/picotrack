'use strict';

function normalizePrivilegeToken(value) {
  return String(value ?? '').replace(/[\t\r\n\f\v]/g, '').trim().toLowerCase().replace(/^[\s"'{}]+|[\s"'{}]+$/g, '').trim();
}

const PAD_LICENSE_ALIASES = new Set(['pad', 'pad_terrain', 'terrain', 'mobile', 'operateur', 'operator']);
const READONLY_LICENSE_ALIASES = new Set(['readonly', 'read_only', 'lecture', 'lecture_seule', 'viewer', 'consultation']);

function normalizeLicenseType(value) {
  const token = normalizePrivilegeToken(value);
  if (PAD_LICENSE_ALIASES.has(token)) return 'pad';
  if (READONLY_LICENSE_ALIASES.has(token)) return 'readonly';
  return 'supervision';
}

function interpretedLicenseType(value) {
  const token = normalizePrivilegeToken(value);
  if (!token) return '';
  if (normalizeLicenseType(value) === 'pad') return 'pad';
  return token;
}

function roleList(value) {
  if (Array.isArray(value)) return value;
  return [];
}

// Le type de licence explicite gagne. Le rôle pad_user ne sert que pour les
// lignes héritées qui n'ont pas encore de license_type.
function seatLicenseType(row) {
  const source = row && typeof row === 'object' ? row : { license_type: row };
  const token = normalizePrivilegeToken(source.license_type);
  if (token) return normalizeLicenseType(source.license_type);
  const primary = normalizePrivilegeToken(source.role);
  const inheritedPad = primary === 'pad_user'
    || roleList(source.roles).some(role => normalizePrivilegeToken(role) === 'pad_user');
  return inheritedPad ? 'pad' : 'supervision';
}

// Normalise les alias connus. Un compte plateforme peut conserver super_admin
// et platform_admin ; tout le reste rejoint les trois types canoniques.
function canonicalizeStoredLicenseType(value, options = {}) {
  const token = normalizePrivilegeToken(value);
  if (PAD_LICENSE_ALIASES.has(token)) return 'pad';
  if (READONLY_LICENSE_ALIASES.has(token)) return 'readonly';
  if (!token || token === 'supervision' || token === 'supervision_user' || token === 'superviseur') return 'supervision';
  if (options.keepPlatformTypes && (token === 'super_admin' || token === 'platform_admin')) return token;
  return 'supervision';
}

module.exports = {
  PAD_LICENSE_ALIASES,
  READONLY_LICENSE_ALIASES,
  normalizeLicenseType,
  interpretedLicenseType,
  seatLicenseType,
  canonicalizeStoredLicenseType
};
