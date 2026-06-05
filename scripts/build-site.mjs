import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'site');

const PAGES = [
  { file: 'PROVEN Bank Cayman Islands.html', route: '' },
  { file: 'About Us _ PROVEN Bank.html', route: 'about-us' },
  { file: 'Executive Management Team _ PROVEN Bank.html', route: 'about-us/team' },
  { file: 'Financial Reports - PROVEN Bank - Cayman Islands.html', route: 'about-us/financials' },
  { file: 'News _ PROVEN Bank.html', route: 'c/news' },
  { file: 'Contact us - PROVEN Bank - Cayman Islands.html', route: 'contact-us' },
  { file: 'Corporate and Private Banking Cayman Islands _ PROVEN Bank.html', route: 'corporate-private-banking' },
  { file: 'Personal Savings Account Cayman Islands _ PROVEN Bank.html', route: 'service/banking/savings-account' },
  { file: 'Personal Chequing Account Cayman Islands _ PROVEN Bank.html', route: 'service/banking/chequing-account' },
  { file: 'Term Deposit Cayman Islands _ PROVEN Bank.html', route: 'service/banking/term-deposit' },
  { file: 'Payment Services Cayman Islands _ PROVEN Bank.html', route: 'service/banking/payment-services' },
  { file: 'Bill Payment Services Cayman Islands _ PROVEN Bank.html', route: 'service/banking/bill-payment-services' },
  { file: 'Visa Debit Cards Cayman Islands _ PROVEN Bank.html', route: 'service/cards/debit-card' },
  { file: 'Credit Cards _ PROVEN Bank.html', route: 'service/cards/credit-card' },
  { file: 'Visa Prepaid Card Cayman Islands _ PROVEN Bank.html', route: 'service/cards/prepaid-card' },
  { file: 'Personal Loans Cayman Islands _ PROVEN Bank.html', route: 'service/loans-financing/personal-loans' },
  { file: 'Mortgage Cayman Islands _ PROVEN Bank.html', route: 'service/loans-financing/mortgage' },
  { file: 'Business Savings Account Cayman Islands _ PROVEN Bank.html', route: 'service/corporate-banking/business-savings-accounts' },
  { file: 'Business Credit Cards Cayman Islands _ PROVEN Bank.html', route: 'service/corporate-banking/business-credit-cards' },
];

const LOCAL_ROUTES = new Map(
  PAGES.map((p) => [normalizePath(p.route), p.route === '' ? '/' : `/${p.route}/`])
);

const HUB_REDIRECTS = {
  '/service/banking/': '/service/banking/savings-account/',
  '/service/cards/': '/service/cards/debit-card/',
  '/service/loans-financing/': '/service/loans-financing/personal-loans/',
  '/service/corporate-banking/': '/service/corporate-banking/business-savings-accounts/',
};

const ASSET_EXT = {
  '.css': 'css',
  '.min.css': 'css',
  '.js': 'js',
  '.min.js': 'js',
  '.jpg': 'img',
  '.jpeg': 'img',
  '.png': 'img',
  '.gif': 'img',
  '.svg': 'img',
  '.webp': 'img',
  '.woff': 'fonts',
  '.woff2': 'fonts',
  '.ttf': 'fonts',
  '.eot': 'fonts',
};

function normalizePath(route) {
  if (!route) return '/';
  const r = route.replace(/^\/+|\/+$/g, '');
  return r ? `/${r}/` : '/';
}

function assetSubdir(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.min.css') || lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.min.js') || lower.endsWith('.js') || lower.endsWith('.téléchargement')) return 'js';
  if (/\.(jpe?g|png|gif|svg|webp)$/i.test(lower)) return 'img';
  if (/\.(woff2?|ttf|eot)$/i.test(lower)) return 'fonts';
  if (lower === 'js' || lower === 'css') return lower;
  return 'misc';
}

function sanitizeAssetName(name) {
  if (/\.téléchargement$/i.test(name)) {
    return name.replace(/\.téléchargement$/i, '.js');
  }
  return name;
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
}

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, callback);
    else callback(full);
  }
}

