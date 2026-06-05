import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, '..', 'site');

const LOCAL_ROUTES = new Map([
  ['/', '/'],
  ['/about-us/', '/about-us/'],
  ['/about-us/team/', '/about-us/team/'],
  ['/about-us/financials/', '/about-us/financials/'],
  ['/c/news/', '/c/news/'],
  ['/contact-us/', '/contact-us/'],
  ['/corporate-private-banking/', '/corporate-private-banking/'],
  ['/service/banking/savings-account/', '/service/banking/savings-account/'],
  ['/service/banking/chequing-account/', '/service/banking/chequing-account/'],
  ['/service/banking/term-deposit/', '/service/banking/term-deposit/'],
  ['/service/banking/payment-services/', '/service/banking/payment-services/'],
  ['/service/banking/bill-payment-services/', '/service/banking/bill-payment-services/'],
  ['/service/cards/debit-card/', '/service/cards/debit-card/'],
  ['/service/cards/credit-card/', '/service/cards/credit-card/'],
  ['/service/cards/prepaid-card/', '/service/cards/prepaid-card/'],
  ['/service/loans-financing/personal-loans/', '/service/loans-financing/personal-loans/'],
  ['/service/loans-financing/mortgage/', '/service/loans-financing/mortgage/'],
  ['/service/corporate-banking/business-savings-accounts/', '/service/corporate-banking/business-savings-accounts/'],
  ['/service/corporate-banking/business-credit-cards/', '/service/corporate-banking/business-credit-cards/'],
]);

const HUB_REDIRECTS = new Map([
  ['/service/banking/', '/service/banking/savings-account/'],
  ['/service/cards/', '/service/cards/debit-card/'],
  ['/service/loans-financing/', '/service/loans-financing/personal-loans/'],
  ['/service/corporate-banking/', '/service/corporate-banking/business-savings-accounts/'],
  ['/service/lending/', '/service/loans-financing/personal-loans/'],
]);

function routeForPath(p) {
  if (LOCAL_ROUTES.has(p)) return LOCAL_ROUTES.get(p);
  if (HUB_REDIRECTS.has(p)) return HUB_REDIRECTS.get(p);
  return null;
}

function patchHtml(html) {
  let out = html;

  // -1. Fix already-broken template_url (from earlier run with wrong order)
  out = out.replace(
    /var template_url = '\/assets\/themes\/pb';/g,
    "var template_url = '/assets';"
  );

  // 0. JS variables (do BEFORE generic wp-content replacement)
  out = out.replace(
    /var site_url = 'https:\/\/www\.provenbank\.com\/';/g,
    "var site_url = '/';"
  );
  out = out.replace(
    /var template_url = 'https:\/\/www\.provenbank\.com\/wp-content\/themes\/pb';/g,
    "var template_url = '/assets';"
  );

  // 1. wp-content/uploads/* (images, PDFs) -> /assets/img/*
  out = out.replace(
    /https:\/\/www\.provenbank\.com\/wp-content\/uploads\/[^"'\s)>]+/g,
    (m) => {
      const file = m.split('/').pop().split('?')[0];
      return `/assets/img/${file}`;
    }
  );

  // 2. wp-content/themes/pb/* -> /assets/*
  out = out.replace(
    /https:\/\/www\.provenbank\.com\/wp-content\/themes\/pb\//g,
    '/assets/'
  );

  // 3. Any other wp-content/* -> /assets/*
  out = out.replace(
    /https:\/\/www\.provenbank\.com\/wp-content\//g,
    '/assets/'
  );

  // 4. Flatten date-subdir image paths: /assets/img/YYYY/MM/file.ext -> /assets/img/file.ext
  // Also handles /assets/img/YYYY/MM/DD/ etc. and PDFs
  out = out.replace(
    /\/assets\/img\/\d{4}\/\d{2}\/[^"'\s)>]+/g,
    (m) => {
      const file = m.split('/').pop();
      return `/assets/img/${file}`;
    }
  );

  // 6. General provenbank.com links -> local route if available
  out = out.replace(
    /https:\/\/www\.provenbank\.com(\/[^"'\s)>]*)?/g,
    (m, rest) => {
      if (!rest) return '/';
      const clean = rest.split('?')[0].split('#')[0];
      const local = routeForPath(clean);
      return local || m;
    }
  );

  return out;
}

function walkHtmlFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkHtmlFiles(full));
    } else if (entry.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

const files = walkHtmlFiles(SITE);
let patched = 0;
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const result = patchHtml(html);
  if (result !== html) {
    fs.writeFileSync(file, result, 'utf8');
    patched++;
    console.log('  \u2713', path.relative(SITE, file));
  }
}
console.log(`\nFait. ${patched}/${files.length} fichiers patchés.`);
