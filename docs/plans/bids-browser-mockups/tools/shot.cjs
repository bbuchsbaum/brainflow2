// usage: node tools/shot.cjs <page.html> <out-prefix> <hash1,hash2,...>
// Full-page screenshots with the preinstalled Playwright Chromium.
// usage: node shot.js <html> <outprefix> <hash1,hash2,...>
const { chromium } = require('playwright');
(async () => {
  const [file, prefix, hashes] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  for (const h of hashes.split(',')) {
    await p.goto('file://' + require('path').resolve(file) + '#' + h); await p.waitForTimeout(400);
    await p.screenshot({ path: `${prefix}-${h}.png`, fullPage: true });
  }
  if (errs.length) console.log('ERRORS', errs); await b.close();
})();
