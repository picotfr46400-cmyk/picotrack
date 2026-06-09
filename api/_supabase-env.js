
export function getSupabaseEnv(){
  const url=(process.env.URL_SUPABASE_VITE||process.env.VITE_SUPABASE_URL||process.env.SUPABASE_URL||'').replace(/\/rest\/v1\/?$/,'').replace(/\/+$/,'');
  const anon=process.env.VITE_SUPABASE_ANON_KEY||process.env.SUPABASE_ANON_KEY||process.env.URL_SUPABASE_ANON_KEY||'';
  if(!url||!anon) throw new Error('Configuration Supabase serveur manquante');
  return { url, anon };
}
export async function readJson(req){
  return await new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>5_000_000)reject(new Error('Payload trop volumineux'));});req.on('end',()=>{try{resolve(b?JSON.parse(b):{});}catch(e){reject(e);}});});
}
export function send(res,status,obj){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(obj));}
export function b64decode(v){try{return decodeURIComponent(escape(Buffer.from(String(v||''),'base64').toString('binary')));}catch{return Buffer.from(String(v||''),'base64').toString('utf8');}}
