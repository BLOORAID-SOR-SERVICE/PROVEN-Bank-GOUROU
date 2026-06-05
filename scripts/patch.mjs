import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(__dirname, '..', 'site');
const DIRS = ['assets/css','assets/js','assets/img','assets/fonts','about-us','about-us/team','about-us/financials','c/news','contact-us','corporate-private-banking','create-account','admin','admin/dashboard','profile','service/banking/savings-account','service/banking/chequing-account','service/banking/term-deposit','service/banking/payment-services','service/banking/bill-payment-services','service/cards/debit-card','service/cards/credit-card','service/cards/prepaid-card','service/loans-financing/personal-loans','service/loans-financing/mortgage','service/corporate-banking/business-savings-accounts','service/corporate-banking/business-credit-cards'];

// create dirs
DIRS.forEach(d => {
  const p = path.join(OUT, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

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

function transformHtml(html, filesFolder) {
  let h = html;
  // replace CDN urls
  h = h.replace(/https?:\/\/www\.provenbank\.com\/wp-content\/themes\/pb\//g, '/');
  h = h.replace(/https?:\/\/www\.provenbank\.com\/wp-content\/uploads\//g, '/assets/img/');
  // replace _files references
  h = h.replace(new RegExp(filesFolder + '/', 'g'), '/assets/');
  // replace /wp-content/themes/pb/ references that might remain
  h = h.replace(/\/wp-content\/themes\/pb\//g, '/');
  h = h.replace(/\/wp-content\/uploads\//g, '/assets/img/');
  // fix font references
  h = h.replace(/\/assets\/fonts\//g, '/assets/fonts/');
  // fix relative paths in CSS/JS
  h = h.replace(/\.\.\/\.\.\/\.\.\/\.\.\/assets\//g, '/assets/');
  h = h.replace(/\.\.\/\.\.\/\.\.\/assets\//g, '/assets/');
  h = h.replace(/\.\.\/\.\.\/assets\//g, '/assets/');
  h = h.replace(/\.\.\/assets\//g, '/assets/');
  // remove no-js class
  h = h.replace('no-js', 'js');
  return h;
}

// copy assets from _files folders
function copyAssets() {
  const rootFilesDirs = fs.readdirSync(ROOT).filter(f => f.endsWith('_files') && fs.statSync(path.join(ROOT, f)).isDirectory());
  console.log('Found ' + rootFilesDirs.length + ' source asset folders');
  const copied = new Set();
  rootFilesDirs.forEach(fd => {
    const srcDir = path.join(ROOT, fd);
    const entries = fs.readdirSync(srcDir);
    entries.forEach(e => {
      const src = path.join(srcDir, e);
      if (fs.statSync(src).isFile()) {
        let destName = e;
        // map to proper subdir
        let subdir = '';
        if (/\.css$/.test(e)) subdir = 'assets/css';
        else if (/\.js$/.test(e)) subdir = 'assets/js';
        else if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/.test(e)) subdir = 'assets/img';
        else if (/\.(woff|woff2|ttf|eot)$/.test(e)) subdir = 'assets/fonts';
        else subdir = 'assets';
        const dest = path.join(OUT, subdir, destName);
        if (!copied.has(dest)) {
          try { fs.copyFileSync(src, dest); copied.add(dest); } catch(e) {}
        }
      }
    });
  });
  console.log('Copied ' + copied.size + ' asset files');
}

copyAssets();

const pagesBuilt = [];
PAGES.forEach(page => {
  const srcPath = path.join(ROOT, page.file);
  if (!fs.existsSync(srcPath)) { console.warn('Missing:', page.file); return; }
  const filesFolder = page.file.replace(/\.html$/, '') + '_files';
  let html = fs.readFileSync(srcPath, 'utf8');
  html = transformHtml(html, filesFolder);
  const outDir = page.route ? path.join(OUT, page.route) : OUT;
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  pagesBuilt.push(page.route || '/');
  console.log('Built:', page.route || '/');
});

// Add script tag to all built pages
const scriptTag = '\n<script src="/assets/js/client-login.js"></script>';
pagesBuilt.forEach(route => {
  const p = route ? path.join(OUT, route, 'index.html') : path.join(OUT, 'index.html');
  if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, 'utf8');
    if (!c.includes('client-login.js')) {
      c = c.replace('</body>', scriptTag + '\n</body>');
      fs.writeFileSync(p, c, 'utf8');
      console.log('Added login script to:', route || '/');
    }
  }
});

console.log('\nDone. ' + pagesBuilt.length + ' pages built');
