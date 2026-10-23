'use strict';

// Envoi d'une étiquette ZPL à une imprimante par FTP, depuis le serveur.
// Garde-fous (voir docs/IMPRIMANTES.md) :
// - l'hôte est celui enregistré par un admin de l'environnement, jamais celui envoyé par le client ;
// - résolution DNS puis connexion à l'adresse résolue (pas de second lookup, pas de rebinding) ;
// - boucle locale, lien local, métadonnées cloud, multicast, 0.0.0.0/8, CGNAT : toujours refusés ;
// - réseau privé (10/8, 172.16/12, 192.168/16, fc00::/7) refusé sauf variable d'environnement
//   PRINTER_FTP_ALLOW_PRIVATE=1 (préfixée par client : <CLIENT>_PRINTER_FTP_ALLOW_PRIVATE) ;
// - port 21 ou 1024-65535 ; en mode passif, l'IP annoncée par le serveur est ignorée (anti-rebond FTP) ;
// - mot de passe chiffré AES-256-GCM en base, jamais renvoyé au navigateur.
const net = require('net');
const dns = require('dns');
const crypto = require('crypto');

function deny(status, message) { return Object.assign(new Error(message), { status }); }

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc * 256) + Number(part), 0);
}
function inV4(ip, cidr) {
  const [base, bits] = cidr.split('/');
  const size = 2 ** (32 - Number(bits));
  const start = ipv4ToInt(base);
  const value = ipv4ToInt(ip);
  return value >= start && value < start + size;
}

const V4_ALWAYS_BLOCKED = ['0.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10', '192.0.0.0/24', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4'];
const V4_PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

// 'blocked' | 'private' | 'public'
function classifyAddress(address) {
  const ip = String(address || '').toLowerCase();
  const family = net.isIP(ip);
  if (family === 4) {
    if (V4_ALWAYS_BLOCKED.some(c => inV4(ip, c))) return 'blocked';
    if (V4_PRIVATE.some(c => inV4(ip, c))) return 'private';
    return 'public';
  }
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return classifyAddress(mapped[1]);
    if (ip === '::' || ip === '::1') return 'blocked';
    if (/^fe[89ab]/.test(ip)) return 'blocked'; // lien local
    if (/^ff/.test(ip)) return 'blocked'; // multicast
    if (/^f[cd]/.test(ip)) return 'private'; // ULA
    if (/^(64:ff9b|2001:db8|2002:)/.test(ip)) return 'blocked';
    return 'public';
  }
  return 'blocked';
}

function allowPrivate(prefix, env) {
  const e = env || process.env;
  const keys = [prefix ? `${prefix}_PRINTER_FTP_ALLOW_PRIVATE` : '', 'PRINTER_FTP_ALLOW_PRIVATE'].filter(Boolean);
  return keys.some(k => String(e[k] || '').trim() === '1');
}

function checkPort(port) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw deny(400, 'Port FTP invalide.');
  if (p !== 21 && p < 1024) throw deny(400, 'Port FTP refusé : 21 ou 1024 à 65535.');
  return p;
}

async function resolveTarget(host, opts) {
  const o = opts || {};
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h || h.length > 253 || !/^[a-z0-9.:-]+$/.test(h)) throw deny(400, 'Hôte FTP invalide.');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h === 'metadata.google.internal') throw deny(400, 'Hôte FTP refusé.');
  const lookup = o.lookup || ((name) => dns.promises.lookup(name, { all: true, verbatim: true }));
  let addrs;
  if (net.isIP(h)) addrs = [{ address: h, family: net.isIP(h) }];
  else {
    try { addrs = await lookup(h); } catch (_) { throw deny(400, 'Hôte FTP introuvable.'); }
  }
  if (!Array.isArray(addrs) || !addrs.length) throw deny(400, 'Hôte FTP introuvable.');
  const privateOk = o.allowPrivate === true;
  for (const a of addrs) {
    const kind = classifyAddress(a.address);
    if (kind === 'blocked') throw deny(400, 'Adresse FTP refusée (réseau local de la machine ou réservé).');
    if (kind === 'private' && !privateOk) throw deny(400, 'Adresse FTP privée refusée : le serveur PicoTrack est sur Internet et ne voit pas votre réseau local. Utilisez une imprimante Wi-Fi/TCP depuis la tablette, ou demandez l’autorisation pour cet environnement.');
  }
  return addrs[0].address;
}

