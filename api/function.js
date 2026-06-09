const { getSupabaseConfig, json } = require('./_server-supabase');
module.exports=async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed'});
  const {url,anonKey,serviceRole}=getSupabaseConfig();
  if(!url||!anonKey) return json(res,500,{error:'Configuration Supabase serveur manquante'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const fn=String(body.functionName||'').replace(/[^a-zA-Z0-9_-]/g,'');
    if(!fn) return json(res,400,{error:'Fonction invalide'});
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    const key=serviceRole||anonKey;
    const upstream=await fetch(`${url}/functions/v1/${fn}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token || key}`,'Content-Type':'application/json'},body:JSON.stringify(body.payload||{})});
    const text=await upstream.text();
    res.statusCode=upstream.status; res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json; charset=utf-8'); res.setHeader('Cache-Control','no-store'); res.end(text);
  }catch(e){ json(res,500,{error:e.message||'Erreur fonction'}); }
};
