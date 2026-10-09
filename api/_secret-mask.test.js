const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  AUDIT_TEXT_MAX,
  isSecretObjectKey,
  isSensitiveField,
  isSensitiveName,
  looksLikeAuditSecret,
  looksLikeSecret,
  maskAuditText,
  maskKindForType,
  maskSecretText,
  normalizeSecretText
} = require('./_secret-mask');

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const TOKEN = 'k7Qm9Vx2Lp4Nw8Rs1Td6Yh3Zc5Bf0AeG';
const IBAN = 'FR7630006000011234567890189';

const MASKED_NAMES = [
  'motdepasse',
  'mot_de_passe',
  'MOTDEPASSE',
  'MotDePasse',
  'mot de passe',
  'password',
  'pwd',
  'mdp',
  'secret',
  'token',
  'accessToken',
  'apiKey',
  'api_key',
  'session',
  'cookie',
  'code PIN',
  'digicode',
  'code d\'accès',
  'code d\u2019accès',
  'codeAcces',
  'code secret',
  'Numéro de carte',
  'cryptogramme',
  'CVV',
  'IBAN',
  'passwd',
  'licenseKey',
  'license_key',
  'clé de licence',
  'code confidentiel',
  'codeConfidentiel',
  'authorization',
  'bearer',
  'supa_key',
  'supa_url',
  'code de verification',
  'verification code',
  'carte bancaire',
  'credit card',
  'card number'
];

const VISIBLE_NAMES = [
  'Code client',
  'Code article',
  'Code chantier',
  'Code barre',
  'Contrôle d\'accès',
  'Contrôle d\u2019accès',
  'Accès',
  'Confidentiel',
  'Code postal',
  'opinion'
];

test('normalisation compacte : NFKD, apostrophe, camelCase, sans espaces', () => {
  assert.equal(normalizeSecretText('MotDePasse'), 'motdepasse');
  assert.equal(normalizeSecretText('mot_de_passe'), 'motdepasse');
  assert.equal(normalizeSecretText('MOTDEPASSE'), 'motdepasse');
  assert.equal(normalizeSecretText('code d\u2019accès'), 'codedacces');
  assert.equal(normalizeSecretText('Contrôle d\u2019accès'), 'controledacces');
  assert.equal(normalizeSecretText('Code postal'), 'codepostal');
  assert.equal(normalizeSecretText('accessToken'), 'accesstoken');
});

test('noms : secrets masqués, identifiants métier et code postal visibles', () => {
  assert.equal(MASKED_NAMES.length, 40);
  assert.equal(VISIBLE_NAMES.length, 10);
  for (const name of MASKED_NAMES) assert.equal(isSensitiveName(name), true, name);
  for (const name of VISIBLE_NAMES) assert.equal(isSensitiveName(name), false, name);
  assert.equal(isSensitiveField({ id: 'note', type: 'password', label: 'Commentaire' }), true);
  assert.equal(isSensitiveField({ id: 'note', type: 'secret', label: 'Commentaire' }), true);
  assert.equal(isSensitiveField({ id: 'cp', type: 'text', nom: 'Code postal' }), false);
  assert.equal(isSensitiveField('codeClient', 'Code client'), false);
  assert.equal(isSensitiveField('note', 'Code d\u2019accès'), true);
  assert.equal(maskKindForType('password'), 'secret');
  assert.equal(maskKindForType('signature'), 'signature');
  assert.equal(maskKindForType('text'), '');
});