function consolidateAssets() {
  const assetsRoot = path.join(OUT, 'assets');
  for (const sub of ['css', 'js', 'img', 'fonts', 'misc']) {
    fs.mkdirSync(path.join(assetsRoot, sub), { recursive: true });
  }

  const copied = new Map();
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('_files')) continue;
    const filesDir = path.join(ROOT, entry.name);
    walkDir(filesDir, (filePath) => {
      const base = path.basename(filePath);
      if (base.endsWith('.html')) return;
      const safeName = sanitizeAssetName(base);
      const sub = assetSubdir(safeName);
      const dest = path.join(assetsRoot, sub, safeName);
      if (!copied.has(safeName)) {
        copyFile(filePath, dest);
        copied.set(safeName, `/assets/${sub}/${safeName}`);
      }
    });
  }
  return copied;
}

function urlToLocal(href) {
  try {
    const u = new URL(href, 'https://www.provenbank.com');
    if (u.hostname !== 'www.provenbank.com') return null;
    let p = u.pathname;
    if (!p.endsWith('/')) {
      const last = p.split('/').pop();
      if (!last.includes('.')) p += '/';
    }
    if (LOCAL_ROUTES.has(p)) return LOCAL_ROUTES.get(p);
    if (HUB_REDIRECTS[p]) return HUB_REDIRECTS[p];
    return null;
  } catch {
    return null;
  }
}

function wpUploadToLocal(url) {
  const m = url.match(/\/wp-content\/uploads\/(.+)$/);
  if (!m) return null;
  const filename = path.basename(m[1].split('?')[0]);
  return `/assets/img/${filename}`;
}

