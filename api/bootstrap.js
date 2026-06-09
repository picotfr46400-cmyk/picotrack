const { json } = require('./_server-supabase');
function pick(...names){for(const name of names){const value=process.env[name];if(value!==undefined&&String(value).trim()!=='')return String(value).trim()}return''}
module.exports=function handler(req,res){
  const host=String(req.headers.host||'').toLowerCase();
  const clientCode=(pick('PICOTRACK_CLIENT_CODE','CODE_CLIENT_PICOTRACK')||(host.includes('prospect')?'prospect':'demo')).trim();
  let environmentCode=(pick('PICOTRACK_ENVIRONMENT_CODE','PICOTRACK_ENVIRONNEMENT_CODE')||'').trim();
  if(!environmentCode)environmentCode=clientCode.toLowerCase()==='prospect'||host.includes('prospect')?'PROSPECT':'DEMO';
  if((clientCode.toLowerCase()==='prospect'||host.includes('prospect'))&&environmentCode.toUpperCase()==='DEMO')environmentCode='PROSPECT';
  json(res,200,{clientCode,environmentCode:environmentCode.toUpperCase()});
};
