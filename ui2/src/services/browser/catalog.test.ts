import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserCatalog,
  fetchCatalogAsset,
  catalogLabelTable,
  type BrowserCatalogEntry,
} from './catalog';
import { BrowserSession } from './session';
import { describeSessionSource } from './sessionSources';
import { parseSessionRecord } from './sessionRecord';
import type { BrowserTransport } from './transport';
const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const entry: BrowserCatalogEntry = {
  id: 'test',
  kind: 'template',
  name: 'Public template',
  description: 'Fixture',
  space: 'Synthetic',
  citation: 'Synthetic fixture',
  volume: { url: 'https://example.org/image.nii', sha256: hash },
};
beforeEach(() => {
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => vi.unstubAllGlobals());
function host() {
  const transport = {
    request: vi.fn(async (cmd: string, args: { file: File }) =>
      cmd === 'describe_source'
        ? describeSessionSource(args.file)
        : {
            id: 'volume',
            name: args.file.name,
            dims: [2, 2, 2],
            center: [0, 0, 0],
            bounds: [
              [-1, -1, -1],
              [1, 1, 1],
            ],
            affine: [
              [1, 0, 0, 0],
              [0, 1, 0, 0],
              [0, 0, 1, 0],
              [0, 0, 0, 1],
            ],
            range: [0, 1],
            frameCount: 1,
            currentFrame: 0,
          },
    ),
    invoke: vi.fn(async () => null),
    dispose: vi.fn(),
  };
  return { transport, session: new BrowserSession(transport as unknown as BrowserTransport) };
}
describe('browser catalog acquisition', () => {
  it('exposes shared metadata and every Schaefer parcel/network/resolution combination', () => {
    expect(browserCatalog.filter((e) => e.kind === 'template')).toHaveLength(21);
    // Catalog entries without a checksum (not yet fetched from TemplateFlow) stay unavailable.
    for (const id of [
      'MNI152NLin2009cAsym_brain_1mm',
      'MNI152NLin2009cAsym_brain_2mm',
      'MNI152NLin2009cAsym_GM_2mm',
      'MNI152NLin2009cAsym_WM_2mm',
      'MNI152NLin2009cAsym_CSF_2mm',
    ]) {
      const entry = browserCatalog.find((e) => e.id === id);
      expect(entry?.unavailable, id).toBeTruthy();
      expect(entry?.volume.sha256, id).toBeUndefined();
    }
    expect(browserCatalog.filter((e) => e.id.startsWith('schaefer2018-'))).toHaveLength(40);
    expect(
      browserCatalog.find((e) => e.id === 'MNI152NLin2009cAsym_T1w_2mm')?.volume.sha256,
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(browserCatalog.find((e) => e.id === 'MNI305_T2w_native')?.unavailable).toBeTruthy();
  });
  it('rejects HTTP errors and excess streamed bytes, cancelling the reader', async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 })),
    );
    await expect(fetchCatalogAsset(entry.volume, abort.signal)).rejects.toThrow('HTTP 404');
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new Uint8Array(4));
              },
              cancel,
            }),
          ),
      ),
    );
    await expect(fetchCatalogAsset(entry.volume, abort.signal, 3)).rejects.toThrow('file size');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not load changed content and preserves provenance bound to the actual digest', async () => {
    const { session, transport } = host();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('abd')),
    );
    await session.loadCatalog(entry);
    expect(session.store.getState().error).toMatch(/checksum changed/);
    expect(transport.request.mock.calls.some(([cmd]) => cmd === 'load_file')).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('abc')),
    );
    await session.loadCatalog(entry);
    expect(session.store.getState().layers[0].catalog).toMatchObject({
      id: 'test',
      sha256: hash,
      url: entry.volume.url,
    });
    const saved = await session.saveRecord();
    expect(parseSessionRecord(JSON.stringify(saved)).volumes[0].catalog?.sha256).toBe(hash);
    saved.volumes[0].catalog!.sha256 = 'f'.repeat(64);
    expect(() => parseSessionRecord(JSON.stringify(saved))).toThrow();
    session.dispose();
  });
  it('refuses to overlay incompatible named reference spaces before acquisition', async () => {
    const { session } = host();
    const fetcher = vi.fn(async () => new Response('abc'));
    vi.stubGlobal('fetch', fetcher);
    await session.loadCatalog(entry);
    await session.loadCatalog({ ...entry, id: 'other', space: 'Different reference' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(session.store.getState().layers).toHaveLength(1);
    expect(session.store.getState().error).toContain('No registration is performed');
    session.dispose();
  });
  it('rejects a network response arriving after workspace reset', async () => {
    const { session, transport } = host();
    let complete!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      ),
    );
    const pending = session.loadCatalog(entry);
    await session.reset();
    complete(new Response('abc'));
    await pending;
    expect(session.store.getState().layers).toEqual([]);
    expect(transport.request).not.toHaveBeenCalled();
    expect(session.store.getState().loading).toBe(false);
    session.dispose();
  });
  it('retains physical line IDs when normalizing an indexed-by-line label source', async () => {
    expect(await catalogLabelTable('Left_V1\n\nRight_V1\n', 'names').text()).toBe(
      'index\tname\n1\tLeft_V1\n3\tRight_V1\n',
    );
  });
});
