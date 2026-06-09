const { getSupabaseConfig, json, decodeQ } = require('./_server-supabase');
module.exports=async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed'});
  const {url,anonKey,serviceRole}=getSupabaseConfig();
  if(!url||!anonKey) return json(res,500,{error:'Configuration Supabase serveur manquante'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const path=decodeQ(body.q);
    if(!path || path.includes('..') || /^https?:/i.test(path)) return json(res,400,{error:'Requête invalide'});
    const method=String(body.method||'GET').toUpperCase();
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    const key=serviceRole||anonKey;
    const headers={
      apikey:key,
      Authorization:`Bearer ${token || key}`,
      'Content-Type':'application/json',
      Prefer: body.prefer!==undefined ? String(body.prefer) : 'return=representation',
      ...(body.headers||{})
    };
    delete headers.host; delete headers.origin; delete headers.referer;
    const upstream=await fetch(`${url}/rest/v1/${path}`,{method,headers,body:body.body||undefined});
    const text=await upstream.text();
    res.statusCode=upstream.status;
    res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.end(text);
  }catch(e){ json(res,500,{error:e.message||'Erreur proxy'}); }
};
