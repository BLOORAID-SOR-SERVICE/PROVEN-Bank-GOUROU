import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ORIG = path.resolve(__dirname, '..', 'site');
const { PAGES, transformHtml, consolidateAssets, ensureImagesFromBuiltHtml, downloadDriveBannerAssets, fetchLiveDriveBannerFromHtml, download } = await import('./build-site.mjs');

const assetMap = consolidateAssets();
console.log(`  ${assetMap.size} shared asset files`);

const liveHtml = await fetchLiveDriveBannerFromHtml();
const driveMain = liveHtml.match(/drive-banner__image-main[^>]+src="([^"]+)"/);
const driveCar = liveHtml.match(/drive-banner__image-car[^>]+src="([^"]+)"/);
if (driveMain) {
  const name = path.basename(driveMain[1].split('?')[0]);
  await download(driveMain[1].startsWith('http') ? driveMain[1] : `https://www.provenbank.com${driveMain[1]}`, path.join(ORIG, 'assets', 'img', name));
}
if (driveCar) {
  const name = path.basename(driveCar[1].split('?')[0]);
  await download(driveCar[1].startsWith('http') ? driveCar[1] : `https://www.provenbank.com${driveCar[1]}`, path.join(ORIG, 'assets', 'img', name));
}
await downloadDriveBannerAssets();

for (const page of PAGES) {
  const srcPath = path.join(ROOT, page.file);
  if (!fs.existsSync(srcPath)) { console.warn('Missing:', page.file); continue; }
  const filesFolder = `${page.file.replace(/\.html$/, '')}_files`;
  let html = fs.readFileSync(srcPath, 'utf8');
  html = transformHtml(html, filesFolder);
  await ensureImagesFromBuiltHtml(html);
  const outDir = page.route ? path.join(ORIG, page.route) : ORIG;
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'index.html');
  fs.writeFileSync(outFile, html, 'utf8');
  console.log('Built:', page.route || '/');
}
console.log('\nDone.');
