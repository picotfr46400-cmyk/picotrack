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

module.exports = {
  PAD_LICENSE_ALIASES,
  normalizeLicenseType,
  interpretedLicenseType
};
