
import { getSupabaseEnv, readJson, send, b64decode } from './_supabase-env.js';
export default async function handler(req,res){
  if(req.method !== 'POST') return send(res,405,{error:'Method not allowed'});
  try{
    const { url, anon } = getSupabaseEnv();
    const input = await readJson(req);
    const name = b64decode(input.f || '');
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(name)) return send(res,400,{error:'Fonction invalide'});
    const token = input.token || anon;
    const r = await fetch(`${url}/functions/v1/${name}`, {method:'POST',headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input.payload||{})});
    const text=await r.text(); let data=null; try{data=text?JSON.parse(text):null;}catch{data={message:text};}
    if(!r.ok) return send(res,r.status,{error:data?.error||data?.message||'Erreur fonction'});
    return send(res,200,data||{});
  }catch(e){return send(res,500,{error:e.message||'Erreur serveur'});}
}
