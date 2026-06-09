
import { getSupabaseEnv, readJson, send, b64decode } from './_supabase-env.js';
const ALLOWED_METHODS = new Set(['GET','POST','PATCH','DELETE']);
export default async function handler(req,res){
  if(req.method !== 'POST') return send(res,405,{error:'Method not allowed'});
  try{
    const { url, anon } = getSupabaseEnv();
    const input = await readJson(req);
    const path = b64decode(input.p || '');
    if(!path || path.includes('://') || path.startsWith('/')) return send(res,400,{error:'Requête invalide'});
    const method = String(input.method || 'GET').toUpperCase();
    if(!ALLOWED_METHODS.has(method)) return send(res,400,{error:'Méthode refusée'});
    const token = input.token || anon;
    const r = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers:{
        apikey: anon,
        Authorization: `Bearer ${token}`,
        'Content-Type':'application/json',
        Prefer: input.prefer !== undefined ? String(input.prefer) : 'return=representation'
      },
      body: method === 'GET' ? undefined : input.body
    });
    const text = await r.text();
    let data=null; try{data=text?JSON.parse(text):[];}catch{data=text;}
    if(!r.ok) return send(res,r.status,{error: typeof data==='string'?data:(data?.message||data?.error||'Erreur Supabase')});
    return send(res,200,{data});
  }catch(e){ return send(res,500,{error:e.message||'Erreur serveur'}); }
}
