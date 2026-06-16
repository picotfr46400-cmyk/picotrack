const { json, publicRuntimeConfig } = require('./_server-supabase');
module.exports=function handler(req,res){
  return json(res,200,publicRuntimeConfig(req));
};