function transformHtml(html, pageFilesFolder) {
  let out = html;

  // Page-specific _files paths -> /assets/
  const filesFolderEscaped = pageFilesFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  out = out.replace(new RegExp(`\\.\\/${filesFolderEscaped}/`, 'g'), '/assets/');
  out = out.replace(new RegExp(`\\.\\/${filesFolderEscaped}`, 'g'), '/assets');

  // Fix téléchargement references (only in paths, not content)
  out = out.replace(/\.téléchargement/gi, '');
  out = out.replace(/\/assets\/js\/([^"']+)\.js\.js/gi, '/assets/js/$1.js');
  out = out.replace(/\/assets\/js\/([^"']+)\.js\.js/gi, '/assets/js/$1.js');

  // Map asset files in /assets/ to correct subfolders
  out = out.replace(/\/assets\/(style(?:\(1\))?\.min\.css)/g, '/assets/css/$1');
  out = out.replace(/\/assets\/(jquery[^"']*\.js)/g, '/assets/js/$1');
  out = out.replace(/\/assets\/(main\.min\.js|script\.min\.js|public\.js|api\.js|gtm\.js|analytics\.js|fbevents\.js|roundtrip\.js|recaptcha[^"']*\.js|controls\.js|onion\.js|log\.js|marker\.js|map\.js|util\.js|common\.js)/g, '/assets/js/$1');
  out = out.replace(/\/assets\/(styles__ltr\.css)/g, '/assets/css/$1');
  out = out.replace(/\/assets\/(M67HV4IZ3FELXDWOQJU3R2)/g, '/assets/misc/$1');

  // Images in root of /assets/ -> /assets/img/
  out = out.replace(/\/assets\/([a-zA-Z0-9_().-]+\.(?:jpg|jpeg|png|gif|svg|webp))/gi, '/assets/img/$1');
  out = out.replace(/\/assets\/img\/(style[^"']*\.css)/gi, '/assets/css/$1');
  out = out.replace(/\/assets\/(out\d*)/gi, '/assets/misc/$1');

  // wp-content uploads -> local img
  out = out.replace(
    /https:\/\/www\.provenbank\.com\/wp-content\/uploads\/[^"'\s)]+/g,
    (url) => wpUploadToLocal(url) || url
  );

  // Internal provenbank links
  out = out.replace(/https:\/\/www\.provenbank\.com([^"'\s]*)/g, (match, pathPart) => {
    const local = urlToLocal(`https://www.provenbank.com${pathPart}`);
    if (local) return local;
    if (pathPart.startsWith('/wp-content/')) {
      const img = wpUploadToLocal(match);
      if (img) return img;
    }
    return match;
  });

  // site_url / template_url
  out = out.replace(/var site_url = 'https:\/\/www\.provenbank\.com\/';/g, "var site_url = '/';");
  out = out.replace(
    /var template_url = 'https:\/\/www\.provenbank\.com\/wp-content\/themes\/pb';/g,
    "var template_url = '/assets';"
  );

  // Fix broken img src pointing to site root only
  out = out.replace(
    /<img([^>]*)\ssrc="\/"\s/g,
    '<img$1 src="/assets/img/mob3-1020x440.jpg" '
  );
  out = out.replace(
    /src="https:\/\/www\.provenbank\.com\/"\s/g,
    'src="/assets/img/mob3-1020x440.jpg" '
  );
  out = out.replace(
    /src="https:\/\/www\.provenbank\.com\/corporate-private-banking\/"\s/g,
    'src="/assets/img/mob3-1020x440.jpg" '
  );

  // Drive banner (images filled by JS on live site; use card promo as fallback)
  out = out.replace(
    /class="drive-banner__image-main"\s+src="[^"]*"/g,
    'class="drive-banner__image-main" src="/assets/img/proven-card-1.jpg"'
  );
  out = out.replace(
    /class="drive-banner__image-car"\s+src="[^"]*"/g,
    'class="drive-banner__image-car" src="/assets/img/proven-card-1.jpg"'
  );

  // Home carousel slide 3 empty srcset
  out = out.replace(
    /<source srcset="" media="\(min-width: 601px\)">/g,
    '<source srcset="/assets/img/mob3-1020x440.jpg" media="(min-width: 601px)">'
  );
  out = out.replace(
    /<source srcset="" media="\(min-width: 0px\)">/g,
    '<source srcset="/assets/img/mob3-600x440.jpg" media="(min-width: 0px)">'
  );

  // Favicons to local if we have them, else keep remote - use assets
  out = out.replace(
    /https:\/\/www\.provenbank\.com\/wp-content\/themes\/pb\/src\/images\/favicon\//g,
    '/assets/img/favicon/'
  );

  // Remove tracking-heavy scripts optional - keep for fidelity
  return out;
}

function download(url, dest) {
  return new Promise((resolve) => {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      resolve(true);
      return;
    }
    const proto = url.startsWith('https') ? https : http;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const file = fs.createWriteStream(dest);
    proto
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {}
          resolve(false);
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(true);
        });
      })
      .on('error', () => {
        try {
          file.close();
          fs.unlinkSync(dest);
        } catch {}
        resolve(false);
      });
  });
}

async function ensureImagesFromSource(sourceHtml, filesFolder) {
  const urls = new Set();
  const wpRe = /https:\/\/www\.provenbank\.com\/wp-content\/uploads\/[^"'\s)]+/g;
  let m;
  while ((m = wpRe.exec(sourceHtml)) !== null) urls.add(m[0].split('?')[0]);

  const localRe = new RegExp(
    `\\.\\/${filesFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^"'\s)]+\\.(?:jpg|jpeg|png|gif|svg|webp))`,
    'gi'
  );
  while ((m = localRe.exec(sourceHtml)) !== null) {
    const localFile = path.join(ROOT, filesFolder, m[1]);
    const dest = path.join(OUT, 'assets', 'img', m[1]);
    if (fs.existsSync(localFile)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) fs.copyFileSync(localFile, dest);
    }
  }

  for (const url of urls) {
    const local = wpUploadToLocal(url);
    if (!local) continue;
    const dest = path.join(OUT, local.replace(/^\//, '').replace(/\//g, path.sep));
    await download(url, dest);
  }
}

async function ensureImagesFromBuiltHtml(html) {
  const re = /\/assets\/img\/([^"'\s?)]+)/g;
  const tried = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const file = m[1];
    const dest = path.join(OUT, 'assets', 'img', file);
    if (fs.existsSync(dest)) continue;
    const prefixes = ['2024/10/', '2023/01/', '2022/12/', '2025/10/'];
    for (const prefix of prefixes) {
      const key = prefix + file;
      if (tried.has(key)) continue;
      tried.add(key);
      const ok = await download(
        `https://www.provenbank.com/wp-content/uploads/${prefix}${file}`,
        dest
      );
      if (ok) break;
    }
  }
}

async function downloadDriveBannerAssets() {
  const candidates = [
    ['https://www.provenbank.com/wp-content/uploads/2024/10/proven-drive-main.png', 'proven-drive-main.png'],
    ['https://www.provenbank.com/wp-content/uploads/2024/10/proven-drive-car.png', 'proven-drive-car.png'],
    ['https://www.provenbank.com/wp-content/themes/pb/src/images/drive-banner-main.png', 'proven-drive-main.png'],
    ['https://www.provenbank.com/wp-content/themes/pb/src/images/drive-banner-car.png', 'proven-drive-car.png'],
  ];
  for (const [url, name] of candidates) {
    const dest = path.join(OUT, 'assets', 'img', name);
    await download(url, dest);
  }
}

async function fetchLiveDriveBannerFromHtml() {
  return new Promise((resolve) => {
    https
      .get('https://www.provenbank.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      })
      .on('error', () => resolve(''));
  });
}

async function main() {
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  console.log('Consolidating assets...');
  const assetMap = consolidateAssets();
  console.log(`  ${assetMap.size} shared asset files`);

  const liveHtml = await fetchLiveDriveBannerFromHtml();
  const driveMain = liveHtml.match(/drive-banner__image-main[^>]+src="([^"]+)"/);
  const driveCar = liveHtml.match(/drive-banner__image-car[^>]+src="([^"]+)"/);
  if (driveMain) {
    const name = path.basename(driveMain[1].split('?')[0]);
    await download(driveMain[1].startsWith('http') ? driveMain[1] : `https://www.provenbank.com${driveMain[1]}`, path.join(OUT, 'assets', 'img', name));
    globalThis.driveMainName = name;
  }
  if (driveCar) {
    const name = path.basename(driveCar[1].split('?')[0]);
    await download(driveCar[1].startsWith('http') ? driveCar[1] : `https://www.provenbank.com${driveCar[1]}`, path.join(OUT, 'assets', 'img', name));
    globalThis.driveCarName = name;
  }
  await downloadDriveBannerAssets();

  for (const page of PAGES) {
    const srcPath = path.join(ROOT, page.file);
    if (!fs.existsSync(srcPath)) {
      console.warn('Missing:', page.file);
      continue;
    }
    const filesFolder = `${page.file.replace(/\.html$/, '')}_files`;
    let html = fs.readFileSync(srcPath, 'utf8');
    html = transformHtml(html, filesFolder);

    await ensureImagesFromSource(fs.readFileSync(srcPath, 'utf8'), filesFolder);
    await ensureImagesFromBuiltHtml(html);

    const outDir = page.route ? path.join(OUT, page.route) : OUT;
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'index.html');
    fs.writeFileSync(outFile, html, 'utf8');
    console.log('Built:', page.route || '/');
  }

  const readme = `# PROVEN Bank — site statique unifié

Ouvrir avec un serveur local (obligatoire pour les chemins absolus) :

\`\`\`bash
npx serve site
\`\`\`

Puis : http://localhost:3000/

## Pages incluses (19)
${PAGES.map((p) => `- \`/${p.route || ''}\` ← ${p.file}`).join('\n')}

## Liens hub (pages non exportées)
- /service/banking/ → savings-account
- /service/cards/ → debit-card
- /service/loans-financing/ → personal-loans

Les exports originaux restent à la racine du dossier parent.
`;
  fs.writeFileSync(path.join(OUT, 'README.md'), readme, 'utf8');
  console.log('\nDone. Output:', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
