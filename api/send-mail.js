// PicoTrack — API Vercel d'envoi d'e-mails via Resend
// Sécurité V2 : endpoint authentifié, aucune clé Resend côté navigateur.
const { json, setCors, getAuthUser, readJsonBody } = require('./_server-supabase');
const DEFAULT_FROM = 'PicoTrack <notifications@noreply.picotrack.fr>';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
function normalizeEmails(value){const arr=Array.isArray(value)?value:String(value||'').split(/[;,]/);return [...new Set(arr.map(v=>String(v||'').trim()).filter(v=>EMAIL_RE.test(v)))]}
function normalizeAttachments(value){if(!Array.isArray(value))return[];return value.slice(0,5).map(a=>{if(!a||typeof a!=='object')return null;const filename=String(a.filename||a.name||'document.pdf').replace(/[\\/\0]/g,'_').slice(0,160);const content=String(a.content||a.base64||'');if(!content||content.length>8_000_000)return null;return {filename,content};}).filter(Boolean)}
function originFromReq(req){const proto=req.headers['x-forwarded-proto']||'https';const host=req.headers.host;return host?`${proto}://${host}`:''}
function textToHtml(text){return escapeHtml(text).replace(/\r?\n/g,'<br>')}
function brandTemplate({subject,html,logoUrl,brandName}){const safeSubject=escapeHtml(subject);const safeBrand=escapeHtml(brandName||'PicoTrack Nexus');const logo=logoUrl?`<div style="padding:28px 32px 12px;text-align:left"><img src="${escapeHtml(logoUrl)}" alt="${safeBrand}" style="max-width:180px;height:auto;border:0;outline:none;text-decoration:none"></div>`:'';return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeSubject}</title></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.08)"><tr><td>${logo}</td></tr><tr><td style="padding:10px 32px 26px"><h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;color:#020617">${safeSubject}</h1><div style="font-size:14px;line-height:1.65;color:#334155">${html}</div></td></tr><tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">Email automatique envoyé par <strong>${safeBrand}</strong>. Merci de ne pas répondre directement à ce message.</td></tr></table></td></tr></table></body></html>`}
module.exports=async function handler(req,res){
  setCors(req,res);
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}
  if(req.method==='GET')return json(res,200,{ok:true,status:'send-mail endpoint ready'});
  if(req.method!=='POST')return json(res,405,{ok:false,error:'Méthode non autorisée'});
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey)return json(res,500,{ok:false,error:'RESEND_API_KEY manquante dans Vercel'});
  try{
    const user = await getAuthUser(req);
    if (!user?.id) return json(res,401,{ok:false,error:'Authentification requise'});
    const body=await readJsonBody(req,9_000_000);
    const to=normalizeEmails(body.to), cc=normalizeEmails(body.cc), bcc=normalizeEmails(body.bcc), replyTo=normalizeEmails(body.replyTo||body.reply_to);
    const subject=String(body.subject||'').trim().slice(0,200);
    const text=String(body.text||body.body||'').trim();
    const html=body.html?String(body.html):textToHtml(text);
    const attachments=normalizeAttachments(body.attachments);
    if(!to.length)return json(res,400,{ok:false,error:'Destinataire manquant ou invalide'});
    if(!subject)return json(res,400,{ok:false,error:'Sujet manquant'});
    if(!text&&!body.html)return json(res,400,{ok:false,error:'Contenu du mail manquant'});
    const baseUrl=originFromReq(req);
    const logoUrl=String(body.logoUrl||process.env.PICOTRACK_LOGO_URL||(baseUrl?`${baseUrl}/logo-picotrack.png`:''));
    const brandName=String(body.brandName||process.env.PICOTRACK_BRAND_NAME||'PicoTrack Nexus').trim();
    const payload={from:process.env.RESEND_FROM||DEFAULT_FROM,to,subject,html:brandTemplate({subject,html,logoUrl,brandName})};
    if(text)payload.text=text;if(cc.length)payload.cc=cc;if(bcc.length)payload.bcc=bcc;if(replyTo.length)payload.reply_to=replyTo;if(attachments.length)payload.attachments=attachments;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)return json(res,response.status,{ok:false,error:result.message||result.error||'Erreur Resend',details:result});
    return json(res,200,{ok:true,id:result.id,provider:'resend'});
  }catch(err){return json(res,err.status||500,{ok:false,error:err.message||'Erreur serveur mail'});}
};
