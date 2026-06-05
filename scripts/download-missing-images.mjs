import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.resolve(__dirname, '..', 'site', 'assets', 'img');

const IMAGES = [
  'home-pic4.jpg',
  'home-pic4-1440x620.jpg',
  'home-pic3.jpg',
  'home-pic3-1440x620.jpg',
  'home-pic.jpg',
  'home-pic-1440x620.jpg',
  'mob3-600x440.jpg',
  'mob2-600x440.jpg',
];

function download(url, dest) {
  return new Promise((resolve) => {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { resolve(true); return; }
    const proto = url.startsWith('https') ? https : http;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        download(res.headers.location, dest).then(resolve);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        console.log('  FAIL:', url, res.statusCode);
        resolve(false);
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
    }).on('error', () => {
      try { file.close(); fs.unlinkSync(dest); } catch {}
      resolve(false);
    });
  });
}

const prefixes = ['2024/10/', '2024/11/'];
let ok = 0, fail = 0;

for (const img of IMAGES) {
  const dest = path.join(IMG_DIR, img);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log('  \u2713', img, '(already exists)');
    ok++;
    continue;
  }
  let downloaded = false;
  for (const prefix of prefixes) {
    const url = `https://www.provenbank.com/wp-content/uploads/${prefix}${img}`;
    const result = await download(url, dest);
    if (result) {
      console.log('  \u2713', img, `(from ${prefix})`);
      downloaded = true;
      ok++;
      break;
    }
  }
  if (!downloaded) {
    console.log('  \u2717', img, '(not found)');
    fail++;
  }
}

console.log(`\nFait. ${ok} OK, ${fail} FAIL`);