test('valeurs : JWT, entropie, Luhn, IBAN, jamais une chaîne vide', () => {
  assert.equal(looksLikeSecret(JWT), true);
  assert.equal(looksLikeSecret(TOKEN), true);
  assert.equal(looksLikeSecret('a'.repeat(40)), false);
  assert.equal(looksLikeSecret('aB3d'.repeat(10)), false);
  assert.equal(looksLikeSecret('4111 1111 1111 1111'), true);
  assert.equal(looksLikeSecret('4111-1111-1111-1111'), true);
  assert.equal(looksLikeSecret(IBAN), true);
  assert.equal(looksLikeSecret('FR76 3000 6000 0112 3456 7890 189'), true);
  assert.equal(looksLikeSecret('data:image/png;base64,' + 'A'.repeat(80)), false);
  assert.equal(looksLikeSecret('CONFIDENTIEL-991'), false);
  assert.equal(maskSecretText(''), '');
  assert.equal(maskSecretText(JWT), 'masqué');
  assert.equal(maskSecretText(`préfixe ${JWT} suite`), 'préfixe masqué suite');
  assert.equal(maskSecretText(`carte 4111 1111 1111 1111 merci`), 'carte masqué merci');
  assert.equal(maskSecretText('visible'), 'visible');
  assert.equal(maskSecretText('CL-441'), 'CL-441');
  const uuid = '123e4567-e89b-12d3-a456-426614174000';
  const token40 = `${TOKEN}wQ4nR8sT`;
  assert.equal(token40.length, 40);
  assert.equal(looksLikeSecret(uuid), false);
  assert.equal(maskSecretText(uuid), uuid);
  assert.equal(maskSecretText(`réf ${uuid} ok`), `réf ${uuid} ok`);
  assert.equal(maskSecretText(`clé=${token40}`), 'clé=masqué');
  assert.equal(maskSecretText(`https://evil.example/a?x=${token40}`).includes(token40), false);
  assert.equal(maskSecretText(`https://app.picotrack.fr/?token=${token40}`).includes(token40), false);
  assert.equal(maskSecretText(`https://app.picotrack.fr/?jwt=${JWT}`).includes(JWT), false);
  assert.match(maskSecretText(`https://app.picotrack.fr/?token=${token40}`), /masqué/);
});

test('journal : valeur entière, hex, IBAN, coupe à 500, mail inchangé', () => {
  assert.equal(looksLikeAuditSecret(`préfixe ${JWT} suffixe`), true);
  assert.equal(looksLikeAuditSecret('a'.repeat(40)), true);
  assert.equal(looksLikeSecret('a'.repeat(40)), false);
  assert.equal(looksLikeAuditSecret(IBAN), true);
  assert.equal(maskAuditText(`préfixe ${JWT} suffixe`), 'masqué');
  assert.equal(maskSecretText(`préfixe ${JWT} suite`), 'préfixe masqué suite');
  assert.equal(maskAuditText('a'.repeat(40)), 'masqué');
  assert.equal(maskAuditText(''), '');
  const long = `note ${'é'.repeat(800)}`;
  assert.equal(Array.from(maskAuditText(long)).length, AUDIT_TEXT_MAX);
  assert.equal(AUDIT_TEXT_MAX, 500);
  assert.equal(isSecretObjectKey('api_key'), true);
  assert.equal(isSecretObjectKey('supa-url'), true);
  assert.equal(isSecretObjectKey('pwd'), false);
  assert.equal(isSecretObjectKey('Mozilla/5.0'), false);
});

test('un seul masqueur dans le dépôt', () => {
  const root = path.join(__dirname, '..');
  const files = [];
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs|cjs)$/.test(name)) files.push(full);
    }
  };
  walk(root);
  const needles = [
    /function\s+looksLikeSecret\s*\(/,
    /function\s+maskEmbeddedSecrets\s*\(/,
    /function\s+luhnOk\s*\(/,
    /const\s+SECRET_KEY\s*=/,
    /const\s+SENSITIVE_TEXT\s*=/
  ];
  const offenders = [];
  for (const file of files) {
    if (file.endsWith(`${path.sep}_secret-mask.js`) || file.endsWith(`${path.sep}_secret-mask.test.js`)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const needle of needles) {
      if (needle.test(text)) offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(offenders, []);
  const audit = fs.readFileSync(path.join(__dirname, '_submission-audit.js'), 'utf8');
  assert.match(audit, /require\('\.\/_secret-mask'\)/);
  assert.equal(/function\s+looksLikeSecret\s*\(/.test(audit), false);
  assert.equal(/function\s+maskEmbeddedSecrets\s*\(/.test(audit), false);
});
