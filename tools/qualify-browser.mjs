// Actual-engine smoke qualification. Numerical parity remains in browser-host.spec.ts.
// Override the Playwright module to qualify current engines without changing the app dependency.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const output = resolve(process.env.BROWSER_QA_OUTPUT ?? 'cruft/browser-completion/engine-matrix');
mkdirSync(output, { recursive: true });
const playwright = await import(pathToFileURL(resolve(process.env.BROWSER_QA_PLAYWRIGHT ?? 'e2e/node_modules/playwright/index.mjs')).href);
const engines = process.argv.slice(2);
if (!engines.length || engines.some(name => !['chromium', 'firefox', 'webkit'].includes(name)))
  throw new Error('Specify one or more engines: chromium firefox webkit');
const log = openSync(resolve(output, 'server.log'), 'w');
const server = spawn('node_modules/.bin/vite', ['preview', '--config', 'vite.browser.config.ts', '--host', '127.0.0.1', '--port', '5360', '--strictPort'], { cwd: 'ui2', stdio: ['ignore', log, log] });
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const sourceDiff = spawnSync('git', ['diff', 'HEAD', '--', 'ui2/src/services/browser', 'ui2/src/browser', 'core/browser_host', 'core/render_loop'], { encoding: 'utf8' }).stdout;
writeFileSync(resolve(output, 'source-changes.patch'), sourceDiff);
const sourceChangesSha256 = createHash('sha256').update(sourceDiff).digest('hex');
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Owned preview exited ${server.exitCode}`);
    try { ready = (await fetch('http://127.0.0.1:5360/browser.html')).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Preview startup timed out');
  for (const engine of engines) {
    let browser;
    const result = { engine, revision, sourceChangesSha256, checkedAt: new Date().toISOString(), renderingQualified: false };
    try {
      browser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' && process.env.BROWSER_QA_BROWSER ? { executablePath: process.env.BROWSER_QA_BROWSER, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'] } : {}) });
      result.version = browser.version();
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto('http://127.0.0.1:5360/browser.html');
      await page.waitForFunction(() => {
        const open = [...document.querySelectorAll('button')].find(button => button.textContent === 'Open NIfTI');
        return (open && !open.disabled) || document.querySelector('[role=alert]');
      }, null, { timeout: 30_000 });
      result.capabilities = await page.evaluate(async () => {
        const adapter = await navigator.gpu?.requestAdapter();
        return { userAgent: navigator.userAgent, webgpu: !!navigator.gpu, adapter: !!adapter, features: adapter ? [...adapter.features] : [] };
      });
      const alert = page.getByRole('alert');
      if (await alert.count()) {
        result.startupError = await alert.innerText();
        result.recoveryOffered = await page.getByRole('button', { name: 'Restart viewer', exact: true }).isVisible();
      } else {
        await page.getByLabel('Choose NIfTI file', { exact: true }).setInputFiles(resolve('test-data/browser/oblique.nii'));
        await page.waitForFunction(() => Number(document.querySelector('main')?.getAttribute('data-frame-revision')) > 0);
        if (await alert.count()) throw new Error(await alert.innerText());
        const data = await page.getByRole('region', { name: 'axial slice' }).locator('canvas').evaluate(canvas => {
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          return { width: canvas.width, height: canvas.height, nonzero: pixels.some((value, i) => i % 4 !== 3 && value !== 0) };
        });
        if (!data.nonzero) throw new Error('No nonzero rendered image pixels');
        result.image = data;
        await page.screenshot({ path: resolve(output, `${engine}.png`) });
        await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
        if (await page.getByRole('button', { name: 'Unload oblique.nii', exact: true }).count()) throw new Error('Image retained after reset');
        result.renderingQualified = true;
      }
    } catch (error) {
      result.error = String(error);
    } finally {
      await browser?.close();
      results.push(result);
      writeFileSync(resolve(output, `${engine}.json`), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(result));
    }
  }
} finally {
  server.kill('SIGTERM');
  if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
  closeSync(log);
}
writeFileSync(resolve(output, 'matrix.json'), JSON.stringify(results, null, 2) + '\n');
