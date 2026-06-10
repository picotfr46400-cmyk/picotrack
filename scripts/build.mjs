import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { transformSync } from '@babel/core';
import terser from 'terser';
import JavaScriptObfuscator from 'javascript-obfuscator';
const root = process.cwd();
const legacy = path.join(root,'src','legacy');
const dist = path.join(root,'dist');
fs.rmSync(dist,{recursive:true,force:true}); fs.mkdirSync(path.join(dist,'assets'),{recursive:true});
const index = fs.readFileSync(path.join(legacy,'index.html'),'utf8');
let body = index.match(/<body[^>]*>([\s\S]*?)<script\s+type=["']text\/babel["']/i)?.[1] || '';
body = body.replace(/<!--[\s\S]*?-->/g,'').replace(/\s+$/,'');
const css = fs.readFileSync(path.join(legacy,'style.css'),'utf8');
fs.writeFileSync(path.join(dist,'style.css'), css);
for (const f of ['logo-picotrack.png','manifest.json']) if (fs.existsSync(path.join(legacy,f))) fs.copyFileSync(path.join(legacy,f),path.join(dist,f));
const builderJsx = fs.readFileSync(path.join(legacy,'assets','picotrack-builder.jsx'),'utf8');
const builderCompiled = transformSync(builderJsx,{presets:[['@babel/preset-react',{runtime:'classic'}]],comments:false,compact:false}).code;
const files = [
 'js/core/supabase.js','js/core/security.js','js/core/offline-queue.js','js/core/constants.js','js/core/data.js','js/core/environments.js','js/core/state.js','js/core/licenses.js','js/core/utils.js','js/core/pdf.js','js/core/mail.js',
 'js/features/forms-admin.js','js/features/forms-production.js','js/features/forms-advanced-helpers.js','js/features/forms-saisie.js','js/features/forms-builder.js','js/features/react-builder-mount.js','js/features/forms-preview-layout.js','js/features/admin-navigation.js','js/features/roles.js','js/features/users.js','js/features/permissions.js','js/features/licensing.js','js/features/services.js','js/features/databases.js','js/features/api.js','js/features/studio-v4.js','js/features/planning.js','js/features/academy-help.js','pad-mode.js','js/features/performance-v34.js','js/features/pc-login.js','js/init.js'
];
let code = '';
code += `;(function(){try{var xhr=new XMLHttpRequest();xhr.open('GET','/api/bootstrap',false);xhr.send(null);if(xhr.status>=200&&xhr.status<300)window.PICOTRACK_RUNTIME_CONFIG=JSON.parse(xhr.responseText||'{}');}catch(e){window.PICOTRACK_RUNTIME_CONFIG={clientCode:'demo',environmentCode:'DEMO'};}document.getElementById('app').innerHTML=${JSON.stringify(body)};})();\n`;
code += '\n;/* builder compiled */\n' + builderCompiled + '\n';
for (const file of files) code += `\n;/* ${file} */\n` + fs.readFileSync(path.join(legacy,file),'utf8') + '\n';
code += "\n;if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js')} if(typeof isPadMode==='function'&&isPadMode()&&typeof initPadMode==='function')initPadMode();\n";
const min = await terser.minify(code,{compress:{passes:2},mangle:false,format:{comments:false}});
if (min.error) throw min.error;
const hash = crypto.createHash('sha256').update(min.code).digest('hex').slice(0,12);
const appName = `app.${hash}.js`;
const obfuscated = JavaScriptObfuscator.obfuscate(min.code, {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  identifierNamesGenerator: 'hexadecimal',
  selfDefending: false,
});
fs.writeFileSync(path.join(dist,'assets',appName), obfuscated.getObfuscatedCode());
const shell = `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="theme-color" content="#059669"><link rel="manifest" href="/manifest.json"><title>PicoTrack</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"><script crossorigin src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"></script><script crossorigin src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script><link rel="stylesheet" href="/style.css"></head><body><div id="app"></div><script src="/assets/${appName}" defer></script></body></html>`;
fs.writeFileSync(path.join(dist,'index.html'), shell);
const sw = `const CACHE='picotrack-v29-${hash}';self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',event=>{const req=event.request;const url=new URL(req.url);if(url.pathname.startsWith('/api/'))return;if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match('/index.html')));return;}event.respondWith(fetch(req));});`;
fs.writeFileSync(path.join(dist,'sw.js'), sw);
fs.writeFileSync(path.join(dist,'BUILD_INFO.json'), JSON.stringify({version:'v29-deep-build-proxy',app:appName,generatedAt:new Date().toISOString()},null,2));
console.log('Built', appName);
