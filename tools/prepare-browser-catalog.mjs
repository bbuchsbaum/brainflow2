/** Prepare verified public templates for static hosting; upstream S3 has no CORS. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(await readFile(resolve(root, 'core/templates/catalog.json'), 'utf8'));
const licenses = JSON.parse(await readFile(resolve(root, 'core/templates/licenses/index.json'), 'utf8'));
const output = resolve(root, 'ui2/public/catalog-assets');
await mkdir(output, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const prepared = [];
for (const entry of catalog) {
  const license = licenses[entry.config.space];
  if (!entry.checksum || !license) continue;
  const filename = `${entry.id}.nii.gz.bin`;
  const path = resolve(output, filename);
  let bytes = await readFile(path).catch(() => null);
  if (!bytes || sha256(bytes) !== entry.checksum) {
    const response = await fetch(entry.download_url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`${entry.id}: HTTP ${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 256 * 1024 * 1024) throw new Error(`${entry.id}: source exceeds 256 MiB`);
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    if (sha256(bytes) !== entry.checksum) throw new Error(`${entry.id}: upstream SHA-256 changed; review source before updating catalog`);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  }
  await copyFile(resolve(root, 'core/templates/licenses', license.file), resolve(output, license.file));
  prepared.push({ id: entry.id, filename, source: entry.download_url, sha256: entry.checksum, bytes: bytes.length, license });
}
await writeFile(resolve(output, 'provenance.json'), JSON.stringify(prepared, null, 2) + '\n');
console.log(`Verified ${prepared.length} public catalog templates (${prepared.reduce((n,e)=>n+e.bytes,0)} bytes); not service-worker cached.`);