/* ---------- chiffrement du mot de passe ---------- */
function deriveKey(secret, env) {
  if (!secret) throw deny(503, 'Chiffrement indisponible : clé serveur absente.');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret)), Buffer.from('picotrack-printer-ftp'), Buffer.from('v1:' + String(env || '')), 32));
}
function encryptSecret(plain, secret, env) {
  const key = deriveKey(secret, env);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(String(env || '')));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decryptSecret(blob, secret, env) {
  const s = String(blob || '');
  if (!s.startsWith('v1:')) throw deny(400, 'Mot de passe FTP à ressaisir.');
  const raw = Buffer.from(s.slice(3), 'base64');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret, env), raw.subarray(0, 12));
    d.setAAD(Buffer.from(String(env || '')));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch (_) {
    throw deny(400, 'Mot de passe FTP illisible (clé serveur changée) : ressaisissez-le.');
  }
}

/* ---------- client FTP minimal (USER/PASS, TYPE I, CWD, EPSV/PASV, STOR) ---------- */
function ftpCommandSafe(v) {
  const s = String(v == null ? '' : v);
  if (/[\r\n\u0000]/.test(s)) throw deny(400, 'Valeur FTP invalide.');
  return s;
}

function uploadFtp(opts) {
  const o = opts;
  const timeoutMs = o.timeoutMs || 8000;
  const connect = o.connect || ((port, host) => net.createConnection({ port, host }));
  return new Promise((resolve, reject) => {
    let done = false;
    let buf = '';
    let waiter = null;
    const lines = [];
    const sock = connect(o.port, o.address);
    const timer = setTimeout(() => finish(deny(504, 'Imprimante FTP : délai dépassé.')), timeoutMs);
    function finish(err, val) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch (_) {}
      if (err) reject(err.status ? err : deny(502, 'Imprimante FTP injoignable.')); else resolve(val);
    }
    sock.setEncoding('utf8');
    sock.on('error', () => finish(deny(502, 'Imprimante FTP injoignable.')));
    sock.on('close', () => { if (!done) finish(deny(502, 'Connexion FTP fermée par l’imprimante.')); });
    sock.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 65536) return finish(deny(502, 'Réponse FTP trop longue.'));
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (/^\d{3} /.test(line)) { lines.push(line); if (waiter) { const w = waiter; waiter = null; w(lines.shift()); } }
      }
    });
    function reply() {
      return new Promise((res) => { if (lines.length) res(lines.shift()); else waiter = res; });
    }
    async function cmd(text, okCodes) {
      if (text) sock.write(ftpCommandSafe(text) + '\r\n');
      const line = await reply();
      const code = Number(line.slice(0, 3));
      if (!okCodes.includes(code)) {
        const err = deny(502, code === 530 ? 'Imprimante FTP : identifiant ou mot de passe refusé.' : `Imprimante FTP : réponse ${code}.`);
        err.ftpCode = code;
        throw err;
      }
      return line;
    }
    (async () => {
      await cmd('', [220]);
      const u = await cmd('USER ' + (o.user || 'anonymous'), [230, 331]);
      if (u.startsWith('331')) await cmd('PASS ' + (o.password || ''), [230, 202]);
      await cmd('TYPE I', [200]);
      if (o.dir) await cmd('CWD ' + o.dir, [250]);
      let dataPort;
      try {
        const ep = await cmd('EPSV', [229]);
        dataPort = Number((/\(\|\|\|(\d+)\|\)/.exec(ep) || [])[1]);
      } catch (_) {
        const pv = await cmd('PASV', [227]);
        const m = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(pv);
        if (m) dataPort = Number(m[5]) * 256 + Number(m[6]);
      }
      if (!Number.isInteger(dataPort) || dataPort < 1024 || dataPort > 65535) throw deny(502, 'Imprimante FTP : mode passif refusé.');
      // IP du canal de données = celle du canal de contrôle (on ignore l'IP annoncée).
      const data = connect(dataPort, o.address);
      await new Promise((res, rej) => { data.once('connect', res); data.once('error', () => rej(deny(502, 'Imprimante FTP : canal de données injoignable.'))); });
      sock.write('STOR ' + ftpCommandSafe(o.filename) + '\r\n');
      const pre = await reply();
      if (!/^1[25]0/.test(pre)) { data.destroy(); throw deny(502, `Imprimante FTP : envoi refusé (${pre.slice(0, 3)}).`); }
      await new Promise((res) => data.end(Buffer.from(o.content, 'utf8'), res));
      const fin = await reply();
      if (!/^2(26|50)/.test(fin)) throw deny(502, `Imprimante FTP : envoi incomplet (${fin.slice(0, 3)}).`);
      try { sock.write('QUIT\r\n'); } catch (_) {}
      return { bytes: Buffer.byteLength(o.content, 'utf8') };
    })().then(v => finish(null, v), e => finish(e));
  });
}

module.exports = { classifyAddress, allowPrivate, checkPort, resolveTarget, encryptSecret, decryptSecret, uploadFtp, ftpCommandSafe };
