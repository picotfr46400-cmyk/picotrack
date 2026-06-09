// PicoTrack — Helper front d'envoi d'e-mails
// Appelle uniquement l'API backend /api/send-mail. Aucune clé Resend côté navigateur.
(function(){
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function arr(value){
    const base = Array.isArray(value) ? value : String(value||'').split(/[;,]/);
    return [...new Set(base.map(x=>String(x||'').trim()).filter(x=>EMAIL_RE.test(x)))];
  }

  function esc(v){
    return String(v ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }

  function htmlFromText(text){
    return esc(text).replace(/\n/g,'<br>');
  }

  window.ptSendMail = async function ptSendMail(mail){
    const payload = {
      to: arr(mail.to),
      cc: arr(mail.cc),
      bcc: arr(mail.bcc),
      replyTo: arr(mail.replyTo || mail.reply_to),
      subject: String(mail.subject || '').trim(),
      text: String(mail.text || mail.body || '').trim(),
      html: mail.html || htmlFromText(mail.text || mail.body || ''),
      logoUrl: mail.logoUrl || '',
      brandName: mail.brandName || 'PicoTrack Nexus',
      attachments: Array.isArray(mail.attachments) ? mail.attachments.filter(Boolean) : []
    };

    if(!payload.to.length) throw new Error('Destinataire manquant ou invalide');
    if(!payload.subject) throw new Error('Sujet manquant');
    if(!payload.text && !payload.html) throw new Error('Contenu du mail manquant');

    // Ne jamais envoyer de champs facultatifs vides à Resend.
    if(!payload.cc.length) delete payload.cc;
    if(!payload.bcc.length) delete payload.bcc;
    if(!payload.replyTo.length) delete payload.replyTo;
    if(!payload.logoUrl) delete payload.logoUrl;
    if(!payload.attachments.length) delete payload.attachments;

    const res = await fetch('/api/send-mail', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    const json = await res.json().catch(()=>({}));
    if(!res.ok || json.ok === false){
      throw new Error(json.error || 'Erreur envoi mail');
    }
    return json;
  };
})();
