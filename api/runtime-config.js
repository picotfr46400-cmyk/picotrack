const { json } = require('./_server-supabase');
module.exports=function handler(req,res){return json(res,410,{error:'runtime-config désactivé. Utiliser /api/bootstrap.'});};
