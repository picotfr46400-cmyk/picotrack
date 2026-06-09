
import { getSupabaseEnv, readJson, send } from './_supabase-env.js';
function normalizeSession(data){
  if(!data) return null;
  return { access_token:data.access_token, refresh_token:data.refresh_token, expires_in:data.expires_in, expires_at:data.expires_at || (Math.floor(Date.now()/1000)+(data.expires_in||3600)), token_type:data.token_type, user:data.user };
}
async function supaAuth(path, opts={}){
  const { url, anon } = getSupabaseEnv();
  const r=await fetch(`${url}/auth/v1/${path}`,{...opts,headers:{apikey:anon,'Content-Type':'application/json',...(opts.headers||{})}});
  const text=await r.text(); let data=null; try{data=text?JSON.parse(text):null;}catch{data={message:text};}
  if(!r.ok) throw new Error(data?.error_description||data?.msg||data?.message||'Erreur auth');
  return data;
}
export default async function handler(req,res){
  if(req.method !== 'POST') return send(res,405,{error:'Method not allowed'});
  try{
    const input=await readJson(req);
    const action=String(input.action||'');
    if(action==='signIn'){
      const data=await supaAuth('token?grant_type=password',{method:'POST',body:JSON.stringify({email:input.email,password:input.password})});
      return send(res,200,{session:normalizeSession(data)});
    }
    if(action==='refresh'){
      const data=await supaAuth('token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:input.refresh_token})});
      return send(res,200,{session:normalizeSession(data)});
    }
    if(action==='signOut'){
      await supaAuth('logout',{method:'POST',headers:{Authorization:`Bearer ${input.token||''}`},body:'{}'}).catch(()=>null);
      return send(res,200,{ok:true});
    }
    if(action==='updateUser'){
      const data=await supaAuth('user',{method:'PUT',headers:{Authorization:`Bearer ${input.token||''}`},body:JSON.stringify({password:input.password})});
      return send(res,200,{user:data});
    }
    if(action==='exchangeCode'){
      return send(res,400,{error:'Lien invitation à finaliser via Supabase Auth côté serveur dédié'});
    }
    return send(res,400,{error:'Action auth invalide'});
  }catch(e){ return send(res,400,{error:e.message||'Erreur auth'}); }
}
