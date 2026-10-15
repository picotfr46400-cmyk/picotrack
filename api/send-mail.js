// PicoTrack — API Vercel d'envoi d'e-mails.
// Sécurité V2 : endpoint authentifié, aucune clé côté navigateur.
const { json, setCors, getAuthUser, getUserProfile, readJsonBody } = require('./_server-supabase');
const { normalizeLicenseType } = require('./_license-type');
const {
  DEFAULT_FROM,
  sanitizeEmailHtml,
  normalizeEmails,
  normalizeAttachments,
  originFromReq,
  textToHtml,
  brandTemplate,
  chooseTransport,
  smtpConfigured,
  deliverMail
} = require('./_mail-transport');

async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method === 'GET') return json(res, 200, { ok: true, status: 'send-mail endpoint ready' });
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Méthode non autorisée' });
  const transport = chooseTransport(process.env);
  if (transport === 'resend' && !process.env.RESEND_API_KEY) return json(res, 500, { ok: false, error: 'RESEND_API_KEY manquante dans Vercel' });
  if (transport === 'smtp' && !smtpConfigured(process.env)) return json(res, 500, { ok: false, error: 'Configuration SMTP incomplète' });
  try {
    const user = await getAuthUser(req);
    if (!user?.id) return json(res, 401, { ok: false, error: 'Authentification requise' });
    const profile = await getUserProfile(user.id, req);
    if (!profile?.id) return json(res, 403, { ok: false, error: 'Profil utilisateur introuvable' });
    if (profile.active === false) return json(res, 403, { ok: false, error: 'Compte désactivé' });
    const license = normalizeLicenseType(profile.license_type);
    if (license === 'pad' || license === 'readonly') {
      return json(res, 403, { ok: false, error: 'Envoi d’e-mail réservé à la supervision.' });
    }
    const body = await readJsonBody(req, 9_000_000);
    const to = normalizeEmails(body.to), cc = normalizeEmails(body.cc), bcc = normalizeEmails(body.bcc), replyTo = normalizeEmails(body.replyTo || body.reply_to);
    const subject = String(body.subject || '').trim().slice(0, 200);
    const text = String(body.text || body.body || '').trim();
    const html = sanitizeEmailHtml(body.html ? String(body.html) : textToHtml(text));
    const attachments = normalizeAttachments(body.attachments);
    if (!to.length) return json(res, 400, { ok: false, error: 'Destinataire manquant ou invalide' });
    if (!subject) return json(res, 400, { ok: false, error: 'Sujet manquant' });
    if (!text && !body.html) return json(res, 400, { ok: false, error: 'Contenu du mail manquant' });
    const baseUrl = originFromReq(req);
    const logoUrl = String(body.logoUrl || process.env.PICOTRACK_LOGO_URL || (baseUrl ? `${baseUrl}/logo-picotrack.png` : ''));
    const brandName = String(body.brandName || process.env.PICOTRACK_BRAND_NAME || 'PicoTrack Nexus').trim();
    const sent = await deliverMail({
      from: process.env.RESEND_FROM || process.env.SMTP_FROM || DEFAULT_FROM,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      html: brandTemplate({ subject, html, logoUrl, brandName }),
      text,
      attachments,
      idempotencyKey: body.idempotencyKey || body.idempotency_key || ''
    });
    return json(res, 200, { ok: true, id: sent.id, provider: sent.provider });
  } catch (err) {
    return json(res, err.status || 500, { ok: false, error: err.message || 'Erreur serveur mail', ...(err.details ? { details: err.details } : {}) });
  }
}
handler.sanitizeEmailHtml = sanitizeEmailHtml;
module.exports = handler;
