import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, statfsSync, existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const disk = statfsSync(root);
if (disk.bavail * disk.bsize < 20_000_000_000) throw new Error('At least 20 GB free is required before building.');
function run(command, args) {
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}
run(process.execPath, ['tools/prepare-browser-catalog.mjs']);
const generated = resolve(root, 'ui2/src/browser/generated');
mkdirSync(generated, { recursive: true });
run('cargo', ['build', '--locked', '--release', '-p', 'browser_host', '--lib', '--target', 'wasm32-unknown-unknown']);
run(process.env.WASM_BINDGEN ?? 'wasm-bindgen', [resolve(process.env.CARGO_TARGET_DIR ?? resolve(root, 'target'), 'wasm32-unknown-unknown/release/browser_host.wasm'), '--target', 'web', '--out-dir', generated]);
run('pnpm', ['--filter', '@brainflow/api', 'build']);
run('pnpm', ['--filter', '@brainflow/visualization', 'build']);
run('pnpm', ['--filter', 'temp-ui', 'exec', 'tsc', '-b']);
run('pnpm', ['--filter', 'temp-ui', 'exec', 'vite', 'build', '--config', 'vite.browser.config.ts']);
// Cache only immutable application assets, never selected neuroimaging files.
const output = resolve(root, 'ui2/dist-browser');
const assets = ['./browser.html', './browser/manifest.webmanifest', './browser/icon-192.png', './browser/icon-512.png', ...readdirSync(resolve(output, 'assets')).map(f => `./assets/${f}`)];
const revision = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const worker = readFileSync(resolve(root, 'ui2/public/browser/sw.js'), 'utf8')
  .replace('/* APP_ASSETS */ []', JSON.stringify(assets))
  .replace('APP_CACHE_VERSION', `${revision}-${Date.now()}`);
if (!existsSync(output)) throw new Error('Browser build output missing');
writeFileSync(resolve(output, 'browser-sw.js'), worker);

// The entry URL and every published byte are bound to the source checkout.
writeFileSync(resolve(output, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./browser.html"><title>Brainflow browser viewer</title><a href="./browser.html">Open Brainflow</a>');
const files = {};
function hashFiles(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) hashFiles(resolve(directory, entry.name), `${name}/`);
    else if (name !== 'build-info.json') {
      const bytes = readFileSync(resolve(directory, entry.name));
      files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
  }
}
hashFiles(output);
const sourceRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const sourceDirty = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim().length > 0;
writeFileSync(resolve(output, 'build-info.json'), JSON.stringify({ sourceRevision, sourceDirty, builtAt: new Date().toISOString(), files }, null, 2) + '\n');
