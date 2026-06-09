// PicoTrack — API Vercel d'envoi d'e-mails via Resend
// Secrets requis dans Vercel : RESEND_API_KEY
// Optionnels :
// - RESEND_FROM="PicoTrack <notifications@noreply.picotrack.fr>"
// - PICOTRACK_LOGO_URL="https://picotrack.fr/logo-picotrack.png"
// - PICOTRACK_BRAND_NAME="PicoTrack Nexus"

const DEFAULT_FROM = 'PicoTrack <notifications@noreply.picotrack.fr>';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function normalizeEmails(value) {
  const arr = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(arr.map(v => String(v || '').trim()).filter(v => EMAIL_RE.test(v)))];
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.map((a) => {
    if (!a || typeof a !== 'object') return null;
    const filename = String(a.filename || 'document.pdf').replace(/[\\/<>:"|?*]+/g, '-').slice(0, 120);
    const content = String(a.content || '').trim();
    const contentType = String(a.contentType || a.content_type || 'application/pdf').trim();
    if (!content) return null;
    return { filename, content, content_type: contentType };
  }).filter(Boolean).slice(0, 5);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function textToHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function originFromReq(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (!host || host.includes('localhost')) return '';
  return `${proto}://${host}`;
}

function brandTemplate({ subject, text, html, logoUrl, brandName }) {
  const safeBrand = escapeHtml(brandName || 'PicoTrack');
  const safeSubject = escapeHtml(subject || 'Notification');
  const content = html || textToHtml(text || '');
  const logo = logoUrl ? `
    <div style="text-align:center;padding:24px 24px 10px">
      <img src="${escapeHtml(logoUrl)}" alt="${safeBrand}" style="max-width:180px;max-height:72px;display:inline-block;object-fit:contain;border:0;outline:none;text-decoration:none">
    </div>` : '';

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.08)">
            <tr><td>${logo}</td></tr>
            <tr>
              <td style="padding:10px 32px 26px">
                <h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;color:#020617">${safeSubject}</h1>
                <div style="font-size:14px;line-height:1.65;color:#334155">${content}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">
                Email automatique envoyé par <strong>${safeBrand}</strong>. Merci de ne pas répondre directement à ce message.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function allowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  const host = String(req.headers.host || '');
  if (!origin) return '*';
  try {
    const url = new URL(origin);
    if (url.hostname === host || url.hostname === 'picotrack.fr' || url.hostname.endsWith('.picotrack.fr') || url.hostname.endsWith('.vercel.app')) return origin;
  } catch (_) {}
  return 'https://picotrack.fr';
}

function pick(...names){for(const name of names){const value=process.env[name];if(value!==undefined&&String(value).trim()!=='')return String(value).trim()}return''}
function base64UrlDecode(input){try{const normalized=String(input||'').replace(/-/g,'+').replace(/_/g,'/');const padded=normalized+'='.repeat((4-normalized.length%4)%4);return Buffer.from(padded,'base64').toString('utf8')}catch(_){return''}}
function deriveSupabaseUrlFromAnonKey(anonKey){try{const parts=String(anonKey||'').split('.');if(parts.length<2)return'';const payload=JSON.parse(base64UrlDecode(parts[1])||'{}');const issuer=String(payload.iss||'');const match=issuer.match(/^(https:\/\/[^/]+\.supabase\.co)(?:\/auth\/v1)?/i);return match?match[1].replace(/\/+$/,''):''}catch(_){return''}}
function normalizeSupabaseUrl(value){return String(value||'').trim().replace(/\/rest\/v1\/?$/,'').replace(/\/auth\/v1\/?$/,'').replace(/\/+$/,'')}
function bearerToken(req){const raw=String(req.headers.authorization||req.headers.Authorization||'');const m=raw.match(/^Bearer\s+(.+)$/i);return m?m[1].trim():''}
async function verifySupabaseUser(req){
  const token=bearerToken(req);
  if(!token) return {ok:false,status:401,error:'Connexion requise pour envoyer un mail'};
  const anonKey=pick('VITE_SUPABASE_ANON_KEY','SUPABASE_ANON_KEY','SUPABASE_ANON_PUBLIC_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const supabaseUrl=normalizeSupabaseUrl(pick('URL_SUPABASE_VITE','VITE_SUPABASE_URL','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','PICOTRACK_SUPABASE_URL')||deriveSupabaseUrlFromAnonKey(anonKey));
  if(!anonKey||!supabaseUrl) return {ok:false,status:500,error:'Configuration Supabase serveur manquante'};
  const r=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{apikey:anonKey,Authorization:`Bearer ${token}`}});
  if(!r.ok) return {ok:false,status:401,error:'Session invalide ou expirée'};
  const user=await r.json().catch(()=>null);
  if(!user||!user.id) return {ok:false,status:401,error:'Utilisateur non vérifié'};
  return {ok:true,user};
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'Méthode non autorisée' }); return; }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { sendJson(res, 500, { ok: false, error: 'RESEND_API_KEY manquante dans Vercel' }); return; }

  const auth = await verifySupabaseUser(req);
  if (!auth.ok) { sendJson(res, auth.status || 401, { ok: false, error: auth.error }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    const to = normalizeEmails(body.to);
    const cc = normalizeEmails(body.cc);
    const bcc = normalizeEmails(body.bcc);
    const replyTo = normalizeEmails(body.replyTo || body.reply_to);
    const subject = String(body.subject || '').trim();
    const text = String(body.text || body.body || '').trim();
    const attachments = normalizeAttachments(body.attachments);

    if (!to.length) { sendJson(res, 400, { ok: false, error: 'Destinataire manquant ou invalide' }); return; }
    if (!subject) { sendJson(res, 400, { ok: false, error: 'Sujet manquant' }); return; }
    if (!text && !body.html) { sendJson(res, 400, { ok: false, error: 'Contenu du mail manquant' }); return; }

    const baseUrl = originFromReq(req);
    const logoUrl = String(body.logoUrl || process.env.PICOTRACK_LOGO_URL || (baseUrl ? `${baseUrl}/logo-picotrack.png` : '')).trim();
    const brandName = String(body.brandName || process.env.PICOTRACK_BRAND_NAME || 'PicoTrack Nexus').trim();
    const contentHtml = body.html ? String(body.html) : textToHtml(text);

    const payload = {
      from: process.env.RESEND_FROM || DEFAULT_FROM,
      to,
      subject,
      html: brandTemplate({ subject, text, html: contentHtml, logoUrl, brandName })
    };

    if (text) payload.text = text;
    if (cc.length) payload.cc = cc;
    if (bcc.length) payload.bcc = bcc;
    if (replyTo.length) payload.reply_to = replyTo;
    if (attachments.length) payload.attachments = attachments;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      sendJson(res, response.status, { ok: false, error: result.message || result.error || 'Erreur Resend', details: result });
      return;
    }

    sendJson(res, 200, { ok: true, id: result.id, provider: 'resend' });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || 'Erreur serveur mail' });
  }
};
