const { getSupabaseConfig, json } = require('./_server-supabase');
module.exports=async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed'});
  const {url,anonKey}=getSupabaseConfig();
  if(!url||!anonKey) return json(res,500,{error:'Configuration Supabase serveur manquante'});
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    if(body.action==='signIn'){
      const upstream=await fetch(`${url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:body.email,password:body.password})});
      const text=await upstream.text();
      let payload={}; try{payload=JSON.parse(text||'{}')}catch{payload={message:text}}
      if(!upstream.ok) return json(res,upstream.status,{error:payload.error_description||payload.msg||payload.error||payload.message||'Connexion refusée'});
      return json(res,200,{session:payload});
    }
    if(body.action==='signOut') return json(res,200,{ok:true});
    return json(res,400,{error:'Action invalide'});
  }catch(e){ json(res,500,{error:e.message||'Erreur auth'}); }
};
