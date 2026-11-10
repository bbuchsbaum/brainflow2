// usage: node shot.js <html> <png> [w h]
const { chromium } = require('playwright');
(async () => {
  const [html, png, w = '1440', h = '900'] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  await p.goto('file://' + html);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: png });
  await b.close();
})();
