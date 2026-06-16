function pick(...names){for(const name of names){const value=process.env[name];if(value!==undefined&&String(value).trim()!=='')return String(value).trim()}return''}
function base64UrlDecode(input){try{const normalized=String(input||'').replace(/-/g,'+').replace(/_/g,'/');const padded=normalized+'='.repeat((4-normalized.length%4)%4);return Buffer.from(padded,'base64').toString('utf8')}catch(_){return''}}
function deriveSupabaseUrlFromAnonKey(anonKey){try{const parts=String(anonKey||'').split('.');if(parts.length<2)return'';const payload=JSON.parse(base64UrlDecode(parts[1])||'{}');const issuer=String(payload.iss||'');const match=issuer.match(/^(https:\/\/[^/]+\.supabase\.co)(?:\/auth\/v1)?/i);return match?match[1].replace(/\/+$/,''):''}catch(_){return''}}
function normalizeSupabaseUrl(value){return String(value||'').trim().replace(/\/rest\/v1\/?$/,'').replace(/\/auth\/v1\/?$/,'').replace(/\/+$/,'')}
function getSupabaseConfig(){
  const anonKey=pick('VITE_SUPABASE_ANON_KEY','SUPABASE_ANON_KEY','SUPABASE_ANON_PUBLIC_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRole=pick('SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_KEY','SERVICE_ROLE_KEY','SUPABASE_SERVICE_ROLE');
  const url=normalizeSupabaseUrl(pick('URL_SUPABASE_VITE','VITE_SUPABASE_URL','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','PICOTRACK_SUPABASE_URL')||deriveSupabaseUrlFromAnonKey(anonKey));
  return { url, anonKey, serviceRole };
}
const SECURITY_HEADERS={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Strict-Transport-Security':'max-age=63072000; includeSubDomains; preload'
};
function applySecurityHeaders(res){for(const [key,value] of Object.entries(SECURITY_HEADERS))res.setHeader(key,value);}
function json(res,status,payload){applySecurityHeaders(res);res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(payload));}
function decodeQ(q){try{return Buffer.from(String(q||''),'base64').toString('utf8')}catch(_){return''}}
function allowedOrigin(req){const origin=String(req.headers.origin||'');const host=String(req.headers.host||'').toLowerCase();if(!origin)return '*';try{const u=new URL(origin);const h=u.hostname.toLowerCase();if(h===host||h==='picotrack.fr'||h.endsWith('.picotrack.fr')||h.endsWith('.vercel.app'))return origin;}catch(_){}return 'https://picotrack.fr'}
function setCors(req,res,methods='POST, OPTIONS'){applySecurityHeaders(res);res.setHeader('Access-Control-Allow-Origin',allowedOrigin(req));res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods',methods);res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');}
function bearer(req){return String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim()}
async function readJsonBody(req,limit=1000000){if(req.body&&typeof req.body==='object')return req.body;if(typeof req.body==='string'){try{return JSON.parse(req.body||'{}')}catch{return{}}}return await new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>limit)reject(Object.assign(new Error('Payload trop volumineux'),{status:413}))});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch{resolve({})}});req.on('error',reject)})}
async function getAuthUser(req){const {url,anonKey}=getSupabaseConfig();const token=bearer(req);if(!url||!anonKey||!token)return null;const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:anonKey,Authorization:`Bearer ${token}`}});if(!r.ok)return null;return await r.json().catch(()=>null)}
async function requireAuth(req){const user=await getAuthUser(req);if(!user?.id){const err=new Error('Authentification requise');err.status=401;throw err;}return user}
async function serviceRest(path,{method='GET',body,prefer='return=representation'}={}){const {url,serviceRole}=getSupabaseConfig();if(!url||!serviceRole)throw Object.assign(new Error('Configuration service Supabase manquante'),{status:500});const r=await fetch(`${url}/rest/v1/${path}`,{method,headers:{apikey:serviceRole,Authorization:`Bearer ${serviceRole}`,'Content-Type':'application/json',Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let payload=null;try{payload=text?JSON.parse(text):null}catch{payload={message:text}};if(!r.ok){const err=new Error(payload?.message||payload?.error||text||`Supabase ${r.status}`);err.status=r.status;err.payload=payload;throw err;}return payload||[]}
async function getUserProfile(userId){const rows=await serviceRest(`user_profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,role,roles,environment_code,active,license_type&limit=1`,{method:'GET',prefer:''});return Array.isArray(rows)?rows[0]:null}
function isAdminProfile(profile){const role=String(profile?.role||'').toLowerCase();const roles=Array.isArray(profile?.roles)?profile.roles.map(r=>String(r).toLowerCase()):[];return profile?.active!==false&&(role==='super_admin'||role==='admin'||roles.includes('super_admin')||roles.includes('admin'))}
async function requireAdmin(req){const user=await requireAuth(req);const profile=await getUserProfile(user.id);if(!isAdminProfile(profile)){const err=new Error('Droits administrateur requis');err.status=403;throw err;}return {user,profile}}
module.exports={getSupabaseConfig,json,decodeQ,setCors,bearer,readJsonBody,getAuthUser,requireAuth,requireAdmin,serviceRest,getUserProfile,isAdminProfile,applySecurityHeaders};
