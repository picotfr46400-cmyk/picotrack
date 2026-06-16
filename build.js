const fs = require('fs');
const path = require('path');
const out = 'public';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'style.css', 'logo-picotrack.png', 'manifest.json', 'favicon.ico', 'sw.js', 'robots.txt', 'security.txt', 'BUILD_INFO.json']) {
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(out, f));
}

if (fs.existsSync('.well-known')) fs.cpSync('.well-known', path.join(out, '.well-known'), { recursive: true });
if (fs.existsSync('icons')) fs.cpSync('icons', path.join(out, 'icons'), { recursive: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
for (const f of ['app.secured-v21.js']) {
  const src = path.join('assets', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, 'assets', f));
}
console.log('PicoTrack static files copied to public with minimized assets');
