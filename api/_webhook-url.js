'use strict';

const net = require('net');
const dns = require('dns').promises;

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data'
]);

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + (Number(part) || 0), 0) >>> 0;
}

function inCidr(ip, cidr) {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  if (!net.isIP(ip) || !net.isIPv4(ip) || !net.isIPv4(range) || !Number.isFinite(bits)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (!version) return false;
  if (version === 4) {
    return (
      inCidr(ip, '0.0.0.0/8') ||
      inCidr(ip, '10.0.0.0/8') ||
      inCidr(ip, '127.0.0.0/8') ||
      inCidr(ip, '169.254.0.0/16') ||
      inCidr(ip, '172.16.0.0/12') ||
      inCidr(ip, '192.168.0.0/16') ||
      inCidr(ip, '224.0.0.0/4') ||
      inCidr(ip, '255.255.255.255/32')
    );
  }
  const normalized = String(ip).toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('ff')
  );
}

function parseWebhookUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    const err = new Error('URL webhook manquante.');
    err.status = 400;
    throw err;
  }
  if (value.length > 2048) {
    const err = new Error('URL webhook trop longue.');
    err.status = 400;
    throw err;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    const err = new Error('URL webhook invalide.');
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    const err = new Error('Seuls http et https sont autorisés.');
    err.status = 400;
    throw err;
  }
  if (parsed.username || parsed.password) {
    const err = new Error('URL webhook avec identifiants refusée.');
    err.status = 400;
    throw err;
  }
  const host = String(parsed.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    const err = new Error('Hôte webhook non autorisé.');
    err.status = 400;
    throw err;
  }
  if (host === '0.0.0.0' || (net.isIP(host) && isPrivateIp(host))) {
    const err = new Error('Adresse privée ou locale refusée.');
    err.status = 400;
    throw err;
  }
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  if (![80, 443, 8080, 8443].includes(port)) {
    const err = new Error('Port webhook non autorisé.');
    err.status = 400;
    throw err;
  }
  return parsed;
}

async function assertPublicWebhookUrl(raw) {
  const parsed = parseWebhookUrl(raw);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) {
      const err = new Error('Adresse privée ou locale refusée.');
      err.status = 400;
      throw err;
    }
    return parsed;
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    const err = new Error('Hôte webhook introuvable.');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(records) || !records.length) {
    const err = new Error('Hôte webhook introuvable.');
    err.status = 400;
    throw err;
  }
  for (const rec of records) {
    if (isPrivateIp(rec.address)) {
      const err = new Error('Résolution DNS vers une adresse privée refusée.');
      err.status = 400;
      throw err;
    }
  }
  return parsed;
}

module.exports = {
  parseWebhookUrl,
  assertPublicWebhookUrl,
  isPrivateIp
};
