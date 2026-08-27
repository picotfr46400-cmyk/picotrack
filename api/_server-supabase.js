function pick(...names){for(const name of names){const value=process.env[name];if(value!==undefined&&String(value).trim()!=='')return String(value).trim()}return''}
function base64UrlDecode(input){try{const normalized=String(input||'').replace(/-/g,'+').replace(/_/g,'/');const padded=normalized+'='.repeat((4-normalized.length%4)%4);return Buffer.from(padded,'base64').toString('utf8')}catch(_){return''}}
function deriveSupabaseUrlFromAnonKey(anonKey){try{const parts=String(anonKey||'').split('.');if(parts.length<2)return'';const payload=JSON.parse(base64UrlDecode(parts[1])||'{}');const issuer=String(payload.iss||'');const match=issuer.match(/^(https:\/\/[^/]+\.supabase\.co)(?:\/auth\/v1)?/i);return match?match[1].replace(/\/+$/,''):''}catch(_){return''}}
function normalizeSupabaseUrl(value){return String(value||'').trim().replace(/\/rest\/v1\/?$/,'').replace(/\/auth\/v1\/?$/,'').replace(/\/+$/,'')}
function cleanHost(value){return String(value||'').toLowerCase().replace(/^https?:\/\//,'').replace(/:\d+$/,'').replace(/\/+$/,'').trim()}
function requestHost(req){return cleanHost(req?.headers?.['x-forwarded-host']||req?.headers?.host||process.env.VERCEL_URL||'')}
function parseConfigJson(){const raw=pick('PICOTRACK_CONFIG_JSON','PICOTRACK_CLIENTS_JSON','PICOTRACK_SUPABASE_CONFIG_JSON');if(!raw)return null;try{return JSON.parse(raw)}catch(e){return null}}
function normalizeConfigEntry(entry, host){if(!entry||typeof entry!=='object')return null;const anonKey=String(entry.supabaseAnonKey||entry.anonKey||entry.anon_key||entry.SUPABASE_ANON_KEY||'').trim();const serviceRole=String(entry.supabaseServiceRoleKey||entry.serviceRoleKey||entry.serviceRole||entry.service_role_key||entry.SUPABASE_SERVICE_ROLE_KEY||'').trim();const url=normalizeSupabaseUrl(entry.supabaseUrl||entry.url||entry.SUPABASE_URL||deriveSupabaseUrlFromAnonKey(anonKey));return {host,clientCode:String(entry.clientCode||entry.client||entry.code||'').trim(),environmentCode:String(entry.environmentCode||entry.environment||entry.env||'').trim(),url,anonKey,serviceRole}}
function jsonHostMatches(pattern, host){
  const h=cleanHost(host);
  const p=cleanHost(pattern);
  if(!p||!h)return false;
  if(p===h)return true;
  if(!p.startsWith('*.'))return false;
  const suffix=p.slice(1);
  if(!suffix||!h.endsWith(suffix))return false;
  const label=h.slice(0, Math.max(0, h.length-suffix.length));
  if(!label||label.includes('.'))return false;
  if(isReservedSubdomain(label))return false;
  if(h==='picotrack.fr'||h==='www.picotrack.fr')return false;
  return true;
}
function matchConfigFromJson(host){const cfg=parseConfigJson();if(!cfg)return null;const h=cleanHost(host);const candidates=[h,h.replace(/^www\./,'')].filter(Boolean);
  if(Array.isArray(cfg)){for(const entry of cfg){const hosts=[entry?.host,entry?.domain,entry?.hostname,...(Array.isArray(entry?.hosts)?entry.hosts:[])].map(cleanHost).filter(Boolean);if(hosts.some(x=>candidates.includes(x)||jsonHostMatches(x,h)))return normalizeConfigEntry(entry,h)}}
  if(typeof cfg==='object'){
    for(const key of candidates){if(cfg[key])return normalizeConfigEntry(cfg[key],h)}
    for(const [key,entry] of Object.entries(cfg)){if(jsonHostMatches(key,h))return normalizeConfigEntry(entry,h)}
  }
  return null
}
function sanitizeClientCode(value){
  const code=String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return code||'PROD';
}
function firstLabel(host){return cleanHost(host).split('.')[0]||''}
function isReservedSubdomain(label){return ['','www','app','api','assets','static','cdn','admin','main','prod','production'].includes(String(label||'').toLowerCase())}
function prefixForHost(host){
  const h=cleanHost(host);
  if(!h)return 'PROD';
  if(h==='localhost'||h.startsWith('localhost.')||h.startsWith('127.0.0.1')||h.startsWith('0.0.0.0'))return 'DEMO';
  if(h==='picotrack.fr'||h==='www.picotrack.fr')return 'PROD';
  if(h.endsWith('.picotrack.fr')){
    const label=firstLabel(h);
    if(label==='demo'||label==='sandbox')return 'DEMO';
    if(isReservedSubdomain(label))return 'PROD';
    return sanitizeClientCode(label);
  }
  if(h.endsWith('.vercel.app')){
    const label=firstLabel(h);
    if(label.includes('demo')||label.includes('sandbox'))return 'DEMO';
    const m=label.match(/^picotrack-([a-z0-9]+)(?:-|$)/i);
    if(m&&m[1]&&!isReservedSubdomain(m[1]))return sanitizeClientCode(m[1]);
    if(label.includes('prospect'))return 'PROSPECT';
    return 'PROD';
  }
  const label=firstLabel(h);
  if(label==='demo'||label==='sandbox')return 'DEMO';
  if(!isReservedSubdomain(label))return sanitizeClientCode(label);
  return 'PROD';
}
function isLocalDevHost(host){
  const h=cleanHost(host);
  return !h||h==='localhost'||h.startsWith('localhost.')||h.startsWith('127.0.0.1')||h.startsWith('0.0.0.0');
}
// Host-first tenant. PICOTRACK_ENVIRONMENT_CODE / PICOTRACK_CLIENT_CODE are local/missing-Host fallback only — never for apex, www, vercel.app, or unknown public hosts.
function resolveTenantFromHost(host){
  const environmentCode=prefixForHost(host);
  const fromHost={environmentCode,clientCode:environmentCode.toLowerCase()};
  if(!isLocalDevHost(host))return fromHost;
  const envCode=pick('PICOTRACK_ENVIRONMENT_CODE','PICOTRACK_ENVIRONNEMENT_CODE');
  const envClient=pick('PICOTRACK_CLIENT_CODE','CODE_CLIENT_PICOTRACK');
  return {environmentCode:envCode||fromHost.environmentCode,clientCode:String(envClient||fromHost.clientCode).toLowerCase()};
}
function withHostTenant(cfg,host){
  const tenant=resolveTenantFromHost(host);
  return Object.assign({},cfg||{},{host:cleanHost(host),clientCode:tenant.clientCode,environmentCode:tenant.environmentCode});
}
function configFromPrefixedEnv(host){const p=prefixForHost(host);const anonKey=pick(`${p}_SUPABASE_ANON_KEY`,`PICOTRACK_${p}_SUPABASE_ANON_KEY`,`${p}_VITE_SUPABASE_ANON_KEY`);const serviceRole=pick(`${p}_SUPABASE_SERVICE_ROLE_KEY`,`PICOTRACK_${p}_SUPABASE_SERVICE_ROLE_KEY`,`${p}_SERVICE_ROLE_KEY`);const url=normalizeSupabaseUrl(pick(`${p}_SUPABASE_URL`,`PICOTRACK_${p}_SUPABASE_URL`,`${p}_URL_SUPABASE_VITE`,`${p}_VITE_SUPABASE_URL`)||deriveSupabaseUrlFromAnonKey(anonKey));return withHostTenant({url,anonKey,serviceRole},host)}
function legacyRawKeys(){const anonKey=pick('VITE_SUPABASE_ANON_KEY','SUPABASE_ANON_KEY','SUPABASE_ANON_PUBLIC_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY');const serviceRole=pick('SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_KEY','SERVICE_ROLE_KEY','SUPABASE_SERVICE_ROLE');const url=normalizeSupabaseUrl(pick('URL_SUPABASE_VITE','VITE_SUPABASE_URL','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','PICOTRACK_SUPABASE_URL')||deriveSupabaseUrlFromAnonKey(anonKey));return {url,anonKey,serviceRole}}
function legacyConfig(host){return withHostTenant(legacyRawKeys(),host)}
function unconfiguredConfig(host){return withHostTenant({url:'',anonKey:'',serviceRole:''},host)}
const KNOWN_EFC_PROJECT_REF='jcanufkmcslxwmheqccp';
const MISSING_TENANT_DB='Aucune base Supabase dédiée pour ce domaine';
function isEfcCanonicalHost(host){return cleanHost(host)==='efc.picotrack.fr'}
function allowsLegacySupabaseFallback(host){
  const h=cleanHost(host);
  if(isEfcCanonicalHost(h))return true;
  return h==='localhost'||h.startsWith('localhost.')||h.startsWith('127.0.0.1')||h.startsWith('0.0.0.0');
}
function supabaseProjectRef(url,anonKey){
  const resolved=normalizeSupabaseUrl(url)||deriveSupabaseUrlFromAnonKey(anonKey);
  const fromUrl=String(resolved||'').match(/^https:\/\/([a-z0-9-]+)\.supabase\.co(?:\/|$)/i);
  if(fromUrl)return fromUrl[1].toLowerCase();
  try{
    const parts=String(anonKey||'').split('.');
    if(parts.length>=2){
      const payload=JSON.parse(base64UrlDecode(parts[1])||'{}');
      const ref=String(payload.ref||'').trim().toLowerCase();
      if(ref)return ref;
    }
  }catch(_){}
  return '';
}
function isEfcProjectConfig(cfg){
  const ref=supabaseProjectRef(cfg&&cfg.url,cfg&&cfg.anonKey);
  if(!ref)return false;
  if(ref===KNOWN_EFC_PROJECT_REF)return true;
  const legacyRef=supabaseProjectRef(legacyRawKeys().url,legacyRawKeys().anonKey);
  return !!legacyRef&&ref===legacyRef;
}
function hasSupabaseKeys(cfg){return !!(cfg&&(cfg.url||cfg.anonKey||cfg.serviceRole))}
function rejectEfcLeak(cfg,host){
  if(allowsLegacySupabaseFallback(host))return cfg;
  if(hasSupabaseKeys(cfg)&&isEfcProjectConfig(cfg))return unconfiguredConfig(host);
  return cfg;
}
function getSupabaseConfig(req){
  const host=requestHost(req);
  const fromJson=matchConfigFromJson(host);
  if(fromJson&&hasSupabaseKeys(fromJson))return rejectEfcLeak(withHostTenant(fromJson,host),host);
  const pref=configFromPrefixedEnv(host);
  if(hasSupabaseKeys(pref))return rejectEfcLeak(pref,host);
  if(allowsLegacySupabaseFallback(host))return legacyConfig(host);
  return unconfiguredConfig(host);
}
function missingTenantDbError(){return Object.assign(new Error(MISSING_TENANT_DB),{status:500,code:'SUPABASE_NOT_CONFIGURED'})}
function publicRuntimeConfig(req){
  const cfg=getSupabaseConfig(req);
  const tenant=resolveTenantFromHost(cfg.host);
  const configured=!!(cfg.url&&cfg.anonKey);
  const serviceConfigured=!!(cfg.url&&cfg.serviceRole);
  const out={host:cfg.host,clientCode:tenant.clientCode,environmentCode:String(tenant.environmentCode).toUpperCase(),configured,serviceConfigured};
  if(!configured)out.error=MISSING_TENANT_DB;
  return out;
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
function allowedOrigin(req){const origin=String(req.headers.origin||'');const host=requestHost(req);if(!origin)return '*';try{const u=new URL(origin);const h=u.hostname.toLowerCase();if(h===host||h==='picotrack.fr'||h.endsWith('.picotrack.fr')||h.endsWith('.vercel.app'))return origin;}catch(_){}return 'https://picotrack.fr'}
function setCors(req,res,methods='POST, OPTIONS'){applySecurityHeaders(res);res.setHeader('Access-Control-Allow-Origin',allowedOrigin(req));res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods',methods);res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');}
function bearer(req){return String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim()}
async function readJsonBody(req,limit=1000000){if(req.body&&typeof req.body==='object')return req.body;if(typeof req.body==='string'){try{return JSON.parse(req.body||'{}')}catch{return{}}}return await new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>limit)reject(Object.assign(new Error('Payload trop volumineux'),{status:413}))});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch{resolve({})}});req.on('error',reject)})}
async function getAuthUser(req){const {url,anonKey}=getSupabaseConfig(req);if(!url||!anonKey)throw missingTenantDbError();const token=bearer(req);if(!token)return null;const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:anonKey,Authorization:`Bearer ${token}`}});if(!r.ok)return null;return await r.json().catch(()=>null)}
function normalizeEnvironmentCode(value){return String(value||'DEMO').trim().toUpperCase()||'DEMO'}
function isPlatformProfile(profile){
  const role=String(profile?.role||'').toLowerCase();
  const env=String(profile?.environment_code||'').toUpperCase();
  const type=String(profile?.license_type||'').toLowerCase();
  return role==='super_admin'||role==='platform_admin'||env==='GLOBAL'||type==='super_admin';
}
async function validateActiveDeviceSession(req,user,profile){
  if(!user?.id||!profile||isPlatformProfile(profile))return true;
  const sessionToken=String(req.headers['x-picotrack-session']||req.headers['x-pt-session']||'').trim();
  if(!sessionToken){
    const err=new Error('Session appareil manquante. Reconnexion requise.');
    err.status=409; err.code='DEVICE_SESSION_REQUIRED'; throw err;
  }
  const env=encodeURIComponent(normalizeEnvironmentCode(profile.environment_code));
  const lic=encodeURIComponent(String(profile.license_type||'supervision'));
  const token=encodeURIComponent(sessionToken);
  const rows=await serviceRest(`active_device_sessions?user_id=eq.${encodeURIComponent(user.id)}&session_token=eq.${token}&environment_code=eq.${env}&license_type=eq.${lic}&revoked_at=is.null&select=id&limit=1`,{method:'GET',prefer:'',req}).catch(()=>[]);
  if(!Array.isArray(rows)||!rows[0]?.id){
    const err=new Error('Cette licence est déjà utilisée sur un autre appareil.');
    err.status=409; err.code='DEVICE_SESSION_REPLACED'; throw err;
  }
  return true;
}
async function requireAuth(req){const user=await getAuthUser(req);if(!user?.id){const err=new Error('Authentification requise');err.status=401;throw err;}const profile=await getUserProfile(user.id,req).catch(()=>null);await validateActiveDeviceSession(req,user,profile);return user}
async function serviceRest(path,{method='GET',body,prefer='return=representation',req}={}){const {url,serviceRole}=getSupabaseConfig(req);if(!url||!serviceRole)throw missingTenantDbError();const r=await fetch(`${url}/rest/v1/${path}`,{method,headers:{apikey:serviceRole,Authorization:`Bearer ${serviceRole}`,'Content-Type':'application/json',Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let payload=null;try{payload=text?JSON.parse(text):null}catch{payload={message:text}};if(!r.ok){const err=new Error(payload?.message||payload?.error||text||`Supabase ${r.status}`);err.status=r.status;err.payload=payload;throw err;}return payload||[]}
async function getUserProfile(userId,req){const rows=await serviceRest(`user_profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,role,roles,environment_code,active,license_type,tenant_id,resolved_permissions&limit=1`,{method:'GET',prefer:'',req});return Array.isArray(rows)?rows[0]:null}
function isAdminProfile(profile){const role=String(profile?.role||'').toLowerCase();const roles=Array.isArray(profile?.roles)?profile.roles.map(r=>String(r).toLowerCase()):[];const perms=profile?.resolved_permissions||{};return profile?.active!==false&&(role==='super_admin'||role==='admin'||role==='client_admin'||role==='environment_admin'||role==='platform_admin'||roles.includes('super_admin')||roles.includes('admin')||roles.includes('client_admin')||roles.includes('environment_admin')||perms.manage_users===true||perms.manage_global_licenses===true||perms.platform_admin===true)}
async function requireAdmin(req){const user=await requireAuth(req);const profile=await getUserProfile(user.id,req);if(!isAdminProfile(profile)){const err=new Error('Droits administrateur requis');err.status=403;throw err;}return {user,profile}}
module.exports={getSupabaseConfig,publicRuntimeConfig,json,decodeQ,setCors,bearer,readJsonBody,getAuthUser,requireAuth,requireAdmin,serviceRest,getUserProfile,isAdminProfile,applySecurityHeaders,requestHost,normalizeEnvironmentCode,isPlatformProfile,validateActiveDeviceSession,prefixForHost,resolveTenantFromHost,allowsLegacySupabaseFallback,isEfcCanonicalHost,MISSING_TENANT_DB};
