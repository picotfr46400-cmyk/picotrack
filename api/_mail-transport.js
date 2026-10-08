'use strict';

const crypto = require('crypto');
const DEFAULT_FROM = 'PicoTrack <notifications@noreply.picotrack.fr>';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeEmailHtml(input) {
  let html = String(input || '');
  html = html.replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|iframe|object|embed|link|meta|base|form)\b[^>]*\/?\s*>/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  html = html.replace(/(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '$1=$2#$2');
  html = html.replace(/(href|src)\s*=\s*(['"])\s*data:(?!image\/)[\s\S]*?\2/gi, '$1=$2#$2');
  return html;
}

function normalizeEmails(value) {
  const arr = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  return [...new Set(arr.map(v => String(v || '').trim()).filter(v => EMAIL_RE.test(v)))];
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map(a => {
    if (!a || typeof a !== 'object') return null;
    const filename = String(a.filename || a.name || 'document.pdf').replace(/[\\/\0]/g, '_').slice(0, 160);
    const content = String(a.content || a.base64 || '');
    if (!content || content.length > 8_000_000) return null;
    return { filename, content };
  }).filter(Boolean);
}

const FALLBACK_ORIGIN = 'https://picotrack.fr';

function allowedAppOrigin(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (_) {
    return '';
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return '';
  if (url.pathname && url.pathname !== '/') return '';
  const host = url.hostname.toLowerCase();
  const pico = host === 'picotrack.fr' || host.endsWith('.picotrack.fr');
  const preview = host.endsWith('.vercel.app') && host.startsWith('picotrack');
  if (!pico && !preview) return '';
  return `https://${host}`;
}

function originFromReq() {
  return allowedAppOrigin(process.env.APP_ORIGIN) || FALLBACK_ORIGIN;
}

function textToHtml(text) {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

function brandTemplate({ subject, html, logoUrl, brandName }) {
  const safeSubject = escapeHtml(subject);
  const safeBrand = escapeHtml(brandName || 'PicoTrack Nexus');
  const logo = logoUrl
    ? `<div style="padding:28px 32px 12px;text-align:left"><img src="${escapeHtml(logoUrl)}" alt="${safeBrand}" style="max-width:180px;height:auto;border:0;outline:none;text-decoration:none"></div>`
    : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeSubject}</title></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.08)"><tr><td>${logo}</td></tr><tr><td style="padding:10px 32px 26px"><h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;color:#020617">${safeSubject}</h1><div style="font-size:14px;line-height:1.65;color:#334155">${html}</div></td></tr><tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">Email automatique envoyé par <strong>${safeBrand}</strong>. Merci de ne pas répondre directement à ce message.</td></tr></table></td></tr></table></body></html>`;
}

function smtpConfigured(env = process.env) {
  return !!(String(env.SMTP_HOST || '').trim() && String(env.SMTP_FROM || '').trim());
}

function chooseTransport(env = process.env) {
  const forced = String(env.MAIL_TRANSPORT || '').trim().toLowerCase();
  if (forced === 'smtp' || forced === 'resend') return forced;
  if (smtpConfigured(env)) return 'smtp';
  return 'resend';
}

function smtpTransportOptions(env = process.env) {
  const port = Number(env.SMTP_PORT || 587);
  const safePort = Number.isFinite(port) && port > 0 ? port : 587;
  const secure = safePort === 465;
  const user = String(env.SMTP_USER || '').trim();
  return {
    host: String(env.SMTP_HOST || '').trim(),
    port: safePort,
    secure,
    requireTLS: safePort === 587,
    auth: user ? { user, pass: String(env.SMTP_PASS || '') } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000
  };
}

function smtpMessageId(outboxId) {
  const key = String(outboxId || '').trim();
  if (!key) return '';
  const digest = crypto.createHash('sha256').update(key).digest('hex');
  return `<${digest}@picotrack.local>`;
}

function resendHeaders(message, env = process.env) {
  const headers = {
    Authorization: `Bearer ${env.RESEND_API_KEY || ''}`,
    'Content-Type': 'application/json'
  };
  const key = String(message && message.idempotencyKey || '').trim();
  if (key) headers['Idempotency-Key'] = key.slice(0, 256);
  return headers;
}

async function sendResend(message, env = process.env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    const err = new Error('RESEND_API_KEY manquante dans Vercel');
    err.status = 500;
    throw err;
  }
  const payload = {
    from: env.RESEND_FROM || message.from || DEFAULT_FROM,
    to: message.to,
    subject: message.subject,
    html: message.html
  };
  if (message.text) payload.text = message.text;
  if (message.cc && message.cc.length) payload.cc = message.cc;
  if (message.bcc && message.bcc.length) payload.bcc = message.bcc;
  if (message.replyTo && message.replyTo.length) payload.reply_to = message.replyTo;
  if (message.attachments && message.attachments.length) payload.attachments = message.attachments;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: resendHeaders(message, env),
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(result.message || result.error || 'Erreur Resend');
    err.status = response.status;
    err.details = result;
    throw err;
  }
  return { id: result.id, provider: 'resend' };
}

async function sendSmtp(message, env = process.env) {
  if (!smtpConfigured(env)) {
    const err = new Error('Configuration SMTP incomplète');
    err.status = 500;
    throw err;
  }
  const nodemailer = require('nodemailer');
  const options = smtpTransportOptions(env);
  const transporter = nodemailer.createTransport(options);
  const messageId = smtpMessageId(message && message.outboxId);
  const info = await transporter.sendMail({
    from: env.SMTP_FROM,
    messageId: messageId || undefined,
    to: message.to,
    cc: message.cc && message.cc.length ? message.cc : undefined,
    bcc: message.bcc && message.bcc.length ? message.bcc : undefined,
    replyTo: message.replyTo && message.replyTo.length ? message.replyTo : undefined,
    subject: message.subject,
    html: message.html,
    text: message.text || undefined,
    attachments: (message.attachments || []).map(item => ({
      filename: item.filename,
      content: Buffer.from(String(item.content || ''), 'base64')
    }))
  });
  return { id: info && info.messageId, provider: 'smtp' };
}

async function deliverMail(message, env = process.env) {
  const transport = chooseTransport(env);
  if (transport === 'smtp') return sendSmtp(message, env);
  return sendResend(message, env);
}

module.exports = {
  DEFAULT_FROM,
  EMAIL_RE,
  escapeHtml,
  sanitizeEmailHtml,
  normalizeEmails,
  normalizeAttachments,
  originFromReq,
  textToHtml,
  brandTemplate,
  smtpConfigured,
  chooseTransport,
  smtpTransportOptions,
  smtpMessageId,
  resendHeaders,
  deliverMail
};
