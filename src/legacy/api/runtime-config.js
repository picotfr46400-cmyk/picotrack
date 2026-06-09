function pick(...names){for(const name of names){const value=process.env[name];if(value!==undefined&&String(value).trim()!=='')return String(value).trim()}return''}
function base64UrlDecode(input){try{const normalized=String(input||'').replace(/-/g,'+').replace(/_/g,'/');const padded=normalized+'='.repeat((4-normalized.length%4)%4);return Buffer.from(padded,'base64').toString('utf8')}catch(_){return''}}
function deriveSupabaseUrlFromAnonKey(anonKey){try{const parts=String(anonKey||'').split('.');if(parts.length<2)return'';const payload=JSON.parse(base64UrlDecode(parts[1])||'{}');const issuer=String(payload.iss||'');const match=issuer.match(/^(https:\/\/[^/]+\.supabase\.co)(?:\/auth\/v1)?/i);return match?match[1].replace(/\/+$/,''):''}catch(_){return''}}
function normalizeSupabaseUrl(value){return String(value||'').trim().replace(/\/rest\/v1\/?$/,'').replace(/\/auth\/v1\/?$/,'').replace(/\/+$/,'')}
module.exports=function handler(req,res){
  const supabaseAnonKey=pick('VITE_SUPABASE_ANON_KEY','SUPABASE_ANON_KEY','SUPABASE_ANON_PUBLIC_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const supabaseUrl=normalizeSupabaseUrl(pick('URL_SUPABASE_VITE','VITE_SUPABASE_URL','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','PICOTRACK_SUPABASE_URL')||deriveSupabaseUrlFromAnonKey(supabaseAnonKey));
  const host=String(req.headers.host||'').toLowerCase();
  const clientCode=(pick('PICOTRACK_CLIENT_CODE','CODE_CLIENT_PICOTRACK')||(host.includes('prospect')?'prospect':'demo')).trim();
  let environmentCode=(pick('PICOTRACK_ENVIRONMENT_CODE','PICOTRACK_ENVIRONNEMENT_CODE')||'').trim();
  if(!environmentCode)environmentCode=clientCode.toLowerCase()==='prospect'||host.includes('prospect')?'PROSPECT':'DEMO';
  if((clientCode.toLowerCase()==='prospect'||host.includes('prospect'))&&environmentCode.toUpperCase()==='DEMO')environmentCode='PROSPECT';
  const payload={supabaseUrl,supabaseAnonKey,clientCode,environmentCode:environmentCode.toUpperCase()};
  res.statusCode=200;
  res.setHeader('Content-Type','application/javascript; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.end('window.PICOTRACK_RUNTIME_CONFIG='+JSON.stringify(payload)+';');
};
