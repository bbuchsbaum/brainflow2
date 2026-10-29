import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeSessionSource,
  isSessionSource,
  matchSessionSources,
  MAX_SESSION_SOURCE_BYTES,
} from './sessionSources';

beforeEach(() => {
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

describe('portable session source identity', () => {
  it('hashes actual bytes against a known SHA-256 vector', async () => {
    expect(await describeSessionSource(new File(['abc'], 'source.nii'))).toEqual({
      name: 'source.nii',
      size: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
  });

  it('accepts renamed content and refuses same-name, same-size changed content', async () => {
    const original = await describeSessionSource(new File(['abc'], 'source.nii'));
    const renamed = new File(['abc'], 'renamed.nii');
    const changed = new File(['abd'], 'source.nii');
    const candidates = [
      { file: changed, source: await describeSessionSource(changed) },
      { file: renamed, source: await describeSessionSource(renamed) },
    ];
    expect(matchSessionSources([original, original], candidates)).toEqual([renamed, renamed]);
    expect(() => matchSessionSources([original], candidates.slice(0, 1))).toThrow(
      'original contents',
    );
  });

  it('rejects oversized files before allocating bytes', async () => {
    const file = new File([], 'large.nii');
    Object.defineProperty(file, 'size', { value: MAX_SESSION_SOURCE_BYTES + 1 });
    const read = vi.spyOn(file, 'arrayBuffer');
    await expect(describeSessionSource(file)).rejects.toThrow('256 MiB');
    expect(read).not.toHaveBeenCalled();
  });

  it('cancels before reading and rejects a read that finishes after cancellation', async () => {
    const file = new File(['abc'], 'source.nii');
    const read = vi.spyOn(file, 'arrayBuffer');
    await expect(describeSessionSource(file, () => true)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(read).not.toHaveBeenCalled();
    let cancelled = false;
    read.mockImplementationOnce(async () => {
      cancelled = true;
      return new ArrayBuffer(3);
    });
    await expect(describeSessionSource(file, () => cancelled)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects malformed and out-of-budget identities', () => {
    const valid = { name: 'source.nii', size: 3, sha256: 'a'.repeat(64) };
    expect(isSessionSource(valid)).toBe(true);
    for (const invalid of [
      null,
      {},
      { ...valid, sha256: 'abc' },
      { ...valid, size: -1 },
      { ...valid, size: 1.5 },
      { ...valid, size: MAX_SESSION_SOURCE_BYTES + 1 },
    ]) {
      expect(isSessionSource(invalid)).toBe(false);
    }
  });
});
