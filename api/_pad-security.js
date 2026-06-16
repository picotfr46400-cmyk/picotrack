const crypto = require('crypto');

function pick(...names){for(const name of names){const value=process.env[name];if(value!==undefined&&String(value).trim()!=='')return String(value).trim()}return''}
function base64UrlDecode(input){try{const normalized=String(input||'').replace(/-/g,'+').replace(/_/g,'/');const padded=normalized+'='.repeat((4-normalized.length%4)%4);return Buffer.from(padded,'base64').toString('utf8')}catch(_){return''}}
function deriveSupabaseUrlFromAnonKey(anonKey){try{const parts=String(anonKey||'').split('.');if(parts.length<2)return'';const payload=JSON.parse(base64UrlDecode(parts[1])||'{}');const issuer=String(payload.iss||'');const match=issuer.match(/^(https:\/\/[^/]+\.supabase\.co)(?:\/auth\/v1)?/i);return match?match[1].replace(/\/+$/,''):''}catch(_){return''}}
function normalizeSupabaseUrl(value){return String(value||'').trim().replace(/\/rest\/v1\/?$/,'').replace(/\/auth\/v1\/?$/,'').replace(/\/+$/,'')}
function supabaseConfig(){
  const anonKey=pick('VITE_SUPABASE_ANON_KEY','SUPABASE_ANON_KEY','SUPABASE_ANON_PUBLIC_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey=pick('SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_KEY','SERVICE_ROLE_KEY','SUPABASE_SERVICE_ROLE');
  const url=normalizeSupabaseUrl(pick('URL_SUPABASE_VITE','VITE_SUPABASE_URL','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','PICOTRACK_SUPABASE_URL')||deriveSupabaseUrlFromAnonKey(anonKey));
  if(!url||!serviceKey) throw new Error('Configuration serveur Supabase manquante');
  return {url,serviceKey};
}
const SECURITY_HEADERS={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Strict-Transport-Security':'max-age=63072000; includeSubDomains; preload'
};
function applySecurityHeaders(res){for(const [key,value] of Object.entries(SECURITY_HEADERS))res.setHeader(key,value);}
function sendJson(res,status,payload){applySecurityHeaders(res);res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(payload));}
function allowedOrigin(req){const origin=String(req.headers.origin||'');const host=String(req.headers.host||'');if(!origin)return'*';try{const url=new URL(origin);if(url.hostname===host||url.hostname==='picotrack.fr'||url.hostname.endsWith('.picotrack.fr')||url.hostname.endsWith('.vercel.app'))return origin;}catch(_){}return'https://picotrack.fr'}
function setCors(req,res){applySecurityHeaders(res);res.setHeader('Access-Control-Allow-Origin',allowedOrigin(req));res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');}
function safeCode(v){return String(v||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,64)}
function safeLogin(v){return String(v||'').trim().slice(0,160)}
function safeHash(v){return String(v||'').trim().slice(0,160)}
function tokenSecret(){return pick('PAD_SESSION_SECRET','PICOTRACK_PAD_SESSION_SECRET','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_KEY','SERVICE_ROLE_KEY','SUPABASE_SERVICE_ROLE')}
function b64url(buf){return Buffer.from(buf).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
function signPayload(payload){const secret=tokenSecret();if(!secret)throw new Error('Secret session PAD manquant');const body=b64url(JSON.stringify(payload));const sig=b64url(crypto.createHmac('sha256',secret).update(body).digest());return `${body}.${sig}`}
function verifyToken(token){const secret=tokenSecret();const [body,sig]=String(token||'').split('.');if(!secret||!body||!sig)throw new Error('Session PAD invalide');const expected=b64url(crypto.createHmac('sha256',secret).update(body).digest());const a=Buffer.from(sig);const b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw new Error('Session PAD invalide');const payload=JSON.parse(Buffer.from(body.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));if(!payload.exp||Date.now()>payload.exp)throw new Error('Session PAD expirée');return payload}
async function sbRest(path,{method='GET',body,prefer='return=representation'}={}){const {url,serviceKey}=supabaseConfig();const r=await fetch(`${url}/rest/v1/${path}`,{method,headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json',Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let json=null;try{json=text?JSON.parse(text):null}catch{json={raw:text}};if(!r.ok)throw new Error(`Supabase ${r.status}: ${text}`);return json||[]}
module.exports={sendJson,setCors,safeCode,safeLogin,safeHash,signPayload,verifyToken,sbRest,applySecurityHeaders};
