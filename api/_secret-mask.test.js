const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSensitiveField,
  isSensitiveName,
  looksLikeSecret,
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
  'passwd'
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
  'codeConfidentiel',
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

test('37 noms : secrets masqués, identifiants métier et code postal visibles', () => {
  assert.equal(MASKED_NAMES.length + VISIBLE_NAMES.length, 37);
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
});
