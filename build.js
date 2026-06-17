const fs = require('fs');
const path = require('path');

const out = 'public';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const rootFiles = [
  'index.html',
  'style.css',
  'logo-picotrack.png',
  'manifest.json',
  'favicon.ico',
  'sw.js',
  'robots.txt',
  'security.txt',
  'BUILD_INFO.json'
];

for (const f of rootFiles) {
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(out, f));
}

if (fs.existsSync('.well-known')) {
  fs.cpSync('.well-known', path.join(out, '.well-known'), { recursive: true });
}

if (fs.existsSync('icons')) {
  fs.cpSync('icons', path.join(out, 'icons'), { recursive: true });
}

fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
if (fs.existsSync('assets')) {
  for (const f of fs.readdirSync('assets')) {
    const src = path.join('assets', f);
    const dst = path.join(out, 'assets', f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, dst);
  }
}

console.log('PicoTrack static files copied to public with all assets');
